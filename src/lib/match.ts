import { and, eq, ilike, or } from "drizzle-orm";
import { cards } from "@/db/schema";
import type { Db } from "@/db/client";
import type { Accepted } from "@/lib/normalize";
import { parseSportsTitle, setLabel } from "@/lib/sportsIdentity";

export type Game = "pokemon" | "baseball" | "basketball" | "football";
export type MatchResult = { cardId: number | null; confidence: "high" | "medium" | "low"; createdCard: boolean };

// Soak evidence (spec §14.3): substring .includes() let junk title tokens
// like "EN"/"2024"/"POKEMON" spuriously match unrelated card names. Whole-token
// comparison against a stoplist of graders, language markers, and hobby
// boilerplate fixes it. "vmax"/"vstar" are stoplisted too because they appear
// in card NAMES too broadly ("Umbreon VMAX" vs junk "VMAX Climax" set text) —
// the base species word is the discriminator.
const STOP_TOKENS = new Set([
  "en", "jp", "jpn", "japanese", "english", "psa", "bgs", "sgc", "cgc",
  "pokemon", "pokémon", "card", "cards", "tcg", "holo", "holofoil", "reverse",
  "rare", "ultra", "secret", "illustration", "special", "promo", "mint", "gem",
  "nm", "graded", "slab", "edition", "1st", "vmax", "vstar",
]);
const usableTokens = (tokens: string[]) =>
  tokens.filter((t) => t.length > 2 && !STOP_TOKENS.has(t.toLowerCase()) && !/^\d+$/.test(t));
const nameWords = (name: string) => new Set(name.toLowerCase().split(/[\s.,'&-]+/).filter(Boolean));

export async function matchListing(db: Db, game: Game, n: Accepted): Promise<MatchResult> {
  const { cardNumberHint, yearHint, nameTokens } = n.titleFacts;

  if (game === "pokemon") {
    if (cardNumberHint) {
      const byNumber = await db.select().from(cards).where(and(eq(cards.game, "pokemon"), eq(cards.cardNumber, cardNumberHint)));
      const usable = usableTokens(nameTokens);
      const nameHits = byNumber.filter((c) => {
        const words = nameWords(c.name);
        return usable.some((t) => words.has(t.toLowerCase()));
      });
      if (nameHits.length === 1) return { cardId: nameHits[0].id, confidence: "high", createdCard: false };
      if (byNumber.length === 1) return { cardId: byNumber[0].id, confidence: "medium", createdCard: false };
    }
    if (nameTokens.length >= 2) {
      const byName = await db
        .select().from(cards)
        .where(and(eq(cards.game, "pokemon"), or(...usableTokens(nameTokens).slice(0, 3).map((t) => ilike(cards.name, `%${t}%`)))))
        .limit(3);
      if (byName.length === 1) return { cardId: byName[0].id, confidence: "medium", createdCard: false };
    }
    return { cardId: null, confidence: "low", createdCard: false };
  }

  // sports (spec §17.1-2): identity comes from the deterministic title parser,
  // never from the raw token soup. No player or no number → low, no card.
  const parsed = parseSportsTitle(n.title);
  if (!parsed) return { cardId: null, confidence: "low", createdCard: false };
  const identity = {
    game, setName: setLabel(parsed.year, parsed.set), cardNumber: parsed.cardNumber,
    name: parsed.player, variant: parsed.variant,
  };
  const whereIdentity = and(
    eq(cards.game, game), eq(cards.setName, identity.setName), eq(cards.cardNumber, identity.cardNumber),
    eq(cards.name, identity.name), eq(cards.variant, identity.variant),
  );
  const existing = await db.select().from(cards).where(whereIdentity);
  if (existing.length === 1) return { cardId: existing[0].id, confidence: "high", createdCard: false };
  const [created] = await db.insert(cards).values({ ...identity, year: parsed.year, createdFrom: "firehose" }).onConflictDoNothing().returning();
  if (created) return { cardId: created.id, confidence: "medium", createdCard: true };
  const refound = await db.select().from(cards).where(whereIdentity);
  return refound.length === 1
    ? { cardId: refound[0].id, confidence: "high", createdCard: false }
    : { cardId: null, confidence: "low", createdCard: false };
}
