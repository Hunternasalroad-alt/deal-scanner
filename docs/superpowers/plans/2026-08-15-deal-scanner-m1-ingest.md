# Deal Scanner M1 — Ingest, Normalize, Match (dry-run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Next.js service that, every 5 minutes, ingests newly listed graded-card eBay listings (Pokémon, baseball, basketball, football), normalizes and matches them against a card catalog, and exposes a dry-run feed — no alerts yet.

**Architecture:** GitHub Actions cron → `POST /api/scan` on Vercel → eBay Browse API (search + selective item detail) → normalizer (graded-only filter, scam-phrase rejection) → deterministic matcher against a Postgres catalog (Pokémon seeded from pokemontcg.io; sports self-growing) → `listings` table → `/api/feed` + minimal feed page. Spec: `docs/superpowers/specs/2026-08-15-card-deal-scanner-design.md`.

**Tech Stack:** Next.js (App Router, latest) · TypeScript strict · pnpm · Drizzle ORM · Neon Postgres (prod) / PGlite (tests) · zod · vitest · GitHub Actions · Vercel.

## Global Constraints

- Graded cards only: grader ∈ {PSA, BGS, SGC}. Beckett Vintage (BVG) counts as BGS. Everything else is dropped at normalize time.
- The app never bids, buys, or messages sellers — no code path may call any eBay buy/offer endpoint.
- $0 subscriptions: free eBay tier only. Daily call budget hard-stops at 4,800 (M1 split: searches ≈1,700 · item details ≈2,000 · reserved for M2 auction-closes ≈600 · headroom ≈500).
- `DRY_RUN` defaults to `"1"` and M1 has no alert code at all.
- Secrets live only in env vars (`.env.local` locally, Vercel env in prod). Never committed; `.gitignore` covers `.env*`.
- All mutation routes require header `authorization: Bearer ${SCAN_SECRET}`.
- TDD per task: failing test → minimal code → pass → commit. Conventional commit messages.

---

### Task 0: User-owned accounts and keys (human task — no code)

**Files:** none (produces `.env.local` values used from Task 1 on).

**Interfaces:**
- Produces: working values for `DATABASE_URL`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `POKEMONTCG_API_KEY`, `SCAN_SECRET`.

The user (not the agent — account creation must be done by the human) completes:

- [ ] **Step 1: Neon** — https://neon.tech → sign up (free) → New Project `deal-scanner` (Postgres 17, default region) → copy the pooled connection string → this is `DATABASE_URL`.
- [ ] **Step 2: eBay developer** — https://developer.ebay.com → Register (free) → Your Account → Application Keysets → Create **Production** keyset → copy App ID (`EBAY_CLIENT_ID`) and Cert ID (`EBAY_CLIENT_SECRET`). No user tokens/redirect URLs needed (client-credentials only).
- [ ] **Step 3: pokemontcg.io** — https://dev.pokemontcg.io → sign up (free) → copy API key → `POKEMONTCG_API_KEY`.
- [ ] **Step 4: Scan secret** — run locally and save the output as `SCAN_SECRET`:

```bash
openssl rand -hex 32
```

- [ ] **Step 5:** Paste all five values into `Trading Cards/.env.local` in the form `NAME=value`, one per line (file created properly in Task 1; creating it early is fine).

---

### Task 1: Scaffold + validated config module

**Files:**
- Create: Next.js app scaffold at repo root (`package.json`, `src/app/...`), `src/lib/config.ts`, `tests/config.test.ts`, `.env.example`, `vitest.config.ts`
- Modify: `.gitignore` (ensure `.env*` and `.env.example` exception)

**Interfaces:**
- Produces: `env` object — `import { env } from "@/lib/config"` with fields `DATABASE_URL, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, POKEMONTCG_API_KEY, SCAN_SECRET: string`, `DRY_RUN: boolean` (default true), `EBAY_ENV: "PRODUCTION"`; and `loadEnv(source: Record<string, string | undefined>)` for tests.

- [ ] **Step 1: Scaffold** (accept defaults; no Tailwind needed for M1):

```bash
cd "/Users/enasalroad/Desktop/Software Projects/Trading Cards"
pnpm create next-app@latest . --ts --app --src-dir --no-tailwind --eslint --turbopack --import-alias "@/*"
pnpm add zod drizzle-orm @neondatabase/serverless
pnpm add -D vitest @electric-sql/pglite drizzle-kit dotenv
```

- [ ] **Step 2: vitest config** — create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Write the failing test** — `tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/config";

const good = {
  DATABASE_URL: "postgres://u:p@h/db",
  EBAY_CLIENT_ID: "id",
  EBAY_CLIENT_SECRET: "secret",
  POKEMONTCG_API_KEY: "k",
  SCAN_SECRET: "s".repeat(64),
};

describe("loadEnv", () => {
  it("parses a complete env and defaults DRY_RUN to true", () => {
    const env = loadEnv(good);
    expect(env.DRY_RUN).toBe(true);
    expect(env.EBAY_ENV).toBe("PRODUCTION");
  });
  it("respects DRY_RUN=0", () => {
    expect(loadEnv({ ...good, DRY_RUN: "0" }).DRY_RUN).toBe(false);
  });
  it("throws naming the missing var", () => {
    const { SCAN_SECRET: _omit, ...bad } = good;
    expect(() => loadEnv(bad)).toThrowError(/SCAN_SECRET/);
  });
});
```

- [ ] **Step 4: Run to verify it fails** — `pnpm test` → FAIL (`loadEnv` not found).
- [ ] **Step 5: Implement** — `src/lib/config.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  EBAY_CLIENT_ID: z.string().min(1),
  EBAY_CLIENT_SECRET: z.string().min(1),
  POKEMONTCG_API_KEY: z.string().min(1),
  SCAN_SECRET: z.string().min(32),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v !== "0"),
  EBAY_ENV: z.literal("PRODUCTION").default("PRODUCTION"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const missing = r.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  return r.data;
}

// Lazy AND per-field: each property validates on first ACCESS, independently.
// Importing this module must never throw (tests import it without env vars), and
// a consumer must only need the vars it actually touches — e.g. `sync:pokemon`
// needs DATABASE_URL + POKEMONTCG_API_KEY and must not fail because the eBay
// pair isn't filled in yet. Errors name the exact var. `loadEnv` (full parse)
// remains for tests and any future whole-app boot check.
const fieldCache = new Map<string, unknown>();
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;
    if (fieldCache.has(prop)) return fieldCache.get(prop);
    const field = schema.shape[prop as keyof typeof schema.shape];
    if (!field) return undefined;
    const r = field.safeParse(process.env[prop]);
    if (!r.success) throw new Error(`Invalid environment: ${prop}`);
    fieldCache.set(prop, r.data);
    return r.data;
  },
});

// Test seam: per-field cache must be resettable between tests that stub env vars.
export function resetEnvCacheForTests(): void {
  fieldCache.clear();
}
```

Additional test cases for `tests/config.test.ts` (import `env`, `resetEnvCacheForTests`; call `resetEnvCacheForTests()` plus `vi.unstubAllEnvs()` in an `afterEach`):

```ts
it("per-field access works when unrelated vars are missing", () => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@h/db");
  expect(env.DATABASE_URL).toBe("postgres://u:p@h/db"); // eBay vars absent — must not throw
});
it("accessing a missing field names exactly that field", () => {
  expect(() => env.EBAY_CLIENT_ID).toThrowError(/EBAY_CLIENT_ID/);
});
it("defaulted fields resolve without the var set", () => {
  expect(env.DRY_RUN).toBe(true);
  expect(env.EBAY_ENV).toBe("PRODUCTION");
});
```

- [ ] **Step 6: Run tests** — `pnpm test` → 3 PASS. Also `pnpm build` → compiles.
- [ ] **Step 7: Create `.env.example`** (names only, no values; one per line): `DATABASE_URL= EBAY_CLIENT_ID= EBAY_CLIENT_SECRET= POKEMONTCG_API_KEY= SCAN_SECRET= DRY_RUN=1`. Confirm `.gitignore` contains `.env*` and add line `!.env.example`.
- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold Next.js app with validated env config"
```

---

### Task 2: Database schema + clients (Neon prod, PGlite tests)

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `tests/helpers/testDb.ts`, `tests/schema.test.ts`, `drizzle.config.ts`

**Interfaces:**
- Produces: Drizzle tables `cards, rawPrices, listings, cursorState, apiBudget, deadLetters`; `getDb()` (prod, Neon http driver); `makeTestDb(): Promise<{ db: TestDb }>` (PGlite, schema pushed); type `TestDb`; `type Db = TestDb | ReturnType<typeof getDb>` exported from `src/db/client.ts` — all later DB-touching functions accept `db: Db` as their first parameter.

- [ ] **Step 1: Write schema** — `src/db/schema.ts`:

```ts
import {
  boolean, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const cards = pgTable(
  "cards",
  {
    id: serial("id").primaryKey(),
    game: text("game", { enum: ["pokemon", "baseball", "basketball", "football"] }).notNull(),
    name: text("name").notNull(),
    // Same NULLS-DISTINCT reasoning as `variant` below: this column sits in the
    // identity unique index, and sports rows have no set name — a NULL here would
    // make the index a no-op for them and let duplicate cards accumulate.
    setName: text("set_name").notNull().default(""),
    year: integer("year"),
    cardNumber: text("card_number"),
    // NOT NULL with '' default: this column sits in the identity unique index, and
    // Postgres treats NULLs as distinct — nullable here would break upsert idempotency.
    variant: text("variant").notNull().default(""),
    externalIds: jsonb("external_ids").$type<Record<string, string>>().default({}),
    createdFrom: text("created_from", { enum: ["catalog", "firehose", "manual"] }).notNull(),
  },
  (t) => [uniqueIndex("cards_identity").on(t.game, t.setName, t.cardNumber, t.name, t.variant)],
);

export const rawPrices = pgTable(
  "raw_prices",
  {
    cardId: integer("card_id").notNull().references(() => cards.id),
    marketCents: integer("market_cents").notNull(),
    source: text("source").notNull().default("pokemontcgio"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.source] })],
);

export const listings = pgTable("listings", {
  ebayItemId: text("ebay_item_id").primaryKey(),
  cardId: integer("card_id").references(() => cards.id),
  matchConfidence: text("match_confidence", { enum: ["high", "medium", "low"] }),
  grader: text("grader", { enum: ["PSA", "BGS", "SGC"] }),
  grade: text("grade"),
  certNumber: text("cert_number"),
  priceCents: integer("price_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull().default(0),
  listingType: text("listing_type", { enum: ["auction", "bin"] }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  sellerFeedbackPct: integer("seller_feedback_pct"),
  sellerFeedbackCount: integer("seller_feedback_count"),
  status: text("status", { enum: ["active", "ended", "sold_probable"] }).notNull().default("active"),
  categoryId: text("category_id").notNull(),
  title: text("title").notNull(),
  detailFetched: boolean("detail_fetched").notNull().default(false),
  dropReason: text("drop_reason"),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  raw: jsonb("raw").$type<unknown>(),
});

export const cursorState = pgTable("cursor_state", {
  categoryId: text("category_id").primaryKey(),
  lastItemTs: timestamp("last_item_ts", { withTimezone: true }).notNull(),
});

export const apiBudget = pgTable(
  "api_budget",
  {
    day: text("day").notNull(), // YYYY-MM-DD UTC
    kind: text("kind").notNull(), // search | detail
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.kind] })],
);

export const deadLetters = pgTable("dead_letters", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<unknown>(),
  error: text("error").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Clients** — `src/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "@/lib/config";
import * as schema from "./schema";

export function getDb() {
  return drizzle(neon(env.DATABASE_URL), { schema });
}
export type Db = ReturnType<typeof getDb> | import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
```

`tests/helpers/testDb.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

// drizzle-kit's pushSchema renders an unsuppressible progress spinner straight to
// process.stdout (hanji renderer, no quiet option), which would pollute every test
// run — mute stdout for exactly that call. Known caveat, accepted: hanji calls
// process.exit(1) if the push itself fails, which would kill the vitest worker
// instead of failing an assertion; if that ever bites, switch this helper to
// executing drizzle-kit-generated DDL instead.
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await quietly(async () => {
    const { pushSchema } = await import("drizzle-kit/api");
    const { apply } = await pushSchema(schema, db as never);
    await apply();
  });
  return { db };
}
export type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];
```

`drizzle.config.ts` (for prod migrations):

```ts
import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config({ path: ".env.local" }); // drizzle-kit runs outside Next.js — load the env file itself

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Add scripts: `"db:push": "drizzle-kit push"`.

- [ ] **Step 3: Write the failing test** — `tests/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { cards, listings } from "@/db/schema";

describe("schema", () => {
  it("round-trips a card and a listing", async () => {
    const { db } = await makeTestDb();
    const [card] = await db
      .insert(cards)
      .values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" })
      .returning();
    await db.insert(listings).values({
      ebayItemId: "v1|123|0", cardId: card.id, priceCents: 419900, listingType: "bin",
      categoryId: "183454", title: "PSA 10 Umbreon ex 161/131",
    });
    const rows = await db.select().from(listings);
    expect(rows).toHaveLength(1);
    expect(rows[0].cardId).toBe(card.id);
    expect(rows[0].status).toBe("active");
  });

  it("identity index dedupes rows relying on the '' defaults for set/variant", async () => {
    const { db } = await makeTestDb();
    const values = { game: "football", name: "Justin Herbert", year: 2020, cardNumber: "325", createdFrom: "firehose" } as const;
    const first = await db.insert(cards).values(values).onConflictDoNothing().returning();
    const second = await db.insert(cards).values(values).onConflictDoNothing().returning();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // conflict fired — no NULLS-DISTINCT escape hatch
    expect(await db.select().from(cards)).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run** — `pnpm test` → schema test FAILS first (missing helper/schema), then after implementation → PASS (schema push works in PGlite).
- [ ] **Step 5: Push schema to Neon** — `pnpm db:push` (uses `.env.local` via `dotenv -e` or exported var). Expected: tables created; verify with `psql` or Neon console showing 6 tables.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: drizzle schema, neon client, pglite test harness"`

---

### Task 3: Pokémon catalog sync (pokemontcg.io → cards + raw_prices)

**Files:**
- Create: `src/lib/pokemonSync.ts`, `tests/pokemonSync.test.ts`, `tests/fixtures/pokemontcgio-page.json`, `scripts/sync-pokemon.ts`

**Interfaces:**
- Consumes: `Db`, `cards`, `rawPrices` (Task 2).
- Produces: `syncPokemonPage(db: Db, page: PokeApiCard[]): Promise<{ upsertedCards: number; pricedCards: number }>` and `runPokemonSync(db: Db, fetchImpl?: typeof fetch): Promise<{ pages: number; upsertedCards: number }>` (pages through `https://api.pokemontcg.io/v2/cards?page=N&pageSize=250&select=id,name,number,set,tcgplayer`, header `X-Api-Key`). `PokeApiCard = { id: string; name: string; number: string; set: { name: string; releaseDate?: string }; tcgplayer?: { prices?: Record<string, { market?: number | null }> } }`.

- [ ] **Step 1: Fixture** — `tests/fixtures/pokemontcgio-page.json`: an array of 3 `PokeApiCard` objects: one with `tcgplayer.prices.holofoil.market: 1499.24`, one with only `normal.market: 2.5`, one with no tcgplayer block.
- [ ] **Step 2: Write the failing test** — `tests/pokemonSync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { syncPokemonPage } from "@/lib/pokemonSync";
import { cards, rawPrices } from "@/db/schema";
import page from "./fixtures/pokemontcgio-page.json";

describe("syncPokemonPage", () => {
  it("upserts cards, stores best market price in cents, is idempotent", async () => {
    const { db } = await makeTestDb();
    const first = await syncPokemonPage(db, page as never);
    expect(first.upsertedCards).toBe(3);
    expect(first.pricedCards).toBe(2);
    const again = await syncPokemonPage(db, page as never);
    expect(again.upsertedCards).toBe(3); // upsert, not duplicate
    expect(await db.select().from(cards)).toHaveLength(3);
    const prices = await db.select().from(rawPrices);
    expect(prices.find((p) => p.marketCents === 149924)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run** — FAIL (`syncPokemonPage` missing).
- [ ] **Step 4: Implement** — `src/lib/pokemonSync.ts`:

```ts
import { sql } from "drizzle-orm";
import { cards, rawPrices } from "@/db/schema";
import type { Db } from "@/db/client";

export type PokeApiCard = {
  id: string; name: string; number: string;
  set: { name: string; releaseDate?: string };
  tcgplayer?: { prices?: Record<string, { market?: number | null }> };
};

function bestMarketCents(c: PokeApiCard): number | null {
  const variants = Object.values(c.tcgplayer?.prices ?? {});
  const markets = variants.map((v) => v.market).filter((m): m is number => typeof m === "number");
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
    .returning({ id: cards.id, name: cards.name, setName: cards.setName, cardNumber: cards.cardNumber });

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
```

- [ ] **Step 4b: Loop-bound test** — add to `tests/pokemonSync.test.ts` (uses the first fixture card only, so the 300 bounded iterations stay fast):

```ts
it("aborts if the API pages forever", async () => {
  const { db } = await makeTestDb();
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [page[0]] }) } as never);
  await expect(runPokemonSync(db, f as never)).rejects.toThrow(/exceeded 300 pages/);
});
```

(Add `vi` to the vitest import and `runPokemonSync` to the module import; `POKEMONTCG_API_KEY` must come from a stubbed env — set `process.env` keys for the five required vars at the top of this test via `vi.stubEnv`, or the lazy config proxy will throw on first access.)

- [ ] **Step 5: Run tests** — PASS.
- [ ] **Step 6: CLI script** — `scripts/sync-pokemon.ts`:

```ts
import { getDb } from "@/db/client";
import { runPokemonSync } from "@/lib/pokemonSync";

// Progress logging lives HERE (CLI), passed as a callback — the library stays
// silent so test output stays pristine.
runPokemonSync(getDb(), fetch, (p) =>
  console.log(`page ${p.page}: +${p.upsertedCards} cards (${p.totalUpserted} total)`),
)
  .then((r) => console.log(`synced ${r.upsertedCards} cards over ${r.pages} pages`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

Additional test for `tests/pokemonSync.test.ts` (create the db BEFORE enabling fake timers; restore real timers in `finally`; stub only `POKEMONTCG_API_KEY` — per-field env validation means nothing else is needed):

```ts
it("retries transient 5xx and then succeeds", async () => {
  vi.stubEnv("POKEMONTCG_API_KEY", "k");
  const { db } = await makeTestDb();
  vi.useFakeTimers();
  try {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 } as never)
      .mockResolvedValueOnce({ ok: false, status: 502 } as never)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [page[0]] }) } as never)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) } as never);
    const promise = runPokemonSync(db, f as never);
    await vi.advanceTimersByTimeAsync(5_000); // covers the 1s + 3s backoffs
    const r = await promise;
    expect(r).toEqual({ pages: 1, upsertedCards: 1 });
    expect(f).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});
```

Add script `"sync:pokemon": "tsx --env-file=.env.local scripts/sync-pokemon.ts"` (`pnpm add -D tsx`). Run it once for real: expect ~20k cards over ~80 pages (several minutes; API is rate-limited but generous with a key).
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: pokemontcg.io catalog and raw-price sync"`

---

### Task 4: eBay client — OAuth, budget counter, search, item detail

**Files:**
- Create: `src/lib/ebay/client.ts`, `src/lib/ebay/categories.ts`, `tests/ebayClient.test.ts`

**Interfaces:**
- Consumes: `Db`, `apiBudget` (Task 2), `env` (Task 1).
- Produces:
  - `class BudgetExceededError extends Error`
  - `getAppToken(fetchImpl?): Promise<string>` (module-level cache, refreshes 5 min early)
  - `searchNewlyListed(db, { categoryId, sinceIso, offset }, fetchImpl?): Promise<EbaySearchPage>` where `EbaySearchPage = { items: EbayItemSummary[]; total: number }` and `EbayItemSummary = { itemId: string; title: string; itemCreationDate: string; price?: { value: string }; shippingOptions?: { shippingCost?: { value: string } }[]; buyingOptions: string[]; itemEndDate?: string; seller?: { feedbackPercentage?: string; feedbackScore?: number }; categories?: { categoryId: string }[] }`
  - `getItemDetail(db, itemId, fetchImpl?): Promise<EbayItemDetail>` where `EbayItemDetail = EbayItemSummary & { localizedAspects?: { name: string; value: string }[] }`
  - `checkAndCount(db, kind: "search" | "detail"): Promise<void>` — throws `BudgetExceededError` when today's total (all kinds) ≥ 4800
  - `SPORTS_CATEGORY_PLACEHOLDER` note: `src/lib/ebay/categories.ts` exports `CATEGORY_IDS: { pokemon: "183454"; baseball: string; basketball: string; football: string }` — Step 7 resolves the three sports IDs live and hardcodes the verified values with a dated comment.

- [ ] **Step 1: Write the failing tests** — `tests/ebayClient.test.ts` (mock `fetch` with `vi.fn()`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { checkAndCount, getAppToken, resetEbayAuthCache, searchNewlyListed, BudgetExceededError } from "@/lib/ebay/client";
import { apiBudget } from "@/db/schema";

const tokenResponse = { ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) };

describe("ebay client", () => {
  beforeEach(() => resetEbayAuthCache()); // module-level cache must not leak across tests
  it("fetches and caches the app token", async () => {
    const f = vi.fn().mockResolvedValue(tokenResponse as never);
    expect(await getAppToken(f as never)).toBe("tok");
    expect(await getAppToken(f as never)).toBe("tok");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("counts calls and hard-stops at 4800", async () => {
    const { db } = await makeTestDb();
    const day = new Date().toISOString().slice(0, 10);
    await db.insert(apiBudget).values({ day, kind: "search", count: 4799 });
    await checkAndCount(db, "detail"); // 4800th is allowed
    await expect(checkAndCount(db, "search")).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("search builds the right URL and parses items", async () => {
    const { db } = await makeTestDb();
    const f = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total: 1, itemSummaries: [{ itemId: "v1|1|0", title: "t", itemCreationDate: "2026-08-15T00:00:00Z", buyingOptions: ["FIXED_PRICE"] }] }),
      } as never);
    const page = await searchNewlyListed(db, { categoryId: "183454", sinceIso: "2026-08-15T00:00:00Z", offset: 0 }, f as never);
    expect(page.items).toHaveLength(1);
    const url = String(f.mock.calls[1][0]);
    expect(url).toContain("item_summary/search");
    expect(url).toContain("sort=newlyListed");
    expect(url).toContain("category_ids=183454");
    expect(url).toContain(encodeURIComponent("itemStartDate:[2026-08-15T00:00:00Z..]"));
  });

  it("retries once on 429 then succeeds", async () => {
    const { db } = await makeTestDb();
    const f = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse as never)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "slow down" } as never)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ total: 0, itemSummaries: [] }) } as never);
    const page = await searchNewlyListed(db, { categoryId: "183454", sinceIso: "2026-08-15T00:00:00Z", offset: 0 }, f as never);
    expect(page.items).toHaveLength(0);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement** — `src/lib/ebay/client.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { apiBudget } from "@/db/schema";
import type { Db } from "@/db/client";
import { env } from "@/lib/config";

export class BudgetExceededError extends Error {}

export type EbayItemSummary = {
  itemId: string; title: string; itemCreationDate: string;
  price?: { value: string };
  shippingOptions?: { shippingCost?: { value: string } }[];
  buyingOptions: string[]; itemEndDate?: string;
  seller?: { feedbackPercentage?: string; feedbackScore?: number };
  categories?: { categoryId: string }[];
};
export type EbaySearchPage = { items: EbayItemSummary[]; total: number };
export type EbayItemDetail = EbayItemSummary & { localizedAspects?: { name: string; value: string }[] };

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE = "https://api.ebay.com/buy/browse/v1";
const DAILY_HARD_STOP = 4800;

let cached: { token: string; expiresAt: number } | null = null;

export async function getAppToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 5 * 60_000) return cached.token;
  const basic = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error(`ebay token ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

// The token cache is module-level state; tests reset it so each test's mock
// sequence starts from a cold cache.
export function resetEbayAuthCache(): void {
  cached = null;
}

export async function checkAndCount(db: Db, kind: "search" | "detail"): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const rows = await db.select().from(apiBudget).where(eq(apiBudget.day, day));
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total >= DAILY_HARD_STOP) throw new BudgetExceededError(`daily budget ${total}/${DAILY_HARD_STOP}`);
  await db
    .insert(apiBudget)
    .values({ day, kind, count: 1 })
    .onConflictDoUpdate({ target: [apiBudget.day, apiBudget.kind], set: { count: sql`${apiBudget.count} + 1` } });
}

async function browseGet(db: Db, kind: "search" | "detail", url: string, fetchImpl: typeof fetch) {
  const token = await getAppToken(fetchImpl);
  for (let attempt = 0; ; attempt++) {
    // Budget is charged per real HTTP attempt — retries included — because eBay
    // meters 429/5xx responses against the free-tier quota too.
    await checkAndCount(db, kind);
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new Error(`ebay ${kind} ${res.status}: ${await res.text()}`);
  }
}

export async function searchNewlyListed(
  db: Db,
  opts: { categoryId: string; sinceIso: string; offset: number },
  fetchImpl: typeof fetch = fetch,
): Promise<EbaySearchPage> {
  const params = new URLSearchParams({
    category_ids: opts.categoryId,
    sort: "newlyListed",
    limit: "200",
    offset: String(opts.offset),
    filter: `itemStartDate:[${opts.sinceIso}..]`, // ".." = open-ended range; a bare [ts] is not eBay's documented filter form
  });
  const body = (await browseGet(db, "search", `${BROWSE}/item_summary/search?${params}`, fetchImpl)) as {
    total?: number; itemSummaries?: EbayItemSummary[];
  };
  return { items: body.itemSummaries ?? [], total: body.total ?? 0 };
}

export async function getItemDetail(db: Db, itemId: string, fetchImpl: typeof fetch = fetch): Promise<EbayItemDetail> {
  return (await browseGet(db, "detail", `${BROWSE}/item/${encodeURIComponent(itemId)}`, fetchImpl)) as EbayItemDetail;
}
```

- [ ] **Step 4: Run tests** — all PASS.
- [ ] **Step 5: Category IDs** — create `src/lib/ebay/categories.ts` with `pokemon: "183454"` and the three sports IDs marked `"TBV"`; then run a one-off verification script (temporary, not committed) that calls `GET {BROWSE}/item_summary/search?q=psa+10&limit=1&category_ids=<candidate>` for candidates from eBay's category browse pages, and `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=Baseball%20Card%20Singles` — record the returned leaf IDs for Baseball/Basketball/Football *Trading Card Singles* into the file with a comment `// verified via taxonomy API 2026-08-XX`, replacing "TBV".
- [ ] **Step 6: Sanity live call** — `pnpm tsx --env-file=.env.local -e 'import{getDb}from"@/db/client";import{searchNewlyListed}from"@/lib/ebay/client";searchNewlyListed(getDb(),{categoryId:"183454",sinceIso:new Date(Date.now()-600000).toISOString(),offset:0}).then(p=>console.log(p.total,p.items[0]?.title))'` → prints a nonzero total and a real title.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: ebay browse client with oauth cache, budget hard-stop, verified category ids"`

---

### Task 5: Normalizer — graded-only filter, scam phrasing, grade parsing

**Files:**
- Create: `src/lib/normalize.ts`, `tests/normalize.test.ts`

**Interfaces:**
- Consumes: `EbayItemSummary`, `EbayItemDetail` (Task 4).
- Produces: `normalizeListing(item: EbayItemSummary, detail?: EbayItemDetail): Normalized` where

```ts
type Accepted = {
  kind: "accepted";
  grader: "PSA" | "BGS" | "SGC";
  grade: string | null;            // "10", "9.5", "9" ... null = grader known, grade not yet
  certNumber: string | null;
  priceCents: number; shippingCents: number;
  listingType: "auction" | "bin";
  titleFacts: { setHint: string | null; cardNumberHint: string | null; yearHint: number | null; nameTokens: string[] };
};
type Dropped = { kind: "dropped"; reason: "raw_candidate_phrasing" | "unsupported_grader" | "not_graded" | "no_price" };
type Normalized = Accepted | Dropped;
```

- [ ] **Step 1: Write the failing tests** — `tests/normalize.test.ts` (table-driven; these are the load-bearing behaviors):

```ts
import { describe, expect, it } from "vitest";
import { normalizeListing } from "@/lib/normalize";
import type { EbayItemSummary } from "@/lib/ebay/client";

const base = (title: string, price = "100.00"): EbayItemSummary => ({
  itemId: "v1|x|0", title, itemCreationDate: "2026-08-15T00:00:00Z",
  price: { value: price }, buyingOptions: ["FIXED_PRICE"],
});

describe("normalizeListing", () => {
  const cases: [string, string, string | null][] = [
    // title, expected kind or grader, expected grade
    ["Umbreon ex 161/131 PSA 10 Prismatic Evolutions", "PSA", "10"],
    ["2023 Bowman Chrome Jackson Holliday BGS 9.5 Gem Mint", "BGS", "9.5"],
    ["Beckett 9 Charizard Vmax", "BGS", "9"],
    ["SGC 10 1989 Ken Griffey Jr Upper Deck #1", "SGC", "10"],
  ];
  for (const [title, grader, grade] of cases)
    it(`accepts: ${title}`, () => {
      const n = normalizeListing(base(title));
      expect(n.kind).toBe("accepted");
      if (n.kind === "accepted") { expect(n.grader).toBe(grader); expect(n.grade).toBe(grade); }
    });

  const drops: [string, string][] = [
    ["Moonbreon Umbreon VMAX PSA 10 candidate!! sharp", "raw_candidate_phrasing"],
    ["Charizard base set potential PSA 10 worthy", "raw_candidate_phrasing"],
    ["Pikachu ex CGC 10 pristine", "unsupported_grader"],
    ["Mega Gengar ex SAR raw NM", "not_graded"],
  ];
  for (const [title, reason] of drops)
    it(`drops: ${title} (${reason})`, () => {
      const n = normalizeListing(base(title));
      expect(n.kind).toBe("dropped");
      if (n.kind === "dropped") expect(n.reason).toBe(reason);
    });

  it("aspect-named grader wins even when the title contains ACE SPEC", () => {
    const n = normalizeListing(base("Computer Search ACE SPEC Ultra Rare slab"), {
      ...base("Computer Search ACE SPEC Ultra Rare slab"),
      localizedAspects: [
        { name: "Graded", value: "Yes" },
        { name: "Professional Grader", value: "Professional Sports Authenticator (PSA)" },
        { name: "Grade", value: "10" },
      ],
    });
    expect(n).toMatchObject({ kind: "accepted", grader: "PSA", grade: "10" });
  });

  it("ACE SPEC without any grader is not_graded, not unsupported_grader", () => {
    const n = normalizeListing(base("Prime Catcher ACE SPEC raw NM"));
    expect(n).toMatchObject({ kind: "dropped", reason: "not_graded" });
  });

  it("BVG aspect value maps to BGS", () => {
    const n = normalizeListing(base("vintage slab"), {
      ...base("vintage slab"),
      localizedAspects: [
        { name: "Graded", value: "Yes" },
        { name: "Professional Grader", value: "BVG" },
        { name: "Grade", value: "8" },
      ],
    });
    expect(n).toMatchObject({ kind: "accepted", grader: "BGS", grade: "8" });
  });

  it("aspect-resolved grader beats a literal unsupported-grader token in the title", () => {
    const n = normalizeListing(base("Pikachu ex CGC slab"), {
      ...base("Pikachu ex CGC slab"),
      localizedAspects: [
        { name: "Graded", value: "Yes" },
        { name: "Professional Grader", value: "Professional Sports Authenticator (PSA)" },
        { name: "Grade", value: "10" },
      ],
    });
    expect(n).toMatchObject({ kind: "accepted", grader: "PSA", grade: "10" });
  });

  it("bare ACE without SPEC still drops as unsupported grader", () => {
    const n = normalizeListing(base("Charizard holo ACE 10 graded"));
    expect(n).toMatchObject({ kind: "dropped", reason: "unsupported_grader" });
  });

  it("prefers structured aspects over title text", () => {
    const n = normalizeListing(base("nice slab lot"), {
      ...base("nice slab lot"),
      localizedAspects: [
        { name: "Graded", value: "Yes" },
        { name: "Professional Grader", value: "Professional Sports Authenticator (PSA)" },
        { name: "Grade", value: "9" },
        { name: "Certification Number", value: "12345678" },
      ],
    });
    expect(n).toMatchObject({ kind: "accepted", grader: "PSA", grade: "9", certNumber: "12345678" });
  });

  it("extracts title facts and money", () => {
    const n = normalizeListing({ ...base("2020 Prizm Justin Herbert #325 PSA 10", "250.00"), shippingOptions: [{ shippingCost: { value: "4.99" } }] });
    if (n.kind !== "accepted") throw new Error("expected accepted");
    expect(n.priceCents).toBe(25000);
    expect(n.shippingCents).toBe(499);
    expect(n.titleFacts.yearHint).toBe(2020);
    expect(n.titleFacts.cardNumberHint).toBe("325");
  });
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — `src/lib/normalize.ts`:

```ts
import type { EbayItemDetail, EbayItemSummary } from "@/lib/ebay/client";

export type Accepted = {
  kind: "accepted";
  grader: "PSA" | "BGS" | "SGC";
  grade: string | null;
  certNumber: string | null;
  priceCents: number; shippingCents: number;
  listingType: "auction" | "bin";
  titleFacts: { setHint: string | null; cardNumberHint: string | null; yearHint: number | null; nameTokens: string[] };
};
export type Dropped = { kind: "dropped"; reason: "raw_candidate_phrasing" | "unsupported_grader" | "not_graded" | "no_price" };
export type Normalized = Accepted | Dropped;

const CANDIDATE_RX = /\b(candidate|potential|worthy|pre[- ]?grade|regrade\??|psa\s*ready)\b/i;
const GRADER_RX = /\b(PSA|BGS|SGC|Beckett|BVG)\s*[-:]?\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5)?\b/i;
// "ACE" the grading company must not fire on "ACE SPEC", a printed Pokémon card
// mechanic that appears constantly in legitimate titles in our main category.
const OTHER_GRADER_RX = /\b(CGC|TAG|HGA|GMA|MNT)\b|\bACE\b(?![\s-]*SPEC)/i;

function toCents(v?: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function normalizeListing(item: EbayItemSummary, detail?: EbayItemDetail): Normalized {
  const title = item.title;
  const aspects = new Map((detail?.localizedAspects ?? []).map((a) => [a.name.toLowerCase(), a.value]));

  // 1. Scam phrasing: "PSA 10 candidate" etc. is a RAW card.
  if (CANDIDATE_RX.test(title)) return { kind: "dropped", reason: "raw_candidate_phrasing" };

  // 2. Grader from structured aspects first, then title.
  let grader: Accepted["grader"] | null = null;
  let grade: string | null = null;
  const aspectGrader = aspects.get("professional grader") ?? "";
  if (/PSA/i.test(aspectGrader)) grader = "PSA";
  else if (/(BGS|Beckett|BVG)/i.test(aspectGrader)) grader = "BGS";
  else if (/SGC/i.test(aspectGrader)) grader = "SGC";
  if (grader) grade = aspects.get("grade") ?? null;
  // Structured aspects beat title text absolutely: once an aspect names a
  // supported grader, no title token can override it. Title parsing is only a
  // fallback for listings with no usable aspects.
  if (!grader) {
    const m = GRADER_RX.exec(title);
    if (m) {
      grader = m[1].toUpperCase() === "BECKETT" || m[1].toUpperCase() === "BVG" ? "BGS" : (m[1].toUpperCase() as Accepted["grader"]);
      grade = m[2] ?? null;
    }
  }
  if (!grader) {
    if (OTHER_GRADER_RX.test(title) || /grader/i.test(aspectGrader)) return { kind: "dropped", reason: "unsupported_grader" };
    return { kind: "dropped", reason: "not_graded" };
  }

  // 3. Money.
  const priceCents = toCents(item.price?.value);
  if (priceCents === null) return { kind: "dropped", reason: "no_price" };
  const shippingCents = toCents(item.shippingOptions?.[0]?.shippingCost?.value) ?? 0;

  // 4. Title facts for the matcher.
  const yearM = /\b(19[5-9]\d|20[0-2]\d)\b/.exec(title);
  const numM = /#\s?(\w{1,6})\b/.exec(title) ?? /\b(\d{1,3})\s*\/\s*\d{1,3}\b/.exec(title);
  const nameTokens = title
    .replace(GRADER_RX, " ")
    .replace(/[^a-zA-Z0-9\s/#]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 12);

  return {
    kind: "accepted",
    grader, grade: grade ? grade.replace(/[^\d.]/g, "") || null : null,
    certNumber: aspects.get("certification number") ?? null,
    priceCents, shippingCents,
    listingType: item.buyingOptions.includes("AUCTION") ? "auction" : "bin",
    titleFacts: {
      setHint: null,
      cardNumberHint: numM ? numM[1] : null,
      yearHint: yearM ? Number(yearM[1]) : null,
      nameTokens,
    },
  };
}
```

- [ ] **Step 4: Run tests** — all normalize tests PASS (fix regexes until table passes; the table is the contract).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: listing normalizer with graded-only filter and scam-phrase rejection"`

---

### Task 6: Deterministic matcher + sports catalog growth

**Files:**
- Create: `src/lib/match.ts`, `tests/match.test.ts`

**Interfaces:**
- Consumes: `Accepted` (Task 5), `Db`, `cards` (Task 2).
- Produces: `matchListing(db: Db, game: Game, n: Accepted): Promise<MatchResult>` where `Game = "pokemon" | "baseball" | "basketball" | "football"` and `MatchResult = { cardId: number | null; confidence: "high" | "medium" | "low"; createdCard: boolean }`. Rules:
  - Pokémon: HIGH when exactly one catalog card matches `cardNumberHint` AND ≥1 name token (case-insensitive) in `name`; MEDIUM when exactly one matches on tokens alone or number alone; LOW otherwise (never creates cards — catalog is authoritative).
  - Sports: if `yearHint` AND `cardNumberHint` AND ≥2 name tokens → find-or-create (`createdFrom: "firehose"`, `name` = title-cased tokens joined, `year`, `cardNumber`) → MEDIUM on create, HIGH on exact re-find; else LOW, no create.

- [ ] **Step 1: Write the failing tests** — `tests/match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { matchListing } from "@/lib/match";
import { cards } from "@/db/schema";
import type { Accepted } from "@/lib/normalize";

const acc = (over: Partial<Accepted["titleFacts"]>): Accepted => ({
  kind: "accepted", grader: "PSA", grade: "10", certNumber: null,
  priceCents: 10000, shippingCents: 0, listingType: "bin",
  titleFacts: { setHint: null, cardNumberHint: null, yearHint: null, nameTokens: [], ...over },
});

describe("matchListing", () => {
  it("pokemon: HIGH on unique number+name hit", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161", createdFrom: "catalog" });
    const r = await matchListing(db, "pokemon", acc({ cardNumberHint: "161", nameTokens: ["Umbreon", "ex"] }));
    expect(r.confidence).toBe("high");
    expect(r.cardId).not.toBeNull();
    expect(r.createdCard).toBe(false);
  });

  it("pokemon: LOW when ambiguous, never creates", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values([
      { game: "pokemon", name: "Pikachu", setName: "A", cardNumber: "25", createdFrom: "catalog" },
      { game: "pokemon", name: "Pikachu", setName: "B", cardNumber: "25", createdFrom: "catalog" },
    ]);
    const r = await matchListing(db, "pokemon", acc({ cardNumberHint: "25", nameTokens: ["Pikachu"] }));
    expect(r.confidence).toBe("low");
    expect(r.createdCard).toBe(false);
  });

  it("sports: creates on first sight (MEDIUM), re-finds on second (HIGH)", async () => {
    const { db } = await makeTestDb();
    const facts = { yearHint: 2020, cardNumberHint: "325", nameTokens: ["Prizm", "Justin", "Herbert"] };
    const first = await matchListing(db, "football", acc(facts));
    expect(first).toMatchObject({ confidence: "medium", createdCard: true });
    const second = await matchListing(db, "football", acc(facts));
    expect(second).toMatchObject({ confidence: "high", createdCard: false });
    expect(second.cardId).toBe(first.cardId);
  });

  it("sports: LOW without year+number", async () => {
    const { db } = await makeTestDb();
    const r = await matchListing(db, "baseball", acc({ nameTokens: ["Griffey"] }));
    expect(r).toMatchObject({ confidence: "low", cardId: null, createdCard: false });
  });
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — `src/lib/match.ts`:

```ts
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
```

- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: deterministic matcher with self-growing sports catalog"`

---

### Task 7: The tick — `/api/scan` orchestration + `/api/feed` + minimal page

**Files:**
- Create: `src/lib/scan.ts`, `src/app/api/scan/route.ts`, `src/app/api/feed/route.ts`, `src/app/feed/page.tsx`, `tests/scan.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `runScanTick(db: Db, deps: { search: typeof searchNewlyListed; detail: typeof getItemDetail; now?: () => Date }): Promise<TickReport>` where `TickReport = { perCategory: Record<string, { fetched: number; accepted: number; dropped: number; detailFetches: number }>; budgetStopped: boolean }`. Behavior contract:
  1. For each of the 4 categories: cursor = `cursor_state.lastItemTs` minus **10 minutes overlap** (first run: now − 30 min); page through `search` (limit 200) until items older than cursor or 3 pages.
  2. Per item: upsert-skip if `ebay_item_id` exists (update `lastSeen` only) — idempotency.
  3. `normalizeListing(summary)`; if `dropped` → store row with `dropReason`, `cardId: null`, no detail fetch.
  4. If accepted AND (grade missing OR certNumber missing) AND priceCents ≥ 5000 → `detail` fetch (cap **8 per category per tick**), re-normalize with detail.
  5. `matchListing` → write listing row with match fields; advance cursor to newest `itemCreationDate` seen.
  6. `BudgetExceededError` anywhere → stop cleanly, set `budgetStopped: true`, still commit cursor progress made.
- Route `POST /api/scan`: 401 without `Bearer ${SCAN_SECRET}`; 200 with `TickReport` JSON. Route `GET /api/feed?limit=50`: latest accepted listings joined to card names. Page `/feed`: server component rendering the same query as a plain table.

- [ ] **Step 1: Write the failing test** — `tests/scan.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { runScanTick } from "@/lib/scan";
import { cards, listings, cursorState } from "@/db/schema";
import type { EbayItemSummary } from "@/lib/ebay/client";

const mk = (id: string, title: string, minsAgo: number, price = "150.00"): EbayItemSummary => ({
  itemId: id, title, itemCreationDate: new Date(Date.now() - minsAgo * 60000).toISOString(),
  price: { value: price }, buyingOptions: ["FIXED_PRICE"],
});

describe("runScanTick", () => {
  it("ingests, drops scams, matches, is idempotent across double-run", async () => {
    const { db } = await makeTestDb();
    await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" });
    const search = vi.fn(async (_db, opts) =>
      opts.categoryId === "183454"
        ? { total: 2, items: [mk("v1|a|0", "Umbreon ex 161/131 PSA 10", 5), mk("v1|b|0", "Charizard PSA 10 candidate", 4)] }
        : { total: 0, items: [] });
    const detail = vi.fn(async () => { throw new Error("no detail needed in this fixture"); });

    const r1 = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r1.perCategory["183454"]).toMatchObject({ fetched: 2, accepted: 1, dropped: 1, detailFetches: 1 });

    const rows = await db.select().from(listings);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.ebayItemId === "v1|a|0")?.matchConfidence).toBe("high");
    expect(rows.find((r) => r.ebayItemId === "v1|b|0")?.dropReason).toBe("raw_candidate_phrasing");

    const r2 = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(await db.select().from(listings)).toHaveLength(2); // no dupes
    expect((await db.select().from(cursorState)).length).toBeGreaterThan(0);
  });

  it("stops cleanly when the budget is exhausted", async () => {
    const { db } = await makeTestDb();
    const search = vi.fn(async () => { throw new BudgetExceededError("cap"); });
    const detail = vi.fn();
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.budgetStopped).toBe(true);
    expect(detail).not.toHaveBeenCalled();
  });

  it("never detail-fetches under the price floor", async () => {
    const { db } = await makeTestDb();
    const search = vi.fn(async (_db, opts) =>
      opts.categoryId === "183454"
        ? { total: 1, items: [mk("v1|cheap|0", "Squirtle PSA 10", 5, "40.00")] }
        : { total: 0, items: [] });
    const detail = vi.fn(async () => { throw new Error("must not be called"); });
    const r = await runScanTick(db, { search: search as never, detail: detail as never });
    expect(r.perCategory["183454"]).toMatchObject({ accepted: 1, detailFetches: 0 });
    expect(detail).not.toHaveBeenCalled();
  });
});
```

(Add `BudgetExceededError` to the test's imports from `@/lib/ebay/client`.)

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement `src/lib/scan.ts`** (complete):

```ts
import { eq, inArray, sql } from "drizzle-orm";
import { CATEGORY_IDS } from "@/lib/ebay/categories";
import { BudgetExceededError, type getItemDetail, type searchNewlyListed } from "@/lib/ebay/client";
import { normalizeListing } from "@/lib/normalize";
import { matchListing, type Game } from "@/lib/match";
import { cursorState, listings } from "@/db/schema";
import type { Db } from "@/db/client";

const OVERLAP_MS = 10 * 60_000;
const FIRST_RUN_LOOKBACK_MS = 30 * 60_000;
const DETAIL_CAP_PER_CATEGORY = 8;
const DETAIL_MIN_PRICE_CENTS = 5000;
const MAX_PAGES = 3;

export type TickReport = {
  perCategory: Record<string, { fetched: number; accepted: number; dropped: number; detailFetches: number }>;
  budgetStopped: boolean;
};

// Entries list, not an object literal: unverified sports IDs are all the literal
// "TBV" and would collapse into a single object key. Skipping them keeps ticks
// working (Pokémon-only) until the taxonomy verification step fills in real IDs.
const GAMES: [string, Game][] = (
  [
    [CATEGORY_IDS.pokemon, "pokemon"],
    [CATEGORY_IDS.baseball, "baseball"],
    [CATEGORY_IDS.basketball, "basketball"],
    [CATEGORY_IDS.football, "football"],
  ] as [string, Game][]
).filter(([id]) => id !== "TBV");

export async function runScanTick(
  db: Db,
  deps: { search: typeof searchNewlyListed; detail: typeof getItemDetail; now?: () => Date },
): Promise<TickReport> {
  const now = deps.now?.() ?? new Date();
  const report: TickReport = { perCategory: {}, budgetStopped: false };

  for (const [categoryId, game] of GAMES) {
    const stats = { fetched: 0, accepted: 0, dropped: 0, detailFetches: 0 };
    report.perCategory[categoryId] = stats;
    try {
      const [cursor] = await db.select().from(cursorState).where(eq(cursorState.categoryId, categoryId));
      const since = new Date((cursor?.lastItemTs.getTime() ?? now.getTime() - FIRST_RUN_LOOKBACK_MS) - OVERLAP_MS);
      let newestSeen = cursor?.lastItemTs ?? since;

      for (let page = 0; page < MAX_PAGES; page++) {
        const { items } = await deps.search(db, { categoryId, sinceIso: since.toISOString(), offset: page * 200 });
        if (items.length === 0) break;

        // Neon's http driver makes every DB call a full round trip — batch the
        // page's existence check and lastSeen refresh (2 round trips per page)
        // instead of paying 2 per item, or burst ticks blow the 60s function cap.
        const pageIds = items.map((i) => i.itemId);
        const existingRows = await db
          .select({ id: listings.ebayItemId })
          .from(listings)
          .where(inArray(listings.ebayItemId, pageIds));
        const existing = new Set(existingRows.map((r) => r.id));
        if (existing.size > 0)
          await db.update(listings).set({ lastSeen: sql`now()` }).where(inArray(listings.ebayItemId, [...existing]));

        for (const item of items) {
          stats.fetched++;
          const created = new Date(item.itemCreationDate);
          if (created > newestSeen) newestSeen = created;
          if (existing.has(item.itemId)) continue;

          let n = normalizeListing(item);
          let usedDetail = false;
          if (n.kind === "accepted" && (!n.grade || !n.certNumber) && n.priceCents >= DETAIL_MIN_PRICE_CENTS && stats.detailFetches < DETAIL_CAP_PER_CATEGORY) {
            stats.detailFetches++;
            try { n = normalizeListing(item, await deps.detail(db, item.itemId)); usedDetail = true; }
            catch (e) { if (e instanceof BudgetExceededError) throw e; /* detail failure: proceed with title-only */ }
          }

          if (n.kind === "dropped") {
            stats.dropped++;
            const rawCents = Number(item.price?.value);
            await db.insert(listings).values({
              ebayItemId: item.itemId, title: item.title, categoryId,
              // NaN guard: a malformed price string must not poison the insert and 500 the tick
              priceCents: Number.isFinite(rawCents) ? Math.round(rawCents * 100) : 0,
              listingType: item.buyingOptions.includes("AUCTION") ? "auction" : "bin",
              dropReason: n.reason, raw: item,
            }).onConflictDoNothing();
            continue;
          }

          const m = await matchListing(db, game, n);
          stats.accepted++;
          await db.insert(listings).values({
            ebayItemId: item.itemId, title: item.title, categoryId,
            cardId: m.cardId, matchConfidence: m.confidence,
            grader: n.grader, grade: n.grade, certNumber: n.certNumber,
            priceCents: n.priceCents, shippingCents: n.shippingCents, listingType: n.listingType,
            detailFetched: usedDetail,
            endTime: item.itemEndDate ? new Date(item.itemEndDate) : null,
            sellerFeedbackPct: item.seller?.feedbackPercentage ? Math.round(Number(item.seller.feedbackPercentage)) : null,
            sellerFeedbackCount: item.seller?.feedbackScore ?? null,
            raw: item,
          }).onConflictDoNothing();
        }
        if (items.length < 200) break;
      }

      await db.insert(cursorState).values({ categoryId, lastItemTs: newestSeen })
        .onConflictDoUpdate({ target: cursorState.categoryId, set: { lastItemTs: newestSeen } });
    } catch (e) {
      if (e instanceof BudgetExceededError) { report.budgetStopped = true; break; }
      throw e;
    }
  }
  return report;
}
```

- [ ] **Step 4: Routes** — `src/app/api/scan/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config";
import { getDb } from "@/db/client";
import { runScanTick } from "@/lib/scan";
import { getItemDetail, searchNewlyListed } from "@/lib/ebay/client";
import { deadLetters } from "@/db/schema";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env.SCAN_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  try {
    const report = await runScanTick(db, { search: searchNewlyListed, detail: getItemDetail });
    return NextResponse.json(report);
  } catch (e) {
    await db.insert(deadLetters).values({ kind: "scan_tick", payload: null, error: String(e) });
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
```

`src/app/api/feed/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cards, listings } from "@/db/schema";

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50), 200);
  const db = getDb();
  const rows = await db
    .select({
      ebayItemId: listings.ebayItemId, title: listings.title, grader: listings.grader, grade: listings.grade,
      priceCents: listings.priceCents, confidence: listings.matchConfidence, cardName: cards.name, firstSeen: listings.firstSeen,
    })
    .from(listings)
    .leftJoin(cards, eq(listings.cardId, cards.id))
    .where(isNull(listings.dropReason))
    .orderBy(desc(listings.firstSeen))
    .limit(limit);
  return NextResponse.json(rows);
}
```

`src/app/feed/page.tsx` (minimal server component; M4 replaces it):

```tsx
import { desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cards, listings } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const rows = await getDb()
    .select({ id: listings.ebayItemId, title: listings.title, grader: listings.grader, grade: listings.grade, price: listings.priceCents, conf: listings.matchConfidence, card: cards.name })
    .from(listings).leftJoin(cards, eq(listings.cardId, cards.id))
    .where(isNull(listings.dropReason)).orderBy(desc(listings.firstSeen)).limit(100);
  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: 24 }}>
      <h1>Dry-run feed ({rows.length})</h1>
      <table cellPadding={6}>
        <thead><tr><th align="left">Card</th><th align="left">Title</th><th>Slab</th><th align="right">Price</th><th>Match</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.card ?? "—"}</td><td>{r.title}</td><td>{r.grader} {r.grade}</td>
              <td align="right">${(r.price / 100).toFixed(2)}</td><td>{r.conf}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 5: Run tests** — `pnpm test` → all PASS (scan test included). `pnpm build` → compiles.
- [ ] **Step 6: Local end-to-end** — `pnpm dev`, then:

```bash
curl -s -X POST -H "authorization: Bearer $(grep SCAN_SECRET .env.local | cut -d= -f2)" http://localhost:3000/api/scan | head -c 400
```

Expected: JSON `TickReport` with nonzero `fetched` for at least one category; then open http://localhost:3000/feed and see real listings.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: scan tick orchestration, feed api, dry-run feed page"`

---

### Task 8: Deploy + GitHub Actions heartbeat

**Files:**
- Create: `.github/workflows/scan.yml`, `README.md` (runbook section)

**Interfaces:**
- Consumes: deployed `/api/scan` (Task 7).
- Produces: production heartbeat every 5 minutes; repo secrets `SCAN_URL`, `SCAN_SECRET`.

- [ ] **Step 1: Workflow** — `.github/workflows/scan.yml`:

```yaml
name: scan-heartbeat
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}
permissions: {}
jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: Call /api/scan
        run: |
          code=$(curl -s --max-time 90 -o /tmp/out -w "%{http_code}" -X POST \
            -H "authorization: Bearer ${{ secrets.SCAN_SECRET }}" \
            "${{ secrets.SCAN_URL }}")
          cat /tmp/out
          test "$code" = "200"
```

- [ ] **Step 2: User deploy steps (human):** create a GitHub repo `deal-scanner` and push; import the repo in Vercel (framework auto-detected) and paste the five env vars from `.env.example` into Vercel → Settings → Environment Variables (values from `.env.local`, plus `DRY_RUN=1`); deploy; note the production URL. Then GitHub → repo → Settings → Secrets and variables → Actions: add `SCAN_URL=https://<prod-domain>/api/scan` and `SCAN_SECRET=<same value>`.
- [ ] **Step 3: Smoke prod** — run the workflow manually (Actions → scan-heartbeat → Run workflow) → green; `https://<prod-domain>/feed` shows listings growing tick over tick.
- [ ] **Step 4: README runbook** — add sections: what this is, env var table, how to run tests, how to trigger a manual tick, where the feed is, "M1 = dry-run only; alerts arrive in M3."
- [ ] **Step 5: Commit + push** — `git add -A && git commit -m "feat: github actions heartbeat and deploy runbook" && git push`

---

## Spec deviations (deliberate, M1-scoped)

- Spec §8 "a tick that finds a lock exits cleanly": M1 satisfies this structurally — `/api/scan` has `maxDuration = 60` seconds against a 5-minute cadence, so overlapping ticks are impossible; a real advisory lock lands in M2 when auction-close sweeps make ticks longer. Idempotent upserts + cursor overlap already make a hypothetical overlap harmless to data.
- Spec §8 "exponential backoff": M1 implements a single 1.5s retry on 429/5xx; unfinished work resumes next tick via cursors. Full backoff ladder deferred to M2 alongside the longer-running sweeps.

## M1 exit criteria

- All vitest suites green; `pnpm build` clean.
- Production feed page accumulating real graded listings from all four categories, with visible match confidences and drop reasons in the DB.
- Budget table shows daily totals comfortably under 4,800.
- One-week soak begins (M2 comp engine will consume the accumulated listings/auction end-times immediately).

## Deferred to M2 (explicit)

AI classifier (needs "price-interesting" = reference prices) · comp engine (auction closes, BIN disappearance) · reference values + floor rule · scoring/alerts (M3) · dashboard proper (M4) · priority lane + digest (M5).
