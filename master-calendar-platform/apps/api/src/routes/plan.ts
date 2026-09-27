// The schedule organizer, as an API: make a day/week plan (suggestions written onto the
// tasks), then accept, move or dismiss each suggestion.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addMinutes, estimatedTravel, localDay, organizeSchedule, zonedToUtc } from "@mcp/planner";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireWorkspace } from "../auth/plugin.js";
import { loadPlanningData } from "../planning/load.js";
import { todayIn } from "../lib/recurrence.js";
import { presentTask, taskInclude } from "./tasks.js";

const uuid = z.string().uuid();
const planBody = z.object({
  scope: z.enum(["day", "week"]),
  /** Local date the day/week starts on; default today. */
  date: z.iso.date().optional(),
});
const agendaQuery = z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) });
const scheduleBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("move"), start: z.iso.datetime({ offset: true }), participantId: uuid.optional() }),
]);

export async function planRoutes(app: FastifyInstance) {
  const p = app.prisma;

  app.post("/workspaces/:workspaceId/plan", { preHandler: requireWorkspace("member") }, async (req) => {
    const body = parse(planBody, req.body);
    const ws = req.membership!.workspace;
    const d = body.date ? (() => { const [y, m, dd] = body.date!.split("-").map(Number); return { year: y!, month: m!, day: dd! }; })() : todayIn(ws.timeZone);
    const first = localDay(d.year, d.month, d.day, ws.timeZone);
    const end = body.scope === "day" ? first.end : zonedToUtc(first.year, first.month, first.day + 7, 0, ws.timeZone);
    const range = { start: first.start, end };

    const data = await loadPlanningData(p, ws.id, range);
    if (data.participants.length === 0) {
      throw new HttpError(422, "no_one_to_plan", "Add a home address and free hours for at least one person first");
    }
    const result = organizeSchedule({
      timeZone: ws.timeZone,
      start: range.start,
      end: range.end,
      now: new Date(),
      participants: data.participants,
      busy: data.busy,
      tasks: data.tasks,
      travelMinutes: estimatedTravel, // free estimate; live traffic is for today's leave-by alerts
    });

    // Replace this range's old suggestions with the new ones, atomically.
    await p.$transaction([
      p.task.updateMany({
        where: { workspaceId: ws.id, scheduleStatus: "suggested", scheduledStart: { gte: range.start, lt: range.end } },
        data: { scheduleStatus: null, scheduledStart: null, scheduledEnd: null, scheduleReason: null, scheduledParticipantId: null },
      }),
      ...result.placements.map((pl) =>
        p.task.update({
          where: { id: pl.taskId },
          data: {
            scheduleStatus: "suggested",
            scheduledStart: pl.start,
            scheduledEnd: pl.end,
            scheduleReason: pl.reason,
            scheduledParticipantId: pl.participantId,
          },
        }),
      ),
    ]);
    return {
      range,
      placements: result.placements.map((pl) => ({ ...pl, title: data.titles.get(pl.taskId) })),
      unplaced: result.unplaced.map((u) => ({ ...u, title: data.titles.get(u.taskId) })),
      skippedParticipants: data.skippedParticipants,
    };
  });

  // The planned agenda (suggested + accepted) for the dashboard.
  app.get("/workspaces/:workspaceId/plan", { preHandler: requireWorkspace() }, async (req) => {
    const q = parse(agendaQuery, req.query);
    const rows = await p.task.findMany({
      where: {
        workspaceId: req.membership!.workspaceId,
        completedAt: null,
        scheduleStatus: { not: null },
        scheduledStart: { lt: new Date(q.end) },
        scheduledEnd: { gt: new Date(q.start) },
      },
      include: taskInclude,
      orderBy: { scheduledStart: "asc" },
    });
    return rows.map(presentTask);
  });

  app.post("/workspaces/:workspaceId/tasks/:taskId/schedule", { preHandler: requireWorkspace("member") }, async (req) => {
    const { taskId } = parse(z.object({ taskId: uuid }), req.params);
    const body = parse(scheduleBody, req.body);
    const ws = req.membership!.workspaceId;
    const t = await p.task.findFirst({ where: { id: taskId, workspaceId: ws } });
    if (!t) throw notFound("Task not found");

    let data;
    if (body.action === "accept") {
      if (t.scheduleStatus !== "suggested") throw badRequest("nothing_to_accept", "There's no suggested time to accept");
      // Accepting an unassigned to-do's slot assigns it to the suggested person.
      data = { scheduleStatus: "accepted" as const, ...(t.assignedParticipantId ? {} : { assignedParticipantId: t.scheduledParticipantId }) };
    } else if (body.action === "dismiss") {
      data = { scheduleStatus: null, scheduledStart: null, scheduledEnd: null, scheduleReason: null, scheduledParticipantId: null };
    } else {
      const minutes = t.estimatedMinutes ?? (t.scheduledStart && t.scheduledEnd ? (t.scheduledEnd.getTime() - t.scheduledStart.getTime()) / 60_000 : null);
      if (!minutes) throw badRequest("needs_estimate", "Add how long this takes first");
      if (body.participantId && !(await p.participant.count({ where: { id: body.participantId, workspaceId: ws } }))) {
        throw badRequest("invalid_participant", "That person isn't in this workspace");
      }
      const start = new Date(body.start);
      data = {
        scheduleStatus: "accepted" as const,
        scheduledStart: start,
        scheduledEnd: addMinutes(start, minutes),
        scheduleReason: "Picked by hand",
        scheduledParticipantId: body.participantId ?? t.assignedParticipantId ?? t.scheduledParticipantId,
        ...(body.participantId ? { assignedParticipantId: body.participantId } : t.assignedParticipantId ? {} : { assignedParticipantId: t.scheduledParticipantId }),
      };
    }
    return presentTask(await p.task.update({ where: { id: taskId }, data, include: taskInclude }));
  });
}
