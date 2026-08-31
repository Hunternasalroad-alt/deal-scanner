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
