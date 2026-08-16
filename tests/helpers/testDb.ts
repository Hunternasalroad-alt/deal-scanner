import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

// drizzle-kit's pushSchema renders an unsuppressible progress spinner straight to
// process.stdout (hanji renderer, no quiet option), which would pollute every test
// run — mute stdout for exactly that call. Known caveat, accepted: hanji calls
// process.exit(1) if the push itself fails, which would kill the vitest worker
// instead of failing an assertion; if that ever bites, switch this helper to
// executing drizzle-kit-generated DDL instead.
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await quietly(async () => {
    const { pushSchema } = await import("drizzle-kit/api");
    const { apply } = await pushSchema(schema, db as never);
    await apply();
  });
  return { db };
}
export type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];
