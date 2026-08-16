import { eq, inArray, sql } from "drizzle-orm";
import { CATEGORY_IDS } from "@/lib/ebay/categories";
import { BudgetExceededError, type getItemDetail, type searchNewlyListed } from "@/lib/ebay/client";
import { normalizeListing } from "@/lib/normalize";
import { matchListing, type Game } from "@/lib/match";
import { cursorState, listings } from "@/db/schema";
import type { Db } from "@/db/client";

const OVERLAP_MS = 10 * 60_000;
const FIRST_RUN_LOOKBACK_MS = 30 * 60_000;
const DETAIL_CAP_PER_CATEGORY = 8;
const DETAIL_MIN_PRICE_CENTS = 5000;
const MAX_PAGES = 3;

export type TickReport = {
  perCategory: Record<string, { fetched: number; accepted: number; dropped: number; detailFetches: number }>;
  budgetStopped: boolean;
};

// Entries list, not an object literal: unverified sports IDs are all the literal
// "TBV" and would collapse into a single object key. Skipping them keeps ticks
// working (Pokémon-only) until the taxonomy verification step fills in real IDs.
const GAMES: [string, Game][] = (
  [
    [CATEGORY_IDS.pokemon, "pokemon"],
    [CATEGORY_IDS.baseball, "baseball"],
    [CATEGORY_IDS.basketball, "basketball"],
    [CATEGORY_IDS.football, "football"],
  ] as [string, Game][]
).filter(([id]) => id !== "TBV");

export async function runScanTick(
  db: Db,
  deps: { search: typeof searchNewlyListed; detail: typeof getItemDetail; now?: () => Date },
): Promise<TickReport> {
  const now = deps.now?.() ?? new Date();
  const report: TickReport = { perCategory: {}, budgetStopped: false };

  for (const [categoryId, game] of GAMES) {
    const stats = { fetched: 0, accepted: 0, dropped: 0, detailFetches: 0 };
    report.perCategory[categoryId] = stats;
    try {
      const [cursor] = await db.select().from(cursorState).where(eq(cursorState.categoryId, categoryId));
      const since = new Date((cursor?.lastItemTs.getTime() ?? now.getTime() - FIRST_RUN_LOOKBACK_MS) - OVERLAP_MS);
      let newestSeen = cursor?.lastItemTs ?? since;

      for (let page = 0; page < MAX_PAGES; page++) {
        const { items } = await deps.search(db, { categoryId, sinceIso: since.toISOString(), offset: page * 200 });
        if (items.length === 0) break;

        // Neon's http driver makes every DB call a full round trip — batch the
        // page's existence check and lastSeen refresh (2 round trips per page)
        // instead of paying 2 per item, or burst ticks blow the 60s function cap.
        const pageIds = items.map((i) => i.itemId);
        const existingRows = await db
          .select({ id: listings.ebayItemId })
          .from(listings)
          .where(inArray(listings.ebayItemId, pageIds));
        const existing = new Set(existingRows.map((r) => r.id));
        if (existing.size > 0)
          await db.update(listings).set({ lastSeen: sql`now()` }).where(inArray(listings.ebayItemId, [...existing]));

        for (const item of items) {
          stats.fetched++;
          const created = new Date(item.itemCreationDate);
          if (created > newestSeen) newestSeen = created;
          if (existing.has(item.itemId)) continue;

          let n = normalizeListing(item);
          let usedDetail = false;
          if (n.kind === "accepted" && (!n.grade || !n.certNumber) && n.priceCents >= DETAIL_MIN_PRICE_CENTS && stats.detailFetches < DETAIL_CAP_PER_CATEGORY) {
            stats.detailFetches++;
            try { n = normalizeListing(item, await deps.detail(db, item.itemId)); usedDetail = true; }
            catch (e) { if (e instanceof BudgetExceededError) throw e; /* detail failure: proceed with title-only */ }
          }

          if (n.kind === "dropped") {
            stats.dropped++;
            const rawCents = Number(item.price?.value);
            await db.insert(listings).values({
              ebayItemId: item.itemId, title: item.title, categoryId,
              // NaN guard: a malformed price string must not poison the insert and 500 the tick
              priceCents: Number.isFinite(rawCents) ? Math.round(rawCents * 100) : 0,
              listingType: item.buyingOptions.includes("AUCTION") ? "auction" : "bin",
              dropReason: n.reason, raw: item,
            }).onConflictDoNothing();
            continue;
          }

          const m = await matchListing(db, game, n);
          stats.accepted++;
          await db.insert(listings).values({
            ebayItemId: item.itemId, title: item.title, categoryId,
            cardId: m.cardId, matchConfidence: m.confidence,
            grader: n.grader, grade: n.grade, certNumber: n.certNumber,
            priceCents: n.priceCents, shippingCents: n.shippingCents, listingType: n.listingType,
            detailFetched: usedDetail,
            endTime: item.itemEndDate ? new Date(item.itemEndDate) : null,
            sellerFeedbackPct: item.seller?.feedbackPercentage ? Math.round(Number(item.seller.feedbackPercentage)) : null,
            sellerFeedbackCount: item.seller?.feedbackScore ?? null,
            raw: item,
          }).onConflictDoNothing();
        }
        if (items.length < 200) break;
      }

      await db.insert(cursorState).values({ categoryId, lastItemTs: newestSeen })
        .onConflictDoUpdate({ target: cursorState.categoryId, set: { lastItemTs: newestSeen } });
    } catch (e) {
      if (e instanceof BudgetExceededError) { report.budgetStopped = true; break; }
      throw e;
    }
  }
  return report;
}
