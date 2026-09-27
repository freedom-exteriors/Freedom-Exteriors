import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createWorkspaceFromTemplate, getWorkspaceTemplate } from "@mcp/db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireUser, requireWorkspace } from "../auth/plugin.js";
import { nextParticipantColor } from "../lib/colors.js";

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  vertical: z.enum(["family", "student", "business"]),
  kind: z.enum(["home", "circle"]).default("home"),
  timeZone: z
    .string()
    .refine((tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "unknown time zone")
    .optional(),
  /** Circles only: the home you're joining it as. */
  homeWorkspaceId: z.string().uuid().optional(),
});

const memberParams = z.object({ workspaceId: z.string().uuid(), membershipId: z.string().uuid() });

export async function workspaceRoutes(app: FastifyInstance) {
  app.post("/workspaces", { preHandler: requireUser }, async (req, reply) => {
    const body = parse(createBody, req.body);
    const userId = req.user!.id;

    // Creating a circle "as" a home requires being an owner/member of that home.
    let home = null;
    if (body.kind === "circle") {
      if (!body.homeWorkspaceId) throw badRequest("home_required", "Pick which of your households is starting this circle");
      const m = await app.prisma.workspaceMembership.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: body.homeWorkspaceId } },
        include: { workspace: true },
      });
      if (!m || m.workspace.kind !== "home") throw notFound("Household not found");
      if (m.role === "viewer") throw forbidden("Viewers can't start a circle for their household");
      home = m.workspace;
    }

    const ws = await createWorkspaceFromTemplate(app.prisma, {
      name: body.name,
      vertical: body.vertical,
      kind: body.kind,
      ownerUserId: userId,
    });
    if (body.timeZone || home) {
      await app.prisma.workspace.update({ where: { id: ws.id }, data: { timeZone: body.timeZone ?? home!.timeZone } });
    }
    if (home) {
      await app.prisma.participant.create({
        data: { workspaceId: ws.id, linkedWorkspaceId: home.id, name: home.name, color: nextParticipantColor([]) },
      });
    }
    return reply.code(201).send({ id: ws.id });
  });

  app.get("/workspaces", { preHandler: requireUser }, async (req) => {
    const rows = await app.prisma.workspaceMembership.findMany({
      where: { userId: req.user!.id },
      include: { workspace: { select: { id: true, name: true, vertical: true, kind: true, timeZone: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((m) => ({ ...m.workspace, role: m.role }));
  });

  app.get("/workspaces/:workspaceId", { preHandler: requireWorkspace() }, async (req) => {
    const m = req.membership!;
    const ws = m.workspace;
    const participants = await app.prisma.participant.findMany({
      where: { workspaceId: ws.id },
      select: { id: true, name: true, color: true, canDrive: true, linkedWorkspaceId: true },
      orderBy: { createdAt: "asc" },
    });
    const template = getWorkspaceTemplate(ws.kind, ws.vertical);
    return {
      id: ws.id,
      name: ws.name,
      vertical: ws.vertical,
      kind: ws.kind,
      timeZone: ws.timeZone,
      myRole: m.role,
      myParticipantId: m.participantId,
      participants,
      // UI copy & pickers come from the template — the app never branches on vertical.
      labels: template.labels,
      contactRoles: template.contactRoles,
      shoppingCategories: template.shoppingCategories,
    };
  });

  app.patch("/workspaces/:workspaceId", { preHandler: requireWorkspace("owner") }, async (req) => {
    const body = parse(createBody.pick({ name: true, timeZone: true }).partial(), req.body);
    const ws = await app.prisma.workspace.update({ where: { id: req.membership!.workspaceId }, data: body });
    return { id: ws.id, name: ws.name, timeZone: ws.timeZone };
  });

  // ─── Members ───

  app.get("/workspaces/:workspaceId/members", { preHandler: requireWorkspace("member") }, async (req) => {
    const rows = await app.prisma.workspaceMembership.findMany({
      where: { workspaceId: req.membership!.workspaceId },
      include: { user: { select: { email: true } }, participant: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({ id: r.id, email: r.user.email, role: r.role, participant: r.participant }));
  });

  app.patch("/workspaces/:workspaceId/members/:membershipId", { preHandler: requireWorkspace("owner") }, async (req) => {
    const { membershipId } = parse(memberParams, req.params);
    const { role } = parse(z.object({ role: z.enum(["owner", "member", "viewer"]) }), req.body);
    const target = await findMember(app, req.membership!.workspaceId, membershipId);
    if (target.role === "owner" && role !== "owner") await assertNotLastOwner(app, target.workspaceId);
    await app.prisma.workspaceMembership.update({ where: { id: target.id }, data: { role } });
    return { id: target.id, role };
  });

  // Owners can remove anyone; anyone can remove themselves (leave).
  app.delete("/workspaces/:workspaceId/members/:membershipId", { preHandler: requireWorkspace() }, async (req, reply) => {
    const { membershipId } = parse(memberParams, req.params);
    const me = req.membership!;
    const target = await findMember(app, me.workspaceId, membershipId);
    if (target.id !== me.id && me.role !== "owner") throw forbidden();
    if (target.role === "owner") await assertNotLastOwner(app, target.workspaceId);
    await app.prisma.workspaceMembership.delete({ where: { id: target.id } });
    return reply.code(204).send();
  });
}

async function findMember(app: FastifyInstance, workspaceId: string, membershipId: string) {
  const m = await app.prisma.workspaceMembership.findFirst({ where: { id: membershipId, workspaceId } });
  if (!m) throw notFound("Member not found");
  return m;
}

async function assertNotLastOwner(app: FastifyInstance, workspaceId: string) {
  const owners = await app.prisma.workspaceMembership.count({ where: { workspaceId, role: "owner" } });
  if (owners <= 1) throw conflict("last_owner", "A workspace needs at least one owner");
}
