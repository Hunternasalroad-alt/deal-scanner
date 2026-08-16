import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { syncPokemonPage } from "@/lib/pokemonSync";
import { cards, rawPrices } from "@/db/schema";
import page from "./fixtures/pokemontcgio-page.json";

describe("syncPokemonPage", () => {
  it("upserts cards, stores best market price in cents, is idempotent", async () => {
    const { db } = await makeTestDb();
    const first = await syncPokemonPage(db, page as never);
    expect(first.upsertedCards).toBe(3);
    expect(first.pricedCards).toBe(2);
    const again = await syncPokemonPage(db, page as never);
    expect(again.upsertedCards).toBe(3); // upsert, not duplicate
    expect(await db.select().from(cards)).toHaveLength(3);
    const prices = await db.select().from(rawPrices);
    expect(prices.find((p) => p.marketCents === 149924)).toBeTruthy();
  });
});
