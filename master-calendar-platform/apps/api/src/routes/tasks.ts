// Task lists (Honey-do, Chores, Packing…) and the tasks on them. Tasks are the one to-do
// concept: list items, goal milestones, automation and reminder output all live here.
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@mcp/db";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { assertParticipantIn } from "../lib/scope.js";
import { assertCanContribute, nextPosition } from "../lib/perm.js";
import { requireWorkspace } from "../auth/plugin.js";

const uuid = z.string().uuid();
const listBody = z.object({
  name: z.string().trim().min(1).max(120),
  viewerCanAdd: z.boolean().default(false),
});
const listPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  viewerCanAdd: z.boolean().optional(),
  position: z.number().optional(),
  archived: z.boolean().optional(),
});
const taskFields = {
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(5000).nullable().optional(),
  taskListId: uuid.nullable().optional(),
  goalId: uuid.nullable().optional(),
  assignedParticipantId: uuid.nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  estimatedMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  locationKind: z.enum(["home", "errand", "anywhere"]).optional(),
  placeId: uuid.nullable().optional(),
  position: z.number().optional(),
};
const createTask = z.object(taskFields);
const patchTask = z.object({ ...taskFields, title: taskFields.title.optional(), completed: z.boolean().optional() });
const listQuery = z.object({
  taskListId: uuid.optional(),
  goalId: uuid.optional(),
  assignedParticipantId: uuid.optional(),
  /** Tasks on no list (e.g. automation output). */
  unlisted: z.enum(["true", "false"]).optional(),
  status: z.enum(["open", "done", "all"]).default("open"),
});

export const taskInclude = {
  assignedParticipant: { select: { id: true, name: true, color: true } },
  scheduledParticipant: { select: { id: true, name: true, color: true } },
  taskList: { select: { id: true, name: true } },
  goal: { select: { id: true, title: true } },
  place: { select: { id: true, name: true } },
  event: { select: { id: true, title: true, startTime: true } },
  createdBy: { select: { email: true } },
  completedBy: { select: { email: true } },
} satisfies Prisma.TaskInclude;

export function presentTask(t: Prisma.TaskGetPayload<{ include: typeof taskInclude }>) {
  const { createdBy, completedBy, createdByUserId: _c, completedByUserId: _d, workspaceId: _w, ...rest } = t;
  return { ...rest, createdBy: createdBy?.email ?? null, completedBy: completedBy?.email ?? null };
}

export async function taskRoutes(app: FastifyInstance) {
  const p = app.prisma;

  // ─── Lists ───
  app.get("/workspaces/:workspaceId/task-lists", { preHandler: requireWorkspace() }, async (req) => {
    const ws = req.membership!.workspaceId;
    const lists = await p.taskList.findMany({ where: { workspaceId: ws, archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    const counts = await p.task.groupBy({ by: ["taskListId"], where: { workspaceId: ws, completedAt: null, taskListId: { in: lists.map((l) => l.id) } }, _count: true });
    const open = new Map(counts.map((c) => [c.taskListId, c._count]));
    return lists.map((l) => ({ ...l, openCount: open.get(l.id) ?? 0 }));
  });

  app.post("/workspaces/:workspaceId/task-lists", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const body = parse(listBody, req.body);
    const ws = req.membership!.workspaceId;
    const max = await p.taskList.aggregate({ where: { workspaceId: ws }, _max: { position: true } });
    const list = await p.taskList.create({ data: { ...body, workspaceId: ws, position: nextPosition(max._max.position) } });
    return reply.code(201).send(list);
  });

  app.patch("/workspaces/:workspaceId/task-lists/:listId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { listId } = parse(z.object({ listId: uuid }), req.params);
    const { archived, ...body } = parse(listPatch, req.body);
    const list = await p.taskList.findFirst({ where: { id: listId, workspaceId: req.membership!.workspaceId } });
    if (!list) throw notFound("List not found");
    return p.taskList.update({
      where: { id: listId },
      data: { ...body, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) },
    });
  });

  // ─── Tasks ───
  app.get("/workspaces/:workspaceId/tasks", { preHandler: requireWorkspace() }, async (req) => {
    const q = parse(listQuery, req.query);
    const where: Prisma.TaskWhereInput = {
      workspaceId: req.membership!.workspaceId,
      ...(q.taskListId ? { taskListId: q.taskListId } : {}),
      ...(q.unlisted === "true" ? { taskListId: null } : {}),
      ...(q.goalId ? { goalId: q.goalId } : {}),
      ...(q.assignedParticipantId ? { assignedParticipantId: q.assignedParticipantId } : {}),
      ...(q.status === "open" ? { completedAt: null } : q.status === "done" ? { completedAt: { not: null } } : {}),
    };
    const rows = await p.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { position: "asc" }, { createdAt: "asc" }],
      take: 1000,
    });
    return rows.map(presentTask);
  });

  app.post("/workspaces/:workspaceId/tasks", { preHandler: requireWorkspace() }, async (req, reply) => {
    const body = parse(createTask, req.body);
    const m = req.membership!;
    const ws = m.workspaceId;
    const list = body.taskListId ? await p.taskList.findFirst({ where: { id: body.taskListId, workspaceId: ws } }) : null;
    if (body.taskListId && !list) throw badRequest("invalid_list", "That list isn't in this workspace");
    let data = body;
    if (m.role === "viewer") {
      // Kids can drop a to-do on an open list; parents decide who/when/how important.
      if (!list) throw forbidden("Ask a parent to add this");
      assertCanContribute(m.role, list);
      data = { title: body.title, notes: body.notes, taskListId: list.id };
    }
    await assertRefs(app, ws, data);
    const max = await p.task.aggregate({ where: { workspaceId: ws, taskListId: data.taskListId ?? null }, _max: { position: true } });
    const t = await p.task.create({
      data: {
        ...data,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        workspaceId: ws,
        position: data.position ?? nextPosition(max._max.position),
        createdByUserId: req.user!.id,
      },
      include: taskInclude,
    });
    return reply.code(201).send(presentTask(t));
  });

  app.patch("/workspaces/:workspaceId/tasks/:taskId", { preHandler: requireWorkspace() }, async (req) => {
    const { taskId } = parse(z.object({ taskId: uuid }), req.params);
    const { completed, ...body } = parse(patchTask, req.body);
    const m = req.membership!;
    const t = await p.task.findFirst({ where: { id: taskId, workspaceId: m.workspaceId }, include: { taskList: true } });
    if (!t) throw notFound("Task not found");
    if (m.role === "viewer") {
      // Viewers may only tick things off: their own chores, or items on open lists.
      const ownChore = m.participantId !== null && t.assignedParticipantId === m.participantId;
      const openList = t.taskList?.viewerCanAdd === true;
      if (Object.keys(body).length > 0 || completed === undefined || !(ownChore || openList)) throw forbidden();
    }
    await assertRefs(app, m.workspaceId, body);
    const updated = await p.task.update({
      where: { id: taskId },
      data: {
        ...body,
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
        ...(completed === true && !t.completedAt ? { completedAt: new Date(), completedByUserId: req.user!.id } : {}),
        ...(completed === false ? { completedAt: null, completedByUserId: null } : {}),
      },
      include: taskInclude,
    });
    return presentTask(updated);
  });

  app.delete("/workspaces/:workspaceId/tasks/:taskId", { preHandler: requireWorkspace() }, async (req, reply) => {
    const { taskId } = parse(z.object({ taskId: uuid }), req.params);
    const m = req.membership!;
    const t = await p.task.findFirst({ where: { id: taskId, workspaceId: m.workspaceId } });
    if (!t) throw notFound("Task not found");
    if (m.role === "viewer" && t.createdByUserId !== req.user!.id) throw forbidden();
    await p.task.delete({ where: { id: taskId } });
    return reply.code(204).send();
  });
}

async function assertRefs(
  app: FastifyInstance,
  ws: string,
  b: { taskListId?: string | null; goalId?: string | null; assignedParticipantId?: string | null; placeId?: string | null },
) {
  const p = app.prisma;
  await assertParticipantIn(p, ws, b.assignedParticipantId);
  if (b.taskListId && !(await p.taskList.count({ where: { id: b.taskListId, workspaceId: ws } }))) throw badRequest("invalid_list", "That list isn't in this workspace");
  if (b.goalId && !(await p.goal.count({ where: { id: b.goalId, workspaceId: ws } }))) throw badRequest("invalid_goal", "That goal isn't in this workspace");
  if (b.placeId && !(await p.place.count({ where: { id: b.placeId, workspaceId: ws } }))) throw badRequest("invalid_place", "That place isn't in this workspace");
}

