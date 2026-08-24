import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { sweepEndedAuctions } from "@/lib/sweeps";
import { BudgetExceededError, EbayHttpError } from "@/lib/ebay/client";
import { cards, comps, deadLetters, listings } from "@/db/schema";

const auction = (id: string, endedMinsAgo: number, over: object = {}) => ({
  ebayItemId: id, title: `t-${id}`, categoryId: "183454", priceCents: 10000,
  listingType: "auction" as const, grader: "PSA" as const, grade: "10",
  endTime: new Date(Date.now() - endedMinsAgo * 60000), ...over,
});

describe("sweepEndedAuctions", () => {
  it("writes a comp for a bid-on ended auction and marks it sold_probable", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" }).returning();
    await db.insert(listings).values(auction("v1|a1|0", 30, { cardId: card.id }));
    const detail = vi.fn(async () => ({ itemId: "v1|a1|0", title: "t", itemCreationDate: "", buyingOptions: ["AUCTION"], currentBidPrice: { value: "142.50" }, bidCount: 7 }));
    const r = await sweepEndedAuctions(db, { detail: detail as never });
    expect(r).toEqual({ checked: 1, compsWritten: 1 });
    const [c] = await db.select().from(comps);
    expect(c).toMatchObject({ soldPriceCents: 14250, source: "auction_close", grader: "PSA" });
    const [l] = await db.select().from(listings);
    expect(l.status).toBe("sold_probable");
  });

  it("no bids → ended, no comp; 404 → ended too", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values([auction("v1|a2|0", 30), auction("v1|a3|0", 40)]);
    const detail = vi.fn()
      .mockResolvedValueOnce({ itemId: "v1|a3|0", title: "t", itemCreationDate: "", buyingOptions: ["AUCTION"], bidCount: 0 })
      .mockRejectedValueOnce(new EbayHttpError(404, "gone"));
    const r = await sweepEndedAuctions(db, { detail: detail as never });
    expect(r).toEqual({ checked: 2, compsWritten: 0 });
    const rows = await db.select().from(listings);
    expect(rows.every((x) => x.status === "ended")).toBe(true);
  });

  it("ignores active and future-ending auctions", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values(auction("v1|a4|0", -60)); // ends in an hour
    const detail = vi.fn();
    const r = await sweepEndedAuctions(db, { detail: detail as never });
    expect(r).toEqual({ checked: 0, compsWritten: 0 });
    expect(detail).not.toHaveBeenCalled();
  });

  it("respects the cap parameter", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values([auction("v1|c1|0", 10), auction("v1|c2|0", 20), auction("v1|c3|0", 30)]);
    const detail = vi.fn(async (_db: unknown, _itemId: string) => ({ itemId: "x", title: "t", itemCreationDate: "", buyingOptions: ["AUCTION"], bidCount: 0 }));
    const r = await sweepEndedAuctions(db, { detail: detail as never }, 2);
    expect(r).toEqual({ checked: 2, compsWritten: 0 });
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it("processes oldest endTime first", async () => {
    const { db } = await makeTestDb();
    // a5 ended 90 minutes ago (oldest), a6 ended 10 minutes ago (newest).
    await db.insert(listings).values([auction("v1|a6|0", 10), auction("v1|a5|0", 90)]);
    const detail = vi.fn(async (_db: unknown, _itemId: string) => ({ itemId: "x", title: "t", itemCreationDate: "", buyingOptions: ["AUCTION"], bidCount: 0 }));
    await sweepEndedAuctions(db, { detail: detail as never });
    expect(detail.mock.calls.map((c) => c[1])).toEqual(["v1|a5|0", "v1|a6|0"]);
  });

  it("an unexpected error dead-letters the listing and leaves it active for the next tick", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values(auction("v1|a7|0", 30));
    const detail = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const r = await sweepEndedAuctions(db, { detail: detail as never });
    expect(r).toEqual({ checked: 1, compsWritten: 0 });
    const [l] = await db.select().from(listings);
    expect(l.status).toBe("active");
    const [dl] = await db.select().from(deadLetters);
    expect(dl).toMatchObject({ kind: "auction_sweep" });
  });

  it("propagates BudgetExceededError instead of dead-lettering it", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values(auction("v1|a8|0", 30));
    const detail = vi.fn().mockRejectedValueOnce(new BudgetExceededError("daily budget 4800/4800"));
    await expect(sweepEndedAuctions(db, { detail: detail as never })).rejects.toBeInstanceOf(BudgetExceededError);
    const [l] = await db.select().from(listings);
    expect(l.status).toBe("active"); // sweep aborted mid-way; listing untouched
  });
});
