import { and, eq, ilike, or } from "drizzle-orm";
import { cards } from "@/db/schema";
import type { Db } from "@/db/client";
import type { Accepted } from "@/lib/normalize";

export type Game = "pokemon" | "baseball" | "basketball" | "football";
export type MatchResult = { cardId: number | null; confidence: "high" | "medium" | "low"; createdCard: boolean };

const titleCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

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
// spec §16.5b: player names legitimately carry two-letter tokens (CJ, Bo, Ja) —
// the general len>2 filter is for junk-token suppression in POKEMON name
// matching and must not erase them from sports card names. Digits and
// stoplisted hobby words still go.
const sportsNameTokens = (tokens: string[]) =>
  tokens.filter((t) => t.length >= 2 && !STOP_TOKENS.has(t.toLowerCase()) && !/^\d+$/.test(t));
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

  // sports
  // I2 (final review): a sports N/N is a serial print-run, not a card number — never treat it as identity.
  if (n.titleFacts.cardNumberFromFraction) return { cardId: null, confidence: "low", createdCard: false };
  if (yearHint && cardNumberHint && nameTokens.length >= 2) {
    const nameParts = sportsNameTokens(nameTokens).filter(
      (t) => !t.startsWith("#") && !/^\d+\/\d+$/.test(t) && t.toLowerCase() !== cardNumberHint.toLowerCase(),
    );
    // spec §16.5a: no usable name material → never insert an empty-name card;
    // the listing stores as low-confidence unmatched like any other.
    if (nameParts.length === 0) return { cardId: null, confidence: "low", createdCard: false };
    const name = nameParts.map(titleCase).join(" ");
    // I1 (final review): year is the sports set-analog — firehose sports rows
    // key their setName on it so a second year of the same player+number gets
    // its own identity-index row instead of silently colliding with (and then
    // failing to re-find) the first year's row.
    const setName = String(yearHint);
    const existing = await db
      .select().from(cards)
      .where(and(eq(cards.game, game), eq(cards.setName, setName), eq(cards.cardNumber, cardNumberHint), eq(cards.name, name)));
    if (existing.length === 1) return { cardId: existing[0].id, confidence: "high", createdCard: false };
    const [created] = await db
      .insert(cards)
      .values({ game, name, setName, year: yearHint, cardNumber: cardNumberHint, createdFrom: "firehose" })
      .onConflictDoNothing()
      .returning();
    if (created) return { cardId: created.id, confidence: "medium", createdCard: true };
    const refound = await db
      .select().from(cards)
      .where(and(eq(cards.game, game), eq(cards.setName, setName), eq(cards.cardNumber, cardNumberHint), eq(cards.name, name)));
    return refound.length === 1
      ? { cardId: refound[0].id, confidence: "high", createdCard: false }
      : { cardId: null, confidence: "low", createdCard: false };
  }
  return { cardId: null, confidence: "low", createdCard: false };
}
