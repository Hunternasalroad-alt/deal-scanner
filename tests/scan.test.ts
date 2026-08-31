import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { runScanTick } from "@/lib/scan";
import { apiBudget, cards, comps, cursorState, deadLetters, listings, referencePrices } from "@/db/schema";
import { BudgetExceededError, type EbayItemSummary } from "@/lib/ebay/client";

const mk = (id: string, title: string, minsAgo: number, price = "150.00"): EbayItemSummary => ({
  itemId: id, title, itemCreationDate: new Date(Date.now() - minsAgo * 60000).toISOString(),
  price: { value: price }, buyingOptions: ["FIXED_PRICE"],
});

const mkPage = (page: number, count: number): EbayItemSummary[] =>
  Array.from({ length: count }, (_, i) => mk(`v1|p${page}i${i}|0`, `Umbreon ex 161/131 PSA 10 lot ${page}-${i}`, page * 10 + 5));

describe("runScanTick", () => {
  it("ingests, drops scams, matches, is idempotent across double-run", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" });
    const search = vi.fn(async (_db, opts) =>
      opts.categoryId === "183454"
        ? {
            total: 2,
            items: [
              {
                ...mk("v1|a|0", "Umbreon ex 161/131 PSA 10", 5),
                seller: { username: "cardseller99", feedbackPercentage: "99.1", feedbackScore: 412 },
              },
              mk("v1|b|0", "Charizard PSA 10 candidate", 4),
            ],
          }
        : { total: 0, items: [] });
    const detail = vi.fn(async () => { throw new Error("no detail needed in this fixture"); });

    const r1 = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r1.perCategory["183454"]).toMatchObject({ fetched: 2, accepted: 1, dropped: 1, detailFetches: 1 });

    const rows = await db.select().from(listings);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.ebayItemId === "v1|a|0")?.matchConfidence).toBe("high");
    expect(rows.find((r) => r.ebayItemId === "v1|b|0")?.dropReason).toBe("raw_candidate_phrasing");
    expect(rows.find((r) => r.ebayItemId === "v1|a|0")?.sellerFeedbackPct).toBe(99);
    expect(rows.find((r) => r.ebayItemId === "v1|a|0")?.sellerFeedbackCount).toBe(412);
    expect((rows.find((r) => r.ebayItemId === "v1|a|0")!.raw as Record<string, unknown>).seller).toBeUndefined();

    const r2 = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(await db.select().from(listings)).toHaveLength(2); // no dupes
    expect((await db.select().from(cursorState)).length).toBeGreaterThan(0);
  });

  it("stops cleanly when the budget is exhausted", async () => {
    const { db } = await makeTestDb();
    const search = vi.fn(async () => { throw new BudgetExceededError("cap"); });
    const detail = vi.fn();
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.budgetStopped).toBe(true);
    expect(detail).not.toHaveBeenCalled();
  });

  it("never detail-fetches under the price floor", async () => {
    const { db } = await makeTestDb();
    const search = vi.fn(async (_db, opts) =>
      opts.categoryId === "183454"
        ? { total: 1, items: [mk("v1|cheap|0", "Squirtle PSA 10", 5, "40.00")] }
        : { total: 0, items: [] });
    const detail = vi.fn(async () => { throw new Error("must not be called"); });
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.perCategory["183454"]).toMatchObject({ accepted: 1, detailFetches: 0 });
    expect(detail).not.toHaveBeenCalled();
  });

  it("pages until the results run out and reports depth", async () => {
    const { db } = await makeTestDb();
    const search = vi.fn(async (_db, opts) => {
      if (opts.categoryId !== "183454") return { total: 0, items: [] };
      const page = opts.offset / 200;
      return page < 2 ? { total: 450, items: mkPage(page, 200) } : { total: 450, items: mkPage(2, 50) };
    });
    const detail = vi.fn(async () => { throw new Error("skip detail"); });
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.perCategory["183454"]).toMatchObject({ fetched: 450, pagesFetched: 3, samplingGap: false });
  });

  it("flags a sampling gap at the hard page cap and still advances the cursor", async () => {
    const { db } = await makeTestDb();
    const search = vi.fn(async (_db, opts) =>
      opts.categoryId === "183454"
        ? { total: 99999, items: mkPage(opts.offset / 200, 200) }
        : { total: 0, items: [] });
    const detail = vi.fn(async () => { throw new Error("skip detail"); });
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.perCategory["183454"]).toMatchObject({ pagesFetched: 20, samplingGap: true });
    const dl = await db.select().from(deadLetters);
    expect(dl.some((d) => d.kind === "sampling_gap")).toBe(true);
    expect((await db.select().from(cursorState)).length).toBeGreaterThan(0);
  });

  it("a short 20th page is clean exhaustion, not a gap", async () => {
    const { db } = await makeTestDb();
    const search = vi.fn(async (_db, opts) =>
      opts.categoryId === "183454"
        ? { total: 3950, items: mkPage(opts.offset / 200, opts.offset / 200 < 19 ? 200 : 150) }
        : { total: 0, items: [] });
    const detail = vi.fn(async () => { throw new Error("skip detail"); });
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.perCategory["183454"]).toMatchObject({ pagesFetched: 20, samplingGap: false });
    expect((await db.select().from(deadLetters)).filter((d) => d.kind === "sampling_gap")).toHaveLength(0);
  });

  it("yields ingestion at the time budget and records the gap", async () => {
    const { db } = await makeTestDb();
    let t = 0;
    const clock = () => t;
    const search = vi.fn(async (_db, opts) => {
      t += 40_000; // each page fetch "costs" 40s of wall clock
      return { total: 99999, items: mkPage(opts.offset / 200, 200) };
    });
    const detail = vi.fn(async () => { throw new Error("skip"); });
    const r = await runScanTick(db, { search: search as never, detail: detail as never, clock });
    expect(r.perCategory["183454"]).toMatchObject({ pagesFetched: 2, samplingGap: true }); // 40s, 80s → guard stops page 3
    expect((await db.select().from(deadLetters)).some((d) => d.kind === "sampling_gap")).toBe(true);
    expect((await db.select().from(cursorState)).length).toBeGreaterThan(0);
  });

  it("scores an accepted high-confidence listing against the live peer floor at ingest", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" }).returning();
    // Two live peer BIN asks define the floor (min incl. shipping = $1000.00);
    // the incoming listing at $1200.00 scores against it.
    await db.insert(listings).values([
      { ebayItemId: "peer-1", cardId: card.id, categoryId: "183454", title: "peer 1", grader: "PSA", grade: "10",
        priceCents: 100000, shippingCents: 0, listingType: "bin", matchConfidence: "high", status: "active" },
      { ebayItemId: "peer-2", cardId: card.id, categoryId: "183454", title: "peer 2", grader: "PSA", grade: "10",
        priceCents: 119000, shippingCents: 1000, listingType: "bin", matchConfidence: "medium", status: "active" },
    ]);
    const search = vi.fn(async (_db, opts) =>
      opts.categoryId === "183454"
        ? { total: 1, items: [mk("v1|score|0", "Umbreon ex 161/131 PSA 10", 5, "1200.00")] }
        : { total: 0, items: [] });
    const detail = vi.fn(async () => { throw new Error("no detail needed in this fixture"); });

    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.perCategory["183454"].accepted).toBe(1);

    const [row] = await db.select().from(listings).where(eq(listings.ebayItemId, "v1|score|0"));
    expect(row.scoreBasis).toBe("peer_floor");
    expect(row.scoreBps).toBe(-2000); // 1 - 120000/100000, in bps (floor 100000 from the two peer BINs)
  });

  it("recomputes references once per UTC day, only at/after 9am UTC", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" }).returning();
    const day = (n: number) => new Date(Date.now() - n * 86400_000);
    await db.insert(comps).values([
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 100000, soldAt: day(1), source: "auction_close", ebayItemId: "rc1" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 110000, soldAt: day(2), source: "auction_close", ebayItemId: "rc2" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 120000, soldAt: day(3), source: "auction_close", ebayItemId: "rc3" },
    ]);
    const search = vi.fn(async () => ({ total: 0, items: [] }));
    const detail = vi.fn(async () => { throw new Error("no detail needed in this fixture"); });

    const early = new Date();
    early.setUTCHours(8, 0, 0, 0);
    const r1 = await runScanTick(db, { search: search as never, detail: detail as never, now: () => early });
    expect(r1.referencesRecomputed).toBeUndefined();
    expect(await db.select().from(referencePrices)).toHaveLength(0);

    const due = new Date();
    due.setUTCHours(9, 30, 0, 0);
    const r2 = await runScanTick(db, { search: search as never, detail: detail as never, now: () => due });
    expect(r2.referencesRecomputed).toBe(1);
    expect(await db.select().from(referencePrices)).toHaveLength(1);

    const r3 = await runScanTick(db, { search: search as never, detail: detail as never, now: () => due });
    expect(r3.referencesRecomputed).toBeUndefined(); // already ran today
  });

  it("wires both sweeps into the tick after ingestion and reports their outcome", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values({
      ebayItemId: "v1|end|0", title: "t", categoryId: "183454", priceCents: 10000,
      listingType: "auction", grader: "PSA", grade: "10",
      endTime: new Date(Date.now() - 30 * 60000),
    });
    const search = vi.fn(async () => ({ total: 0, items: [] }));
    const detail = vi.fn(async () => ({ itemId: "x", title: "t", itemCreationDate: "", buyingOptions: ["AUCTION"], bidCount: 0 }));

    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.sweeps?.auctions).toEqual({ checked: 1, compsWritten: 0 });
    expect(r.sweeps?.bins).toEqual({ probed: 0, compsWritten: 0 });
  });

  it("skips both sweeps once today's api spend passes the soft ceiling", async () => {
    const { db } = await makeTestDb();
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(apiBudget).values({ day: today, kind: "search", count: 3_700 });
    const search = vi.fn(async () => ({ total: 0, items: [] }));
    const detail = vi.fn();
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.sweeps).toBeUndefined();
  });
});
