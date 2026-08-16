import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config({ path: ".env.local" }); // drizzle-kit runs outside Next.js — load the env file itself

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
