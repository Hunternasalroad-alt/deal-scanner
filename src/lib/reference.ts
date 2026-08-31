import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { comps, listings, referencePrices } from "@/db/schema";
import type { Db } from "@/db/client";

const TRAILING_WINDOW_MS = 30 * 86400_000;
const MIN_COMPS = 3;

// spec §9: comp-median reference prices. scan.ts gates the recompute cadence
// (nightly, once per UTC day); this function just does the math. Only comps
// tied to a real card, within the trailing 30-day window, are grouped by
// (cardId, grader, grade); groups with fewer than 3 comps are too thin to
// trust and are skipped rather than upserted with a shaky value.
export async function recomputeReferences(db: Db): Promise<{ upserted: number }> {
  const cutoff = new Date(Date.now() - TRAILING_WINDOW_MS);
  const rows = await db
    .select({ cardId: comps.cardId, grader: comps.grader, grade: comps.grade, soldPriceCents: comps.soldPriceCents })
    .from(comps)
    .where(and(isNotNull(comps.cardId), gte(comps.soldAt, cutoff)));

  type Group = { cardId: number; grader: (typeof rows)[number]["grader"]; grade: string; prices: number[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (r.cardId === null) continue; // narrows for TS; the query above already filters these out
    const key = `${r.cardId}|${r.grader}|${r.grade}`;
    const g = groups.get(key);
    if (g) g.prices.push(r.soldPriceCents);
    else groups.set(key, { cardId: r.cardId, grader: r.grader, grade: r.grade, prices: [r.soldPriceCents] });
  }

  const now = new Date();
  let upserted = 0;
  for (const g of groups.values()) {
    if (g.prices.length < MIN_COMPS) continue;

    // Deterministic median, no interpolation: sort ascending, then take the
    // middle element for an odd count, or the LOWER of the two middle elements
    // for an even count (index n/2 - 1) — never an average of the two.
    const sorted = [...g.prices].sort((a, b) => a - b);
    const n = sorted.length;
    const median = n % 2 === 1 ? sorted[(n - 1) / 2] : sorted[n / 2 - 1];

    await db
      .insert(referencePrices)
      .values({
        cardId: g.cardId, grader: g.grader, grade: g.grade,
        valueCents: median, basis: "comp_median", compCount30d: g.prices.length, asOf: now,
      })
      .onConflictDoUpdate({
        target: [referencePrices.cardId, referencePrices.grader, referencePrices.grade],
        set: { valueCents: median, basis: "comp_median", compCount30d: g.prices.length, asOf: now },
      });
    upserted++;
  }

  return { upserted };
}

export const GRADE_FLOOR_MULTIPLIER: Record<string, number> = { "10": 1.0, "9.5": 0.8, "9": 0.8 };

// spec §15: peer-ask floor. A listing's peers are the OTHER active Buy-It-Now
// listings sharing (cardId, grader, grade) at high/medium match confidence.
// The floor is the minimum peer ask including shipping, and exists only with
// ≥2 peers — one lone ask never defines a market. Auctions are never peers
// (a mid-auction bid is not an ask).
export type PeerAsk = { ebayItemId: string; totalCents: number };

export const peerKey = (cardId: number, grader: string, grade: string | null) =>
  `${cardId}|${grader}|${grade ?? ""}`;

export async function collectPeerAsks(db: Db, cardIds: number[]): Promise<Map<string, PeerAsk[]>> {
  if (cardIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: listings.ebayItemId, cardId: listings.cardId, grader: listings.grader,
      grade: listings.grade, priceCents: listings.priceCents, shippingCents: listings.shippingCents,
    })
    .from(listings)
    .where(and(
      eq(listings.status, "active"),
      eq(listings.listingType, "bin"),
      inArray(listings.matchConfidence, ["high", "medium"]),
      inArray(listings.cardId, cardIds),
      isNotNull(listings.grader),
    ));
  const map = new Map<string, PeerAsk[]>();
  for (const r of rows) {
    if (r.cardId === null || r.grader === null) continue; // narrows for TS; the query already filters
    const key = peerKey(r.cardId, r.grader, r.grade);
    const ask = { ebayItemId: r.id, totalCents: r.priceCents + r.shippingCents };
    const asks = map.get(key);
    if (asks) asks.push(ask); else map.set(key, [ask]);
  }
  return map;
}

const MIN_PEERS = 2;

export function peerFloorCents(asks: PeerAsk[] | undefined, selfId: string): number | null {
  const peers = (asks ?? []).filter((a) => a.ebayItemId !== selfId);
  if (peers.length < MIN_PEERS) return null;
  return Math.min(...peers.map((a) => a.totalCents));
}

// spec §15 hierarchy: comp median (real observed sales) when present, else the
// live peer-ask floor, else unscored. scoreBps is basis points (score * 10000);
// negative values mean priced above the reference — valid, not an error.
export function scoreListing(input: {
  totalCents: number;
  compMedianCents?: number | null;
  peerFloorCents?: number | null;
}): { scoreBps: number; scoreBasis: "comp_median" | "peer_floor" } | null {
  const { totalCents, compMedianCents, peerFloorCents: floor } = input;
  if (compMedianCents != null && compMedianCents > 0)
    return { scoreBps: Math.round((1 - totalCents / compMedianCents) * 10000), scoreBasis: "comp_median" };
  if (floor != null && floor > 0)
    return { scoreBps: Math.round((1 - totalCents / floor) * 10000), scoreBasis: "peer_floor" };
  return null;
}

// spec §15.3: nightly re-score. Peer floors move as copies appear and sell,
// so scores written at ingest go stale — recompute every active, matched,
// graded listing against CURRENT comp references and peer floors, clearing
// scores whose basis has evaporated. Processes highest-current-score first so
// stale top-of-feed rows flush earliest if the guard stops us short; only
// changed rows are written (steady-state nights are nearly free). One update
// round trip per changed row is the Neon-HTTP-driver norm (no transactions).
export async function rescoreActiveListings(
  db: Db,
  opts?: { shouldContinue?: () => boolean },
): Promise<{ rescored: number; exhausted: boolean }> {
  const shouldContinue = opts?.shouldContinue ?? (() => true);
  // Checked before the query too, not only per-row below: an already-exhausted
  // budget shouldn't pay for the SELECT, and with zero active matched listings
  // the loop below never runs at all, so this is the only place that check
  // could ever fire.
  if (!shouldContinue()) return { rescored: 0, exhausted: false };

  const rows = await db
    .select({
      id: listings.ebayItemId, cardId: listings.cardId, grader: listings.grader, grade: listings.grade,
      priceCents: listings.priceCents, shippingCents: listings.shippingCents,
      scoreBps: listings.scoreBps, scoreBasis: listings.scoreBasis,
    })
    .from(listings)
    .where(and(
      eq(listings.status, "active"),
      isNotNull(listings.cardId),
      isNotNull(listings.grader),
      inArray(listings.matchConfidence, ["high", "medium"]),
    ))
    .orderBy(sql`${listings.scoreBps} desc nulls last`);

  const cardIds = [...new Set(rows.map((r) => r.cardId).filter((id): id is number => id !== null))];
  const peerMap = await collectPeerAsks(db, cardIds);
  const refs = cardIds.length > 0
    ? await db.select().from(referencePrices).where(inArray(referencePrices.cardId, cardIds))
    : [];
  const refByKey = new Map(refs.map((r) => [`${r.cardId}|${r.grader}|${r.grade}`, r.valueCents]));

  let rescored = 0;
  for (const r of rows) {
    if (!shouldContinue()) return { rescored, exhausted: false };
    if (r.cardId === null || r.grader === null) continue; // narrows for TS; the query already filters
    const key = peerKey(r.cardId, r.grader, r.grade);
    const scored = scoreListing({
      totalCents: r.priceCents + r.shippingCents,
      compMedianCents: refByKey.get(key) ?? null,
      peerFloorCents: peerFloorCents(peerMap.get(key), r.id),
    });
    const nextBps = scored?.scoreBps ?? null;
    const nextBasis = scored?.scoreBasis ?? null;
    if (nextBps === r.scoreBps && nextBasis === r.scoreBasis) continue;
    await db.update(listings).set({ scoreBps: nextBps, scoreBasis: nextBasis }).where(eq(listings.ebayItemId, r.id));
    rescored++;
  }
  return { rescored, exhausted: true };
}
