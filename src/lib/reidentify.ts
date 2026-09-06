import { and, inArray, isNotNull, isNull } from "drizzle-orm";
import { cards, comps, listings, referencePrices } from "@/db/schema";
import type { Db } from "@/db/client";
import { parseSportsTitle, setLabel } from "@/lib/sportsIdentity";

const SPORTS = ["baseball", "basketball", "football"] as const;
type SportsGame = (typeof SPORTS)[number];

type Identity = { game: SportsGame; setName: string; cardNumber: string; name: string; variant: string; year: number | null };
type Group = Identity & { listingIds: string[] };

export type ReidentifyResult = {
  listingsSeen: number;
  listingsRepointed: number;
  compsRepointed: number;
  cardsCreated: number;
  orphanCardsDeleted: number;
  unparsed: number;
  unresolved: number;
  orphanDeleteErrors: number;
};

// "|" is a safe delimiter: every field here comes from parseSportsTitle's
// curated dictionaries or its title-cased player residue, and none of those
// outputs can contain a pipe character.
const identityKey = (id: Identity) => `${id.game}|${id.setName}|${id.cardNumber}|${id.name}|${id.variant}`;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// spec §17.6: re-parse every accepted sports listing's title into its
// canonical (game, set, cardNumber, player, variant) identity (Task 1's
// parseSportsTitle/setLabel), re-point listings and comps at a find-or-created
// canonical card per identity, then delete firehose sports cards left with no
// listing/comp reference at all (and their reference_prices rows). Idempotent
// by construction — the same title always parses to the same identity — so a
// second run finds every card already in place and repoints nothing.
//
// Runs over the Neon HTTP driver, which has no transactions/sessions (the
// same constraint sweeps.ts and importCompsDb.ts work under): every statement
// below is individually safe to repeat, and `batchSize` bounds how many ids
// ride in one IN (...) list.
//
// dryRun performs the identical read-and-count pass but skips every write.
// An identity with no existing card has no real id yet to compare against —
// its listings/comps are compared against `undefined`, which no real row can
// already equal, so they still count correctly as "would repoint" even
// though no card is created.
export async function reidentifySports(
  db: Db,
  opts?: { dryRun?: boolean; batchSize?: number; orphanIdCeiling?: number },
): Promise<ReidentifyResult> {
  const dryRun = opts?.dryRun ?? false;
  const batchSize = opts?.batchSize ?? 500;

  // I1 (prod-critical): snapshot the orphan-deletion ceiling BEFORE this run
  // makes any write. Anything created after this point — by the live scan
  // tick running concurrently, or by this very run's card-creation step
  // below — carries an id above the ceiling and is excluded from the orphan
  // sweep at the bottom by construction, never by timing luck. Tests pin
  // this directly via opts.orphanIdCeiling.
  const orphanIdCeiling =
    opts?.orphanIdCeiling ?? Math.max(0, ...(await db.select({ id: cards.id }).from(cards)).map((c) => c.id));

  // Scope (spec §17.6): every accepted (non-dropped) sports listing. comps
  // carry no title of their own — they reach one only by joining back to a
  // listing on ebayItemId — so this same listing set anchors both passes.
  const rows = await db
    .select({ id: listings.ebayItemId, title: listings.title, game: listings.game, cardId: listings.cardId })
    .from(listings)
    .where(and(isNull(listings.dropReason), inArray(listings.game, [...SPORTS])));
  const cardIdByListingId = new Map(rows.map((r) => [r.id, r.cardId] as const));

  // Group listings by canonical identity: every title in a group parses to
  // the exact same 5-tuple, so they all resolve to one canonical card.
  const groups = new Map<string, Group>();
  let unparsed = 0;
  for (const row of rows) {
    const parsed = parseSportsTitle(row.title);
    // row.game is guaranteed non-null by the WHERE above (inArray never
    // matches SQL NULL); the check just satisfies the nullable column type.
    if (!parsed || !row.game) { unparsed++; continue; }
    const identity: Identity = {
      game: row.game as SportsGame, setName: setLabel(parsed.year, parsed.set), cardNumber: parsed.cardNumber,
      name: parsed.player, variant: parsed.variant, year: parsed.year,
    };
    const key = identityKey(identity);
    const group = groups.get(key);
    if (group) group.listingIds.push(row.id);
    else groups.set(key, { ...identity, listingIds: [row.id] });
  }
  const allGroups = [...groups.values()];

  // Resolve each identity to a canonical card id: find, or (outside dry-run)
  // create. `undefined` means "no card exists yet". In dry-run that's the
  // final answer (counted via cardsCreated; nothing written). In a real run
  // it can only survive the insert + re-select below if a concurrent writer
  // raced this one and somehow still isn't visible on re-select — such a
  // group is left untouched below rather than reported as done, and counted
  // in `unresolved`.
  const targetByKey = new Map<string, number | undefined>();
  let cardsCreated = 0;
  for (const batch of chunk(allGroups, batchSize)) {
    const numbers = [...new Set(batch.map((g) => g.cardNumber))];
    let existing = await db.select().from(cards).where(and(inArray(cards.game, [...SPORTS]), inArray(cards.cardNumber, numbers)));
    const findExisting = (g: Group) =>
      existing.find((c) => c.game === g.game && c.setName === g.setName && c.cardNumber === g.cardNumber && c.name === g.name && c.variant === g.variant);

    const toCreate = batch.filter((g) => findExisting(g) === undefined);
    cardsCreated += toCreate.length;

    if (!dryRun && toCreate.length > 0) {
      await db.insert(cards).values(toCreate.map((g) => ({
        game: g.game, setName: g.setName, cardNumber: g.cardNumber, name: g.name, variant: g.variant,
        year: g.year, createdFrom: "firehose" as const,
      }))).onConflictDoNothing();
      // Race/duplicate-safe re-select (same pattern as match.ts and
      // importCompsDb.ts's resolveSportsCard): onConflictDoNothing silently
      // drops rows that collided with a card another actor inserted
      // concurrently, so the ids below must come from a fresh read.
      existing = await db.select().from(cards).where(and(inArray(cards.game, [...SPORTS]), inArray(cards.cardNumber, numbers)));
    }

    for (const g of batch) targetByKey.set(identityKey(g), findExisting(g)?.id);
  }

  // Comps' before-state, read once up front so "did this comp's cardId
  // change" reflects the state before this run's writes rather than
  // trivially comparing a value against the thing it's about to become.
  const compCardIdByListingId = new Map<string, number | null>();
  for (const idBatch of chunk(rows.map((r) => r.id), batchSize)) {
    const compRows = await db.select({ id: comps.ebayItemId, cardId: comps.cardId }).from(comps).where(inArray(comps.ebayItemId, idBatch));
    for (const c of compRows) compCardIdByListingId.set(c.id, c.cardId);
  }

  let listingsRepointed = 0;
  let compsRepointed = 0;
  let unresolved = 0;
  for (const g of allGroups) {
    const target = targetByKey.get(identityKey(g));

    if (target === undefined) {
      if (!dryRun) { unresolved++; continue; } // unresolved race (see above) — leave this group untouched entirely
      // Would-create: no real row can already hold an id that doesn't exist,
      // so every listing counts as "would repoint" and every attached comp
      // as "would repoint" too.
      listingsRepointed += g.listingIds.length;
      compsRepointed += g.listingIds.filter((id) => compCardIdByListingId.has(id)).length;
      continue;
    }

    const listingsForGroup = g.listingIds.filter((id) => cardIdByListingId.get(id) !== target).length;
    const compsForGroup = g.listingIds.filter((id) => compCardIdByListingId.has(id) && compCardIdByListingId.get(id) !== target).length;
    listingsRepointed += listingsForGroup;
    compsRepointed += compsForGroup;
    if (dryRun) continue;
    // M7: nothing would actually change for this group — skip both UPDATEs.
    if (listingsForGroup === 0 && compsForGroup === 0) continue;

    for (const idBatch of chunk(g.listingIds, batchSize)) {
      await db.update(listings).set({ cardId: target, matchConfidence: "high" }).where(inArray(listings.ebayItemId, idBatch));
      await db.update(comps).set({ cardId: target }).where(inArray(comps.ebayItemId, idBatch));
    }
  }

  if (dryRun) {
    return {
      listingsSeen: rows.length, listingsRepointed, compsRepointed, cardsCreated,
      orphanCardsDeleted: 0, unparsed, unresolved, orphanDeleteErrors: 0,
    };
  }

  // Orphans: firehose sports cards with no listing or comp reference left
  // anywhere, restricted to cards that already existed at (or before) this
  // run's snapshot (I1) — a card created during this run, or by a
  // concurrently-running scan tick, is never a deletion candidate. Deliberately
  // table-wide rather than sports-scoped, so a stray reference from outside
  // this function's usual scope still protects the card — and avoids a
  // foreign-key violation on the delete below.
  const referencedByListings = await db.select({ id: listings.cardId }).from(listings).where(isNotNull(listings.cardId));
  const referencedByComps = await db.select({ id: comps.cardId }).from(comps).where(isNotNull(comps.cardId));
  const referenced = new Set(
    [...referencedByListings, ...referencedByComps].map((r) => r.id).filter((id): id is number => id !== null),
  );
  const sportsCards = await db.select({ id: cards.id, createdFrom: cards.createdFrom }).from(cards).where(inArray(cards.game, [...SPORTS]));
  const orphanIds = sportsCards
    .filter((c) => c.createdFrom === "firehose" && c.id <= orphanIdCeiling && !referenced.has(c.id))
    .map((c) => c.id);

  // I1: an FK failure deleting one chunk (e.g. a concurrent insert referenced
  // one of these ids after the `referenced` snapshot above) is caught and
  // counted instead of aborting the whole run — later chunks still get a
  // chance to delete.
  let orphanCardsDeleted = 0;
  let orphanDeleteErrors = 0;
  for (const idBatch of chunk(orphanIds, batchSize)) {
    try {
      await db.delete(referencePrices).where(inArray(referencePrices.cardId, idBatch));
      await db.delete(cards).where(inArray(cards.id, idBatch));
      orphanCardsDeleted += idBatch.length;
    } catch {
      orphanDeleteErrors++;
    }
  }

  return {
    listingsSeen: rows.length, listingsRepointed, compsRepointed, cardsCreated,
    orphanCardsDeleted, unparsed, unresolved, orphanDeleteErrors,
  };
}
