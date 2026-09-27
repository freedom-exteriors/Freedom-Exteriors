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

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
  }
}

export async function buildApp(opts: { prisma: PrismaClient; config: AppConfig; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true, // Railway / Vercel proxy: rate limits key on the real client IP
    bodyLimit: 1_000_000,
  });
  app.decorate("prisma", opts.prisma);
  app.decorate("config", opts.config);

  await app.register(cookie);
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
  return app;
}
