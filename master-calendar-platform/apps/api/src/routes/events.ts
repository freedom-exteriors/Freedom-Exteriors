// The unified calendar: every source (ICS feeds, Google, photo imports) in one list,
// annotated for display — participant color, tag, driver, place — including unassigned
// events, plus the circle events that involve this household.
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@mcp/db";
import { z } from "zod";
import { badRequest, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { assertParticipantIn, assertTagIn } from "../lib/scope.js";
import { requireWorkspace } from "../auth/plugin.js";

const MAX_RANGE_DAYS = 100; // a month view with padding; the wall shows a few days

const listQuery = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  participantId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  /** "unassigned" = only events nobody has claimed yet. */
  assigned: z.enum(["all", "assigned", "unassigned"]).default("all"),
  /** Home workspaces: also show circle events involving this household. Default on. */
  includeCircles: z.enum(["true", "false"]).default("true"),
});

const eventParams = z.object({ workspaceId: z.string().uuid(), eventId: z.string().uuid() });
const patchBody = z
  .object({
    participantId: z.string().uuid().nullable().optional(),
    eventTagId: z.string().uuid().nullable().optional(),
    driverParticipantId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "nothing to change");

const include = {
  participant: { select: { id: true, name: true, color: true } },
  driver: { select: { id: true, name: true } },
  eventTag: { select: { id: true, key: true, label: true, color: true } },
  place: { select: { id: true, name: true } },
  calendarSource: { select: { id: true, name: true, type: true, workspaceId: true } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof include }>;

function present(e: EventRow, circle: { id: string; name: string } | null) {
  const raw = (e.rawSourceData ?? {}) as { url?: string | null; description?: string | null };
  return {
    id: e.id,
    title: e.title,
    start: e.startTime,
    end: e.endTime,
    allDay: e.allDay,
    location: e.location,
    description: raw.description ?? null,
    url: raw.url ?? null,
    participant: e.participant,
    // UI draws unassigned events distinctly (hatched/grey) — it doesn't guess a color.
    unassigned: e.participantId === null,
    tag: e.eventTag,
    driver: e.driver,
    // Has somewhere to be but nobody taking them: the dashboard flags it, and the
    // "Who's driving?" automation rule turns it into a task.
    needsDriver: (e.placeId !== null || e.location !== null) && e.driverParticipantId === null && !e.allDay,
    place: e.place,
    source: { id: e.calendarSource.id, name: e.calendarSource.name, type: e.calendarSource.type },
    circle,
    // Circle events are edited in the circle, not from a household's own calendar.
    editable: circle === null,
  };
}

export async function eventRoutes(app: FastifyInstance) {
  app.get("/workspaces/:workspaceId/events", { preHandler: requireWorkspace() }, async (req) => {
    const q = parse(listQuery, req.query);
    const start = new Date(q.start);
    const end = new Date(q.end);
    if (end <= start) throw badRequest("invalid_range", "end must be after start");
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw badRequest("invalid_range", `Ask for at most ${MAX_RANGE_DAYS} days at a time`);
    }
    const m = req.membership!;
    const ws = m.workspace;
    await assertParticipantIn(app.prisma, ws.id, q.participantId);
    await assertTagIn(app.prisma, ws.id, q.tagId);

    const overlaps = { startTime: { lt: end }, endTime: { gt: start } };
    // Zero-length events (deadlines) at exactly `start` still belong in the range.
    const inRange: Prisma.EventWhereInput = { OR: [overlaps, { startTime: { gte: start, lt: end } }] };
    const filters: Prisma.EventWhereInput[] = [inRange];
    if (q.participantId) filters.push({ participantId: q.participantId });
    if (q.tagId) filters.push({ eventTagId: q.tagId });
    if (q.assigned === "assigned") filters.push({ participantId: { not: null } });
    if (q.assigned === "unassigned") filters.push({ participantId: null });

    const own = await app.prisma.event.findMany({
      where: { calendarSource: { workspaceId: ws.id }, AND: filters },
      include,
      orderBy: [{ startTime: "asc" }, { title: "asc" }],
      take: 5000,
    });
    const events = own.map((e) => present(e, null));

    // Circle events involving this household (not filterable by this home's participants/tags).
    if (ws.kind === "home" && q.includeCircles === "true" && !q.participantId && !q.tagId) {
      const links = await app.prisma.participant.findMany({
        where: { linkedWorkspaceId: ws.id, workspace: { kind: "circle" } },
        select: { id: true, workspaceId: true, workspace: { select: { name: true } } },
      });
      if (links.length) {
        const myCircleIds = new Set(
          (
            await app.prisma.workspaceMembership.findMany({
              where: { userId: req.user!.id, workspaceId: { in: links.map((l) => l.workspaceId) } },
              select: { workspaceId: true },
            })
          ).map((x) => x.workspaceId),
        );
        const circleFilters: Prisma.EventWhereInput[] = links.map((l) => ({
          calendarSource: { workspaceId: l.workspaceId },
          // Ours: always. Unclaimed: only for people in the circle, who can claim them.
          OR: [
            { participantId: l.id },
            { driverParticipantId: l.id },
            ...(myCircleIds.has(l.workspaceId) && q.assigned !== "assigned" ? [{ participantId: null }] : []),
          ],
        }));
        const rows = await app.prisma.event.findMany({
          where: { AND: [inRange, { OR: circleFilters }, q.assigned === "unassigned" ? { participantId: null } : {}] },
          include,
          orderBy: { startTime: "asc" },
          take: 2000,
        });
        const circleName = new Map(links.map((l) => [l.workspaceId, l.workspace.name]));
        for (const e of rows) {
          const id = e.calendarSource.workspaceId;
          events.push(present(e, { id, name: circleName.get(id)! }));
        }
        events.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
      }
    }

    const participants = await app.prisma.participant.findMany({
      where: { workspaceId: ws.id },
      select: { id: true, name: true, color: true },
      orderBy: { createdAt: "asc" },
    });
    return { range: { start, end }, timeZone: ws.timeZone, participants, events };
  });

  app.get("/workspaces/:workspaceId/events/:eventId", { preHandler: requireWorkspace() }, async (req) => {
    const { eventId } = parse(eventParams, req.params);
    const e = await app.prisma.event.findFirst({ where: { id: eventId, calendarSource: { workspaceId: req.membership!.workspaceId } }, include });
    if (!e) throw notFound("Event not found");
    return present(e, null);
  });

  // Claiming / assigning: who it's for, what kind of thing it is, who's driving.
  // These are the fields syncs never overwrite.
  app.patch("/workspaces/:workspaceId/events/:eventId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { eventId } = parse(eventParams, req.params);
    const body = parse(patchBody, req.body);
    const workspaceId = req.membership!.workspaceId;
    const existing = await app.prisma.event.findFirst({ where: { id: eventId, calendarSource: { workspaceId } } });
    if (!existing) throw notFound("Event not found");
    await assertParticipantIn(app.prisma, workspaceId, body.participantId);
    await assertParticipantIn(app.prisma, workspaceId, body.driverParticipantId);
    await assertTagIn(app.prisma, workspaceId, body.eventTagId);
    if (body.driverParticipantId) {
      const driver = await app.prisma.participant.findUniqueOrThrow({ where: { id: body.driverParticipantId } });
      // Households in a circle stand in for their drivers; people must be marked as drivers.
      if (!driver.canDrive && !driver.linkedWorkspaceId) throw badRequest("not_a_driver", `${driver.name} isn't set up as a driver`);
    }
    const e = await app.prisma.event.update({ where: { id: eventId }, data: body, include });
    return present(e, null);
  });
}
