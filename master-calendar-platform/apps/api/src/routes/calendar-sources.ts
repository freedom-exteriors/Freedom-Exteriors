import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, badRequest, conflict, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { assertParticipantIn, assertTagIn } from "../lib/scope.js";
import { requireWorkspace } from "../auth/plugin.js";
import { normalizeFeedUrl } from "../ingestion/safe-fetch.js";
import { describeSyncError, syncIcsSource } from "../ingestion/ics-sync.js";

const MANUAL_SYNC_COOLDOWN_MS = 5 * 60_000;

const createBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  feedUrl: z.string().trim().min(1).max(2000),
  defaultParticipantId: z.string().uuid().nullable().optional(),
  defaultEventTagId: z.string().uuid().nullable().optional(),
  username: z.string().max(500).optional(),
  password: z.string().max(500).optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  defaultParticipantId: z.string().uuid().nullable().optional(),
  defaultEventTagId: z.string().uuid().nullable().optional(),
  /** Also give existing unassigned/untagged events from this feed the new defaults. */
  applyToExisting: z.boolean().default(false),
});

const sourceParams = z.object({ workspaceId: z.string().uuid(), sourceId: z.string().uuid() });

/** Feed URLs often embed a private token (ParentSquare, SportsEngine): never echo them back. */
function maskUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return `${new URL(url).host}/…`;
  } catch {
    return "…";
  }
}

export async function calendarSourceRoutes(app: FastifyInstance) {
  const syncDeps = () => ({ fetchFeed: app.feedFetcher, crypter: app.crypter });

  app.get("/workspaces/:workspaceId/calendar-sources", { preHandler: requireWorkspace() }, async (req) => {
    const rows = await app.prisma.calendarSource.findMany({
      where: { workspaceId: req.membership!.workspaceId },
      include: { _count: { select: { events: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      feed: maskUrl(s.feedUrl),
      hasCredentials: !!s.feedPasswordEnc,
      defaultParticipantId: s.defaultParticipantId,
      defaultEventTagId: s.defaultEventTagId,
      lastSyncedAt: s.lastSyncedAt,
      nextSyncAt: s.nextSyncAt,
      lastSyncError: s.lastSyncError,
      lastSyncStats: s.lastSyncStats,
      eventCount: s._count.events,
    }));
  });

  app.post("/workspaces/:workspaceId/calendar-sources", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const body = parse(createBody, req.body);
    const workspaceId = req.membership!.workspaceId;
    let url: URL;
    try {
      url = normalizeFeedUrl(body.feedUrl);
    } catch (err) {
      throw badRequest("invalid_feed", (err as Error).message);
    }
    await assertParticipantIn(app.prisma, workspaceId, body.defaultParticipantId);
    await assertTagIn(app.prisma, workspaceId, body.defaultEventTagId);
    if (await app.prisma.calendarSource.count({ where: { workspaceId, feedUrl: url.toString() } })) {
      throw conflict("duplicate_feed", "That calendar is already connected");
    }
    const hasCreds = !!(body.username || body.password);
    if (hasCreds && !app.crypter) throw new HttpError(503, "not_configured", "Password-protected feeds aren't enabled on this server");

    const source = await app.prisma.calendarSource.create({
      data: {
        workspaceId,
        type: "ics_feed",
        name: body.name ?? url.host,
        feedUrl: url.toString(),
        defaultParticipantId: body.defaultParticipantId ?? null,
        defaultEventTagId: body.defaultEventTagId ?? null,
        feedUsernameEnc: hasCreds ? app.crypter!.encrypt(body.username ?? "") : null,
        feedPasswordEnc: hasCreds ? app.crypter!.encrypt(body.password ?? "") : null,
      },
    });
    // First sync runs right away so a bad link fails here, with a message, not silently later.
    try {
      const stats = await syncIcsSource(app.prisma, source.id, syncDeps());
      return reply.code(201).send({ id: source.id, stats });
    } catch (err) {
      await app.prisma.calendarSource.delete({ where: { id: source.id } });
      req.log.warn({ err }, "initial ics sync failed");
      throw new HttpError(422, "feed_unreadable", describeSyncError(err));
    }
  });

  app.patch("/workspaces/:workspaceId/calendar-sources/:sourceId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { sourceId } = parse(sourceParams, req.params);
    const body = parse(updateBody, req.body);
    const workspaceId = req.membership!.workspaceId;
    await findSource(app, workspaceId, sourceId);
    await assertParticipantIn(app.prisma, workspaceId, body.defaultParticipantId);
    await assertTagIn(app.prisma, workspaceId, body.defaultEventTagId);

    const updated = await app.prisma.calendarSource.update({
      where: { id: sourceId },
      data: { name: body.name, defaultParticipantId: body.defaultParticipantId, defaultEventTagId: body.defaultEventTagId },
    });
    let assigned = 0;
    let tagged = 0;
    if (body.applyToExisting) {
      // Only fills blanks: never reassigns an event a person already assigned.
      if (updated.defaultParticipantId) {
        assigned = (await app.prisma.event.updateMany({ where: { calendarSourceId: sourceId, participantId: null }, data: { participantId: updated.defaultParticipantId } })).count;
      }
      if (updated.defaultEventTagId) {
        tagged = (await app.prisma.event.updateMany({ where: { calendarSourceId: sourceId, eventTagId: null }, data: { eventTagId: updated.defaultEventTagId } })).count;
      }
    }
    return { id: sourceId, assigned, tagged };
  });

  app.delete("/workspaces/:workspaceId/calendar-sources/:sourceId", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const { sourceId } = parse(sourceParams, req.params);
    await findSource(app, req.membership!.workspaceId, sourceId);
    await app.prisma.calendarSource.delete({ where: { id: sourceId } }); // its events go with it
    return reply.code(204).send();
  });

  app.post("/workspaces/:workspaceId/calendar-sources/:sourceId/sync", { preHandler: requireWorkspace("member") }, async (req) => {
    const { sourceId } = parse(sourceParams, req.params);
    const source = await findSource(app, req.membership!.workspaceId, sourceId);
    if (source.type !== "ics_feed") throw badRequest("unsupported", "Only calendar feeds can be synced here");
    if (source.lastSyncedAt && Date.now() - source.lastSyncedAt.getTime() < MANUAL_SYNC_COOLDOWN_MS) {
      throw new HttpError(429, "too_soon", "This calendar was just updated — try again in a few minutes");
    }
    try {
      return { stats: await syncIcsSource(app.prisma, sourceId, syncDeps()) };
    } catch (err) {
      const message = describeSyncError(err);
      await app.prisma.calendarSource.update({ where: { id: sourceId }, data: { lastSyncError: message } });
      throw new HttpError(422, "feed_unreadable", message);
    }
  });
}

async function findSource(app: FastifyInstance, workspaceId: string, sourceId: string) {
  const s = await app.prisma.calendarSource.findFirst({ where: { id: sourceId, workspaceId } });
  if (!s) throw notFound("Calendar not found");
  return s;
}
