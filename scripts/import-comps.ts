import { readFileSync } from "node:fs";
import { getDb } from "@/db/client";
import { parseManualCompCsv, type ManualCompRow } from "@/lib/importComps";
import { importComps, previewResolveCard } from "@/lib/importCompsDb";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const rowLabel = (row: ManualCompRow) =>
  `${row.game} ${row.setName} #${row.cardNumber} ${row.name} ${row.grader} ${row.grade} ${money(row.soldPriceCents)} ${row.soldAt.toISOString().slice(0, 10)}`;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: pnpm comps:import <file.csv> [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const text = readFileSync(file, "utf8");
  const { rows, errors } = parseManualCompCsv(text, new Date());
  for (const e of errors) console.error(`line ${e.line}: ${e.message}`);

  const db = getDb();

  if (dryRun) {
    // Dry-run resolves cards read-only (never inserts) — see
    // previewResolveCard in importCompsDb.ts.
    let unmatched = 0;
    for (const row of rows) {
      const resolved = await previewResolveCard(db, row);
      let outcome: string;
      if ("error" in resolved) {
        unmatched++;
        outcome = `UNMATCHED — ${resolved.error}`;
      } else if ("wouldCreate" in resolved) {
        outcome = "CREATE (sports)";
      } else {
        outcome = `matched card #${resolved.cardId}`;
      }
      console.log(`would import: ${rowLabel(row)} → ${outcome}`);
    }
    console.log(`parse errors: ${errors.length}, rows: ${rows.length}, unmatched: ${unmatched}`);
    process.exitCode = errors.length > 0 || unmatched > 0 ? 1 : 0;
    return;
  }

  const result = await importComps(db, rows);
  console.log(`inserted ${result.inserted}, duplicates ${result.duplicates}, rejected ${result.rejected.length}, parse errors ${errors.length}`);
  for (const r of result.rejected) console.error(`rejected: ${rowLabel(r.row)} — ${r.reason}`);
  process.exitCode = errors.length > 0 || result.rejected.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
