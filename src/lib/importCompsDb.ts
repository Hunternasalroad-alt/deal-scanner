import { and, eq } from "drizzle-orm";
import { cards, comps } from "@/db/schema";
import type { Db } from "@/db/client";
import { syntheticCompId, type ManualCompRow } from "@/lib/importComps";

function formatCandidate(c: { setName: string; name: string; variant: string }): string {
  return `${c.setName || "(no set)"} / ${c.name} / ${c.variant || "(no variant)"}`;
}

// Broader than either lookup below on purpose: ignores set_name/variant so a
// typo'd set (the most common CSV mistake) still surfaces the real card as a
// candidate the user can copy from.
async function pokemonCandidates(db: Db, cardNumber: string) {
  return db
    .select({ setName: cards.setName, name: cards.name, variant: cards.variant })
    .from(cards)
    .where(and(eq(cards.game, "pokemon"), eq(cards.cardNumber, cardNumber)))
    .limit(3);
}

async function pokemonMatchError(db: Db, row: ManualCompRow): Promise<string> {
  const candidates = await pokemonCandidates(db, row.cardNumber);
  const prefix = `no pokemon catalog card matched set "${row.setName}" / name "${row.name}" / card_number "${row.cardNumber}" / variant "${row.variant}"`;
  return candidates.length === 0
    ? `${prefix} — no candidates`
    : `${prefix} — candidates sharing that card_number: ${candidates.map(formatCandidate).join("; ")}`;
}

// Repo policy: Pokémon cards come only from the pokemontcg.io catalog sync
// (src/lib/pokemonSync.ts) — a manual CSV row must MATCH an existing card,
// never create one, or a typo'd set name would silently fork the catalog.
// Lookup 1 trusts set_name (tolerant of a wrong/mistyped name); if that finds
// nothing, Lookup 2 falls back to trusting name instead (tolerant of a
// wrong/mistyped set_name). Either an ambiguous hit (>1) or a total miss (0
// from both) is an error.
async function resolvePokemonCard(db: Db, row: ManualCompRow): Promise<{ cardId: number } | { error: string }> {
  const setKey = row.setName.trim().toLowerCase();
  const byIdentity = await db
    .select()
    .from(cards)
    .where(and(eq(cards.game, "pokemon"), eq(cards.cardNumber, row.cardNumber), eq(cards.variant, row.variant)));

  const bySetName = byIdentity.filter((c) => c.setName.trim().toLowerCase() === setKey);
  if (bySetName.length === 1) return { cardId: bySetName[0].id };

  if (bySetName.length === 0) {
    const nameKey = row.name.toLowerCase(); // row.name is already trimmed by parseManualCompCsv
    const byName = byIdentity.filter((c) => c.name.toLowerCase() === nameKey);
    if (byName.length === 1) return { cardId: byName[0].id };
  }

  return { error: await pokemonMatchError(db, row) };
}

async function findSportsCard(db: Db, row: ManualCompRow) {
  const setKey = row.setName.toLowerCase();
  const nameKey = row.name.toLowerCase();
  const candidates = await db
    .select()
    .from(cards)
    .where(and(eq(cards.game, row.game), eq(cards.cardNumber, row.cardNumber), eq(cards.variant, row.variant)));
  return candidates.find((c) => c.setName.toLowerCase() === setKey && c.name.toLowerCase() === nameKey) ?? null;
}

// Sports cards (unlike Pokémon) are created on demand — there is no upstream
// catalog to defer to. Insert-then-reselect (mirroring src/lib/match.ts's
// firehose creation path) keeps two concurrent imports of the same new card
// race-safe against the cards_identity unique index instead of erroring.
async function resolveSportsCard(db: Db, row: ManualCompRow): Promise<{ cardId: number } | { error: string }> {
  const existing = await findSportsCard(db, row);
  if (existing) return { cardId: existing.id };

  const inserted = await db
    .insert(cards)
    .values({
      game: row.game, name: row.name, setName: row.setName, cardNumber: row.cardNumber,
      variant: row.variant, year: row.year, createdFrom: "manual",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return { cardId: inserted[0].id };

  const refound = await findSportsCard(db, row);
  return refound
    ? { cardId: refound.id }
    : { error: `card insert conflicted but no matching row was found for ${row.game} "${row.name}" #${row.cardNumber}` };
}

export async function resolveCard(db: Db, row: ManualCompRow): Promise<{ cardId: number } | { error: string }> {
  return row.game === "pokemon" ? resolvePokemonCard(db, row) : resolveSportsCard(db, row);
}

// Read-only variant for the CLI's --dry-run: same lookups as resolveCard, but
// a missing sports card is reported rather than created, so a preview run
// never writes to `cards`. Pokémon resolution is already read-only (it never
// creates), so it's reused as-is.
export async function previewResolveCard(
  db: Db,
  row: ManualCompRow,
): Promise<{ cardId: number } | { wouldCreate: true } | { error: string }> {
  if (row.game === "pokemon") return resolvePokemonCard(db, row);
  const existing = await findSportsCard(db, row);
  return existing ? { cardId: existing.id } : { wouldCreate: true };
}

export async function importComps(
  db: Db,
  rows: ManualCompRow[],
): Promise<{ inserted: number; duplicates: number; rejected: { row: ManualCompRow; reason: string }[] }> {
  let inserted = 0;
  let duplicates = 0;
  const rejected: { row: ManualCompRow; reason: string }[] = [];

  // Per-row, no transaction: the Neon HTTP driver has no session/transaction
  // support (the same constraint src/lib/sweeps.ts works under), so a
  // mid-import failure must not roll back rows already committed — it should
  // just reject the one row and move on to the next.
  for (const row of rows) {
    try {
      const resolved = await resolveCard(db, row);
      if ("error" in resolved) {
        rejected.push({ row, reason: resolved.error });
        continue;
      }

      const result = await db
        .insert(comps)
        .values({
          cardId: resolved.cardId, grader: row.grader, grade: row.grade,
          soldPriceCents: row.soldPriceCents, soldAt: row.soldAt,
          source: "manual", ebayItemId: syntheticCompId(row, resolved.cardId),
        })
        .onConflictDoNothing()
        .returning();
      if (result.length > 0) inserted++;
      else duplicates++;
    } catch (e) {
      rejected.push({ row, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return { inserted, duplicates, rejected };
}
