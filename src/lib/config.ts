import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  EBAY_CLIENT_ID: z.string().min(1),
  EBAY_CLIENT_SECRET: z.string().min(1),
  POKEMONTCG_API_KEY: z.string().min(1),
  SCAN_SECRET: z.string().min(32),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v !== "0"),
  EBAY_ENV: z.literal("PRODUCTION").default("PRODUCTION"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const missing = r.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  return r.data;
}

// Lazy AND per-field: each property validates on first ACCESS, independently.
// Importing this module must never throw (tests import it without env vars), and
// a consumer must only need the vars it actually touches — e.g. `sync:pokemon`
// needs DATABASE_URL + POKEMONTCG_API_KEY and must not fail because the eBay
// pair isn't filled in yet. Errors name the exact var. `loadEnv` (full parse)
// remains for tests and any future whole-app boot check.
const fieldCache = new Map<string, unknown>();
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;
    if (fieldCache.has(prop)) return fieldCache.get(prop);
    const field = schema.shape[prop as keyof typeof schema.shape];
    if (!field) return undefined;
    const r = field.safeParse(process.env[prop]);
    if (!r.success) throw new Error(`Invalid environment: ${prop}`);
    fieldCache.set(prop, r.data);
    return r.data;
  },
});

// Test seam: per-field cache must be resettable between tests that stub env vars.
export function resetEnvCacheForTests(): void {
  fieldCache.clear();
}
