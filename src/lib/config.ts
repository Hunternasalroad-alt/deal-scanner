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

// Lazy: parsing happens on first property ACCESS, not at import time.
// Importing this module must never throw (tests import it without real env vars);
// `env.X` everywhere else keeps working unchanged.
let cached: Env | null = null;
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    cached ??= loadEnv(process.env);
    return cached[prop as keyof Env];
  },
});
