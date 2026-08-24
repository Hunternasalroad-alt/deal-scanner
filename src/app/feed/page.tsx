import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cards, comps, listings, rawPrices, referencePrices } from "@/db/schema";
import { GRADE_FLOOR_MULTIPLIER } from "@/lib/reference";
import { saleMetrics, type CompPoint, type SaleMetrics } from "@/lib/valuation";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const itemUrl = (id: string) => `https://www.ebay.com/itm/${id.split("|")[1] ?? id}`;
  const displayValue = (r: { refValueCents: number | null; rawMarketCents: number | null; grade: string | null }) => {
    if (r.refValueCents != null && r.refValueCents > 0) return { cents: r.refValueCents, basis: "comps" };
    const mult = r.grade != null ? GRADE_FLOOR_MULTIPLIER[r.grade] : undefined;
    if (mult != null && r.rawMarketCents != null && r.rawMarketCents > 0)
      return { cents: Math.round(r.rawMarketCents * mult), basis: "raw floor" };
    return null;
  };
  const db = getDb();
  const rows = await db
    .select({ id: listings.ebayItemId, title: listings.title, grader: listings.grader, grade: listings.grade, price: listings.priceCents, conf: listings.matchConfidence, cardId: listings.cardId, card: cards.name, scoreBps: listings.scoreBps, scoreBasis: listings.scoreBasis, refValueCents: referencePrices.valueCents, rawMarketCents: rawPrices.marketCents })
    .from(listings).leftJoin(cards, eq(listings.cardId, cards.id))
    .leftJoin(referencePrices, and(
      eq(referencePrices.cardId, listings.cardId),
      eq(referencePrices.grader, listings.grader),
      eq(referencePrices.grade, listings.grade),
    ))
    .leftJoin(rawPrices, eq(rawPrices.cardId, listings.cardId))
    .where(isNull(listings.dropReason)).orderBy(sql`${listings.scoreBps} desc nulls last`, desc(listings.firstSeen)).limit(100);

  // Observed-sale metrics (from comps — real closes/disappearances), separate from
  // the comp-median reference joined above. One extra query scoped to just the
  // cards on this page (no N+1), grouped in TS by cardId|grader|grade — same key
  // shape as reference.ts's recomputeReferences — so saleMetrics runs once per
  // group rather than once per row.
  const cardIds = [...new Set(rows.map((r) => r.cardId).filter((id): id is number => id != null))];
  const compRows = cardIds.length > 0
    ? await db
        .select({ cardId: comps.cardId, grader: comps.grader, grade: comps.grade, soldPriceCents: comps.soldPriceCents, soldAt: comps.soldAt })
        .from(comps)
        .where(inArray(comps.cardId, cardIds))
    : [];
  const compGroups = new Map<string, CompPoint[]>();
  for (const c of compRows) {
    if (c.cardId === null) continue; // narrows for TS; inArray(cardIds) above already excludes nulls
    const key = `${c.cardId}|${c.grader}|${c.grade}`;
    const points = compGroups.get(key);
    if (points) points.push({ soldPriceCents: c.soldPriceCents, soldAt: c.soldAt });
    else compGroups.set(key, [{ soldPriceCents: c.soldPriceCents, soldAt: c.soldAt }]);
  }
  const metricsByKey = new Map<string, SaleMetrics | null>();
  for (const [key, points] of compGroups) metricsByKey.set(key, saleMetrics(points, new Date()));

  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: 24 }}>
      <h1>Dry-run feed ({rows.length})</h1>
      <table cellPadding={6}>
        <thead><tr><th align="left">Card</th><th align="left">Title</th><th>Slab</th><th align="right">Price</th><th align="right">Value</th><th align="right">Last Sale</th><th align="right">Avg (3)</th><th align="right">Avg (5)</th><th align="right">Avg 90d</th><th>Match</th><th align="right">Score</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const m = metricsByKey.get(`${r.cardId}|${r.grader}|${r.grade ?? ""}`);
            return (
              <tr key={r.id}>
                <td>{r.card ?? "—"}</td><td><a href={itemUrl(r.id)} target="_blank" rel="noopener noreferrer">{r.title}</a></td><td>{r.grader} {r.grade}</td>
                <td align="right">${(r.price / 100).toFixed(2)}</td>
                <td align="right">{(() => { const v = displayValue(r); return v ? `$${(v.cents / 100).toFixed(2)} (${v.basis})` : "—"; })()}</td>
                <td align="right" title={m ? m.lastSaleAt.toISOString() : undefined}>{m ? `$${(m.lastSaleCents / 100).toFixed(2)}` : "—"}</td>
                <td align="right">{m?.avg3Cents != null ? `$${(m.avg3Cents / 100).toFixed(2)}` : "—"}</td>
                <td align="right">{m?.avg5Cents != null ? `$${(m.avg5Cents / 100).toFixed(2)}` : "—"}</td>
                <td align="right">{m?.avg90dCents != null ? `$${(m.avg90dCents / 100).toFixed(2)} (${m.count90d})` : "—"}</td>
                <td>{r.conf}</td>
                <td align="right">
                  {r.scoreBps != null
                    ? `${(r.scoreBps / 100).toFixed(2)}% (${r.scoreBasis === "comp_median" ? "comps" : "raw floor"})`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
