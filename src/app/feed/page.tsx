import { desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cards, listings } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const rows = await getDb()
    .select({ id: listings.ebayItemId, title: listings.title, grader: listings.grader, grade: listings.grade, price: listings.priceCents, conf: listings.matchConfidence, card: cards.name, scoreBps: listings.scoreBps, scoreBasis: listings.scoreBasis })
    .from(listings).leftJoin(cards, eq(listings.cardId, cards.id))
    .where(isNull(listings.dropReason)).orderBy(sql`${listings.scoreBps} desc nulls last`, desc(listings.firstSeen)).limit(100);
  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: 24 }}>
      <h1>Dry-run feed ({rows.length})</h1>
      <table cellPadding={6}>
        <thead><tr><th align="left">Card</th><th align="left">Title</th><th>Slab</th><th align="right">Price</th><th>Match</th><th align="right">Score</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.card ?? "—"}</td><td>{r.title}</td><td>{r.grader} {r.grade}</td>
              <td align="right">${(r.price / 100).toFixed(2)}</td><td>{r.conf}</td>
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
