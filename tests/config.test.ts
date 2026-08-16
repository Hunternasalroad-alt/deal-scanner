import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/config";

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
