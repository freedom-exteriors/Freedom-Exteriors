// Wall / kiosk display. Owners create one link per screen; the screen polls
// GET /wall/:token without logging in. The response is deliberately minimal (no notes,
// descriptions, links or emails): it's on a wall in the kitchen.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addMinutes, localDay, localParts } from "@mcp/planner";
import { notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireWorkspace } from "../auth/plugin.js";
import { generateSessionToken, hashToken } from "../auth/session.js";

const createBody = z.object({
  name: z.string().trim().min(1).max(60).default("Kitchen"),
  daysAhead: z.number().int().min(1).max(7).default(4),
  showLocations: z.boolean().default(true),
});

/** Redacts wall tokens from anything we log (request logs include the URL). */
export const redactWallToken = (url: string) => url.replace(/\/wall\/[^/?#]+/, "/wall/[redacted]");

export async function wallRoutes(app: FastifyInstance) {
  const p = app.prisma;

  // ─── Managing screens (owner) ───
  app.get("/workspaces/:workspaceId/wall-displays", { preHandler: requireWorkspace("owner") }, async (req) =>
    p.wallDisplay.findMany({
      where: { workspaceId: req.membership!.workspaceId, revokedAt: null },
      select: { id: true, name: true, daysAhead: true, showLocations: true, lastSeenAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  );

  app.post("/workspaces/:workspaceId/wall-displays", { preHandler: requireWorkspace("owner") }, async (req, reply) => {
    const body = parse(createBody, req.body);
    const token = generateSessionToken();
    const d = await p.wallDisplay.create({ data: { ...body, workspaceId: req.membership!.workspaceId, tokenHash: hashToken(token) } });
    // Shown once. To set up another screen, make another link.
    return reply.code(201).send({ id: d.id, name: d.name, url: `${app.config.publicWebUrl}/wall/${token}` });
  });

  app.delete("/workspaces/:workspaceId/wall-displays/:displayId", { preHandler: requireWorkspace("owner") }, async (req, reply) => {
    const { displayId } = parse(z.object({ displayId: z.string().uuid() }), req.params);
    const { count } = await p.wallDisplay.updateMany({
      where: { id: displayId, workspaceId: req.membership!.workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw notFound("Display not found");
    return reply.code(204).send();
  });

  // ─── The screen itself ───
  app.get("/wall/:token", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.params);
    const display = await p.wallDisplay.findUnique({ where: { tokenHash: hashToken(token) }, include: { workspace: true } });
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex");
    if (!display || display.revokedAt) throw notFound("This display was turned off");

    const ws = display.workspace;
    const tz = ws.timeZone;
    const now = new Date();
    const t = localParts(now, tz);
    const days = Array.from({ length: display.daysAhead }, (_, i) => localDay(t.year, t.month, t.day + i, tz));
    const start = days[0]!.start;
    const end = days[days.length - 1]!.end;

    const [events, chores, groceries, departures] = await Promise.all([
      p.event.findMany({
        where: { calendarSource: { workspaceId: ws.id }, startTime: { lt: end }, endTime: { gt: start } },
        select: {
          id: true, title: true, startTime: true, endTime: true, allDay: true, location: true,
          participant: { select: { name: true, color: true } },
          driver: { select: { name: true } },
          eventTag: { select: { label: true } },
        },
        orderBy: [{ allDay: "desc" }, { startTime: "asc" }],
        take: 300,
      }),
      // Today's to-dos people can act on at home: chores list + anything due by tonight.
      p.task.findMany({
        where: {
          workspaceId: ws.id,
          completedAt: null,
          OR: [{ taskList: { key: "chores" } }, { dueAt: { lte: days[0]!.end } }],
        },
        select: { id: true, title: true, dueAt: true, assignedParticipant: { select: { name: true, color: true } } },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { position: "asc" }],
        take: 12,
      }),
      p.shoppingItem.findMany({
        where: { shoppingList: { workspaceId: ws.id, key: "groceries", archivedAt: null }, checkedAt: null },
        select: { id: true, name: true, quantity: true },
        orderBy: { createdAt: "asc" },
        take: 30,
      }),
      p.departureAlert.findMany({
        where: { event: { calendarSource: { workspaceId: ws.id } }, leaveBy: { gte: addMinutes(now, -15), lt: days[0]!.end } },
        select: { leaveBy: true, trafficMinutes: true, typicalMinutes: true, participant: { select: { name: true } }, event: { select: { title: true } } },
        orderBy: { leaveBy: "asc" },
        take: 5,
      }),
    ]);
    // Best-effort heartbeat so owners can see the screen is alive (at most once a minute-ish).
    if (!display.lastSeenAt || now.getTime() - display.lastSeenAt.getTime() > 60_000) {
      await p.wallDisplay.update({ where: { id: display.id }, data: { lastSeenAt: now } }).catch(() => {});
    }

    const iso = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    return {
      household: ws.name,
      timeZone: tz,
      generatedAt: now,
      people: (await p.participant.findMany({ where: { workspaceId: ws.id, linkedWorkspaceId: null }, select: { name: true, color: true }, orderBy: { createdAt: "asc" } })),
      days: days.map((d) => ({
        date: iso(d),
        events: events
          .filter((e) => e.startTime < d.end && (e.endTime > d.start || (e.startTime.getTime() === e.endTime.getTime() && e.startTime >= d.start)))
          .map((e) => ({
            id: e.id,
            title: e.title,
            start: e.startTime,
            end: e.endTime,
            allDay: e.allDay,
            location: display.showLocations ? e.location : null,
            person: e.participant,
            driver: e.driver?.name ?? null,
            kind: e.eventTag?.label ?? null,
          })),
      })),
      leaveBy: departures.map((d) => ({
        title: d.event.title,
        driver: d.participant.name,
        leaveBy: d.leaveBy,
        minutes: d.trafficMinutes,
        heavyTraffic: d.trafficMinutes - d.typicalMinutes >= 5 && d.trafficMinutes - d.typicalMinutes >= d.typicalMinutes * 0.25,
      })),
      chores: chores.map((c) => ({ id: c.id, title: c.title, person: c.assignedParticipant })),
      groceries: groceries.map((g) => (g.quantity ? `${g.name} (${g.quantity})` : g.name)),
    };
  });
}
