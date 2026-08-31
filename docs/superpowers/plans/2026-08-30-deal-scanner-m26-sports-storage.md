# M2.6 Storage Diet + Sports Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut listings storage ~10× (stop storing raw payloads for rejected listings; nightly prune) and turn on graded-sports ingestion via three Sport-aspect-filtered eBay queries with per-query budgets.

**Architecture:** Task 1 slims the dropped-listing insert and adds `pruneDroppedListings` to the nightly slot. Task 2 fixes the two sports-matcher gate defects (empty-name card creation; two-letter player names). Task 3 replaces scan.ts's category loop with a QUERIES list — pokemon plus three aspect-filtered sports queries, each with its own cursor key, page cap, and detail cap — and threads an optional `aspectFilter` through the eBay client. Scoring, sweeps, comps, references, and the feed need zero changes (spec §15 made valuation source-agnostic).

**Tech Stack:** Next.js 16 App Router, TypeScript 6.0.3 (pinned), Drizzle ORM, Neon serverless HTTP driver, PGlite test harness, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-15-card-deal-scanner-design.md` — §16 (M2.6) governs; §14.2/§15 context. Measured facts baked into §16: sports inflow 24,950/hr (Baseball 8,528 / Basketball 3,632 / Football 7,935, ~81% aspect coverage), Neon at 481/512 MB.

## Global Constraints

- TypeScript pinned 6.0.3, ESLint pinned 9.39.5 — never touch versions.
- Full suite (currently 101 tests) + `pnpm lint` + `pnpm exec tsc --noEmit` green at the END of every task; delete any `tsconfig.tsbuildinfo` before committing.
- Bare `.returning()` only on the Db union (TS2554 — repo precedent). Neon HTTP driver: no transactions.
- PGlite integration tests: copy the `makeTestDb` pattern (`const { db } = await makeTestDb()`) from existing test files.
- DO NOT modify: `src/lib/sweeps.ts`, `src/lib/reference.ts`, `src/lib/valuation.ts`, `src/lib/importComps*.ts`, `src/app/feed/page.tsx`, `.github/workflows/*`, `src/db/schema.ts`.
- Commit at the end of each task with the given message. Do not push (the session lead pushes; pushes auto-deploy production).
- Budget arithmetic is binding (spec §16.6): per-query page caps 7/4/3/4, per-query detail caps 4/2/2/2. Do not "round up".

## File Structure

- `src/lib/prune.ts` (new) — `pruneDroppedListings`: raw-nulling + 7-day deletion of dropped rows. One responsibility: listings hygiene.
- `src/lib/scan.ts` — Task 1: dropped insert loses `raw`; nightly wiring for prune. Task 3: QUERIES loop restructure, per-query caps, cursor keys, report keys.
- `src/lib/match.ts` — Task 2: sports name-token filter + empty-name guard.
- `src/lib/ebay/client.ts` — Task 3: optional `aspectFilter` param on `searchNewlyListed`.
- `src/lib/ebay/categories.ts` — Task 3: real sports category constant replaces the three "TBV" placeholders.
- Tests: `tests/prune.test.ts` (new), `tests/match.test.ts`, `tests/scan.test.ts`, `tests/ebayClient.test.ts` — updated in their owning tasks.

---

### Task 1: Storage diet — slim dropped inserts + nightly prune

**Files:**
- Create: `src/lib/prune.ts`
- Modify: `src/lib/scan.ts` (dropped-path insert ~line 125; nightly block after the re-score call; `TickReport` type)
- Test: `tests/prune.test.ts` (new), `tests/scan.test.ts` (nightly test extension)

**Interfaces:**
- Consumes: `listings` schema columns (`dropReason`, `raw`, `firstSeen`), the nightly block's existing `shouldContinue`-style guard `withinPostIngestBudget`.
- Produces: `pruneDroppedListings(db: Db, opts?: { shouldContinue?: () => boolean; now?: Date }): Promise<{ rawsNulled: number; deleted: number; exhausted: boolean }>`; `TickReport` gains `pruned?: { rawsNulled: number; deleted: number }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/prune.test.ts` (copy the makeTestDb harness import/setup lines from `tests/reference.test.ts` verbatim):

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listings } from "@/db/schema";
import { pruneDroppedListings } from "@/lib/prune";
// + the exact makeTestDb helper import used by tests/reference.test.ts

describe("pruneDroppedListings", () => {
  it("nulls raw on dropped rows, deletes old dropped rows, leaves accepted rows alone", async () => {
    const { db } = await makeTestDb();
    const base = { categoryId: "183454", priceCents: 1000, shippingCents: 0, listingType: "bin" as const };
    const old = new Date(Date.now() - 10 * 86400_000);
    await db.insert(listings).values([
      // dropped, recent, raw present → raw nulled, row kept
      { ...base, ebayItemId: "d-recent", title: "d1", dropReason: "no_grader", raw: { big: "blob" } },
      // dropped, 10 days old → deleted
      { ...base, ebayItemId: "d-old", title: "d2", dropReason: "no_grader", raw: { big: "blob" }, firstSeen: old },
      // accepted (no dropReason), old, raw present → untouched
      { ...base, ebayItemId: "a-old", title: "a1", grader: "PSA", grade: "10", raw: { keep: "me" }, firstSeen: old },
    ]);
    const r = await pruneDroppedListings(db);
    expect(r.exhausted).toBe(true);
    expect(r.deleted).toBe(1);
    expect(r.rawsNulled).toBe(1); // d-old is deleted first; only d-recent needs nulling
    const [recent] = await db.select().from(listings).where(eq(listings.ebayItemId, "d-recent"));
    expect(recent.raw).toBeNull();
    expect(await db.select().from(listings).where(eq(listings.ebayItemId, "d-old"))).toEqual([]);
    const [kept] = await db.select().from(listings).where(eq(listings.ebayItemId, "a-old"));
    expect(kept.raw).toEqual({ keep: "me" });
  });

  it("honors the time guard", async () => {
    const { db } = await makeTestDb();
    expect(await pruneDroppedListings(db, { shouldContinue: () => false }))
      .toEqual({ rawsNulled: 0, deleted: 0, exhausted: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/prune.test.ts`
Expected: FAIL — module `@/lib/prune` not found.

- [ ] **Step 3: Implement `src/lib/prune.ts`**

```ts
import { and, count, isNotNull, lt } from "drizzle-orm";
import { listings } from "@/db/schema";
import type { Db } from "@/db/client";

// spec §16.1-2: a dropped listing's row exists to dedupe re-fetches of the
// recent search window and to keep dropReason observability — its raw JSON
// payload serves nothing and was ~96% of the listings table's bytes. Delete
// dropped rows once they age out of the window entirely (7 days), and null
// any raw still sitting on younger dropped rows (transition hygiene — new
// drops are inserted rawless as of M2.6).
const DROPPED_RETENTION_MS = 7 * 86400_000;

export async function pruneDroppedListings(
  db: Db,
  opts?: { shouldContinue?: () => boolean; now?: Date },
): Promise<{ rawsNulled: number; deleted: number; exhausted: boolean }> {
  const shouldContinue = opts?.shouldContinue ?? (() => true);
  if (!shouldContinue()) return { rawsNulled: 0, deleted: 0, exhausted: false };
  const cutoff = new Date((opts?.now ?? new Date()).getTime() - DROPPED_RETENTION_MS);

  const deleteWhere = and(isNotNull(listings.dropReason), lt(listings.firstSeen, cutoff));
  const [{ n: toDelete }] = await db.select({ n: count() }).from(listings).where(deleteWhere);
  await db.delete(listings).where(deleteWhere);

  if (!shouldContinue()) return { rawsNulled: 0, deleted: toDelete, exhausted: false };

  const nullWhere = and(isNotNull(listings.dropReason), isNotNull(listings.raw));
  const [{ n: toNull }] = await db.select({ n: count() }).from(listings).where(nullWhere);
  await db.update(listings).set({ raw: null }).where(nullWhere);

  return { rawsNulled: toNull, deleted: toDelete, exhausted: true };
}
```

- [ ] **Step 4: Slim the dropped insert in `src/lib/scan.ts`**

In the `n.kind === "dropped"` insert (~lines 125-131), delete the `raw: rawForStorage,` field and change the comment above the insert to note (one line) that drops are stored rawless per spec §16.1. The `rawForStorage` destructuring stays (the accepted path still uses it).

- [ ] **Step 5: Wire prune into the nightly block**

In `src/lib/scan.ts`: import `pruneDroppedListings` from `@/lib/prune`. Add to `TickReport` after `rescored?: number;`:

```ts
  // spec §16.2: dropped-listings hygiene counters (present only when the nightly gate ran)
  pruned?: { rawsNulled: number; deleted: number };
```

Inside the nightly gate block, immediately after the `report.rescored = rescored;` line and still BEFORE the syncState day-marker upsert:

```ts
        const { rawsNulled, deleted } = await pruneDroppedListings(db, { shouldContinue: withinPostIngestBudget, now });
        report.pruned = { rawsNulled, deleted };
```

- [ ] **Step 6: Extend the nightly test in `tests/scan.test.ts`**

In the existing nightly test (the one asserting `referencesRecomputed`/`rescored`), seed one dropped listing older than 7 days (any title, `dropReason: "no_grader"`, `firstSeen: new Date(Date.now() - 10 * 86400_000)`) before the tick, and after the tick assert:

```ts
    expect(report.pruned).toEqual({ rawsNulled: 0, deleted: 1 });
```

(rawsNulled 0 because the seeded row is deleted by the age rule before the null pass sees it, and no younger dropped row carries raw.)

- [ ] **Step 7: Full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/prune.ts src/lib/scan.ts tests/prune.test.ts tests/scan.test.ts
git commit -m "feat: storage diet — rawless dropped inserts + nightly prune (spec §16.1-2)"
```

---

### Task 2: Sports matcher gate fixes

**Files:**
- Modify: `src/lib/match.ts` (sports branch, lines ~51-71)
- Test: `tests/match.test.ts`

**Interfaces:**
- Consumes: existing `usableTokens`, `STOP_TOKENS`, `titleCase`, `matchListing` signature (unchanged).
- Produces: unchanged `matchListing` signature; new internal `sportsNameTokens(tokens: string[]): string[]`. Task 3's scan restructure relies on `matchListing(db, game, n)` continuing to work per-listing with game supplied by the caller.

- [ ] **Step 1: Write the failing tests**

Add to `tests/match.test.ts` (match the file's existing harness and fixture style — it already builds `Accepted` fixtures with `titleFacts`):

```ts
  it("sports: two-letter player-name tokens survive (CJ Stroud, Bo Nix)", async () => {
    const { db } = await makeTestDb();
    const n = mkAccepted({ nameTokens: ["CJ", "Stroud", "PSA"], cardNumberHint: "150", yearHint: 2023 });
    const r = await matchListing(db, "football", n);
    expect(r.createdCard).toBe(true);
    const [card] = await db.select().from(cards).where(eq(cards.game, "football"));
    expect(card.name).toBe("Cj Stroud"); // titleCase of both tokens — 2-letter token kept
  });

  it("sports: never creates a card with an empty name", async () => {
    const { db } = await makeTestDb();
    // every token is stoplisted or numeric → no usable name material
    const n = mkAccepted({ nameTokens: ["PSA", "2023", "Graded", "Mint"], cardNumberHint: "77", yearHint: 2023 });
    const r = await matchListing(db, "baseball", n);
    expect(r).toEqual({ cardId: null, confidence: "low", createdCard: false });
    expect(await db.select().from(cards)).toEqual([]);
  });
```

Adapt `mkAccepted` to whatever the file's existing fixture-builder is named — if none exists, build the minimal `Accepted` object inline the way the file's other sports test does. Both tests must FAIL against current code (the first creates name "Stroud", the second creates name "").

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/match.test.ts`
Expected: FAIL — first test: name is "Stroud" (2-letter token erased); second: a card row with name "" was created.

- [ ] **Step 3: Implement in `src/lib/match.ts`**

Add beside `usableTokens`:

```ts
// spec §16.5b: player names legitimately carry two-letter tokens (CJ, Bo, Ja) —
// the general len>2 filter is for junk-token suppression in POKEMON name
// matching and must not erase them from sports card names. Digits and
// stoplisted hobby words still go.
const sportsNameTokens = (tokens: string[]) =>
  tokens.filter((t) => t.length >= 2 && !STOP_TOKENS.has(t.toLowerCase()) && !/^\d+$/.test(t));
```

In the sports branch, replace `const name = usableTokens(nameTokens).map(titleCase).join(" ");` with:

```ts
    const nameParts = sportsNameTokens(nameTokens);
    // spec §16.5a: no usable name material → never insert an empty-name card;
    // the listing stores as low-confidence unmatched like any other.
    if (nameParts.length === 0) return { cardId: null, confidence: "low", createdCard: false };
    const name = nameParts.map(titleCase).join(" ");
```

Everything else in the branch stays byte-identical.

- [ ] **Step 4: Full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green (the pokemon matcher tests must be untouched and passing — `usableTokens` itself is NOT modified).

- [ ] **Step 5: Commit**

```bash
git add src/lib/match.ts tests/match.test.ts
git commit -m "fix: sports matcher gate — keep 2-letter name tokens, never create empty-name cards (spec §16.5)"
```

---

### Task 3: Sports queries live — aspect filter, per-query budgets, category flip

**Files:**
- Modify: `src/lib/ebay/categories.ts`, `src/lib/ebay/client.ts` (`searchNewlyListed`), `src/lib/scan.ts` (loop restructure)
- Test: `tests/ebayClient.test.ts`, `tests/scan.test.ts`

**Interfaces:**
- Consumes: Task 2's `matchListing(db, game, n)` per-listing; `cursorState.categoryId` text PK reused as a QUERY KEY (existing `"183454"` rows remain valid).
- Produces: `searchNewlyListed(db, opts: { categoryId: string; sinceIso: string; offset: number; aspectFilter?: string })`; scan iterates `SCAN_QUERIES` (exact shape below); `TickReport.perCategory` keys become the query cursor keys (`"183454"`, `"261328:Baseball"`, `"261328:Basketball"`, `"261328:Football"`).

- [ ] **Step 1: Update `src/lib/ebay/categories.ts`**

Replace the whole placeholder block (keep the file's opening comment about verified leaf categories, rewritten):

```ts
// eBay Browse API leaf category IDs used to scope newly-listed searches.
// pokemon: "Pokémon Individual Cards" leaf, verified M1. sports: ALL sports
// singles resolve to ONE leaf (spec §14.2), verified live 2026-08-30 with
// per-sport aspect_filter sanity searches (Baseball 8,528/hr, Basketball
// 3,632/hr, Football 7,935/hr at time of measurement).
export const CATEGORY_IDS = {
  pokemon: "183454",
  sports: "261328",
} as const;
```

Then fix the two consumers of the old shape: `src/lib/scan.ts` (rewritten in Step 4 anyway) and any test referencing `CATEGORY_IDS.baseball` etc. (grep for `CATEGORY_IDS` — update references to the new shape).

- [ ] **Step 2: Thread `aspectFilter` through `searchNewlyListed` (test first)**

In `tests/ebayClient.test.ts`, find the existing `searchNewlyListed` test that asserts the request URL/params, and add a sibling test: calling with `aspectFilter: "categoryId:261328,Sport:{Baseball}"` must produce a request whose query string contains `aspect_filter=` with that value URL-encoded, while a call WITHOUT `aspectFilter` must not contain `aspect_filter` at all. Follow the file's existing mock-fetch pattern exactly. Run it, verify FAIL. Then in `src/lib/ebay/client.ts`'s `searchNewlyListed`, extend the opts type with `aspectFilter?: string` and add after the existing params construction:

```ts
  if (opts.aspectFilter) params.set("aspect_filter", opts.aspectFilter);
```

(match the file's actual params-building idiom — if it builds the URL by string concatenation, append `&aspect_filter=${encodeURIComponent(opts.aspectFilter)}` instead). Run the test, verify GREEN.

- [ ] **Step 3: Restructure the scan loop (test expectations first)**

`tests/scan.test.ts` currently drives ticks through category `"183454"` fixtures. Update the test's search stub to record the `opts` it is called with, and extend the main tick test to assert:

```ts
    const keys = Object.keys(report.perCategory).sort();
    expect(keys).toEqual(["183454", "261328:Baseball", "261328:Basketball", "261328:Football"]);
    const sportCalls = searchCalls.filter((c) => c.categoryId === "261328");
    expect(new Set(sportCalls.map((c) => c.aspectFilter))).toEqual(new Set([
      "categoryId:261328,Sport:{Baseball}",
      "categoryId:261328,Sport:{Basketball}",
      "categoryId:261328,Sport:{Football}",
    ]));
```

(Adapt to the test file's stub plumbing; sports stubs may return `{ items: [] }` so the new queries exhaust immediately — existing pokemon fixtures then behave exactly as before.) Any existing assertions keyed on `report.perCategory["183454"]` keep working.

- [ ] **Step 4: Implement the QUERIES loop in `src/lib/scan.ts`**

Replace the `GAMES` list (lines ~48-58) with:

```ts
// spec §16.4: one query per (category, sport-aspect). The game is known from
// the query itself — no per-listing aspect inspection, no title guessing.
// Page and detail caps per spec §16.6 (binding): pokemon 7/4, each sport
// caps at 4/3/4 pages and 2 details, sized to measured inflow within the
// 4,800/day budget at 10-minute cadence.
type ScanQuery = {
  cursorKey: string; categoryId: string; game: Game;
  aspectFilter?: string; maxPages: number; detailCap: number;
};
const SCAN_QUERIES: ScanQuery[] = [
  { cursorKey: CATEGORY_IDS.pokemon, categoryId: CATEGORY_IDS.pokemon, game: "pokemon", maxPages: 7, detailCap: 4 },
  { cursorKey: `${CATEGORY_IDS.sports}:Baseball`, categoryId: CATEGORY_IDS.sports, game: "baseball", aspectFilter: `categoryId:${CATEGORY_IDS.sports},Sport:{Baseball}`, maxPages: 4, detailCap: 2 },
  { cursorKey: `${CATEGORY_IDS.sports}:Basketball`, categoryId: CATEGORY_IDS.sports, game: "basketball", aspectFilter: `categoryId:${CATEGORY_IDS.sports},Sport:{Basketball}`, maxPages: 3, detailCap: 2 },
  { cursorKey: `${CATEGORY_IDS.sports}:Football`, categoryId: CATEGORY_IDS.sports, game: "football", aspectFilter: `categoryId:${CATEGORY_IDS.sports},Sport:{Football}`, maxPages: 4, detailCap: 2 },
];
```

Delete the `MAX_PAGES_HARD` and `DETAIL_CAP_PER_CATEGORY` constants. In the loop:
- `for (const q of SCAN_QUERIES)` replacing `for (const [categoryId, game] of GAMES)`; use `q.game` where `game` was used, `q.categoryId` for the search call, and `q.cursorKey` EVERYWHERE `categoryId` was used as a KEY: `report.perCategory[q.cursorKey]`, the `cursorState` select/upsert, and the sampling_gap dead-letter payload (`{ categoryId: q.cursorKey, ... }`).
- Page loop bound becomes `page < q.maxPages`; the sampling_gap error string becomes `` `page cap ${q.maxPages} hit before exhausting results` ``.
- The search call becomes `deps.search(db, { categoryId: q.categoryId, sinceIso: since.toISOString(), offset: page * 200, aspectFilter: q.aspectFilter })`.
- The detail-fetch condition's `stats.detailFetches < DETAIL_CAP_PER_CATEGORY` becomes `stats.detailFetches < q.detailCap`.
- The listing insert's `categoryId` field stays `q.categoryId` (the REAL eBay category — only keys use cursorKey).

- [ ] **Step 5: Full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green. If any scan test asserted the old 20-page cap by count, update it to the per-query caps (the timing/gap tests parameterize over pages fetched — check their fixtures still exercise the guard paths with maxPages 7).

- [ ] **Step 6: README**

In README.md: update the scanning description to say what is scanned — graded Pokémon plus graded baseball/basketball/football singles (one eBay category, three Sport-aspect queries); note per-tick budget split and that the external 10-minute scheduler (cron-job.org hitting `/api/scan` with the Bearer secret) is the intended heartbeat with GitHub Actions as backup. One short paragraph; match README tone.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ebay/categories.ts src/lib/ebay/client.ts src/lib/scan.ts tests/ebayClient.test.ts tests/scan.test.ts README.md
git commit -m "feat: sports ingestion live — aspect-filtered queries with per-query budgets (spec §16.4,6-7)"
```

---

## Post-plan (session lead, not a task)

1. One-time storage cleanup against prod (spec §16.3): null raw on dropped rows, delete dropped >7d, VACUUM, re-measure `pg_database_size` — BEFORE announcing sports live.
2. Push (auto-deploys). Fire one manual tick; verify all four `perCategory` keys report, sports listings/cards appear, and no dead-letter spike.
3. Walk the user through cron-job.org setup (10-minute POST with Bearer secret) when they're ready.
4. Ledger + memory updates.
