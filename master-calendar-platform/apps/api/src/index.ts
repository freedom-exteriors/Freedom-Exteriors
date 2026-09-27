import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "@mcp/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const app = await buildApp({ prisma, config, logger: true });
await app.listen({ port: config.port, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
