import { getDb } from "@/db/client";
import { runPokemonSync } from "@/lib/pokemonSync";

runPokemonSync(getDb()).then((r) =>
  console.log(`synced ${r.upsertedCards} cards over ${r.pages} pages`)
);
