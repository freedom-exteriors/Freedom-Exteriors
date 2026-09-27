// Goals (short/long term, whole household or one person) with milestone tasks, and
// seasonal / recurring reminders.
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@mcp/db";
import { z } from "zod";
import { badRequest, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { assertParticipantIn } from "../lib/scope.js";
import { requireWorkspace } from "../auth/plugin.js";
import { isoDate, nextDates, todayIn, validateRule } from "../lib/recurrence.js";

const uuid = z.string().uuid();
const date = z.iso.date();
const goalBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  horizon: z.enum(["short_term", "long_term"]),
  participantId: uuid.nullable().optional(),
  targetDate: date.nullable().optional(),
  /** Convenience: create milestone tasks in one go. */
  milestones: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
});
const goalPatch = goalBody.omit({ milestones: true }).partial().extend({
  status: z.enum(["active", "achieved", "dropped"]).optional(),
  position: z.number().optional(),
});
const reminderBody = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
  rrule: z.string().trim().min(5).max(300),
  leadDays: z.number().int().min(0).max(90).default(7),
  taskListId: uuid.nullable().optional(),
  assignedParticipantId: uuid.nullable().optional(),
  enabled: z.boolean().default(true),
});
const reminderPatch = reminderBody.partial();

const milestoneSelect = {
  id: true,
  title: true,
  completedAt: true,
  position: true,
  assignedParticipant: { select: { id: true, name: true, color: true } },
} satisfies Prisma.TaskSelect;

export async function goalRoutes(app: FastifyInstance) {
  const p = app.prisma;

  app.get("/workspaces/:workspaceId/goals", { preHandler: requireWorkspace() }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["active", "achieved", "dropped", "all"]).default("all") }), req.query);
    const goals = await p.goal.findMany({
      where: { workspaceId: req.membership!.workspaceId, ...(status === "all" ? { status: { not: "dropped" } } : { status }) },
      include: { participant: { select: { id: true, name: true, color: true } }, milestones: { select: milestoneSelect, orderBy: { position: "asc" } } },
      orderBy: [{ status: "asc" }, { horizon: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    });
    return goals.map((g) => {
      const done = g.milestones.filter((m) => m.completedAt).length;
      const total = g.milestones.length;
      return { ...g, progress: { done, total, percent: total ? Math.round((done / total) * 100) : g.status === "achieved" ? 100 : 0 } };
    });
  });

  app.post("/workspaces/:workspaceId/goals", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const { milestones, targetDate, ...body } = parse(goalBody, req.body);
    const ws = req.membership!.workspaceId;
    await assertParticipantIn(p, ws, body.participantId);
    const goal = await p.goal.create({
      data: {
        ...body,
        workspaceId: ws,
        targetDate: targetDate ? new Date(targetDate) : null,
        milestones: { create: (milestones ?? []).map((title, i) => ({ title, position: i, workspaceId: ws, createdByUserId: req.user!.id })) },
      },
      include: { milestones: { select: milestoneSelect, orderBy: { position: "asc" } } },
    });
    return reply.code(201).send(goal);
  });

  app.patch("/workspaces/:workspaceId/goals/:goalId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { goalId } = parse(z.object({ goalId: uuid }), req.params);
    const { targetDate, status, ...body } = parse(goalPatch, req.body);
    const ws = req.membership!.workspaceId;
    if (!(await p.goal.count({ where: { id: goalId, workspaceId: ws } }))) throw notFound("Goal not found");
    await assertParticipantIn(p, ws, body.participantId);
    return p.goal.update({
      where: { id: goalId },
      data: {
        ...body,
        ...(targetDate !== undefined ? { targetDate: targetDate ? new Date(targetDate) : null } : {}),
        ...(status ? { status, achievedAt: status === "achieved" ? new Date() : null } : {}),
      },
    });
  });

  app.delete("/workspaces/:workspaceId/goals/:goalId", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const { goalId } = parse(z.object({ goalId: uuid }), req.params);
    const ws = req.membership!.workspaceId;
    if (!(await p.goal.count({ where: { id: goalId, workspaceId: ws } }))) throw notFound("Goal not found");
    await p.$transaction([
      // Milestones that only exist as steps of this goal go with it; ones also on a list stay.
      p.task.deleteMany({ where: { goalId, taskListId: null } }),
      p.goal.delete({ where: { id: goalId } }),
    ]);
    return reply.code(204).send();
  });

  // ─── Recurring / seasonal reminders ───

  app.get("/workspaces/:workspaceId/recurring-reminders", { preHandler: requireWorkspace() }, async (req) => {
    const ws = req.membership!.workspace;
    const rows = await p.recurringReminder.findMany({
      where: { workspaceId: ws.id },
      include: { taskList: { select: { id: true, name: true } }, assignedParticipant: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    const today = todayIn(ws.timeZone);
    return rows
      .map((r) => {
        let next: string | null = null;
        try {
          const [d] = nextDates(r.rrule, today);
          next = d ? isoDate(d) : null;
        } catch {
          next = null;
        }
        return { ...r, nextDate: next };
      })
      .sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999"));
  });

  async function checkReminder(ws: string, b: { rrule?: string; taskListId?: string | null; assignedParticipantId?: string | null }) {
    if (b.rrule) {
      try {
        validateRule(b.rrule);
      } catch (err) {
        throw badRequest("invalid_rrule", (err as Error).message);
      }
    }
    await assertParticipantIn(p, ws, b.assignedParticipantId);
    if (b.taskListId && !(await p.taskList.count({ where: { id: b.taskListId, workspaceId: ws } }))) {
      throw badRequest("invalid_list", "That list isn't in this workspace");
    }
  }

  app.post("/workspaces/:workspaceId/recurring-reminders", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const body = parse(reminderBody, req.body);
    const ws = req.membership!.workspaceId;
    await checkReminder(ws, body);
    return reply.code(201).send(await p.recurringReminder.create({ data: { ...body, workspaceId: ws } }));
  });

  app.patch("/workspaces/:workspaceId/recurring-reminders/:reminderId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { reminderId } = parse(z.object({ reminderId: uuid }), req.params);
    const body = parse(reminderPatch, req.body);
    const ws = req.membership!.workspaceId;
    if (!(await p.recurringReminder.count({ where: { id: reminderId, workspaceId: ws } }))) throw notFound("Reminder not found");
    await checkReminder(ws, body);
    return p.recurringReminder.update({ where: { id: reminderId }, data: body });
  });

  app.delete("/workspaces/:workspaceId/recurring-reminders/:reminderId", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const { reminderId } = parse(z.object({ reminderId: uuid }), req.params);
    const { count } = await p.recurringReminder.deleteMany({ where: { id: reminderId, workspaceId: req.membership!.workspaceId } });
    if (!count) throw notFound("Reminder not found");
    return reply.code(204).send();
  });
}
