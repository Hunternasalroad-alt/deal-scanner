import { and, asc, eq, lt, sql } from "drizzle-orm";
import { comps, deadLetters, listings } from "@/db/schema";
import type { Db } from "@/db/client";
import { BudgetExceededError, EbayHttpError, type getItemDetail } from "@/lib/ebay/client";

// spec §14.4(a): auctions whose end_time has passed get one detail fetch to
// read final bid state. Bid activity present → record a real comp at the
// final bid price. No bids → ended-unsold, no comp. The item detail payload
// is used transiently for this bid check only and is never persisted (it may
// carry seller identifiers upstream — same scrub invariant as scan.ts).
export async function sweepEndedAuctions(
  db: Db,
  deps: { detail: typeof getItemDetail },
  cap = 10,
): Promise<{ checked: number; compsWritten: number }> {
  const candidates = await db
    .select()
    .from(listings)
    .where(and(eq(listings.listingType, "auction"), eq(listings.status, "active"), lt(listings.endTime, sql`now()`)))
    .orderBy(asc(listings.endTime))
    .limit(cap);

  let compsWritten = 0;

  for (const row of candidates) {
    // Invariant: the WHERE clause above only matches rows with a past
    // endTime. The one insert path that leaves endTime NULL — the
    // dropped/ungraded branch in scan.ts — also never sets grader, and a
    // NULL endTime can never satisfy `endTime < now()`. So every row reached
    // here came through the accepted-listing path, which always sets both.
    const endTime = row.endTime!;
    const grader = row.grader!;

    try {
      const detail = await deps.detail(db, row.ebayItemId);
      const bidValue = detail.currentBidPrice ? Number(detail.currentBidPrice.value) : NaN;
      const sold = (detail.bidCount ?? 0) > 0 && Number.isFinite(bidValue);

      if (sold) {
        const inserted = await db
          .insert(comps)
          .values({
            cardId: row.cardId,
            grader,
            grade: row.grade ?? "",
            soldPriceCents: Math.round(bidValue * 100),
            soldAt: endTime,
            source: "auction_close",
            ebayItemId: row.ebayItemId,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length > 0) compsWritten++;
        await db.update(listings).set({ status: "sold_probable" }).where(eq(listings.ebayItemId, row.ebayItemId));
      } else {
        await db.update(listings).set({ status: "ended" }).where(eq(listings.ebayItemId, row.ebayItemId));
      }
    } catch (e) {
      // A gone/removed item (404) or an ended auction eBay no longer serves
      // (410) is ended-unsold — same outcome as a resolved detail with no bids.
      if (e instanceof EbayHttpError && (e.status === 404 || e.status === 410)) {
        await db.update(listings).set({ status: "ended" }).where(eq(listings.ebayItemId, row.ebayItemId));
        continue;
      }
      if (e instanceof BudgetExceededError) throw e;
      // Anything else (network blip, unexpected HTTP status, parse failure):
      // record and move on. The listing stays "active" so the next tick retries it.
      await db.insert(deadLetters).values({
        kind: "auction_sweep",
        payload: { ebayItemId: row.ebayItemId },
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { checked: candidates.length, compsWritten };
}
