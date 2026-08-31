# M2.5 eBay-Only Valuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire pokemontcg.io prices from the valuation engine; every scoring basis becomes an eBay observation — comp medians (real sales) preferred, live peer-ask floors as the fallback — with a nightly re-score keeping scores current.

**Architecture:** `scoreListing` (pure, in `src/lib/reference.ts`) swaps its `raw_floor` fallback for a `peer_floor` basis: the minimum ask (price+shipping) among ≥2 OTHER active Buy-It-Now listings sharing (cardId, grader, grade) at high/medium confidence. A batched peer-ask collector serves both ingest-time scoring in `scan.ts` and a new nightly re-score phase. The feed's Value column and the Pokémon sync drop their raw-price halves. No schema migration — `scoreBasis` is a TS-level text enum; `raw_prices` stays dormant.

**Tech Stack:** Next.js 16 App Router, TypeScript 6.0.3 (pinned), Drizzle ORM, Neon serverless HTTP driver, PGlite test harness, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-15-card-deal-scanner-design.md` — §15 (M2.5 amendments) governs; §5/§7/§9/§12 are amended by it.

## Global Constraints

- TypeScript pinned 6.0.3, ESLint pinned 9.39.5 — never touch these versions.
- Package manager: pnpm (`pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`). Full suite (currently 97 tests) must pass at the END of every task — no task may leave `main` red.
- Drizzle on the `Db` union type: use bare `.returning()` — a field-map argument fails TS2554 (established repo precedent).
- Neon HTTP driver has no transactions — per-row/batched statements only, idempotent by construction.
- PGlite integration tests: copy the `makeTestDb` pattern from `tests/reference.test.ts`/`tests/scan.test.ts` (includes the `quietly()` stdout mute for pushSchema).
- DO NOT modify: `src/lib/sweeps.ts`, `src/lib/match.ts`, `src/lib/normalize.ts`, `src/lib/importComps*.ts`, `.github/workflows/*`.
- Commit at the end of each task with the message given in that task. Do not push (the session lead pushes; pushes auto-deploy production).
- Delete any `tsconfig.tsbuildinfo` produced by typechecking before committing.

## File Structure

- `src/db/schema.ts` — `listings.scoreBasis` enum gains `"peer_floor"` (keeps `"raw_floor"` as legacy-readable).
- `src/lib/reference.ts` — owns all scoring: rewritten `scoreListing`, new `collectPeerAsks`/`peerFloorCents`/`peerKey` helpers, new `rescoreActiveListings`. `GRADE_FLOOR_MULTIPLIER` survives until Task 3 (the feed still imports it), then dies.
- `src/lib/scan.ts` — ingest scoring hook swaps rawPrices for peer asks (Task 1); nightly block gains the re-score call (Task 2).
- `src/app/feed/page.tsx` — Value column: comps → peer floor → dash; rawPrices join removed (Task 3).
- `src/lib/pokemonSync.ts` — catalog-only: price extraction/upsert deleted (Task 4).
- Tests: `tests/reference.test.ts`, `tests/scan.test.ts`, `tests/pokemonSync.test.ts` updated in their owning tasks.

---

### Task 1: Peer-floor basis replaces raw-floor in scoring (schema + reference.ts + scan.ts ingest hook)

**Files:**
- Modify: `src/db/schema.ts` (line ~68, `scoreBasis` enum)
- Modify: `src/lib/reference.ts` (rewrite `scoreListing`; add peer helpers; KEEP `GRADE_FLOOR_MULTIPLIER` export untouched — the feed still imports it until Task 3)
- Modify: `src/lib/scan.ts` (ingest scoring block lines ~138-164; imports line 8)
- Test: `tests/reference.test.ts`, `tests/scan.test.ts`

**Interfaces:**
- Consumes: existing `listings` table columns (`status`, `listingType`, `matchConfidence`, `priceCents`, `shippingCents`), `referencePrices` exact-key lookup (unchanged).
- Produces (later tasks rely on these EXACT signatures):
  - `peerKey(cardId: number, grader: string, grade: string | null): string` — `` `${cardId}|${grader}|${grade ?? ""}` ``
  - `collectPeerAsks(db: Db, cardIds: number[]): Promise<Map<string, PeerAsk[]>>` where `type PeerAsk = { ebayItemId: string; totalCents: number }`
  - `peerFloorCents(asks: PeerAsk[] | undefined, selfId: string): number | null` (null when <2 peers after self-exclusion)
  - `scoreListing(input: { totalCents: number; compMedianCents?: number | null; peerFloorCents?: number | null }): { scoreBps: number; scoreBasis: "comp_median" | "peer_floor" } | null`

- [ ] **Step 1: Schema — add the enum value**

In `src/db/schema.ts`, change the `scoreBasis` line inside `listings`:

```ts
  // "raw_floor" is legacy (M2, retired by spec §15): never written after M2.5,
  // still readable on rows the nightly re-score hasn't reached yet.
  scoreBasis: text("score_basis", { enum: ["comp_median", "peer_floor", "raw_floor"] }),
```

Text enums are TypeScript-level only in this schema — no DB migration exists or is needed.

- [ ] **Step 2: Write the failing tests for the new scoring API**

In `tests/reference.test.ts`, REPLACE the three `raw_floor` test expectations (lines ~31-37: the `rawMarketCents: 149924` cases and the `grade: "8"` case) and the `rawMarketCents: 0` guard (line ~44) with the following, and ADD the peer-helper tests. Keep the comp-median-preference case but update its shape. The `base` fixture object drops `grader`/`grade` (the new `scoreListing` takes neither):

```ts
import { collectPeerAsks, peerFloorCents, peerKey, scoreListing } from "@/lib/reference";

// scoreListing — pure basis hierarchy
it("prefers comp median over peer floor", () =>
  expect(scoreListing({ totalCents: 400000, compMedianCents: 520000, peerFloorCents: 150000 }))
    .toEqual({ scoreBps: 2308, scoreBasis: "comp_median" }));

it("falls back to peer floor when no comp median", () =>
  expect(scoreListing({ totalCents: 120000, peerFloorCents: 149924 }))
    .toEqual({ scoreBps: 1996, scoreBasis: "peer_floor" }));

it("scores negative when priced above the peer floor", () =>
  expect(scoreListing({ totalCents: 180000, peerFloorCents: 149924 }))
    .toEqual({ scoreBps: -2006, scoreBasis: "peer_floor" }));

it("returns null with no usable basis", () => {
  expect(scoreListing({ totalCents: 1000 })).toBeNull();
  expect(scoreListing({ totalCents: 1000, compMedianCents: 0, peerFloorCents: 0 })).toBeNull();
  expect(scoreListing({ totalCents: 1000, peerFloorCents: null })).toBeNull();
});

// peerFloorCents — pure floor math
it("peerFloorCents excludes self and requires 2 peers", () => {
  const asks = [
    { ebayItemId: "self", totalCents: 5000 },
    { ebayItemId: "a", totalCents: 10000 },
    { ebayItemId: "b", totalCents: 12000 },
  ];
  expect(peerFloorCents(asks, "self")).toBe(10000);
  expect(peerFloorCents([asks[0], asks[1]], "self")).toBeNull(); // 1 peer after self-exclusion
  expect(peerFloorCents(undefined, "self")).toBeNull();
});
```

And a PGlite integration test for `collectPeerAsks` (same `makeTestDb` harness already in this file). Seed one card, then five listings that exercise every filter, then assert only the two qualifying BINs come back:

```ts
it("collectPeerAsks returns only active high/medium BIN asks grouped by card|grader|grade", async () => {
  const db = await makeTestDb();
  const [card] = await db.insert(cards).values({ game: "pokemon", name: "Umbreon ex", setName: "S", cardNumber: "161", createdFrom: "catalog" }).returning();
  const base = { cardId: card.id, categoryId: "183454", title: "t", grader: "PSA" as const, grade: "10", priceCents: 100000, shippingCents: 500 };
  await db.insert(listings).values([
    { ...base, ebayItemId: "bin-hi", listingType: "bin", matchConfidence: "high", status: "active" },
    { ...base, ebayItemId: "bin-med", listingType: "bin", matchConfidence: "medium", status: "active", priceCents: 120000, shippingCents: 0 },
    { ...base, ebayItemId: "auction", listingType: "auction", matchConfidence: "high", status: "active" },       // excluded: auction
    { ...base, ebayItemId: "bin-low", listingType: "bin", matchConfidence: "low", status: "active" },            // excluded: low confidence
    { ...base, ebayItemId: "bin-ended", listingType: "bin", matchConfidence: "high", status: "ended" },          // excluded: not active
  ]);
  const map = await collectPeerAsks(db, [card.id]);
  const asks = map.get(peerKey(card.id, "PSA", "10"))!;
  expect(asks.map((a) => a.ebayItemId).sort()).toEqual(["bin-hi", "bin-med"]);
  expect(asks.find((a) => a.ebayItemId === "bin-hi")!.totalCents).toBe(100500); // price + shipping
});
```

- [ ] **Step 3: Run the reference tests to verify they fail**

Run: `pnpm exec vitest run tests/reference.test.ts`
Expected: FAIL — `collectPeerAsks`/`peerFloorCents`/`peerKey` not exported; `scoreListing` rejects the new input shape.

- [ ] **Step 4: Rewrite `src/lib/reference.ts` scoring section**

Replace `scoreListing` (and its doc comment) and add the peer helpers. `recomputeReferences` and `GRADE_FLOOR_MULTIPLIER` stay byte-identical this task. New/changed code:

```ts
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { comps, listings, referencePrices } from "@/db/schema";
import type { Db } from "@/db/client";
```

```ts
// spec §15: peer-ask floor. A listing's peers are the OTHER active Buy-It-Now
// listings sharing (cardId, grader, grade) at high/medium match confidence.
// The floor is the minimum peer ask including shipping, and exists only with
// ≥2 peers — one lone ask never defines a market. Auctions are never peers
// (a mid-auction bid is not an ask).
export type PeerAsk = { ebayItemId: string; totalCents: number };

export const peerKey = (cardId: number, grader: string, grade: string | null) =>
  `${cardId}|${grader}|${grade ?? ""}`;

export async function collectPeerAsks(db: Db, cardIds: number[]): Promise<Map<string, PeerAsk[]>> {
  if (cardIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: listings.ebayItemId, cardId: listings.cardId, grader: listings.grader,
      grade: listings.grade, priceCents: listings.priceCents, shippingCents: listings.shippingCents,
    })
    .from(listings)
    .where(and(
      eq(listings.status, "active"),
      eq(listings.listingType, "bin"),
      inArray(listings.matchConfidence, ["high", "medium"]),
      inArray(listings.cardId, cardIds),
      isNotNull(listings.grader),
    ));
  const map = new Map<string, PeerAsk[]>();
  for (const r of rows) {
    if (r.cardId === null || r.grader === null) continue; // narrows for TS; the query already filters
    const key = peerKey(r.cardId, r.grader, r.grade);
    const ask = { ebayItemId: r.id, totalCents: r.priceCents + r.shippingCents };
    const asks = map.get(key);
    if (asks) asks.push(ask); else map.set(key, [ask]);
  }
  return map;
}

const MIN_PEERS = 2;

export function peerFloorCents(asks: PeerAsk[] | undefined, selfId: string): number | null {
  const peers = (asks ?? []).filter((a) => a.ebayItemId !== selfId);
  if (peers.length < MIN_PEERS) return null;
  return Math.min(...peers.map((a) => a.totalCents));
}

// spec §15 hierarchy: comp median (real observed sales) when present, else the
// live peer-ask floor, else unscored. scoreBps is basis points (score * 10000);
// negative values mean priced above the reference — valid, not an error.
export function scoreListing(input: {
  totalCents: number;
  compMedianCents?: number | null;
  peerFloorCents?: number | null;
}): { scoreBps: number; scoreBasis: "comp_median" | "peer_floor" } | null {
  const { totalCents, compMedianCents, peerFloorCents: floor } = input;
  if (compMedianCents != null && compMedianCents > 0)
    return { scoreBps: Math.round((1 - totalCents / compMedianCents) * 10000), scoreBasis: "comp_median" };
  if (floor != null && floor > 0)
    return { scoreBps: Math.round((1 - totalCents / floor) * 10000), scoreBasis: "peer_floor" };
  return null;
}
```

- [ ] **Step 5: Update the scan.ts ingest scoring hook**

In `src/lib/scan.ts`: remove `rawPrices` from the schema import (line 8); add `collectPeerAsks, peerFloorCents, peerKey` to the `@/lib/reference` import (line 6). Replace the scoring block (the `let scored ...` section, ~lines 138-164) with:

```ts
          // Scoring (spec §15): comp median preferred, live peer-ask floor as
          // fallback. scoreListing itself is pure — all DB access for its
          // inputs lives here. The new listing isn't inserted yet, so the
          // peer set naturally excludes it; selfId is passed for symmetry
          // with the nightly re-score path.
          let scored: ReturnType<typeof scoreListing> = null;
          if ((m.confidence === "high" || m.confidence === "medium") && m.cardId !== null) {
            const cardId = m.cardId;
            const [ref] = await db
              .select()
              .from(referencePrices)
              .where(
                and(
                  eq(referencePrices.cardId, cardId),
                  eq(referencePrices.grader, n.grader),
                  eq(referencePrices.grade, n.grade ?? ""),
                ),
              );
            const peerAsks = await collectPeerAsks(db, [cardId]);
            scored = scoreListing({
              totalCents: n.priceCents + n.shippingCents,
              compMedianCents: ref?.valueCents ?? null,
              peerFloorCents: peerFloorCents(peerAsks.get(peerKey(cardId, n.grader, n.grade)), item.itemId),
            });
          }
```

- [ ] **Step 6: Update the scan ingest scoring test**

In `tests/scan.test.ts`: the existing ingest-scoring test seeds `rawPrices` (line ~128) and expects `scoreBasis "raw_floor"` (line ~139). Replace the seed with two active peer BINs on the same card/grader/grade and update the expectations. Keep the test's existing card/listing fixture machinery; the essential replacement (adapt identifiers to the file's local fixtures):

```ts
    // Two live peer BIN asks define the floor (min incl. shipping = $1000.00);
    // the incoming listing at $593.78 scores 4062 bps against it.
    await db.insert(listings).values([
      { ebayItemId: "peer-1", cardId: card.id, categoryId: "183454", title: "peer 1", grader: "PSA", grade: "10",
        priceCents: 100000, shippingCents: 0, listingType: "bin", matchConfidence: "high", status: "active" },
      { ebayItemId: "peer-2", cardId: card.id, categoryId: "183454", title: "peer 2", grader: "PSA", grade: "10",
        priceCents: 119000, shippingCents: 1000, listingType: "bin", matchConfidence: "medium", status: "active" },
    ]);
```

and after the tick runs:

```ts
    expect(row.scoreBps).toBe(4062); // 1 - 59378/100000, in bps
    expect(row.scoreBasis).toBe("peer_floor");
```

(If the fixture listing's price in this test isn't 59378, keep the file's price and compute bps as `Math.round((1 - total/100000) * 10000)` — state the literal in the assertion, never the formula.) Delete the `rawPrices` import from this test file if nothing else in it uses it.

- [ ] **Step 7: Run the full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all tests pass (the two edited files green, everything else untouched), lint clean, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/lib/reference.ts src/lib/scan.ts tests/reference.test.ts tests/scan.test.ts
git commit -m "feat: peer-ask floor replaces raw-floor scoring basis (spec §15.1-2)"
```

---

### Task 2: Nightly re-score of active matched listings

**Files:**
- Modify: `src/lib/reference.ts` (add `rescoreActiveListings`)
- Modify: `src/lib/scan.ts` (nightly block ~lines 205-228; `TickReport` type)
- Test: `tests/reference.test.ts`, `tests/scan.test.ts`

**Interfaces:**
- Consumes (from Task 1, exact): `collectPeerAsks(db, cardIds)`, `peerFloorCents(asks, selfId)`, `peerKey(cardId, grader, grade)`, `scoreListing({ totalCents, compMedianCents, peerFloorCents })`.
- Produces: `rescoreActiveListings(db: Db, opts?: { shouldContinue?: () => boolean }): Promise<{ rescored: number; exhausted: boolean }>` — `rescored` counts rows WRITTEN (changed scores only); `exhausted: false` means the time guard stopped it early (next night continues — not an error). `TickReport` gains optional `rescored?: number`.

- [ ] **Step 1: Write the failing tests**

In `tests/reference.test.ts` add (same PGlite harness; import `rescoreActiveListings` and also `comps` + `recomputeReferences` where needed):

```ts
it("rescoreActiveListings clears stale scores, applies peer floors, prefers comps, and skips unchanged rows", async () => {
  const db = await makeTestDb();
  const [card] = await db.insert(cards).values({ game: "pokemon", name: "Pikachu V", setName: "S4", cardNumber: "104", createdFrom: "catalog" }).returning();
  const base = { cardId: card.id, categoryId: "183454", grader: "PSA" as const, grade: "10", shippingCents: 0, listingType: "bin" as const, matchConfidence: "high" as const, status: "active" as const };

  // (a) legacy raw_floor score with no basis left → must be cleared
  await db.insert(listings).values({ ...base, ebayItemId: "stale", title: "stale", priceCents: 50000, scoreBps: 7781, scoreBasis: "raw_floor" });
  const first = await rescoreActiveListings(db);
  expect(first).toEqual({ rescored: 1, exhausted: true });
  const [cleared] = await db.select().from(listings).where(eq(listings.ebayItemId, "stale"));
  expect(cleared.scoreBps).toBeNull();
  expect(cleared.scoreBasis).toBeNull();

  // (b) two peers appear → "stale" gains a peer_floor score on the next pass
  await db.insert(listings).values([
    { ...base, ebayItemId: "p1", title: "p1", priceCents: 100000 },
    { ...base, ebayItemId: "p2", title: "p2", priceCents: 110000 },
  ]);
  const second = await rescoreActiveListings(db);
  expect(second.exhausted).toBe(true);
  const [scored] = await db.select().from(listings).where(eq(listings.ebayItemId, "stale"));
  expect(scored.scoreBasis).toBe("peer_floor");
  expect(scored.scoreBps).toBe(5000); // 1 - 50000/100000

  // (c) running again with nothing changed writes nothing
  expect((await rescoreActiveListings(db)).rescored).toBe(0);

  // (d) a comp-median reference outranks the peer floor
  const soldAt = new Date();
  await db.insert(comps).values([1, 2, 3].map((i) => ({
    cardId: card.id, grader: "PSA" as const, grade: "10", soldPriceCents: 200000, soldAt, source: "manual" as const, ebayItemId: `c${i}`,
  })));
  await recomputeReferences(db);
  await rescoreActiveListings(db);
  const [comped] = await db.select().from(listings).where(eq(listings.ebayItemId, "stale"));
  expect(comped.scoreBasis).toBe("comp_median");
  expect(comped.scoreBps).toBe(7500); // 1 - 50000/200000
});

it("rescoreActiveListings honors the time guard", async () => {
  const db = await makeTestDb();
  expect(await rescoreActiveListings(db, { shouldContinue: () => false })).toEqual({ rescored: 0, exhausted: false });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run tests/reference.test.ts`
Expected: FAIL — `rescoreActiveListings` not exported.

- [ ] **Step 3: Implement `rescoreActiveListings` in `src/lib/reference.ts`**

```ts
// spec §15.3: nightly re-score. Peer floors move as copies appear and sell,
// so scores written at ingest go stale — recompute every active, matched,
// graded listing against CURRENT comp references and peer floors, clearing
// scores whose basis has evaporated. Processes highest-current-score first so
// stale top-of-feed rows flush earliest if the guard stops us short; only
// changed rows are written (steady-state nights are nearly free). One update
// round trip per changed row is the Neon-HTTP-driver norm (no transactions).
export async function rescoreActiveListings(
  db: Db,
  opts?: { shouldContinue?: () => boolean },
): Promise<{ rescored: number; exhausted: boolean }> {
  const shouldContinue = opts?.shouldContinue ?? (() => true);
  const rows = await db
    .select({
      id: listings.ebayItemId, cardId: listings.cardId, grader: listings.grader, grade: listings.grade,
      priceCents: listings.priceCents, shippingCents: listings.shippingCents,
      scoreBps: listings.scoreBps, scoreBasis: listings.scoreBasis,
    })
    .from(listings)
    .where(and(
      eq(listings.status, "active"),
      isNotNull(listings.cardId),
      isNotNull(listings.grader),
      inArray(listings.matchConfidence, ["high", "medium"]),
    ))
    .orderBy(sql`${listings.scoreBps} desc nulls last`);

  const cardIds = [...new Set(rows.map((r) => r.cardId).filter((id): id is number => id !== null))];
  const peerMap = await collectPeerAsks(db, cardIds);
  const refs = cardIds.length > 0
    ? await db.select().from(referencePrices).where(inArray(referencePrices.cardId, cardIds))
    : [];
  const refByKey = new Map(refs.map((r) => [`${r.cardId}|${r.grader}|${r.grade}`, r.valueCents]));

  let rescored = 0;
  for (const r of rows) {
    if (!shouldContinue()) return { rescored, exhausted: false };
    if (r.cardId === null || r.grader === null) continue; // narrows for TS; the query already filters
    const key = peerKey(r.cardId, r.grader, r.grade);
    const scored = scoreListing({
      totalCents: r.priceCents + r.shippingCents,
      compMedianCents: refByKey.get(key) ?? null,
      peerFloorCents: peerFloorCents(peerMap.get(key), r.id),
    });
    const nextBps = scored?.scoreBps ?? null;
    const nextBasis = scored?.scoreBasis ?? null;
    if (nextBps === r.scoreBps && nextBasis === r.scoreBasis) continue;
    await db.update(listings).set({ scoreBps: nextBps, scoreBasis: nextBasis }).where(eq(listings.ebayItemId, r.id));
    rescored++;
  }
  return { rescored, exhausted: true };
}
```

Add `sql` to the drizzle-orm import in `reference.ts` if not already present.

- [ ] **Step 4: Wire it into scan.ts's nightly block**

In `src/lib/scan.ts`: add `rescoreActiveListings` to the `@/lib/reference` import; add `rescored?: number;` to `TickReport` (after `referencesRecomputed?: number;`, with a one-line comment `// spec §15.3: rows re-scored by the nightly pass (present only when the nightly gate ran)`). Inside the nightly `if (storedDay !== today && now.getUTCHours() >= 9)` block, immediately after `report.referencesRecomputed = upserted;`, insert:

```ts
        const { rescored } = await rescoreActiveListings(db, { shouldContinue: withinPostIngestBudget });
        report.rescored = rescored;
```

(Placement matters: BEFORE the `syncState` day-marker upsert, so a crash mid-re-score retries the same night on the next tick rather than silently skipping a day.)

- [ ] **Step 5: Extend the existing nightly test in `tests/scan.test.ts`**

Find the existing nightly-recompute test (it asserts `referencesRecomputed`). In that test, add one active matched listing with a stale score before the tick (reusing the test's seeded card; any `priceCents`, `scoreBps: 1234, scoreBasis: "raw_floor"`, `matchConfidence: "high"`, `status: "active"`, `grader`/`grade` matching the seeded comp group if one exists), and after the tick assert:

```ts
    expect(report.rescored).toBeGreaterThanOrEqual(1);
```

- [ ] **Step 6: Run the full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass, clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reference.ts src/lib/scan.ts tests/reference.test.ts tests/scan.test.ts
git commit -m "feat: nightly re-score against current comps and peer floors (spec §15.3)"
```

---

### Task 3: Feed Value column — comps, then peer floor; rawPrices out

**Files:**
- Modify: `src/app/feed/page.tsx`
- Modify: `src/lib/reference.ts` (delete `GRADE_FLOOR_MULTIPLIER` — the feed is its last consumer)

**Interfaces:**
- Consumes (from Task 1, exact): `collectPeerAsks(db, cardIds)`, `peerFloorCents(asks, selfId)`, `peerKey(cardId, grader, grade)`.
- Produces: nothing downstream. No test file — the feed page has no test by repo precedent; verification is build + typecheck + the session lead's post-deploy production check.

- [ ] **Step 1: Edit `src/app/feed/page.tsx`**

1. Imports: remove `rawPrices` from the `@/db/schema` import; replace the `GRADE_FLOOR_MULTIPLIER` import with `collectPeerAsks, peerFloorCents, peerKey` from `@/lib/reference`.
2. Main query: delete the `.leftJoin(rawPrices, eq(rawPrices.cardId, listings.cardId))` line and the `rawMarketCents: rawPrices.marketCents` select field.
3. After the `cardIds` list is built (it already exists for the metrics query), fetch peer asks once for the page:

```tsx
  const peerAsks = await collectPeerAsks(db, cardIds);
```

4. Replace the `displayValue` helper with (note it now needs the row's id and keys):

```tsx
  const displayValue = (r: { id: string; cardId: number | null; grader: string | null; grade: string | null; refValueCents: number | null }) => {
    if (r.refValueCents != null && r.refValueCents > 0) return { cents: r.refValueCents, basis: "comps" };
    if (r.cardId == null || r.grader == null) return null;
    const floor = peerFloorCents(peerAsks.get(peerKey(r.cardId, r.grader, r.grade)), r.id);
    if (floor != null) return { cents: floor, basis: "peers" };
    return null;
  };
```

5. The Score column's basis label ternary becomes a three-way map — replace the existing expression with:

```tsx
                  {r.scoreBps != null
                    ? `${(r.scoreBps / 100).toFixed(2)}% (${r.scoreBasis === "comp_median" ? "comps" : r.scoreBasis === "peer_floor" ? "vs peers" : "raw floor"})`
                    : "—"}
```

("raw floor" renders only on legacy rows until the first nightly re-score flushes them.)

- [ ] **Step 2: Delete `GRADE_FLOOR_MULTIPLIER` from `src/lib/reference.ts`**

Remove the export and its comment. Run `grep -rn "GRADE_FLOOR_MULTIPLIER" src/ tests/` — expected: zero hits.

- [ ] **Step 3: Run the full suite, lint, typecheck, build**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit && pnpm exec next build`
Expected: all pass; the build compiles the feed page.

- [ ] **Step 4: Commit**

```bash
git add src/app/feed/page.tsx src/lib/reference.ts
git commit -m "feat: feed Value column uses comps then peer floor; rawPrices out (spec §15.4)"
```

---

### Task 4: Catalog-only Pokémon sync + README

**Files:**
- Modify: `src/lib/pokemonSync.ts`
- Modify: `README.md`
- Test: `tests/pokemonSync.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `syncPokemonPage(db, page)` now returns `{ upsertedCards: number }` (the `pricedCards` field is gone — `grep -rn "pricedCards" src/ scripts/ tests/` must end at zero hits). `runPokemonSync` signature unchanged.

- [ ] **Step 1: Update the tests first**

In `tests/pokemonSync.test.ts`: remove the `rawPrices` import's price-count assertions (`expect(first.pricedCards).toBe(2)` line ~12 and the `priceRows` select/assertions at lines ~16 and ~32) and replace with an explicit no-prices invariant. Keep the card-upsert assertions untouched. The replacement assertions:

```ts
    const prices = await db.select().from(rawPrices);
    expect(prices).toEqual([]); // spec §15.5: the sync never writes prices
```

(Keep the `rawPrices` import for this assertion.) Any fixture cards carrying `tcgplayer` price blobs STAY in the fixtures — they prove price data present in the API response is ignored, not merely absent.

- [ ] **Step 2: Run to verify the suite fails**

Run: `pnpm exec vitest run tests/pokemonSync.test.ts`
Expected: FAIL — `pricedCards` still returned and prices still written (assertion `toEqual([])` fails).

- [ ] **Step 3: Strip prices from `src/lib/pokemonSync.ts`**

1. Delete the `bestMarketCents` function entirely.
2. Delete the price-rows block in `syncPokemonPage` (the `const now = new Date();` through the `rawPrices` insert, lines ~92-107) and change both return statements to `{ upsertedCards: ... }` (`{ upsertedCards: 0 }` for the empty-page early return).
3. Remove `rawPrices` from the schema import.
4. In the zod `pokeCardSchema`, delete the `tcgplayer` field, and drop `tcgplayer` from the `select=` query-string in `runPokemonSync` (becomes `select=id,name,number,set`) — the sync no longer requests price data at all.
5. Update the file-top/section comments to say the sync is catalog-only per spec §15.5.

- [ ] **Step 4: Check the CLI script still compiles**

`scripts/sync-pokemon.ts` consumes `runPokemonSync`'s `onPage` info and final `{ pages, upsertedCards }` — neither changed. Run `grep -n "pricedCards" scripts/sync-pokemon.ts src/ -r` — expected: zero hits. If the script prints a price count anywhere, delete that print.

- [ ] **Step 5: Update README.md**

1. In the scoring/feed documentation: replace the raw-floor formula and grade-multiplier text with the §15 hierarchy — comp median (n≥3 observed sales in 30d) preferred, else peer floor (lowest live BIN ask incl. shipping among ≥2 other copies of the same card+grader+grade at high/medium match), else unscored; note the nightly re-score keeps scores current.
2. In the weekly-sync section: retitle the cadence guidance — the sync is catalog-only (new sets/cards for matching); prices are never fetched; running it around new-set releases (~monthly) is enough. `POKEMONTCG_API_KEY` stays required.
3. Leave the "Manual comps (Fanatics Collect etc.)" section untouched.

- [ ] **Step 6: Run the full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass, clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pokemonSync.ts tests/pokemonSync.test.ts README.md
git commit -m "feat: catalog-only pokemon sync — prices retired (spec §15.5)"
```

---

## Post-plan (session lead, not a task)

Push (auto-deploys production), verify the live feed's Value/Score columns, confirm the first nightly pass (≥09:00 UTC) flushes legacy raw_floor rows, update `.git/sdd/progress.md` and project memory.
