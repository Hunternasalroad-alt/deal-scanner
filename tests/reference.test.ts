import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/testDb";
import { collectPeerAsks, peerFloorCents, peerKey, recomputeReferences, rescoreActiveListings, scoreListing } from "@/lib/reference";
import { cards, comps, listings, referencePrices } from "@/db/schema";

describe("recomputeReferences", () => {
  it("medians 3+ comps in 30d and skips thin or stale groups", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" }).returning();
    const day = (n: number) => new Date(Date.now() - n * 86400_000);
    await db.insert(comps).values([
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 500000, soldAt: day(2), source: "auction_close", ebayItemId: "c1" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 520000, soldAt: day(5), source: "auction_close", ebayItemId: "c2" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 610000, soldAt: day(9), source: "bin_disappeared", ebayItemId: "c3" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 990000, soldAt: day(45), source: "auction_close", ebayItemId: "c4" }, // stale
      { cardId: card.id, grader: "BGS", grade: "9.5", soldPriceCents: 400000, soldAt: day(3), source: "auction_close", ebayItemId: "c5" }, // thin
    ]);
    const r = await recomputeReferences(db);
    expect(r.upserted).toBe(1);
    const [ref] = await db.select().from(referencePrices);
    expect(ref).toMatchObject({ grader: "PSA", grade: "10", valueCents: 520000, basis: "comp_median", compCount30d: 3 });
  });
});

describe("scoreListing", () => {
  it("prefers comp median over peer floor", () =>
    expect(scoreListing({ totalCents: 400000, compMedianCents: 520000, peerFloorCents: 150000 }))
      .toEqual({ scoreBps: 2308, scoreBasis: "comp_median" }));

  it("falls back to peer floor when no comp median", () =>
    expect(scoreListing({ totalCents: 120000, peerFloorCents: 149924 }))
      .toEqual({ scoreBps: 1996, scoreBasis: "peer_floor" }));

  it("scores negative when priced above the peer floor", () =>
    expect(scoreListing({ totalCents: 180000, peerFloorCents: 149924 }))
      .toEqual({ scoreBps: -2006, scoreBasis: "peer_floor" }));

  it("returns null with no usable basis", () => {
    expect(scoreListing({ totalCents: 1000 })).toBeNull();
    expect(scoreListing({ totalCents: 1000, compMedianCents: 0, peerFloorCents: 0 })).toBeNull();
    expect(scoreListing({ totalCents: 1000, peerFloorCents: null })).toBeNull();
  });

  it("clamps absurd ratios instead of overflowing int4", () => {
    expect(scoreListing({ totalCents: 99_900_000, peerFloorCents: 99 }))
      .toEqual({ scoreBps: -10_000_000, scoreBasis: "peer_floor" });
  });
});

it("peerFloorCents excludes self and requires 2 peers", () => {
  const asks = [
    { ebayItemId: "self", totalCents: 5000 },
    { ebayItemId: "a", totalCents: 10000 },
    { ebayItemId: "b", totalCents: 12000 },
  ];
  expect(peerFloorCents(asks, "self")).toBe(10000);
  expect(peerFloorCents([asks[0], asks[1]], "self")).toBeNull(); // 1 peer after self-exclusion
  expect(peerFloorCents(undefined, "self")).toBeNull();
});

it("collectPeerAsks returns only active high/medium BIN asks within the 14-day recency window, grouped by card|grader|grade", async () => {
  const { db } = await makeTestDb();
  const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "S", cardNumber: "161", createdFrom: "catalog" }).returning();
  const base = { cardId: card.id, categoryId: "183454", title: "t", grader: "PSA" as const, grade: "10", priceCents: 100000, shippingCents: 500 };
  await db.insert(listings).values([
    { ...base, ebayItemId: "bin-hi", listingType: "bin", matchConfidence: "high", status: "active" },
    { ...base, ebayItemId: "bin-med", listingType: "bin", matchConfidence: "medium", status: "active", priceCents: 120000, shippingCents: 0 },
    { ...base, ebayItemId: "auction", listingType: "auction", matchConfidence: "high", status: "active" },       // excluded: auction
    { ...base, ebayItemId: "bin-low", listingType: "bin", matchConfidence: "low", status: "active" },            // excluded: low confidence
    { ...base, ebayItemId: "bin-ended", listingType: "bin", matchConfidence: "high", status: "ended" },          // excluded: not active
    { ...base, ebayItemId: "bin-old", listingType: "bin", matchConfidence: "high", status: "active", firstSeen: new Date(Date.now() - 20 * 86400_000) }, // excluded: older than 14d
  ]);
  const map = await collectPeerAsks(db, [card.id]);
  const asks = map.get(peerKey(card.id, "PSA", "10"))!;
  expect(asks.map((a) => a.ebayItemId).sort()).toEqual(["bin-hi", "bin-med"]);
  expect(asks.find((a) => a.ebayItemId === "bin-hi")!.totalCents).toBe(100500); // price + shipping
});

it("rescoreActiveListings clears stale scores, applies peer floors, prefers comps, and skips unchanged rows", async () => {
  const { db } = await makeTestDb();
  const [card] = await db.insert(cards).values({ game: "pokemon", name: "Pikachu V", setName: "S4", cardNumber: "104", createdFrom: "catalog" }).returning();
  const base = { cardId: card.id, categoryId: "183454", grader: "PSA" as const, grade: "10", shippingCents: 0, listingType: "bin" as const, matchConfidence: "high" as const, status: "active" as const };

  // (a) legacy raw_floor score with no basis left → must be cleared
  await db.insert(listings).values({ ...base, ebayItemId: "stale", title: "stale", priceCents: 50000, scoreBps: 7781, scoreBasis: "raw_floor" });
  const first = await rescoreActiveListings(db);
  expect(first).toEqual({ rescored: 1, exhausted: true });
  const [cleared] = await db.select().from(listings).where(eq(listings.ebayItemId, "stale"));
  expect(cleared.scoreBps).toBeNull();
  expect(cleared.scoreBasis).toBeNull();

  // (b) two peers appear → "stale" gains a peer_floor score on the next pass
  await db.insert(listings).values([
    { ...base, ebayItemId: "p1", title: "p1", priceCents: 100000 },
    { ...base, ebayItemId: "p2", title: "p2", priceCents: 110000 },
  ]);
  const second = await rescoreActiveListings(db);
  expect(second.exhausted).toBe(true);
  const [scored] = await db.select().from(listings).where(eq(listings.ebayItemId, "stale"));
  expect(scored.scoreBasis).toBe("peer_floor");
  expect(scored.scoreBps).toBe(5000); // 1 - 50000/100000

  // (c) running again with nothing changed writes nothing
  expect((await rescoreActiveListings(db)).rescored).toBe(0);

  // (d) a comp-median reference outranks the peer floor
  const soldAt = new Date();
  await db.insert(comps).values([1, 2, 3].map((i) => ({
    cardId: card.id, grader: "PSA" as const, grade: "10", soldPriceCents: 200000, soldAt, source: "manual" as const, ebayItemId: `c${i}`,
  })));
  await recomputeReferences(db);
  await rescoreActiveListings(db);
  const [comped] = await db.select().from(listings).where(eq(listings.ebayItemId, "stale"));
  expect(comped.scoreBasis).toBe("comp_median");
  expect(comped.scoreBps).toBe(7500); // 1 - 50000/200000
});

it("rescoreActiveListings scores an auction against the BIN peer floor, and the auction never serves as a peer itself (spec §15.1)", async () => {
  const { db } = await makeTestDb();
  const [card] = await db.insert(cards).values({ game: "pokemon", name: "Charizard", setName: "S1", cardNumber: "6", createdFrom: "catalog" }).returning();
  const base = { cardId: card.id, categoryId: "183454", grader: "PSA" as const, grade: "10", shippingCents: 0, matchConfidence: "high" as const, status: "active" as const };

  // The auction is priced LOWEST of the three on purpose: if it ever leaked
  // into a peer set — its own (broken self-exclusion) or a BIN's (broken
  // listingType filter) — that leak would win the min() and change the
  // asserted numbers below, so a passing test proves both exclusions hold.
  await db.insert(listings).values([
    { ...base, ebayItemId: "auc", title: "auc", listingType: "auction", priceCents: 60000 },
    { ...base, ebayItemId: "bin1", title: "bin1", listingType: "bin", priceCents: 100000 },
    { ...base, ebayItemId: "bin2", title: "bin2", listingType: "bin", priceCents: 150000 },
  ]);

  await rescoreActiveListings(db);

  // Auction scored against the BIN floor (min(100000, 150000) = 100000), not
  // its own lower price: 1 - 60000/100000 = 0.4.
  const [auction] = await db.select().from(listings).where(eq(listings.ebayItemId, "auc"));
  expect(auction.scoreBasis).toBe("peer_floor");
  expect(auction.scoreBps).toBe(4000);

  // Each BIN has only the OTHER bin as a same-type peer (1, after self-exclusion)
  // — below MIN_PEERS — so both stay unscored. If the auction wrongly counted as
  // a second peer, either BIN would clear MIN_PEERS and pick up a score instead.
  const [bin1] = await db.select().from(listings).where(eq(listings.ebayItemId, "bin1"));
  const [bin2] = await db.select().from(listings).where(eq(listings.ebayItemId, "bin2"));
  expect(bin1.scoreBasis).toBeNull();
  expect(bin1.scoreBps).toBeNull();
  expect(bin2.scoreBasis).toBeNull();
  expect(bin2.scoreBps).toBeNull();
});

it("rescoreActiveListings honors the time guard", async () => {
  const { db } = await makeTestDb();
  expect(await rescoreActiveListings(db, { shouldContinue: () => false })).toEqual({ rescored: 0, exhausted: false });
});
