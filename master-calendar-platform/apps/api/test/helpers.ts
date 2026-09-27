import path from "node:path";
import { after } from "node:test";
import { config as loadEnv } from "dotenv";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createPrismaClient } from "@mcp/db";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import type { FeedFetcher, FeedRequest } from "../src/ingestion/safe-fetch.js";
import type { GoogleApi } from "../src/integrations/google-api.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });

export const ORIGIN = "http://localhost:5173";
export const prisma = createPrismaClient();
const run = Math.random().toString(36).slice(2, 8);
export const email = (name: string) => `${name}-${run}@api-test.test`;

const apps: FastifyInstance[] = [];
export const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

export async function makeApp(
  overrides: Partial<AppConfig> = {},
  deps: { feedFetcher?: FeedFetcher; google?: GoogleApi | null } = {},
): Promise<FastifyInstance> {
  const config = {
    ...loadConfig({ ...process.env, NODE_ENV: "test", WEB_ORIGIN: ORIGIN }),
    authRateLimitMax: 1000,
    credentialsKey: TEST_KEY,
    ...overrides,
  };
  const app = await buildApp({ prisma, config, ...deps });
  apps.push(app);
  return app;
}

after(async () => {
  // Workspaces created by test users (owner memberships), then the users themselves.
  const users = await prisma.user.findMany({ where: { email: { endsWith: `-${run}@api-test.test` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const owned = await prisma.workspaceMembership.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
  await prisma.workspace.deleteMany({ where: { id: { in: owned.map((o) => o.workspaceId) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const app of apps) await app.close();
  await prisma.$disconnect();
});

/** A tiny cookie-jar client around app.inject. */
export class Client {
  cookie: string | null = null;
  constructor(readonly app: FastifyInstance) {}

  async req(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: body as object | undefined,
      headers: { origin: ORIGIN, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.cookies.find((c) => c.name === "session");
    if (set) this.cookie = set.value ? `session=${set.value}` : null;
    return res;
  }
  get = (url: string) => this.req("GET", url);
  post = (url: string, body?: unknown) => this.req("POST", url, body ?? {});
  patch = (url: string, body?: unknown) => this.req("PATCH", url, body ?? {});
  del = (url: string) => this.req("DELETE", url);

  async signup(name: string, workspace?: { name: string; vertical: "family" | "student" | "business" }) {
    const res = await this.post("/auth/signup", { email: email(name), password: "correct horse battery", displayName: name, workspace });
    if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
    return res.json() as { user: { id: string; email: string }; workspaceId: string | null };
  }
}

export const json = (res: LightMyRequestResponse) => res.json();

/** A feed you can edit between syncs; records what the fetcher was asked for. */
export class FakeFeed {
  requests: { url: string; req?: FeedRequest }[] = [];
  error: Error | null = null;
  constructor(public body: string) {}
  fetcher: FeedFetcher = async (url, req) => {
    this.requests.push({ url, req });
    if (this.error) throw this.error;
    return { status: "ok", body: this.body, etag: null, lastModified: null };
  };
}
