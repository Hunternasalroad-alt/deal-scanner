import { and, eq, ilike, or } from "drizzle-orm";
import { cards } from "@/db/schema";
import type { Db } from "@/db/client";
import type { Accepted } from "@/lib/normalize";

export type Game = "pokemon" | "baseball" | "basketball" | "football";
export type MatchResult = { cardId: number | null; confidence: "high" | "medium" | "low"; createdCard: boolean };

const titleCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

export async function matchListing(db: Db, game: Game, n: Accepted): Promise<MatchResult> {
  const { cardNumberHint, yearHint, nameTokens } = n.titleFacts;

  if (game === "pokemon") {
    if (cardNumberHint) {
      const byNumber = await db.select().from(cards).where(and(eq(cards.game, "pokemon"), eq(cards.cardNumber, cardNumberHint)));
      const nameHits = byNumber.filter((c) => nameTokens.some((t) => c.name.toLowerCase().includes(t.toLowerCase())));
      if (nameHits.length === 1) return { cardId: nameHits[0].id, confidence: "high", createdCard: false };
      if (byNumber.length === 1) return { cardId: byNumber[0].id, confidence: "medium", createdCard: false };
    }
    if (nameTokens.length >= 2) {
      const byName = await db
        .select().from(cards)
        .where(and(eq(cards.game, "pokemon"), or(...nameTokens.slice(0, 3).map((t) => ilike(cards.name, `%${t}%`)))))
        .limit(3);
      if (byName.length === 1) return { cardId: byName[0].id, confidence: "medium", createdCard: false };
    }
    return { cardId: null, confidence: "low", createdCard: false };
  }

  // sports
  if (yearHint && cardNumberHint && nameTokens.length >= 2) {
    const name = nameTokens.map(titleCase).join(" ");
    const existing = await db
      .select().from(cards)
      .where(and(eq(cards.game, game), eq(cards.year, yearHint), eq(cards.cardNumber, cardNumberHint), eq(cards.name, name)));
    if (existing.length === 1) return { cardId: existing[0].id, confidence: "high", createdCard: false };
    const [created] = await db
      .insert(cards)
      .values({ game, name, year: yearHint, cardNumber: cardNumberHint, createdFrom: "firehose" })
      .onConflictDoNothing()
      .returning();
    if (created) return { cardId: created.id, confidence: "medium", createdCard: true };
    const refound = await db
      .select().from(cards)
      .where(and(eq(cards.game, game), eq(cards.year, yearHint), eq(cards.cardNumber, cardNumberHint), eq(cards.name, name)));
    return refound.length === 1
      ? { cardId: refound[0].id, confidence: "high", createdCard: false }
      : { cardId: null, confidence: "low", createdCard: false };
  }
  return { cardId: null, confidence: "low", createdCard: false };
}
