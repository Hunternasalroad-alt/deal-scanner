import { and, inArray, isNotNull, lt } from "drizzle-orm";
import { listings } from "@/db/schema";
import type { Db } from "@/db/client";

// spec §16.1-2: a dropped listing's row exists to dedupe re-fetches of the
// recent search window and to keep dropReason observability — its raw JSON
// payload serves nothing and was ~96% of the listings table's bytes. Delete
// dropped rows once they age out of the window entirely, and null any raw
// still sitting on younger dropped rows (transition hygiene — new drops are
// inserted rawless as of M2.6). Retention only needs to cover realistic
// cursor lag; 48h is ~20x typical (final review, item C3).
const DROPPED_RETENTION_MS = 2 * 86400_000;

// Batch size for both passes below (final review, item I4): keeps every
// statement off the backlog's full size and gives shouldContinue() a chance
// to interrupt between batches instead of only before/after the whole pass.
export const PRUNE_BATCH = 1_000;

export async function pruneDroppedListings(
  db: Db,
  opts?: { shouldContinue?: () => boolean; now?: Date },
): Promise<{ rawsNulled: number; deleted: number; exhausted: boolean }> {
  const shouldContinue = opts?.shouldContinue ?? (() => true);
  if (!shouldContinue()) return { rawsNulled: 0, deleted: 0, exhausted: false };
  const cutoff = new Date((opts?.now ?? new Date()).getTime() - DROPPED_RETENTION_MS);

  const deleteWhere = and(isNotNull(listings.dropReason), lt(listings.firstSeen, cutoff));
  let deleted = 0;
  for (;;) {
    const batch = await db.select({ id: listings.ebayItemId }).from(listings).where(deleteWhere).limit(PRUNE_BATCH);
    if (batch.length === 0) break;
    await db.delete(listings).where(inArray(listings.ebayItemId, batch.map((r) => r.id)));
    deleted += batch.length;
    if (!shouldContinue()) return { rawsNulled: 0, deleted, exhausted: false };
  }

  const nullWhere = and(isNotNull(listings.dropReason), isNotNull(listings.raw));
  let rawsNulled = 0;
  for (;;) {
    const batch = await db.select({ id: listings.ebayItemId }).from(listings).where(nullWhere).limit(PRUNE_BATCH);
    if (batch.length === 0) break;
    await db.update(listings).set({ raw: null }).where(inArray(listings.ebayItemId, batch.map((r) => r.id)));
    rawsNulled += batch.length;
    if (!shouldContinue()) return { rawsNulled, deleted, exhausted: false };
  }

  return { rawsNulled, deleted, exhausted: true };
}
