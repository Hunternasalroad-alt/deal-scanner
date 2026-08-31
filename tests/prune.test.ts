import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/testDb";
import { listings } from "@/db/schema";
import { PRUNE_BATCH, pruneDroppedListings } from "@/lib/prune";

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

  it("deletes old dropped rows across a full pass, and guards the batch size isn't set absurdly low", async () => {
    // Multi-batch behavior is itself size-parameter-internal (PRUNE_BATCH =
    // 1,000) and not worth a slow thousands-of-rows seed here — this just
    // guards against someone dropping PRUNE_BATCH to a footgun value.
    expect(PRUNE_BATCH).toBeGreaterThanOrEqual(100);

    const { db } = await makeTestDb();
    const base = { categoryId: "183454", priceCents: 1000, shippingCents: 0, listingType: "bin" as const };
    const old = new Date(Date.now() - 10 * 86400_000);
    await db.insert(listings).values(
      Array.from({ length: 5 }, (_, i) => ({ ...base, ebayItemId: `d-old-${i}`, title: `d${i}`, dropReason: "no_grader", firstSeen: old })),
    );
    const r = await pruneDroppedListings(db);
    expect(r).toEqual({ rawsNulled: 0, deleted: 5, exhausted: true });
  });

  it("stops mid-run when the guard trips between batches, before the null pass starts", async () => {
    const { db } = await makeTestDb();
    const base = { categoryId: "183454", priceCents: 1000, shippingCents: 0, listingType: "bin" as const };
    const old = new Date(Date.now() - 10 * 86400_000);
    await db.insert(listings).values([
      { ...base, ebayItemId: "d-old", title: "old", dropReason: "no_grader", firstSeen: old },
      { ...base, ebayItemId: "d-recent", title: "recent", dropReason: "no_grader", raw: { big: "blob" } },
    ]);
    // Call-count semantics of this implementation: call 1 is the pre-flight
    // check before the delete pass starts (must return true so the pass
    // begins); call 2 is the check after the delete pass's one and only batch
    // (must return false to trip there) — so `calls++ < 1` (true once, then
    // false) lands the trip exactly between the delete batch and the null
    // pass: the delete batch completes, the null pass never begins.
    let calls = 0;
    const r = await pruneDroppedListings(db, { shouldContinue: () => calls++ < 1 });
    expect(r).toEqual({ deleted: 1, rawsNulled: 0, exhausted: false });
    const [recent] = await db.select().from(listings).where(eq(listings.ebayItemId, "d-recent"));
    expect(recent.raw).toEqual({ big: "blob" }); // null pass never ran
  });
});
