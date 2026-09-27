import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { Prisma, type PrismaClient } from "@mcp/db";
import type { AppConfig } from "./config.js";
import { HttpError } from "./lib/errors.js";
import { registerAuth } from "./auth/plugin.js";
import { authRoutes } from "./auth/routes.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { inviteRoutes } from "./routes/invites.js";
import { calendarSourceRoutes } from "./routes/calendar-sources.js";
import { googleRoutes } from "./routes/google.js";
import { eventRoutes } from "./routes/events.js";
import { taskRoutes } from "./routes/tasks.js";
import { shoppingRoutes } from "./routes/shopping.js";
import { goalRoutes } from "./routes/goals.js";
import { peopleRoutes, type Geocoder } from "./routes/people.js";
import { planRoutes } from "./routes/plan.js";
import { geocodeAddress } from "@mcp/planner";
import multipart from "@fastify/multipart";
import { photoRoutes } from "./routes/photos.js";
import { notificationRoutes } from "./routes/notifications.js";
import { redactWallToken, wallRoutes } from "./routes/wall.js";
import { LocalDiskPhotoStore, SupabasePhotoStore, type PhotoStore } from "./extraction/photo-store.js";
import { ClaudeScheduleExtractor, type ScheduleExtractor } from "./extraction/extractor.js";
import { HttpGoogleApi, type GoogleApi } from "./integrations/google-api.js";
import { Crypter } from "./lib/crypto.js";
import { fetchFeed, type FeedFetcher } from "./ingestion/safe-fetch.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    feedFetcher: FeedFetcher;
    crypter: Crypter | null;
    google: GoogleApi | null;
    geocoder: Geocoder | null;
    photoStore: PhotoStore;
    extractor: ScheduleExtractor | null;
  }
}

export async function buildApp(opts: {
  prisma: PrismaClient;
  config: AppConfig;
  logger?: boolean;
  /** Injected in tests; defaults to the SSRF-safe fetcher. */
  feedFetcher?: FeedFetcher;
  /** Injected in tests; defaults to the real client when GOOGLE_* env vars are set. */
  google?: GoogleApi | null;
  geocoder?: Geocoder | null;
  photoStore?: PhotoStore;
  extractor?: ScheduleExtractor | null;
}): Promise<FastifyInstance> {
  const app = Fastify({
    // Wall-display links are bearer secrets in the URL: never write them to logs.
    logger: opts.logger
      ? { serializers: { req: (req) => ({ method: req.method, url: redactWallToken(req.url), remoteAddress: req.ip }) } }
      : false,
    trustProxy: true, // Railway / Vercel proxy: rate limits key on the real client IP
    bodyLimit: 1_000_000,
  });
  app.decorate("prisma", opts.prisma);
  app.decorate("config", opts.config);
  app.decorate("feedFetcher", opts.feedFetcher ?? fetchFeed);
  app.decorate("crypter", opts.config.credentialsKey ? new Crypter(opts.config.credentialsKey) : null);
  app.decorate("photoStore", opts.photoStore ?? photoStoreFor(opts.config));
  app.decorate(
    "extractor",
    opts.extractor !== undefined ? opts.extractor : opts.config.extractionModel ? new ClaudeScheduleExtractor(opts.config.extractionModel) : null,
  );
  const mapsKey = opts.config.mapsApiKey;
  app.decorate(
    "geocoder",
    opts.geocoder !== undefined ? opts.geocoder : mapsKey ? (address: string, near?: { lat: number; lng: number }) => geocodeAddress(address, mapsKey, { near }) : null,
  );
  app.decorate("google", opts.google !== undefined ? opts.google : opts.config.google ? new HttpGoogleApi(opts.config.google) : null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return reply.code(409).send({ error: "conflict", message: "That already exists" });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: status === 429 ? "rate_limited" : "bad_request", message: err instanceof Error ? err.message : "Bad request" });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "internal", message: "Something went wrong" });
  });

  await registerAuth(app);
  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(inviteRoutes);
  await app.register(calendarSourceRoutes);
  await app.register(googleRoutes);
  await app.register(eventRoutes);
  await app.register(taskRoutes);
  await app.register(shoppingRoutes);
  await app.register(goalRoutes);
  await app.register(peopleRoutes);
  await app.register(planRoutes);
  await app.register(photoRoutes);
  await app.register(notificationRoutes);
  await app.register(wallRoutes);
  return app;
}

export function photoStoreFor(config: AppConfig): PhotoStore {
  const s = config.supabaseStorage;
  return s ? new SupabasePhotoStore(s.url, s.serviceRoleKey, s.bucket) : new LocalDiskPhotoStore(config.photoDir);
}
