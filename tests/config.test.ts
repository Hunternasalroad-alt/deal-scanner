import { afterEach, describe, expect, it, vi } from "vitest";
import { env, loadEnv, resetEnvCacheForTests } from "@/lib/config";

const good = {
  DATABASE_URL: "postgres://u:p@h/db",
  EBAY_CLIENT_ID: "id",
  EBAY_CLIENT_SECRET: "secret",
  POKEMONTCG_API_KEY: "k",
  SCAN_SECRET: "s".repeat(64),
};

describe("loadEnv", () => {
  it("parses a complete env and defaults DRY_RUN to true", () => {
    const env = loadEnv(good);
    expect(env.DRY_RUN).toBe(true);
    expect(env.EBAY_ENV).toBe("PRODUCTION");
  });
  it("respects DRY_RUN=0", () => {
    expect(loadEnv({ ...good, DRY_RUN: "0" }).DRY_RUN).toBe(false);
  });
  it("throws naming the missing var", () => {
    const { SCAN_SECRET: _omit, ...bad } = good;
    expect(() => loadEnv(bad)).toThrowError(/SCAN_SECRET/);
  });
});

describe("env (per-field proxy)", () => {
  afterEach(() => {
    resetEnvCacheForTests();
    vi.unstubAllEnvs();
  });

  it("per-field access works when unrelated vars are missing", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h/db");
    expect(env.DATABASE_URL).toBe("postgres://u:p@h/db"); // eBay vars absent — must not throw
  });
  it("accessing a missing field names exactly that field", () => {
    expect(() => env.EBAY_CLIENT_ID).toThrowError(/EBAY_CLIENT_ID/);
  });
  it("defaulted fields resolve without the var set", () => {
    expect(env.DRY_RUN).toBe(true);
    expect(env.EBAY_ENV).toBe("PRODUCTION");
  });
});
