import { and, gte, isNotNull } from "drizzle-orm";
import { comps, referencePrices } from "@/db/schema";
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

// spec §9 floor rule. comp-median is the trusted reference when present: score
// = 1 - total/median, so a listing priced under the trailing comp median scores
// positive. Without a comp median, fall back to a fraction of raw market price
// (pokemontcg.io's near-mint raw price) — but only for grades we've calibrated a
// multiplier for; other grades have no floor to compare against and score null
// rather than guess. scoreBps is basis points (score * 10000) so callers never
// handle floating point directly; negative values are valid and mean the
// listing is priced above the reference (overpriced), not an error.
export function scoreListing(input: {
  totalCents: number;
  grader: "PSA" | "BGS" | "SGC";
  grade: string | null;
  compMedianCents?: number | null;
  rawMarketCents?: number | null;
}): { scoreBps: number; scoreBasis: "comp_median" | "raw_floor" } | null {
  const { totalCents, grade, compMedianCents, rawMarketCents } = input;

  if (compMedianCents != null)
    return { scoreBps: Math.round((1 - totalCents / compMedianCents) * 10000), scoreBasis: "comp_median" };

  if (grade !== null && grade in GRADE_FLOOR_MULTIPLIER && rawMarketCents != null) {
    const ref = rawMarketCents * GRADE_FLOOR_MULTIPLIER[grade];
    return { scoreBps: Math.round((1 - totalCents / ref) * 10000), scoreBasis: "raw_floor" };
  }

  return null;
}
