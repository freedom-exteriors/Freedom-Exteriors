// Background worker (a separate Railway service): runs due feed syncs every minute.
// Steps 7–8 add the automation rules, reminder generator and leave-by alerts here.
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "@mcp/db";
import { loadConfig } from "./config.js";
import { Crypter } from "./lib/crypto.js";
import { fetchFeed } from "./ingestion/safe-fetch.js";
import { runDueIcsSyncs } from "./ingestion/ics-sync.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });
const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const crypter = config.credentialsKey ? new Crypter(config.credentialsKey) : null;
const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

let stopping = false;
async function tick() {
  try {
    const r = await runDueIcsSyncs(prisma, { fetchFeed, crypter, log });
    if (r.attempted) log("tick", r);
  } catch (err) {
    log("tick failed", { error: String(err) });
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  });
}

log("worker started");
while (!stopping) {
  await tick();
  await new Promise((r) => setTimeout(r, 60_000));
}

