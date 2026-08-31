// Pokémon catalog sync: fetches and upserts cards from pokemontcg.io (spec §15.5).
// Catalog-only — prices are never fetched or stored; valuation uses live eBay comps.

import { sql } from "drizzle-orm";
import { z } from "zod";
import { cards } from "@/db/schema";
import type { Db } from "@/db/client";

const pokeCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Deliberately tolerant: pokemontcg.io omits `number` for some promos — a
  // null/missing number is valid input, normalized to '' at the insert site below.
  number: z.string().nullish(),
  set: z.object({ name: z.string(), releaseDate: z.string().optional() }),
});

const pokePageSchema = z.object({ data: z.array(pokeCardSchema) });

export type PokeApiCard = z.infer<typeof pokeCardSchema>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// A card missing its `set` used to crash mid-sync with a bare TypeError deep in
// identityKey; a shape-drifted response body used to crash on `.data.length`.
// Both must fail loudly instead, naming the page and (when identifiable) card.
function parsePokePage(raw: unknown, page: number): PokeApiCard[] {
  const r = pokePageSchema.safeParse(raw);
  if (r.success) return r.data.data;

  const issue = r.error.issues[0];
  const cardIndex = issue.path[0] === "data" && typeof issue.path[1] === "number" ? issue.path[1] : undefined;
  const rawData = isRecord(raw) && Array.isArray(raw.data) ? raw.data : undefined;
  const rawCard = cardIndex !== undefined ? rawData?.[cardIndex] : undefined;
  const cardId = isRecord(rawCard) && typeof rawCard.id === "string" ? rawCard.id : undefined;
  const cardPart = cardId ? ` (card "${cardId}")` : "";

  throw new Error(
    `pokemontcg.io page ${page} failed validation${cardPart}: ${issue.path.join(".")} — ${issue.message}`,
  );
}

// Batched: 2 DB round trips per 250-card page instead of 1-2 per card. Over the
// Neon HTTP driver that is the difference between ~1 minute and ~1 hour for the
// full ~20k-card catalog (final-review requirement before the first live run).
const identityKey = (r: { setName: string | null; cardNumber: string | null | undefined; name: string }) =>
  `${r.setName ?? ""}|${r.cardNumber ?? ""}|${r.name}`;

export async function syncPokemonPage(db: Db, page: PokeApiCard[]) {
  if (page.length === 0) return { upsertedCards: 0 };

  // Dedupe within the page by identity key: two rows hitting the same index key
  // in one multi-row upsert make Postgres error ("cannot affect row a second time").
  const byKey = new Map<string, PokeApiCard>();
  for (const c of page) byKey.set(identityKey({ setName: c.set.name, cardNumber: c.number, name: c.name }), c);
  const unique = [...byKey.values()];

  const inserted = await db
    .insert(cards)
    .values(
      unique.map((c) => ({
        // The schema deliberately admits a null/missing number (promos) — it must
        // land as '' to hit the identity index's NOT NULL default, matching
        // identityKey's `?? ""` semantics.
        game: "pokemon" as const, name: c.name, setName: c.set.name, cardNumber: c.number ?? "",
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

  return { upsertedCards: inserted.length };
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
  // Resume support: against a flaky API, sequential-from-1 restarts can never
  // finish (observed: ~15 pages/attempt mean before failure vs 82 needed).
  // Upserts are idempotent, so overlapping restarts are safe.
  startPage = 1,
) {
  const { env } = await import("@/lib/config");
  let pages = 0, upsertedCards = 0;
  for (let pageNum = startPage; ; pageNum++) {
    if (pageNum > MAX_SYNC_PAGES)
      throw new Error(`pokemontcg.io sync exceeded ${MAX_SYNC_PAGES} pages — aborting (possible API paging bug)`);
    const res = await fetchWithRetry(
      `https://api.pokemontcg.io/v2/cards?page=${pageNum}&pageSize=250&select=id,name,number,set`,
      env.POKEMONTCG_API_KEY,
      fetchImpl,
    );
    const data = parsePokePage(await res.json(), pageNum);
    if (data.length === 0) break;
    const r = await syncPokemonPage(db, data);
    upsertedCards += r.upsertedCards; pages++;
    onPage?.({ page: pageNum, upsertedCards: r.upsertedCards, totalUpserted: upsertedCards });
  }
  return { pages, upsertedCards };
}
