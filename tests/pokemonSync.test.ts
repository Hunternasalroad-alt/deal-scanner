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

  it("retries transient 5xx and then succeeds", async () => {
    vi.stubEnv("POKEMONTCG_API_KEY", "k");
    const { db } = await makeTestDb();
    vi.useFakeTimers();
    try {
      const f = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500 } as never)
        .mockResolvedValueOnce({ ok: false, status: 502 } as never)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [page[0]] }) } as never)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) } as never);
      const promise = runPokemonSync(db, f as never);
      await vi.advanceTimersByTimeAsync(5_000); // covers the 1s + 3s backoffs
      const r = await promise;
      expect(r).toEqual({ pages: 1, upsertedCards: 1 });
      expect(f).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes from startPage", async () => {
    vi.stubEnv("POKEMONTCG_API_KEY", "k");
    const { db } = await makeTestDb();
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [page[0]] }) } as never)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) } as never);
    const r = await runPokemonSync(db, f as never, undefined, 41);
    expect(r).toEqual({ pages: 1, upsertedCards: 1 });
    expect(String(f.mock.calls[0][0])).toContain("page=41");
    expect(String(f.mock.calls[1][0])).toContain("page=42");
  });
});
