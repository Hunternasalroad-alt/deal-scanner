import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { recomputeReferences, scoreListing } from "@/lib/reference";
import { cards, comps, referencePrices } from "@/db/schema";

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
  const base = { grader: "PSA" as const, grade: "10" };
  it("prefers comp median", () =>
    expect(scoreListing({ ...base, totalCents: 400000, compMedianCents: 520000, rawMarketCents: 150000 }))
      .toEqual({ scoreBps: 2308, scoreBasis: "comp_median" }));
  it("falls back to the raw floor for a 10", () =>
    expect(scoreListing({ ...base, totalCents: 120000, rawMarketCents: 149924 }))
      .toEqual({ scoreBps: 1996, scoreBasis: "raw_floor" }));
  it("applies the 0.8 multiplier for a 9", () =>
    expect(scoreListing({ ...base, grade: "9", totalCents: 100000, rawMarketCents: 149924 }))
      .toEqual({ scoreBps: 1662, scoreBasis: "raw_floor" }));
  it("returns null with no usable basis", () => {
    expect(scoreListing({ ...base, grade: "8", totalCents: 1000, rawMarketCents: 5000 })).toBeNull();
    expect(scoreListing({ ...base, totalCents: 1000 })).toBeNull();
  });
  it("goes negative for overpriced listings", () =>
    expect(scoreListing({ ...base, totalCents: 600000, compMedianCents: 520000 })!.scoreBps).toBeLessThan(0));
});
