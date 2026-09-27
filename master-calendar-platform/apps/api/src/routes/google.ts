// "Connect Google Calendar": OAuth (authorization code + PKCE + single-use state), then
// the person picks which of their calendars to bring in. Read-only.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { HttpError, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { assertParticipantIn, assertTagIn } from "../lib/scope.js";
import { hasRole, requireWorkspace } from "../auth/plugin.js";
import { hashToken } from "../auth/session.js";
import { CALENDAR_SCOPE, decodeIdToken, type GoogleApi } from "../integrations/google-api.js";
import { getAccessToken } from "../integrations/google-sync.js";
import { describeSyncError, syncSource } from "../ingestion/sync-runner.js";

const STATE_TTL_MS = 10 * 60_000;

const connParams = z.object({ workspaceId: z.string().uuid(), connectionId: z.string().uuid() });
const callbackQuery = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(2000).optional(),
  error: z.string().max(200).optional(),
});
const addBody = z.object({
  calendars: z
    .array(
      z.object({
        calendarId: z.string().min(1).max(500),
        name: z.string().trim().min(1).max(120).optional(),
        defaultParticipantId: z.string().uuid().nullable().optional(),
        defaultEventTagId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(25),
});

export async function googleRoutes(app: FastifyInstance) {
  const requireGoogle = (): GoogleApi => {
    if (!app.google || !app.crypter) throw new HttpError(503, "not_configured", "Google Calendar isn't set up on this server yet");
    return app.google;
  };
  const syncDeps = () => ({ fetchFeed: app.feedFetcher, crypter: app.crypter, google: app.google });

  /** Loads a connection in this workspace that the caller personally owns. */
  async function myConnection(workspaceId: string, connectionId: string, userId: string) {
    const conn = await app.prisma.oAuthConnection.findFirst({ where: { id: connectionId, workspaceId } });
    if (!conn) throw notFound("Google account not found");
    if (conn.connectedByUserId !== userId) throw forbidden("Only the person who connected this Google account can choose its calendars");
    return conn;
  }

  app.post("/workspaces/:workspaceId/integrations/google/start", { preHandler: requireWorkspace("member") }, async (req) => {
    const google = requireGoogle();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    await app.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // housekeeping
    await app.prisma.oAuthState.create({
      data: {
        stateHash: hashToken(state),
        codeVerifier,
        provider: "google",
        userId: req.user!.id,
        workspaceId: req.membership!.workspaceId,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    return { url: google.authUrl({ state, codeChallenge }) };
  });

  // Google sends the browser here. Always answers with a redirect back into the web app.
  app.get("/integrations/google/callback", async (req, reply) => {
    const q = parse(callbackQuery, req.query);
    const back = (workspaceId: string | null, params: Record<string, string>) =>
      redirectToWeb(app, reply, workspaceId, params);

    if (!q.state) return back(null, { google: "error", reason: "invalid_request" });
    const state = await app.prisma.oAuthState.findUnique({ where: { stateHash: hashToken(q.state) } });
    if (!state) return back(null, { google: "error", reason: "expired" });
    await app.prisma.oAuthState.delete({ where: { id: state.id } }); // single use, whatever happens next
    const workspaceId = state.workspaceId;

    if (state.expiresAt < new Date()) return back(workspaceId, { google: "error", reason: "expired" });
    // The browser finishing the flow must be the person who started it (login-CSRF guard).
    if (!req.user || req.user.id !== state.userId) return back(workspaceId, { google: "error", reason: "wrong_account" });
    const membership = await app.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
    });
    if (!membership || !hasRole(membership.role, "member")) return back(null, { google: "error", reason: "forbidden" });
    if (q.error || !q.code) return back(workspaceId, { google: "error", reason: q.error === "access_denied" ? "denied" : "failed" });

    let google: GoogleApi;
    try {
      google = requireGoogle();
    } catch {
      return back(workspaceId, { google: "error", reason: "not_configured" });
    }
    try {
      const tokens = await google.exchangeCode(q.code, state.codeVerifier);
      // Google's consent screen lets people untick the calendar box.
      if (!tokens.scope.split(" ").includes(CALENDAR_SCOPE)) {
        await google.revoke(tokens.accessToken);
        return back(workspaceId, { google: "error", reason: "calendar_scope_missing" });
      }
      if (!tokens.idToken) throw new Error("no id_token");
      const { sub, email } = decodeIdToken(tokens.idToken);
      const existing = await app.prisma.oAuthConnection.findUnique({
        where: { workspaceId_provider_providerAccountId: { workspaceId, provider: "google", providerAccountId: sub } },
      });
      const refreshToken = tokens.refreshToken ? app.crypter!.encrypt(tokens.refreshToken) : existing?.refreshTokenEnc;
      if (!refreshToken) throw new Error("no refresh token");
      const data = {
        connectedByUserId: req.user.id,
        accountEmail: email,
        accessTokenEnc: app.crypter!.encrypt(tokens.accessToken),
        refreshTokenEnc: refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scope,
        status: "active" as const,
      };
      const conn = existing
        ? await app.prisma.oAuthConnection.update({ where: { id: existing.id }, data })
        : await app.prisma.oAuthConnection.create({ data: { ...data, workspaceId, provider: "google", providerAccountId: sub } });
      if (existing) {
        // Reconnected after a revoke: clear the "reconnect Google" errors and sync soon.
        await app.prisma.calendarSource.updateMany({ where: { oauthConnectionId: conn.id }, data: { lastSyncError: null, nextSyncAt: new Date() } });
      }
      return back(workspaceId, { google: "connected", connectionId: conn.id });
    } catch (err) {
      req.log.warn({ err }, "google oauth callback failed");
      return back(workspaceId, { google: "error", reason: "failed" });
    }
  });

  app.get("/workspaces/:workspaceId/integrations/google", { preHandler: requireWorkspace("member") }, async (req) => {
    const rows = await app.prisma.oAuthConnection.findMany({
      where: { workspaceId: req.membership!.workspaceId, provider: "google" },
      include: { _count: { select: { sources: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((c) => ({
      id: c.id,
      email: c.accountEmail,
      status: c.status,
      calendarCount: c._count.sources,
      mine: c.connectedByUserId === req.user!.id,
    }));
  });

  app.get("/workspaces/:workspaceId/integrations/google/:connectionId/calendars", { preHandler: requireWorkspace("member") }, async (req) => {
    requireGoogle();
    const { workspaceId, connectionId } = parse(connParams, req.params);
    const conn = await myConnection(workspaceId, connectionId, req.user!.id);
    const token = await getGoogleToken(app, conn);
    const [calendars, added] = await Promise.all([
      app.google!.listCalendars(token),
      app.prisma.calendarSource.findMany({ where: { oauthConnectionId: conn.id }, select: { id: true, externalCalendarId: true } }),
    ]);
    const addedBy = new Map(added.map((a) => [a.externalCalendarId, a.id]));
    return calendars.map((c) => ({ ...c, sourceId: addedBy.get(c.id) ?? null }));
  });

  app.post("/workspaces/:workspaceId/integrations/google/:connectionId/calendars", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    requireGoogle();
    const { workspaceId, connectionId } = parse(connParams, req.params);
    const body = parse(addBody, req.body);
    const conn = await myConnection(workspaceId, connectionId, req.user!.id);
    for (const c of body.calendars) {
      await assertParticipantIn(app.prisma, workspaceId, c.defaultParticipantId);
      await assertTagIn(app.prisma, workspaceId, c.defaultEventTagId);
    }
    // Only calendars this account can actually see (not arbitrary calendar ids).
    const available = new Map((await app.google!.listCalendars(await getGoogleToken(app, conn))).map((c) => [c.id, c]));

    const results = [];
    for (const c of body.calendars) {
      const cal = available.get(c.calendarId);
      if (!cal) {
        results.push({ calendarId: c.calendarId, ok: false, error: "That calendar isn't in this Google account" });
        continue;
      }
      const dup = await app.prisma.calendarSource.findFirst({ where: { oauthConnectionId: conn.id, externalCalendarId: c.calendarId } });
      if (dup) {
        results.push({ calendarId: c.calendarId, ok: false, error: "Already added", sourceId: dup.id });
        continue;
      }
      const source = await app.prisma.calendarSource.create({
        data: {
          workspaceId,
          type: "google",
          name: c.name ?? cal.name,
          oauthConnectionId: conn.id,
          externalCalendarId: c.calendarId,
          defaultParticipantId: c.defaultParticipantId ?? null,
          defaultEventTagId: c.defaultEventTagId ?? null,
        },
      });
      try {
        const stats = await syncSource(app.prisma, source.id, syncDeps());
        results.push({ calendarId: c.calendarId, ok: true, sourceId: source.id, stats });
      } catch (err) {
        await app.prisma.calendarSource.delete({ where: { id: source.id } });
        results.push({ calendarId: c.calendarId, ok: false, error: describeSyncError(err) });
      }
    }
    return reply.code(results.some((r) => r.ok) ? 201 : 422).send({ results });
  });

  // Disconnect: revokes our access at Google and removes the calendars (and their events).
  app.delete("/workspaces/:workspaceId/integrations/google/:connectionId", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const { workspaceId, connectionId } = parse(connParams, req.params);
    const conn = await app.prisma.oAuthConnection.findFirst({ where: { id: connectionId, workspaceId } });
    if (!conn) throw notFound("Google account not found");
    if (conn.connectedByUserId !== req.user!.id && req.membership!.role !== "owner") throw forbidden();
    if (app.google && app.crypter) {
      await app.google.revoke(app.crypter.decrypt(conn.refreshTokenEnc)).catch(() => {});
    }
    await app.prisma.oAuthConnection.delete({ where: { id: conn.id } });
    return reply.code(204).send();
  });
}

async function getGoogleToken(app: FastifyInstance, conn: Parameters<typeof getAccessToken>[1]) {
  try {
    return await getAccessToken(app.prisma, conn, { google: app.google, crypter: app.crypter });
  } catch (err) {
    throw new HttpError(409, "reconnect_required", describeSyncError(err));
  }
}

function redirectToWeb(app: FastifyInstance, reply: FastifyReply, workspaceId: string | null, params: Record<string, string>) {
  const path = workspaceId ? `/w/${workspaceId}/settings/calendars` : "/";
  return reply.redirect(`${app.config.publicWebUrl}${path}?${new URLSearchParams(params)}`, 302);
}
