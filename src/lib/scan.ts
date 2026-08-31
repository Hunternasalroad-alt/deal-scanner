import { and, eq, inArray, sql } from "drizzle-orm";
import { CATEGORY_IDS } from "@/lib/ebay/categories";
import { BudgetExceededError, getTodaySpend, type getItemDetail, type searchNewlyListed } from "@/lib/ebay/client";
import { normalizeListing } from "@/lib/normalize";
import { matchListing, type Game } from "@/lib/match";
import { collectPeerAsks, peerFloorCents, peerKey, recomputeReferences, rescoreActiveListings, scoreListing } from "@/lib/reference";
import { sweepAgedBins, sweepEndedAuctions } from "@/lib/sweeps";
import { cursorState, deadLetters, listings, referencePrices, syncState } from "@/db/schema";
import type { Db } from "@/db/client";

const OVERLAP_MS = 10 * 60_000;
const FIRST_RUN_LOOKBACK_MS = 30 * 60_000;
const DETAIL_CAP_PER_CATEGORY = 8;
const DETAIL_MIN_PRICE_CENTS = 5000;
const MAX_PAGES_HARD = 20; // spec §14.1: page to the cursor; cap bounds a pathological gap

export type TickReport = {
  perCategory: Record<
    string,
    { fetched: number; accepted: number; dropped: number; detailFetches: number; pagesFetched: number; samplingGap: boolean }
  >;
  budgetStopped: boolean;
  // Present only once the corresponding phase actually starts (see the
  // POST_INGEST_BUDGET_MS wall-clock guard below) — each sub-key is
  // independently optional because the guard is checked separately before
  // each phase and a slow tick can run one sweep but not the other. Shapes
  // derived from the sweep functions themselves rather than duplicated, so a
  // future change to their return value can't silently drift out of sync
  // with this type.
  sweeps?: {
    auctions?: Awaited<ReturnType<typeof sweepEndedAuctions>>;
    bins?: Awaited<ReturnType<typeof sweepAgedBins>>;
  };
  referencesRecomputed?: number;
  // spec §15.3: rows re-scored by the nightly pass (present only when the nightly gate ran)
  rescored?: number;
};

// Derived timing budget (final review): the route's maxDuration is 120s (kept in
// sync manually — Next.js requires a static literal there). Ingestion yields at
// 75s so the post-ingestion phases always get a bounded window; a timed-out
// ingestion exits with `exhausted` still false, so the existing sampling_gap
// path records the bounded loss and the cursor still advances. This converts the
// former killed-mid-loop failure (frozen cursor, silent loss) into the designed
// observable-loss path.
export const TICK_MAX_DURATION_S = 120;
const INGEST_BUDGET_MS = 75_000;
const POST_INGEST_BUDGET_MS = (TICK_MAX_DURATION_S - 25) * 1000; // 95s for nightly + sweeps

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
  deps: { search: typeof searchNewlyListed; detail: typeof getItemDetail; now?: () => Date; clock?: () => number },
): Promise<TickReport> {
  const clock = deps.clock ?? Date.now;
  const tickStart = clock();
  const now = deps.now?.() ?? new Date();
  const report: TickReport = { perCategory: {}, budgetStopped: false };
  const withinPostIngestBudget = () => clock() - tickStart <= POST_INGEST_BUDGET_MS;

  for (const [categoryId, game] of GAMES) {
    const stats = { fetched: 0, accepted: 0, dropped: 0, detailFetches: 0, pagesFetched: 0, samplingGap: false };
    report.perCategory[categoryId] = stats;
    try {
      const [cursor] = await db.select().from(cursorState).where(eq(cursorState.categoryId, categoryId));
      const since = new Date((cursor?.lastItemTs.getTime() ?? now.getTime() - FIRST_RUN_LOOKBACK_MS) - OVERLAP_MS);
      let newestSeen = cursor?.lastItemTs ?? since;
      let exhausted = false;

      for (let page = 0; page < MAX_PAGES_HARD; page++) {
        // Ingestion time guard (final review, item a): every page after the
        // first re-checks the budget before paying for another eBay round
        // trip. Leaving `exhausted` false here routes a time-out through the
        // same sampling_gap dead-letter path as the page-cap case below.
        if (page > 0 && clock() - tickStart > INGEST_BUDGET_MS) break;
        const { items } = await deps.search(db, { categoryId, sinceIso: since.toISOString(), offset: page * 200 });
        stats.pagesFetched++;
        if (items.length === 0) { exhausted = true; break; }

        // Neon's http driver makes every DB call a full round trip — batch the
        // page's existence check and lastSeen refresh (2 round trips per page)
        // instead of paying 2 per item, or burst ticks blow the function's
        // maxDuration cap.
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

          // Compliance-by-construction: we claim eBay's marketplace-account-deletion
          // exemption on the basis that we store NO eBay user data. The Browse payload
          // includes the seller's username — strip the seller object before persisting.
          // The anonymous numeric feedback stats live in their own columns.
          const { seller: _stripSeller, ...rawForStorage } = item;

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
              dropReason: n.reason, raw: rawForStorage,
            }).onConflictDoNothing();
            continue;
          }

          const m = await matchListing(db, game, n);
          stats.accepted++;

          // Scoring (spec §15): comp median preferred, live peer-ask floor as
          // fallback. scoreListing itself is pure — all DB access for its
          // inputs lives here. The new listing isn't inserted yet, so the
          // peer set naturally excludes it; selfId is passed for symmetry
          // with the nightly re-score path.
          let scored: ReturnType<typeof scoreListing> = null;
          if ((m.confidence === "high" || m.confidence === "medium") && m.cardId !== null) {
            const cardId = m.cardId;
            const [ref] = await db
              .select()
              .from(referencePrices)
              .where(
                and(
                  eq(referencePrices.cardId, cardId),
                  eq(referencePrices.grader, n.grader),
                  eq(referencePrices.grade, n.grade ?? ""),
                ),
              );
            const peerAsks = await collectPeerAsks(db, [cardId]);
            scored = scoreListing({
              totalCents: n.priceCents + n.shippingCents,
              compMedianCents: ref?.valueCents ?? null,
              peerFloorCents: peerFloorCents(peerAsks.get(peerKey(cardId, n.grader, n.grade)), item.itemId),
            });
          }

          await db.insert(listings).values({
            ebayItemId: item.itemId, title: item.title, categoryId,
            cardId: m.cardId, matchConfidence: m.confidence,
            grader: n.grader, grade: n.grade, certNumber: n.certNumber,
            priceCents: n.priceCents, shippingCents: n.shippingCents, listingType: n.listingType,
            detailFetched: usedDetail,
            endTime: item.itemEndDate ? new Date(item.itemEndDate) : null,
            sellerFeedbackPct: item.seller?.feedbackPercentage ? Math.round(Number(item.seller.feedbackPercentage)) : null,
            sellerFeedbackCount: item.seller?.feedbackScore ?? null,
            scoreBps: scored?.scoreBps ?? null,
            scoreBasis: scored?.scoreBasis ?? null,
            raw: rawForStorage,
          }).onConflictDoNothing();
        }
        if (items.length < 200) { exhausted = true; break; }
      }

      if (!exhausted) {
        stats.samplingGap = true;
        await db.insert(deadLetters).values({
          kind: "sampling_gap",
          payload: { categoryId, since: since.toISOString(), newestSeen: newestSeen.toISOString() },
          error: `page cap ${MAX_PAGES_HARD} hit before exhausting results`,
        });
      }

      await db.insert(cursorState).values({ categoryId, lastItemTs: newestSeen })
        .onConflictDoUpdate({ target: cursorState.categoryId, set: { lastItemTs: newestSeen } });
    } catch (e) {
      if (e instanceof BudgetExceededError) { report.budgetStopped = true; break; }
      throw e;
    }
  }

  // Post-ingestion phases, in brief order: nightly reference recompute, then
  // the two comp-writing sweeps. Each phase independently re-checks both the
  // wall-clock budget and report.budgetStopped immediately before starting —
  // a BudgetExceededError from an earlier phase (or from the ingestion loop
  // above) must stop every phase still to come, not just the one that hit it.
  if (!report.budgetStopped && withinPostIngestBudget()) {
    try {
      const today = now.toISOString().slice(0, 10);
      const [state] = await db.select().from(syncState).where(eq(syncState.key, "referenceRecomputeDay"));
      const storedDay = typeof state?.value === "string" ? state.value : null;
      // spec §9: once per UTC day, and not before 9am UTC — gives the day's
      // comps (auction closes, BIN vanishes) time to land before the median
      // recompute draws from them.
      if (storedDay !== today && now.getUTCHours() >= 9) {
        const { upserted } = await recomputeReferences(db);
        report.referencesRecomputed = upserted;
        const { rescored } = await rescoreActiveListings(db, { shouldContinue: withinPostIngestBudget });
        report.rescored = rescored;
        await db
          .insert(syncState)
          .values({ key: "referenceRecomputeDay", value: today })
          .onConflictDoUpdate({ target: syncState.key, set: { value: today } });
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) report.budgetStopped = true;
      else
        await db.insert(deadLetters).values({
          kind: "nightly_recompute", payload: null, error: e instanceof Error ? e.message : String(e),
        });
    }
  }

  // Soft ceiling (final review, item f): once today's api_budget spend passes
  // this, skip both sweeps for the rest of the tick. Not a failure — normal
  // backpressure protecting next-day ingestion budget if the cron cadence ever
  // tightens — so report.sweeps simply stays undefined and no dead letter is
  // written. Computed once, like the other two guards, and reused by both
  // phase checks below.
  const SWEEP_SOFT_CEILING = 3_600;
  const underSweepCeiling = (await getTodaySpend(db)) <= SWEEP_SOFT_CEILING;

  if (!report.budgetStopped && underSweepCeiling && withinPostIngestBudget()) {
    try {
      report.sweeps = { ...report.sweeps, auctions: await sweepEndedAuctions(db, { detail: deps.detail }) };
    } catch (e) {
      if (e instanceof BudgetExceededError) report.budgetStopped = true;
      else
        await db.insert(deadLetters).values({
          kind: "auction_sweep", payload: null, error: e instanceof Error ? e.message : String(e),
        });
    }
  }

  if (!report.budgetStopped && underSweepCeiling && withinPostIngestBudget()) {
    try {
      report.sweeps = { ...report.sweeps, bins: await sweepAgedBins(db, { detail: deps.detail }) };
    } catch (e) {
      if (e instanceof BudgetExceededError) report.budgetStopped = true;
      else
        await db.insert(deadLetters).values({
          kind: "bin_sweep", payload: null, error: e instanceof Error ? e.message : String(e),
        });
    }
  }

  return report;
}
