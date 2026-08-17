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

// Batched: 2 DB round trips per 250-card page instead of 1-2 per card. Over the
// Neon HTTP driver that is the difference between ~1 minute and ~1 hour for the
// full ~20k-card catalog (final-review requirement before the first live run).
const identityKey = (r: { setName: string | null; cardNumber: string | null; name: string }) =>
  `${r.setName ?? ""}|${r.cardNumber ?? ""}|${r.name}`;

export async function syncPokemonPage(db: Db, page: PokeApiCard[]) {
  if (page.length === 0) return { upsertedCards: 0, pricedCards: 0 };

  // Dedupe within the page by identity key: two rows hitting the same index key
  // in one multi-row upsert make Postgres error ("cannot affect row a second time").
  const byKey = new Map<string, PokeApiCard>();
  for (const c of page) byKey.set(identityKey({ setName: c.set.name, cardNumber: c.number, name: c.name }), c);
  const unique = [...byKey.values()];

  const inserted = await db
    .insert(cards)
    .values(
      unique.map((c) => ({
        game: "pokemon" as const, name: c.name, setName: c.set.name, cardNumber: c.number,
        year: c.set.releaseDate ? Number(c.set.releaseDate.slice(0, 4)) : null,
        externalIds: { pokemontcgio: c.id }, createdFrom: "catalog" as const,
      })),
    )
    .onConflictDoUpdate({
      target: [cards.game, cards.setName, cards.cardNumber, cards.name, cards.variant],
      set: { externalIds: sql`excluded.external_ids` },
    })
    // Bare (no field list): `Db` is a NeonHttpDatabase | PgliteDatabase union, and
    // TS only resolves the zero-arg `returning()` overload consistently across a
    // union of insert builders — a `returning({...})` field selection fails to
    // typecheck here even though both drivers support it individually.
    .returning();

  const idByKey = new Map(inserted.map((r) => [identityKey(r), r.id]));
  const now = new Date();
  const priceRows = unique.flatMap((c) => {
    const cents = bestMarketCents(c);
    const cardId = idByKey.get(identityKey({ setName: c.set.name, cardNumber: c.number, name: c.name }));
    return cents !== null && cardId !== undefined
      ? [{ cardId, marketCents: cents, source: "pokemontcgio", asOf: now }]
      : [];
  });
  if (priceRows.length > 0)
    await db
      .insert(rawPrices)
      .values(priceRows)
      .onConflictDoUpdate({
        target: [rawPrices.cardId, rawPrices.source],
        set: { marketCents: sql`excluded.market_cents`, asOf: sql`excluded.as_of` },
      });

  return { upsertedCards: inserted.length, pricedCards: priceRows.length };
}

// ~80 pages exist today; hard ceiling so an API paging bug can't spin the
// unattended sync forever. Restart after a fix is safe — upserts are idempotent.
const MAX_SYNC_PAGES = 300;

// pokemontcg.io is a community API that intermittently 500/502s under load
// (observed live: the same URL returned 200, then 500 twice, seconds apart).
// A full sync must survive ~82 pages in one process, so each page fetch
// retries with escalating backoff before giving up.
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 20_000];

async function fetchWithRetry(url: string, apiKey: string, fetchImpl: typeof fetch): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers: { "X-Api-Key": apiKey } });
    if (res.ok) return res;
    if (attempt >= RETRY_DELAYS_MS.length)
      throw new Error(`pokemontcg.io ${res.status} after ${attempt + 1} attempts`);
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

export type SyncPageInfo = { page: number; upsertedCards: number; totalUpserted: number };

export async function runPokemonSync(
  db: Db,
  fetchImpl: typeof fetch = fetch,
  onPage?: (info: SyncPageInfo) => void,
) {
  const { env } = await import("@/lib/config");
  let pages = 0, upsertedCards = 0;
  for (let pageNum = 1; ; pageNum++) {
    if (pageNum > MAX_SYNC_PAGES)
      throw new Error(`pokemontcg.io sync exceeded ${MAX_SYNC_PAGES} pages — aborting (possible API paging bug)`);
    const res = await fetchWithRetry(
      `https://api.pokemontcg.io/v2/cards?page=${pageNum}&pageSize=250&select=id,name,number,set,tcgplayer`,
      env.POKEMONTCG_API_KEY,
      fetchImpl,
    );
    const body = (await res.json()) as { data: PokeApiCard[] };
    if (body.data.length === 0) break;
    const r = await syncPokemonPage(db, body.data);
    upsertedCards += r.upsertedCards; pages++;
    onPage?.({ page: pageNum, upsertedCards: r.upsertedCards, totalUpserted: upsertedCards });
  }
  return { pages, upsertedCards };
}
