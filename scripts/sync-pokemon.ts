import { getDb } from "@/db/client";
import { runPokemonSync } from "@/lib/pokemonSync";

// Progress logging lives HERE (CLI), passed as a callback — the library stays
// silent so test output stays pristine. SYNC_START_PAGE resumes a failed run.
const startPage = Math.max(1, Number(process.env.SYNC_START_PAGE ?? "1") || 1);

runPokemonSync(
  getDb(),
  fetch,
  (p) => console.log(`page ${p.page}: +${p.upsertedCards} cards (${p.totalUpserted} total)`),
  startPage,
)
  .then((r) => console.log(`synced ${r.upsertedCards} cards over ${r.pages} pages`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
