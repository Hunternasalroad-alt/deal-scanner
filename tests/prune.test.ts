import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/testDb";
import { listings } from "@/db/schema";
import { pruneDroppedListings } from "@/lib/prune";

describe("pruneDroppedListings", () => {
  it("nulls raw on dropped rows, deletes old dropped rows, leaves accepted rows alone", async () => {
    const { db } = await makeTestDb();
    const base = { categoryId: "183454", priceCents: 1000, shippingCents: 0, listingType: "bin" as const };
    const old = new Date(Date.now() - 10 * 86400_000);
    await db.insert(listings).values([
      // dropped, recent, raw present → raw nulled, row kept
      { ...base, ebayItemId: "d-recent", title: "d1", dropReason: "no_grader", raw: { big: "blob" } },
      // dropped, 10 days old → deleted
      { ...base, ebayItemId: "d-old", title: "d2", dropReason: "no_grader", raw: { big: "blob" }, firstSeen: old },
      // accepted (no dropReason), old, raw present → untouched
      { ...base, ebayItemId: "a-old", title: "a1", grader: "PSA", grade: "10", raw: { keep: "me" }, firstSeen: old },
    ]);
    const r = await pruneDroppedListings(db);
    expect(r.exhausted).toBe(true);
    expect(r.deleted).toBe(1);
    expect(r.rawsNulled).toBe(1); // d-old is deleted first; only d-recent needs nulling
    const [recent] = await db.select().from(listings).where(eq(listings.ebayItemId, "d-recent"));
    expect(recent.raw).toBeNull();
    expect(await db.select().from(listings).where(eq(listings.ebayItemId, "d-old"))).toEqual([]);
    const [kept] = await db.select().from(listings).where(eq(listings.ebayItemId, "a-old"));
    expect(kept.raw).toEqual({ keep: "me" });
  });

  it("honors the time guard", async () => {
    const { db } = await makeTestDb();
    expect(await pruneDroppedListings(db, { shouldContinue: () => false }))
      .toEqual({ rawsNulled: 0, deleted: 0, exhausted: false });
  });
});
