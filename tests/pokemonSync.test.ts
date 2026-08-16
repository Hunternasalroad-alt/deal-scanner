import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { syncPokemonPage, runPokemonSync } from "@/lib/pokemonSync";
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

  it("aborts if the API pages forever", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("EBAY_CLIENT_ID", "test-id");
    vi.stubEnv("EBAY_CLIENT_SECRET", "test-secret");
    vi.stubEnv("POKEMONTCG_API_KEY", "test-key");
    vi.stubEnv("SCAN_SECRET", "a".repeat(32));

    const { db } = await makeTestDb();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [page[0]] }) } as never);
    await expect(runPokemonSync(db, f as never)).rejects.toThrow(/exceeded 300 pages/);
  });
});
