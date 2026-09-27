// Background worker (a separate Railway service from the API). One loop, several jobs:
//   feeds         every minute   ICS + Google calendar sync (each source ≤ every 30 min)
//   photos        every minute   retry photo extractions that never finished
//   departures    every minute   leave-by alerts with traffic
//   notifications every minute   email delivery (in-app is instant)
//   automation    every 5 min    rule engine → tasks
//   reminders     hourly         seasonal reminders → tasks
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "@mcp/db";
import { GoogleRoutesTrafficProvider } from "@mcp/planner";
import { loadConfig } from "./config.js";
import { Crypter } from "./lib/crypto.js";
import { fetchFeed } from "./ingestion/safe-fetch.js";
import { runDueSyncs } from "./ingestion/sync-runner.js";
import { HttpGoogleApi } from "./integrations/google-api.js";
import { runPendingExtractions } from "./extraction/process.js";
import { ClaudeScheduleExtractor } from "./extraction/extractor.js";
import { photoStoreFor } from "./app.js";
import { runAutomation } from "./jobs/automation.js";
import { runReminders } from "./jobs/reminders.js";
import { estimateOnlyTraffic, runDepartures } from "./jobs/departures.js";
import { ResendEmailSender, VapidPushSender, deliverPending } from "./jobs/notify.js";
import { JobScheduler } from "./jobs/scheduler.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });
const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const crypter = config.credentialsKey ? new Crypter(config.credentialsKey) : null;
const google = config.google ? new HttpGoogleApi(config.google) : null;
const extraction = {
  store: photoStoreFor(config),
  extractor: config.extractionModel ? new ClaudeScheduleExtractor(config.extractionModel) : null,
  log,
};
const traffic = config.mapsApiKey ? new GoogleRoutesTrafficProvider(config.mapsApiKey) : estimateOnlyTraffic;
const email = config.email ? new ResendEmailSender(config.email.resendApiKey, config.email.from) : null;
const push = config.vapid ? new VapidPushSender(config.vapid) : null;

const scheduler = new JobScheduler(
  [
    { name: "feeds", everySeconds: 60, run: () => runDueSyncs(prisma, { fetchFeed, crypter, google, log }) },
    { name: "photos", everySeconds: 60, run: async () => ({ retried: await runPendingExtractions(prisma, extraction) }) },
    { name: "departures", everySeconds: 60, run: () => runDepartures(prisma, { traffic, live: !!config.mapsApiKey }) },
    { name: "notifications", everySeconds: 60, run: () => deliverPending(prisma, { email, push, publicWebUrl: config.publicWebUrl }) },
    { name: "automation", everySeconds: 300, run: () => runAutomation(prisma) },
    { name: "reminders", everySeconds: 3600, run: () => runReminders(prisma) },
  ],
  log,
);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  });
}

log("worker started", { liveTraffic: !!config.mapsApiKey, email: !!email, push: !!push, photos: !!extraction.extractor, google: !!google });
while (!stopping) {
  await scheduler.tick();
  await new Promise((r) => setTimeout(r, 15_000));
}
