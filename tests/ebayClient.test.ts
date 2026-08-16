import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDb } from "./helpers/testDb";
import { checkAndCount, getAppToken, resetEbayAuthCache, searchNewlyListed, BudgetExceededError } from "@/lib/ebay/client";
import { apiBudget } from "@/db/schema";

const tokenResponse = { ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) };

describe("ebay client", () => {
  beforeEach(() => {
    // getAppToken reads env.EBAY_CLIENT_ID/SECRET; stub all required vars (same
    // pattern as pokemonSync.test.ts) so the lazy env proxy never throws here.
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("EBAY_CLIENT_ID", "test-id");
    vi.stubEnv("EBAY_CLIENT_SECRET", "test-secret");
    vi.stubEnv("POKEMONTCG_API_KEY", "test-key");
    vi.stubEnv("SCAN_SECRET", "a".repeat(32));
    resetEbayAuthCache(); // module-level cache must not leak across tests
  });
  it("fetches and caches the app token", async () => {
    const f = vi.fn().mockResolvedValue(tokenResponse as never);
    expect(await getAppToken(f as never)).toBe("tok");
    expect(await getAppToken(f as never)).toBe("tok");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("counts calls and hard-stops at 4800", async () => {
    const { db } = await makeTestDb();
    const day = new Date().toISOString().slice(0, 10);
    await db.insert(apiBudget).values({ day, kind: "search", count: 4799 });
    await checkAndCount(db, "detail"); // 4800th is allowed
    await expect(checkAndCount(db, "search")).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("search builds the right URL and parses items", async () => {
    const { db } = await makeTestDb();
    const f = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total: 1, itemSummaries: [{ itemId: "v1|1|0", title: "t", itemCreationDate: "2026-08-15T00:00:00Z", buyingOptions: ["FIXED_PRICE"] }] }),
      } as never);
    const page = await searchNewlyListed(db, { categoryId: "183454", sinceIso: "2026-08-15T00:00:00Z", offset: 0 }, f as never);
    expect(page.items).toHaveLength(1);
    const url = String(f.mock.calls[1][0]);
    expect(url).toContain("item_summary/search");
    expect(url).toContain("sort=newlyListed");
    expect(url).toContain("category_ids=183454");
    expect(url).toContain(encodeURIComponent("itemStartDate:[2026-08-15T00:00:00Z]"));
  });

  it("retries once on 429 then succeeds", async () => {
    const { db } = await makeTestDb();
    const f = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse as never)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "slow down" } as never)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ total: 0, itemSummaries: [] }) } as never);
    const page = await searchNewlyListed(db, { categoryId: "183454", sinceIso: "2026-08-15T00:00:00Z", offset: 0 }, f as never);
    expect(page.items).toHaveLength(0);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
