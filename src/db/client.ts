import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "@/lib/config";
import * as schema from "./schema";

export function getDb() {
  return drizzle(neon(env.DATABASE_URL), { schema });
}
export type Db = ReturnType<typeof getDb> | import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
