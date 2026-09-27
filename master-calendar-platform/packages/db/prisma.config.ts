import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// .env lives at the monorepo root.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (non-pgbouncer) connection on Supabase.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
    // Scratch DB used by `migrate diff` / `migrate dev` to replay migrations.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
