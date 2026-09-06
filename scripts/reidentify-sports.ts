import { getDb } from "@/db/client";
import { reidentifySports } from "@/lib/reidentify";

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const db = getDb();
  const result = await reidentifySports(db, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
