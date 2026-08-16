import { sql } from "drizzle-orm";
import { cards, rawPrices } from "@/db/schema";
import type { Db } from "@/db/client";

export type PokeApiCard = {
  id: string;
  name: string;
  number: string;
  set: { name: string; releaseDate?: string };
  tcgplayer?: { prices?: Record<string, { market?: number | null }> };
};

function bestMarketCents(c: PokeApiCard): number | null {
  const variants = Object.values(c.tcgplayer?.prices ?? {});
  const markets = variants
    .map((v) => v.market)
    .filter((m): m is number => typeof m === "number");
  if (markets.length === 0) return null;
  return Math.round(Math.max(...markets) * 100);
}

export async function syncPokemonPage(db: Db, page: PokeApiCard[]) {
  let upsertedCards = 0,
    pricedCards = 0;
  for (const c of page) {
    const [row] = await db
      .insert(cards)
      .values({
        game: "pokemon",
        name: c.name,
        setName: c.set.name,
        cardNumber: c.number,
        year: c.set.releaseDate ? Number(c.set.releaseDate.slice(0, 4)) : null,
        externalIds: { pokemontcgio: c.id },
        createdFrom: "catalog",
      })
      .onConflictDoUpdate({
        target: [cards.game, cards.setName, cards.cardNumber, cards.name, cards.variant],
        set: { externalIds: { pokemontcgio: c.id } },
      })
      .returning();
    upsertedCards++;
    const cents = bestMarketCents(c);
    if (cents !== null) {
      pricedCards++;
      await db
        .insert(rawPrices)
        .values({
          cardId: row.id,
          marketCents: cents,
          source: "pokemontcgio",
          asOf: new Date(),
        })
        .onConflictDoUpdate({
          target: [rawPrices.cardId, rawPrices.source],
          set: { marketCents: cents, asOf: sql`now()` },
        });
    }
  }
  return { upsertedCards, pricedCards };
}

// ~80 pages exist today; hard ceiling so an API paging bug can't spin the
// unattended sync forever. Restart after a fix is safe — upserts are idempotent.
const MAX_SYNC_PAGES = 300;

export async function runPokemonSync(db: Db, fetchImpl: typeof fetch = fetch) {
  const { env } = await import("@/lib/config");
  let pages = 0, upsertedCards = 0;
  for (let pageNum = 1; ; pageNum++) {
    if (pageNum > MAX_SYNC_PAGES)
      throw new Error(`pokemontcg.io sync exceeded ${MAX_SYNC_PAGES} pages — aborting (possible API paging bug)`);
    const res = await fetchImpl(
      `https://api.pokemontcg.io/v2/cards?page=${pageNum}&pageSize=250&select=id,name,number,set,tcgplayer`,
      { headers: { "X-Api-Key": env.POKEMONTCG_API_KEY } }
    );
    if (!res.ok) throw new Error(`pokemontcg.io ${res.status}`);
    const body = (await res.json()) as { data: PokeApiCard[] };
    if (body.data.length === 0) break;
    const r = await syncPokemonPage(db, body.data);
    upsertedCards += r.upsertedCards; pages++;
  }
  return { pages, upsertedCards };
}
