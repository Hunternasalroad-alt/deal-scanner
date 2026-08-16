// eBay Browse API leaf category IDs used to scope newly-listed searches.
//
// pokemon is verified (eBay's "Pokémon Individual Cards" leaf category).
// The three sports IDs are placeholders: Step 5 (live verification via the
// taxonomy API's get_category_suggestions endpoint, plus a sanity search per
// candidate) requires EBAY_CLIENT_ID/SECRET, which are not available yet
// (.env.local does not exist). Do not invent these — an unverified numeric ID
// would silently scope searches to the wrong category or a nonexistent one.
// TBV: resolve via taxonomy API when EBAY keys exist (plan Task 4 Step 5)
export const CATEGORY_IDS: {
  pokemon: "183454";
  baseball: string;
  basketball: string;
  football: string;
} = {
  pokemon: "183454",
  baseball: "TBV",
  basketball: "TBV",
  football: "TBV",
};
