import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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

// spec §14.4(b): a BIN listing never has an end_time to poll, so vanishing
// (404/410, or eventually a detail response whose itemEndDate has passed) is
// the only sold signal. A vanish observed soon after firstSeen is treated as
// a sale at the listed price; a slow vanish is not — sellers commonly let BIN
// listings lapse or relist them, and that isn't a sale signal.
export async function sweepAgedBins(
  db: Db,
  deps: { detail: typeof getItemDetail },
  cap = 10,
): Promise<{ probed: number; compsWritten: number }> {
  const candidates = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.listingType, "bin"),
        eq(listings.status, "active"),
        lt(listings.firstSeen, sql`now() - interval '6 hours'`),
        // Only listings still inside the 48h comp-eligible window are worth
        // probing — a vanish observed past that window can no longer be
        // recorded as a comp (see recordVanished's withinSaleWindow below), so
        // probing it would just burn an eBay call for nothing. Status hygiene
        // for stale BINs (marking them "ended") is deferred to M3's bulk-expiry
        // sweep rather than done here.
        gt(listings.firstSeen, sql`now() - interval '48 hours'`),
        // Unlike sweepEndedAuctions' endTime filter, firstSeen is set on every
        // listing — including scan.ts's dropped/unmatched rows, which never get
        // a grader. Without this, an aged dropped BIN would become a candidate
        // here and blow up on comps.grader's NOT NULL constraint once vanished.
        isNotNull(listings.grader),
        or(isNull(listings.lastProbedAt), lt(listings.lastProbedAt, sql`now() - interval '12 hours'`)),
      ),
    )
    // Ordering trap: plain asc() is NULLS LAST in Postgres, which would starve
    // never-probed listings behind already-probed ones forever. The explicit
    // fragment below puts them first; within each tier, younger listings (later
    // firstSeen) go first — they have more of their 48h comp window left, so a
    // vanish for them is more likely to still be recordable by the time the cap
    // is reached.
    .orderBy(sql`${listings.lastProbedAt} asc nulls first`, desc(listings.firstSeen))
    .limit(cap);

  let compsWritten = 0;

  // Shared by both vanish-detection paths (thrown 404/410, and a detail body
  // whose itemEndDate has already passed): decide sale-vs-lapse from how long
  // after firstSeen the disappearance was observed, then write the outcome.
  const recordVanished = async (
    row: (typeof candidates)[number],
    grader: NonNullable<(typeof candidates)[number]["grader"]>,
  ): Promise<boolean> => {
    const withinSaleWindow = Date.now() - row.firstSeen.getTime() <= 48 * 3600_000;
    if (!withinSaleWindow) {
      await db.update(listings).set({ status: "ended" }).where(eq(listings.ebayItemId, row.ebayItemId));
      return false;
    }
    const inserted = await db
      .insert(comps)
      .values({
        cardId: row.cardId,
        grader,
        grade: row.grade ?? "",
        soldPriceCents: row.priceCents,
        soldAt: sql`now()`,
        source: "bin_disappeared",
        ebayItemId: row.ebayItemId,
      })
      .onConflictDoNothing()
      .returning();
    await db.update(listings).set({ status: "sold_probable" }).where(eq(listings.ebayItemId, row.ebayItemId));
    return inserted.length > 0;
  };

  for (const row of candidates) {
    const grader = row.grader!; // guaranteed by isNotNull(listings.grader) above

    try {
      // Stamp before the detail call, not after: a crash mid-fetch must not
      // leave lastProbedAt untouched, or this listing gets re-probed every tick.
      await db.update(listings).set({ lastProbedAt: sql`now()` }).where(eq(listings.ebayItemId, row.ebayItemId));

      const detail = await deps.detail(db, row.ebayItemId);
      const alreadyEnded = detail.itemEndDate !== undefined && new Date(detail.itemEndDate).getTime() <= Date.now();
      if (alreadyEnded && (await recordVanished(row, grader))) compsWritten++;
      // else: still purchasable — nothing else to do, lastProbedAt already refreshed.
    } catch (e) {
      // A gone/removed item (404) or a BIN listing eBay no longer serves (410)
      // is the same vanish signal as an itemEndDate already in the past.
      if (e instanceof EbayHttpError && (e.status === 404 || e.status === 410)) {
        if (await recordVanished(row, grader)) compsWritten++;
        continue;
      }
      if (e instanceof BudgetExceededError) throw e;
      // Anything else (network blip, unexpected HTTP status, parse failure):
      // record and move on. The listing stays "active" so the next tick retries it.
      await db.insert(deadLetters).values({
        kind: "bin_sweep",
        payload: { ebayItemId: row.ebayItemId },
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { probed: candidates.length, compsWritten };
}
