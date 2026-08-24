# Deal Scanner M2 — Lossless Ingestion, Comp Engine, References, Scoring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the sampling gap found in the soak, turn observed auctions/BINs into real sold comps, compute reference values, and score matched listings in the feed — still zero alerts (M3).

**Architecture:** Amendments live in spec §14 (`docs/superpowers/specs/2026-08-15-card-deal-scanner-design.md`). Ingestion pages until it reaches the cursor (cap 20 pages, observable `sampling_gap` on overflow). Two new sweeps run inside the tick under the existing budget: ended-auction detail checks (real comps) and aged-BIN probes (`sold_probable` comps). A nightly branch recomputes comp-median references; the floor rule scores at ingest for matched listings with raw prices. Branch: `m2-comps` off `main` (in place, per project precedent).

**Tech stack:** unchanged (Next.js 16 / TS 6.0.3 / pnpm 11.22.0 pinned / Drizzle + Neon / PGlite tests / vitest).

## Global Constraints

- Graded-only (PSA/BGS/SGC) and notify-NEVER remain absolute: M2 adds scoring columns and feed display only — no Telegram, email, webhook, or any notification path may exist. `DRY_RUN` semantics unchanged.
- Budget: per-attempt counter and 4,800/day hard stop unchanged. New per-tick caps: ingestion ≤ 20 pages/category; auction sweep ≤ 10 details/tick; BIN sweep ≤ 10 details/tick. Worst-case tick ≈ 20 search + 8 ingest-detail + 20 sweep-detail = 48 calls; at the observed ~60 ticks/day ≈ 2,900/day — inside budget with headroom.
- Compliance invariant: persisted payloads never contain seller identifiers (`rawForStorage` pattern) — sweeps must apply the same scrub to anything they store.
- Prod tick must stay under Vercel's 60s `maxDuration`: sweeps run AFTER ingestion and each checks remaining time — skip cleanly if the tick started >35s ago (`Date.now() - tickStart`), never start a sweep that can't finish.
- All Postgres work follows the established patterns: NOT NULL DEFAULT '' for identity-index text columns; idempotent upserts; PGlite tests via `makeTestDb()`.
- TDD per task: failing test → minimal code → pass → commit (conventional messages, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer).

---

### Task 1: Lossless cursor pagination

**Files:**
- Modify: `src/lib/scan.ts`
- Test: `tests/scan.test.ts`

**Interfaces:**
- Consumes: existing `searchNewlyListed` (the `itemStartDate:[since..]` filter already bounds results — "reached the cursor" = a page comes back short or empty).
- Produces: `TickReport.perCategory[id]` gains `pagesFetched: number` and `samplingGap: boolean`. `MAX_PAGES_HARD = 20` replaces `MAX_PAGES = 3`. On overflow: one `dead_letters` row `kind: "sampling_gap"` with `{ categoryId, since, newestSeen }` payload, and the cursor STILL advances (bounded, observable loss — never a stuck cursor).

- [ ] **Step 1: Write the failing tests** — extend `tests/scan.test.ts` (the `mk` helper exists; add a page-builder):

```ts
const mkPage = (page: number, count: number): EbayItemSummary[] =>
  Array.from({ length: count }, (_, i) => mk(`v1|p${page}i${i}|0`, `Umbreon ex 161/131 PSA 10 lot ${page}-${i}`, page * 10 + 5));

it("pages until the results run out and reports depth", async () => {
  const { db } = await makeTestDb();
  const search = vi.fn(async (_db, opts) => {
    if (opts.categoryId !== "183454") return { total: 0, items: [] };
    const page = opts.offset / 200;
    return page < 2 ? { total: 450, items: mkPage(page, 200) } : { total: 450, items: mkPage(2, 50) };
  });
  const detail = vi.fn(async () => { throw new Error("skip detail"); });
  const r = await runScanTick(db, { search: search as never, detail: detail as never });
  expect(r.perCategory["183454"]).toMatchObject({ fetched: 450, pagesFetched: 3, samplingGap: false });
});

it("flags a sampling gap at the hard page cap and still advances the cursor", async () => {
  const { db } = await makeTestDb();
  const search = vi.fn(async (_db, opts) =>
    opts.categoryId === "183454"
      ? { total: 99999, items: mkPage(opts.offset / 200, 200) }
      : { total: 0, items: [] });
  const detail = vi.fn(async () => { throw new Error("skip detail"); });
  const r = await runScanTick(db, { search: search as never, detail: detail as never });
  expect(r.perCategory["183454"]).toMatchObject({ pagesFetched: 20, samplingGap: true });
  const dl = await db.select().from(deadLetters);
  expect(dl.some((d) => d.kind === "sampling_gap")).toBe(true);
  expect((await db.select().from(cursorState)).length).toBeGreaterThan(0);
});
```

(Import `deadLetters` in the test file. The existing three tests must pass unchanged — the first test's two-item fixture is a single short page, so `pagesFetched: 1, samplingGap: false`.)

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run tests/scan.test.ts` → new tests FAIL (`pagesFetched` undefined).
- [ ] **Step 3: Implement** in `src/lib/scan.ts`:
  - Replace `const MAX_PAGES = 3;` with `const MAX_PAGES_HARD = 20; // spec §14.1: page to the cursor; cap bounds a pathological gap`.
  - Stats shape: `{ fetched: 0, accepted: 0, dropped: 0, detailFetches: 0, pagesFetched: 0, samplingGap: false }` (update the `TickReport` type accordingly).
  - Loop: `for (let page = 0; page < MAX_PAGES_HARD; page++) { ... stats.pagesFetched++; ...existing body...; if (items.length < 200) break; }` and after the loop: `if (stats.pagesFetched === MAX_PAGES_HARD) { stats.samplingGap = true; await db.insert(deadLetters).values({ kind: "sampling_gap", payload: { categoryId, since: since.toISOString(), newestSeen: newestSeen.toISOString() }, error: \`page cap ${MAX_PAGES_HARD} hit before exhausting results\` }); }` — wait: a run that ends EXACTLY on a full 20th page is indistinguishable from overflow; that is the intended conservative behavior (flag it).
  - Cursor upsert stays exactly where it is (after the loop, before the catch) so it advances in both outcomes.
- [ ] **Step 4: Run tests** — `pnpm vitest run tests/scan.test.ts` (5 tests) then full `pnpm test`, `pnpm lint`, `pnpm build`. Green, pristine.
- [ ] **Step 5: Commit** — `feat: lossless cursor pagination with observable sampling gaps`

---

### Task 2: Matcher and normalizer tuning (soak-title evidence)

**Files:**
- Modify: `src/lib/normalize.ts`, `src/lib/match.ts`
- Test: `tests/normalize.test.ts`, `tests/match.test.ts`

**Interfaces:**
- `normalize.ts`: `titleFacts.cardNumberHint` additionally recognizes lettered set-number formats. Extraction priority: `#`-prefixed → fraction (`161/131`) → lettered (`GG40`, `TG12`, `SM9a`, `SWSH250`). New regex (applied to the title AFTER stripping grader text — reuse the existing `title.replace(GRADER_RX, " ")` output for this extraction so `PSA 10` can never contaminate it): `/\b([A-Z]{2,4}\d{1,3}[a-z]?)\b/`.
- `match.ts`: name matching becomes whole-token with a stoplist. New module-level:

```ts
const STOP_TOKENS = new Set([
  "en", "jp", "jpn", "japanese", "english", "psa", "bgs", "sgc", "cgc",
  "pokemon", "pokémon", "card", "cards", "tcg", "holo", "holofoil", "reverse",
  "rare", "ultra", "secret", "illustration", "special", "promo", "mint", "gem",
  "nm", "graded", "slab", "edition", "1st", "vmax", "vstar",
]);
const usableTokens = (tokens: string[]) =>
  tokens.filter((t) => t.length > 2 && !STOP_TOKENS.has(t.toLowerCase()) && !/^\d+$/.test(t));
const nameWords = (name: string) => new Set(name.toLowerCase().split(/[\s.,'&-]+/).filter(Boolean));
```

  The Pokémon `nameHits` filter becomes: `byNumber.filter((c) => { const words = nameWords(c.name); return usableTokens(nameTokens).some((t) => words.has(t.toLowerCase())); })` — note "vmax"/"vstar" are in the stoplist because they appear in card NAMES too broadly ("Umbreon VMAX" vs junk "VMAX Climax" set text) — the base species word is the discriminator. The `byName` ilike fallback uses `usableTokens(nameTokens).slice(0, 3)` and keeps its `.limit(3)`; the sports path's `name` join uses `usableTokens` too (title-cased, joined).

- [ ] **Step 1: Failing tests** — add to `tests/normalize.test.ts`:

```ts
it("extracts lettered gallery numbers", () => {
  const n = normalizeListing(base("PSA 10 Glaceon VSTAR GG40 Crown Zenith Galarian Gallery"));
  if (n.kind !== "accepted") throw new Error("expected accepted");
  expect(n.titleFacts.cardNumberHint).toBe("GG40");
});
it("prefers explicit # over lettered formats", () => {
  const n = normalizeListing(base("2024 POKEMON TEF EN-TEMPORAL FORCES ILLUSTRATION RARE #166 SAWSBUCK PSA 10"));
  if (n.kind !== "accepted") throw new Error("expected accepted");
  expect(n.titleFacts.cardNumberHint).toBe("166");
});
```

  and to `tests/match.test.ts` (the two real soak titles, end-to-end through the matcher):

```ts
it("matches the real Sawsbuck soak title despite junk tokens", async () => {
  const { db } = await makeTestDb();
  await db.insert(cards).values([
    { game: "pokemon", name: "Sawsbuck", setName: "Temporal Forces", cardNumber: "166", createdFrom: "catalog" },
    { game: "pokemon", name: "Venusaur", setName: "Temporal Forces", cardNumber: "166x", createdFrom: "catalog" },
  ]);
  const n = normalizeListing(base("2024 POKEMON TEF EN-TEMPORAL FORCES ILLUSTRATION RARE #166 SAWSBUCK PSA 10"));
  if (n.kind !== "accepted") throw new Error("expected accepted");
  const r = await matchListing(db, "pokemon", n);
  expect(r.confidence).toBe("high");
});
it("matches the real Glaceon GG40 soak title", async () => {
  const { db } = await makeTestDb();
  await db.insert(cards).values({ game: "pokemon", name: "Glaceon VSTAR", setName: "Crown Zenith: Galarian Gallery", cardNumber: "GG40", createdFrom: "catalog" });
  const n = normalizeListing(base("PSA 10 Glaceon VSTAR GG40 Ultra Rare 2023 Pokemon Crown Zenith Galarian Gallery"));
  if (n.kind !== "accepted") throw new Error("expected accepted");
  const r = await matchListing(db, "pokemon", n);
  expect(["high", "medium"]).toContain(r.confidence);
});
```

  (`tests/match.test.ts` gains an import of `normalizeListing` and the local `base` helper copied from `tests/normalize.test.ts` — copy it; tasks may be read out of order.)
- [ ] **Step 2: RED** — both files fail.
- [ ] **Step 3: Implement** per the Interfaces block. All existing rows in both test files must stay green (the 15 normalize rows and 6 match tests are the regression contract).
- [ ] **Step 4: Full verify** — `pnpm test`, `pnpm lint`, `pnpm build`.
- [ ] **Step 5: Commit** — `feat: whole-token matching with stoplist and lettered card numbers`

---

### Task 3: Comps schema + ended-auction sweep

**Files:**
- Modify: `src/db/schema.ts` (add `comps`, extend `listings`), `src/lib/ebay/client.ts` (typed HTTP error + detail fields)
- Create: `src/lib/sweeps.ts`
- Test: `tests/sweeps.test.ts`

**Interfaces:**
- Schema additions:

```ts
export const comps = pgTable(
  "comps",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id").references(() => cards.id),
    grader: text("grader", { enum: ["PSA", "BGS", "SGC"] }).notNull(),
    grade: text("grade").notNull().default(""),
    soldPriceCents: integer("sold_price_cents").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    source: text("source", { enum: ["auction_close", "bin_disappeared", "manual"] }).notNull(),
    ebayItemId: text("ebay_item_id").notNull(),
  },
  (t) => [uniqueIndex("comps_item").on(t.ebayItemId)],
);
```

  `listings` gains `lastProbedAt: timestamp("last_probed_at", { withTimezone: true })` (nullable).
- `client.ts`: `export class EbayHttpError extends Error { constructor(public status: number, message: string) { super(message); } }` — `browseGet` throws it (with the status) instead of the plain `Error` on non-retryable failures; `EbayItemDetail` gains optional `currentBidPrice?: { value: string }` and `bidCount?: number`.
- `sweeps.ts`:

```ts
export async function sweepEndedAuctions(
  db: Db,
  deps: { detail: typeof getItemDetail },
  cap = 10,
): Promise<{ checked: number; compsWritten: number }>
```

  Behavior: select up to `cap` listings where `listingType='auction' AND status='active' AND endTime < now()`, oldest `endTime` first. For each: `detail(db, id)`. Sold detection: `bidCount > 0` and finite `Number(currentBidPrice.value)` → insert a comp (`soldPriceCents` from the bid, `soldAt` = the listing's `endTime`, `source: "auction_close"`, grader/grade from the listing row, `cardId` may be null) with `.onConflictDoNothing()`, then status → `sold_probable`. No bids → status `ended`, no comp. `EbayHttpError` with status 404/410 → treat as ended-unsold. `BudgetExceededError` rethrows; any other error → one `dead_letters` row (`kind: "auction_sweep"`), listing left for the next tick.

- [ ] **Step 1: Failing tests** — `tests/sweeps.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { sweepEndedAuctions } from "@/lib/sweeps";
import { EbayHttpError } from "@/lib/ebay/client";
import { cards, comps, listings } from "@/db/schema";

const auction = (id: string, endedMinsAgo: number, over: object = {}) => ({
  ebayItemId: id, title: `t-${id}`, categoryId: "183454", priceCents: 10000,
  listingType: "auction" as const, grader: "PSA" as const, grade: "10",
  endTime: new Date(Date.now() - endedMinsAgo * 60000), ...over,
});

describe("sweepEndedAuctions", () => {
  it("writes a comp for a bid-on ended auction and marks it sold_probable", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" }).returning();
    await db.insert(listings).values(auction("v1|a1|0", 30, { cardId: card.id }));
    const detail = vi.fn(async () => ({ itemId: "v1|a1|0", title: "t", itemCreationDate: "", buyingOptions: ["AUCTION"], currentBidPrice: { value: "142.50" }, bidCount: 7 }));
    const r = await sweepEndedAuctions(db, { detail: detail as never });
    expect(r).toEqual({ checked: 1, compsWritten: 1 });
    const [c] = await db.select().from(comps);
    expect(c).toMatchObject({ soldPriceCents: 14250, source: "auction_close", grader: "PSA" });
    const [l] = await db.select().from(listings);
    expect(l.status).toBe("sold_probable");
  });

  it("no bids → ended, no comp; 404 → ended too", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values([auction("v1|a2|0", 30), auction("v1|a3|0", 40)]);
    const detail = vi.fn()
      .mockResolvedValueOnce({ itemId: "v1|a3|0", title: "t", itemCreationDate: "", buyingOptions: ["AUCTION"], bidCount: 0 })
      .mockRejectedValueOnce(new EbayHttpError(404, "gone"));
    const r = await sweepEndedAuctions(db, { detail: detail as never });
    expect(r).toEqual({ checked: 2, compsWritten: 0 });
    const rows = await db.select().from(listings);
    expect(rows.every((x) => x.status === "ended")).toBe(true);
  });

  it("ignores active and future-ending auctions", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values(auction("v1|a4|0", -60)); // ends in an hour
    const detail = vi.fn();
    const r = await sweepEndedAuctions(db, { detail: detail as never });
    expect(r).toEqual({ checked: 0, compsWritten: 0 });
    expect(detail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: RED** (module missing).
- [ ] **Step 3: Implement** schema + client + sweeps per Interfaces. Ordering detail: select `orderBy(asc(listings.endTime))`.
- [ ] **Step 4: Full verify** — all suites, lint, build.
- [ ] **Step 5: Commit** — `feat: comps table and ended-auction sweep`

---

### Task 4: BIN-disappearance sweep

**Files:**
- Modify: `src/lib/sweeps.ts`
- Test: `tests/sweeps.test.ts`

**Interfaces:**

```ts
export async function sweepAgedBins(
  db: Db,
  deps: { detail: typeof getItemDetail },
  cap = 10,
): Promise<{ probed: number; compsWritten: number }>
```

Behavior (spec §14.4): candidates are `listingType='bin' AND status='active' AND firstSeen < now()-6h AND (lastProbedAt IS NULL OR lastProbedAt < now()-12h)`, ordered `lastProbedAt` nulls-first then `firstSeen` asc, limit `cap`. **Ordering trap:** Postgres `ASC` defaults to NULLS LAST — never-probed listings must come FIRST, so order with an explicit `sql\`${listings.lastProbedAt} asc nulls first\`` fragment (drizzle's `asc()` helper alone is wrong here). For each: set `lastProbedAt = now()`, then `detail(db, id)`. Outcomes: detail succeeds and item still purchasable (no `itemEndDate` in the past) → still active, nothing else. `EbayHttpError` 404/410 (or detail shows an `itemEndDate` in the past): if the disappearance is observed within 48h of `firstSeen` → comp (`source: "bin_disappeared"`, `soldPriceCents` = listing's `priceCents`, `soldAt` = now) + status `sold_probable`; if older than 48h → status `ended`, no comp (slow vanish ≠ sale). `BudgetExceededError` rethrows; other errors → dead letter + continue.

- [ ] **Step 1: Failing tests** — append to `tests/sweeps.test.ts`:

```ts
const bin = (id: string, ageHours: number, over: object = {}) => ({
  ebayItemId: id, title: `t-${id}`, categoryId: "183454", priceCents: 25000,
  listingType: "bin" as const, grader: "SGC" as const, grade: "10",
  firstSeen: new Date(Date.now() - ageHours * 3600_000), ...over,
});

describe("sweepAgedBins", () => {
  it("fast disappearance becomes a sold_probable comp", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values(bin("v1|b1|0", 12));
    const detail = vi.fn().mockRejectedValue(new EbayHttpError(404, "gone"));
    const r = await sweepAgedBins(db, { detail: detail as never });
    expect(r).toEqual({ probed: 1, compsWritten: 1 });
    const [c] = await db.select().from(comps);
    expect(c).toMatchObject({ soldPriceCents: 25000, source: "bin_disappeared" });
  });

  it("slow disappearance is ended, not a comp; young and recently-probed BINs are skipped", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values([
      bin("v1|b2|0", 80),                                     // older than 48h → ended on vanish
      bin("v1|b3|0", 2),                                      // too young to probe
      bin("v1|b4|0", 24, { lastProbedAt: new Date() }),       // probed too recently
    ]);
    const detail = vi.fn().mockRejectedValue(new EbayHttpError(404, "gone"));
    const r = await sweepAgedBins(db, { detail: detail as never });
    expect(r).toEqual({ probed: 1, compsWritten: 0 });
    const b2 = (await db.select().from(listings)).find((x) => x.ebayItemId === "v1|b2|0");
    expect(b2?.status).toBe("ended");
  });

  it("still-live BIN just refreshes lastProbedAt", async () => {
    const { db } = await makeTestDb();
    await db.insert(listings).values(bin("v1|b5|0", 12));
    const detail = vi.fn(async () => ({ itemId: "v1|b5|0", title: "t", itemCreationDate: "", buyingOptions: ["FIXED_PRICE"] }));
    const r = await sweepAgedBins(db, { detail: detail as never });
    expect(r).toEqual({ probed: 1, compsWritten: 0 });
    const [l] = await db.select().from(listings);
    expect(l.status).toBe("active");
    expect(l.lastProbedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: RED.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Full verify.**
- [ ] **Step 5: Commit** — `feat: aged-BIN disappearance sweep`

---

### Task 5: Reference computation + floor-rule scoring

**Files:**
- Modify: `src/db/schema.ts` (add `referencePrices`, `syncState`; `listings` gains `scoreBps`, `scoreBasis`), `src/lib/scan.ts` (score at ingest; nightly recompute branch; wire both sweeps into the tick)
- Create: `src/lib/reference.ts`
- Test: `tests/reference.test.ts`, extend `tests/scan.test.ts`

**Interfaces:**
- Schema: `referencePrices` per spec §9 — `{ cardId int notNull refs cards, grader enum, grade text notNull default '', valueCents int notNull, basis text enum ["comp_median"], compCount30d int notNull, asOf timestamptz notNull }` with `primaryKey(cardId, grader, grade)`. `syncState`: `{ key text pk, value jsonb }`. `listings.scoreBps: integer` (nullable), `listings.scoreBasis: text` (nullable; values "comp_median" | "raw_floor").
- `reference.ts`:

```ts
export async function recomputeReferences(db: Db): Promise<{ upserted: number }>
// median of comps.soldPriceCents per (cardId, grader, grade), trailing 30d, cardId not null,
// count >= 3 → upsert into referencePrices (basis comp_median, compCount30d, asOf now)

export const GRADE_FLOOR_MULTIPLIER: Record<string, number> = { "10": 1.0, "9.5": 0.8, "9": 0.8 };
export function scoreListing(input: {
  totalCents: number; grader: "PSA" | "BGS" | "SGC"; grade: string | null;
  compMedianCents?: number | null; rawMarketCents?: number | null;
}): { scoreBps: number; scoreBasis: "comp_median" | "raw_floor" } | null
// comp_median preferred when present: score = 1 - total/median.
// else raw_floor: only for grades in GRADE_FLOOR_MULTIPLIER with rawMarketCents present:
//   ref = raw × multiplier; score = 1 - total/ref.
// null when no basis applies. scoreBps = Math.round(score * 10000) — negative allowed (overpriced).
```

- `scan.ts` wiring: (a) at ingest, for accepted listings with `match_confidence in ('high','medium')` and a `cardId`, look up `referencePrices` (exact grader+grade) and `rawPrices` for the card, call `scoreListing({ totalCents: priceCents + shippingCents, ... })`, persist `scoreBps`/`scoreBasis` on the insert; (b) after per-category ingestion, run `sweepEndedAuctions` then `sweepAgedBins` (each in its own try/catch that dead-letters non-Budget errors), skipping both if `Date.now() - tickStart > 35_000`; (c) nightly: read `syncState['referenceRecomputeDay']`; if ≠ today (UTC) and current UTC hour ≥ 9 → `recomputeReferences(db)` + write today — placed before sweeps, same 35s guard. `TickReport` gains top-level `sweeps?: { auctions: {...}; bins: {...} }` and `referencesRecomputed?: number`.

- [ ] **Step 1: Failing tests** — `tests/reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { recomputeReferences, scoreListing } from "@/lib/reference";
import { cards, comps, referencePrices } from "@/db/schema";

describe("recomputeReferences", () => {
  it("medians 3+ comps in 30d and skips thin or stale groups", async () => {
    const { db } = await makeTestDb();
    const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "PRE", cardNumber: "161", createdFrom: "catalog" }).returning();
    const day = (n: number) => new Date(Date.now() - n * 86400_000);
    await db.insert(comps).values([
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 500000, soldAt: day(2), source: "auction_close", ebayItemId: "c1" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 520000, soldAt: day(5), source: "auction_close", ebayItemId: "c2" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 610000, soldAt: day(9), source: "bin_disappeared", ebayItemId: "c3" },
      { cardId: card.id, grader: "PSA", grade: "10", soldPriceCents: 990000, soldAt: day(45), source: "auction_close", ebayItemId: "c4" }, // stale
      { cardId: card.id, grader: "BGS", grade: "9.5", soldPriceCents: 400000, soldAt: day(3), source: "auction_close", ebayItemId: "c5" }, // thin
    ]);
    const r = await recomputeReferences(db);
    expect(r.upserted).toBe(1);
    const [ref] = await db.select().from(referencePrices);
    expect(ref).toMatchObject({ grader: "PSA", grade: "10", valueCents: 520000, basis: "comp_median", compCount30d: 3 });
  });
});

describe("scoreListing", () => {
  const base = { grader: "PSA" as const, grade: "10" };
  it("prefers comp median", () =>
    expect(scoreListing({ ...base, totalCents: 400000, compMedianCents: 520000, rawMarketCents: 150000 }))
      .toEqual({ scoreBps: 2308, scoreBasis: "comp_median" }));
  it("falls back to the raw floor for a 10", () =>
    expect(scoreListing({ ...base, totalCents: 120000, rawMarketCents: 149924 }))
      .toEqual({ scoreBps: 1996, scoreBasis: "raw_floor" }));
  it("applies the 0.8 multiplier for a 9", () =>
    expect(scoreListing({ ...base, grade: "9", totalCents: 100000, rawMarketCents: 149924 }))
      .toEqual({ scoreBps: 1662, scoreBasis: "raw_floor" }));
  it("returns null with no usable basis", () => {
    expect(scoreListing({ ...base, grade: "8", totalCents: 1000, rawMarketCents: 5000 })).toBeNull();
    expect(scoreListing({ ...base, totalCents: 1000 })).toBeNull();
  });
  it("goes negative for overpriced listings", () =>
    expect(scoreListing({ ...base, totalCents: 600000, compMedianCents: 520000 })!.scoreBps).toBeLessThan(0));
});
```

  and one tick-integration test in `tests/scan.test.ts`: seed a catalog card + rawPrice (1499.24 → 149924), fixture listing "Umbreon ex 161/131 PSA 10" at $1,200 → after the tick the stored row has `scoreBasis: "raw_floor"` and `scoreBps` ≈ `Math.round((1 - 120000/149924) * 10000)`.
- [ ] **Step 2: RED.** — [ ] **Step 3: Implement** (median: order the group's prices, take the middle element for odd counts, lower-middle for even — deterministic, no interpolation; document in a comment).
- [ ] **Step 4: Full verify** — all suites, lint, build.
- [ ] **Step 5: Commit** — `feat: comp-median references and floor-rule scoring in the tick`

---

### Task 6: Feed scoring display + runbook + go-live ops

**Files:**
- Modify: `src/app/feed/page.tsx`, `src/app/api/feed/route.ts`, `README.md`

**Interfaces:** `/api/feed` and the page add `scoreBps`/`scoreBasis` (feed orders by `scoreBps` DESC NULLS LAST, then `firstSeen` DESC); the page renders score as a percentage with the basis in parentheses (e.g. `+19.96% (raw floor)`) and dashes for unscored rows. README gains an "M2: comps & scoring" section (what the sweeps do, what a score means, the explicit "no alerts until M3" line, and the manual weekly `pnpm sync:pokemon` guidance per spec §14.6).

- [ ] **Step 1:** Implement route + page + README (server components stay minimal; no client JS). Exact deltas:
  - `src/app/api/feed/route.ts` select gains `scoreBps: listings.scoreBps, scoreBasis: listings.scoreBasis` and the orderBy becomes `.orderBy(sql\`${listings.scoreBps} desc nulls last\`, desc(listings.firstSeen))` (import `sql`).
  - `src/app/feed/page.tsx` query gains the same two fields and ordering; the table gains a **Score** column header and per-row cell:

```tsx
<td align="right">
  {r.scoreBps != null
    ? `${(r.scoreBps / 100).toFixed(2)}% (${r.scoreBasis === "comp_median" ? "comps" : "raw floor"})`
    : "—"}
</td>
```

  - `README.md` new section "## M2: comps & scoring" covering: what the two sweeps record and why (`auction_close` = real sale; `bin_disappeared` = probable sale within 48h of listing), what a score means (percentage under the reference; negative = overpriced), that references need 3+ comps in 30 days or a raw-price floor on grades 9/9.5/10, the explicit line "**No alerts exist yet — M3 adds Telegram/email; this milestone only measures.**", and the weekly manual `pnpm sync:pokemon` guidance.
- [ ] **Step 2:** `pnpm test` (unchanged suites), `pnpm lint`, `pnpm build`.
- [ ] **Step 3: Commit** — `feat: score column in feed, M2 runbook`
- [ ] **Step 4 (controller ops, not the implementer):** `pnpm db:push` (new tables/columns to Neon), merge to `main`, push, `vercel deploy --prod`, verify a prod tick's TickReport shows `pagesFetched`/`sweeps`, and confirm the feed renders scores.

---

## Spec deviations (deliberate)
- Nightly reference recompute rides inside the first post-09:00-UTC tick (spec §4 "nightly" language) rather than a separate scheduler — one moving part, same 35s guard as the sweeps.
- Automated raw-price re-sync deferred per spec §14.6.

## M2 exit criteria
All suites green; prod tick reports paging depth and sweep activity; `sampling_gap` dead-letters visible when they occur (rather than silent loss); comps accumulate from both sources; references appear once any (card, grader, grade) reaches 3 comps in 30d; matched listings carry scores in the feed; budget stays under 4,800/day at observed cadence.
