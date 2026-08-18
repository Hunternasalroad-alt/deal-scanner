import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { runScanTick } from "@/lib/scan";
import { cards, listings, cursorState } from "@/db/schema";
import { BudgetExceededError, type EbayItemSummary } from "@/lib/ebay/client";

const mk = (id: string, title: string, minsAgo: number, price = "150.00"): EbayItemSummary => ({
  itemId: id, title, itemCreationDate: new Date(Date.now() - minsAgo * 60000).toISOString(),
  price: { value: price }, buyingOptions: ["FIXED_PRICE"],
});

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
});
