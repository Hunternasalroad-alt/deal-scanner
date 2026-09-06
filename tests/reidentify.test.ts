import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, type TestDb } from "./helpers/testDb";
import { cards, comps, listings, referencePrices } from "@/db/schema";
import { reidentifySports } from "@/lib/reidentify";

// Both listings below are the real ship-day soak titles for this card (spec
// §17.6's worked example): differently worded, same canonical identity.
const LISTING_BASE = {
  categoryId: "261328", game: "basketball" as const, grader: "PSA" as const,
  listingType: "bin" as const, shippingCents: 0, matchConfidence: "medium" as const,
};

// Seeds one legacy (pre-§17.1) basketball card — setName is a bare year,
// name is the old brand+player+team+"rookie" soup — with two accepted active
// listings pointing at it, one comp on the first listing, and a reference
// price row, all keyed to the legacy card. This is the exact shape backfill
// is meant to fix: one real card, forked across a wrong old identity.
async function seedLegacy(db: TestDb) {
  const [legacy] = await db.insert(cards).values({
    game: "basketball", setName: "2019", name: "Panini Prizm Ja Morant Grizzlies Rookie",
    cardNumber: "249", variant: "", year: 2019, createdFrom: "firehose",
  }).returning();

  await db.insert(listings).values([
    { ...LISTING_BASE, ebayItemId: "L1", title: "2019 Panini Prizm Ja Morant #249 PSA 10 Grizzlies RC", cardId: legacy.id, grade: "10", priceCents: 500000 },
    { ...LISTING_BASE, ebayItemId: "L2", title: "Ja Morant 2019-20 Prizm #249 Rookie PSA 9", cardId: legacy.id, grade: "9", priceCents: 300000 },
  ]);

  await db.insert(comps).values({
    cardId: legacy.id, grader: "PSA", grade: "10", soldPriceCents: 480000,
    soldAt: new Date(), source: "auction_close", ebayItemId: "L1",
  });

  await db.insert(referencePrices).values({
    cardId: legacy.id, grader: "PSA", grade: "10", valueCents: 480000,
    basis: "comp_median", compCount30d: 3, asOf: new Date(),
  });

  return legacy;
}

describe("reidentifySports", () => {
  it("re-points listings and the comp at one canonical card, deletes the orphaned legacy card and its reference row", async () => {
    const { db } = await makeTestDb();
    const legacy = await seedLegacy(db);

    const result = await reidentifySports(db);
    expect(result).toEqual({ listingsSeen: 2, listingsRepointed: 2, compsRepointed: 1, cardsCreated: 1, orphanCardsDeleted: 1, unparsed: 0 });

    const rows = await db.select().from(listings);
    expect(rows).toHaveLength(2);
    const cardIds = new Set(rows.map((r) => r.cardId));
    expect(cardIds.size).toBe(1); // both listings now share one card
    for (const r of rows) expect(r.matchConfidence).toBe("high");

    const [canonical] = await db.select().from(cards);
    expect(canonical).toMatchObject({ setName: "2019 Panini Prizm", name: "Ja Morant", cardNumber: "249", variant: "" });
    expect(canonical.id).not.toBe(legacy.id);

    const [comp] = await db.select().from(comps);
    expect(comp.cardId).toBe(canonical.id);

    expect(await db.select().from(cards).where(eq(cards.id, legacy.id))).toEqual([]);
    expect(await db.select().from(referencePrices).where(eq(referencePrices.cardId, legacy.id))).toEqual([]);
  });

  it("is idempotent: re-running on the already-backfilled data is a no-op", async () => {
    const { db } = await makeTestDb();
    await seedLegacy(db);
    await reidentifySports(db);

    const second = await reidentifySports(db);
    expect(second).toEqual({ listingsSeen: 2, listingsRepointed: 0, compsRepointed: 0, cardsCreated: 0, orphanCardsDeleted: 0, unparsed: 0 });
  });

  it("dry-run reports the same would-do counts but writes nothing", async () => {
    const { db } = await makeTestDb();
    const legacy = await seedLegacy(db);

    const result = await reidentifySports(db, { dryRun: true });
    expect(result).toEqual({ listingsSeen: 2, listingsRepointed: 2, compsRepointed: 1, cardsCreated: 1, orphanCardsDeleted: 0, unparsed: 0 });

    expect(await db.select().from(cards)).toHaveLength(1); // no canonical card created
    const rows = await db.select().from(listings);
    for (const r of rows) {
      expect(r.cardId).toBe(legacy.id);
      expect(r.matchConfidence).toBe("medium");
    }
    const [comp] = await db.select().from(comps);
    expect(comp.cardId).toBe(legacy.id);
  });

  it("leaves an unparseable title untouched and never deletes a referenced-free manual card", async () => {
    const { db } = await makeTestDb();
    const [manual] = await db.insert(cards).values({
      game: "basketball", setName: "2020 Panini Mosaic", name: "Lamelo Ball",
      cardNumber: "1", variant: "", year: 2020, createdFrom: "manual",
    }).returning();

    // No "#" and no bare digit token survives grade-stripping — the parser
    // has no card number to anchor on, so this title rejects outright.
    await db.insert(listings).values({
      ...LISTING_BASE, ebayItemId: "U1", title: "2020 Panini Mosaic Lamelo Ball Rookie Auto PSA 10",
      cardId: null, grade: "10", priceCents: 900000,
    });

    const result = await reidentifySports(db);
    expect(result).toEqual({ listingsSeen: 1, listingsRepointed: 0, compsRepointed: 0, cardsCreated: 0, orphanCardsDeleted: 0, unparsed: 1 });

    const [listing] = await db.select().from(listings).where(eq(listings.ebayItemId, "U1"));
    expect(listing.cardId).toBeNull();

    expect(await db.select().from(cards).where(eq(cards.id, manual.id))).toHaveLength(1);
  });
});
