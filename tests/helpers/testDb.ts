import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const { pushSchema } = await import("drizzle-kit/api");
  const { apply } = await pushSchema(schema, db as never);
  await apply();
  return { db };
}
export type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];
