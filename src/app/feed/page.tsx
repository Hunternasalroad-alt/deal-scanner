import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cards, listings, rawPrices, referencePrices } from "@/db/schema";
import { GRADE_FLOOR_MULTIPLIER } from "@/lib/reference";

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
  const rows = await getDb()
    .select({ id: listings.ebayItemId, title: listings.title, grader: listings.grader, grade: listings.grade, price: listings.priceCents, conf: listings.matchConfidence, card: cards.name, scoreBps: listings.scoreBps, scoreBasis: listings.scoreBasis, refValueCents: referencePrices.valueCents, rawMarketCents: rawPrices.marketCents })
    .from(listings).leftJoin(cards, eq(listings.cardId, cards.id))
    .leftJoin(referencePrices, and(
      eq(referencePrices.cardId, listings.cardId),
      eq(referencePrices.grader, listings.grader),
      eq(referencePrices.grade, listings.grade),
    ))
    .leftJoin(rawPrices, eq(rawPrices.cardId, listings.cardId))
    .where(isNull(listings.dropReason)).orderBy(sql`${listings.scoreBps} desc nulls last`, desc(listings.firstSeen)).limit(100);
  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: 24 }}>
      <h1>Dry-run feed ({rows.length})</h1>
      <table cellPadding={6}>
        <thead><tr><th align="left">Card</th><th align="left">Title</th><th>Slab</th><th align="right">Price</th><th align="right">Value</th><th>Match</th><th align="right">Score</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.card ?? "—"}</td><td><a href={itemUrl(r.id)} target="_blank" rel="noopener noreferrer">{r.title}</a></td><td>{r.grader} {r.grade}</td>
              <td align="right">${(r.price / 100).toFixed(2)}</td>
              <td align="right">{(() => { const v = displayValue(r); return v ? `$${(v.cents / 100).toFixed(2)} (${v.basis})` : "—"; })()}</td>
              <td>{r.conf}</td>
              <td align="right">
                {r.scoreBps != null
                  ? `${(r.scoreBps / 100).toFixed(2)}% (${r.scoreBasis === "comp_median" ? "comps" : "raw floor"})`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
