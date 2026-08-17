import { getDb } from "@/db/client";
import { runPokemonSync } from "@/lib/pokemonSync";

// Progress logging lives HERE (CLI), passed as a callback — the library stays
// silent so test output stays pristine.
runPokemonSync(getDb(), fetch, (p) =>
  console.log(`page ${p.page}: +${p.upsertedCards} cards (${p.totalUpserted} total)`),
)
  .then((r) => console.log(`synced ${r.upsertedCards} cards over ${r.pages} pages`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
