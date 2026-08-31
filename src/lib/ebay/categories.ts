// eBay Browse API leaf category IDs used to scope newly-listed searches.
// pokemon: "Pokémon Individual Cards" leaf, verified M1. sports: ALL sports
// singles resolve to ONE leaf (spec §14.2), verified live 2026-08-30 with
// per-sport aspect_filter sanity searches (Baseball 8,528/hr, Basketball
// 3,632/hr, Football 7,935/hr at time of measurement).
export const CATEGORY_IDS = {
  pokemon: "183454",
  sports: "261328",
} as const;
