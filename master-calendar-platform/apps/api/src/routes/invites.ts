import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addHomeToCircle, Prisma } from "@mcp/db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireUser, requireWorkspace } from "../auth/plugin.js";
import { generateSessionToken, hashToken } from "../auth/session.js";
import { nextParticipantColor } from "../lib/colors.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createBody = z.object({
  role: z.enum(["owner", "member", "viewer"]).default("member"),
  /** Only this address can accept (recommended). */
  email: z.string().trim().toLowerCase().email().optional(),
  /** Home invites: the invitee becomes this participant (e.g. a teen's own view). */
  participantId: z.string().uuid().optional(),
});

const acceptBody = z.object({
  /** Circle invites: which of your households is joining. */
  homeWorkspaceId: z.string().uuid().optional(),
});

const tokenParams = z.object({ token: z.string().min(20).max(100) });

export async function inviteRoutes(app: FastifyInstance) {
  app.post("/workspaces/:workspaceId/invites", { preHandler: requireWorkspace("owner") }, async (req, reply) => {
    const body = parse(createBody, req.body);
    const ws = req.membership!.workspace;
    if (body.participantId) {
      if (ws.kind === "circle") throw badRequest("invalid_input", "Circle invites join a household, not a participant");
      const p = await app.prisma.participant.findFirst({
        where: { id: body.participantId, workspaceId: ws.id },
        include: { membership: true },
      });
      if (!p) throw notFound("Participant not found");
      if (p.membership) throw conflict("participant_claimed", `${p.name} already has a login`);
    }
    const token = generateSessionToken();
    const invite = await app.prisma.workspaceInvite.create({
      data: {
        workspaceId: ws.id,
        tokenHash: hashToken(token),
        email: body.email ?? null,
        role: body.role,
        participantId: body.participantId ?? null,
        invitedByUserId: req.user!.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    // The raw token is shown exactly once, here.
    return reply.code(201).send({
      id: invite.id,
      url: `${app.config.publicWebUrl}/invite/${token}`,
      token,
      expiresAt: invite.expiresAt,
    });
  });

  app.get("/workspaces/:workspaceId/invites", { preHandler: requireWorkspace("owner") }, async (req) => {
    const rows = await app.prisma.workspaceInvite.findMany({
      where: { workspaceId: req.membership!.workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, participantId: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return rows;
  });

  app.delete("/workspaces/:workspaceId/invites/:inviteId", { preHandler: requireWorkspace("owner") }, async (req, reply) => {
    const { inviteId } = parse(z.object({ inviteId: z.string().uuid() }), req.params);
    const { count } = await app.prisma.workspaceInvite.deleteMany({ where: { id: inviteId, workspaceId: req.membership!.workspaceId } });
    if (count === 0) throw notFound("Invite not found");
    return reply.code(204).send();
  });

  // Public preview so the invite page can say "Join Rivera Family as a viewer".
  app.get("/invites/:token", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const invite = await findUsableInvite(app, parse(tokenParams, req.params).token);
    return {
      workspace: { name: invite.workspace.name, kind: invite.workspace.kind },
      role: invite.role,
      participantName: invite.participant?.name ?? null,
      restrictedToEmail: invite.email !== null,
    };
  });

  app.post("/invites/:token/accept", { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const invite = await findUsableInvite(app, parse(tokenParams, req.params).token);
    const body = parse(acceptBody, req.body ?? {});
    const user = req.user!;
    if (invite.email && invite.email !== user.email) {
      throw forbidden("This invite was sent to a different email address");
    }
    const existing = await app.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
    });
    if (existing) throw conflict("already_member", "You're already in this workspace");

    let homeId: string | null = null;
    if (invite.workspace.kind === "circle") {
      if (!body.homeWorkspaceId) throw badRequest("home_required", "Pick which of your households is joining");
      const home = await app.prisma.workspaceMembership.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId: body.homeWorkspaceId } },
        include: { workspace: true },
      });
      if (!home || home.workspace.kind !== "home") throw notFound("Household not found");
      homeId = home.workspaceId;
    }

    try {
      await app.prisma.$transaction(async (tx) => {
        // Mark used first, conditionally, so two concurrent accepts can't both succeed.
        const { count } = await tx.workspaceInvite.updateMany({
          where: { id: invite.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (count === 0) throw notFound("Invite not found or already used");
        await tx.workspaceMembership.create({
          data: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role, participantId: invite.participantId },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw conflict("participant_claimed", "That person already has a login");
      }
      throw err;
    }

    // A second adult from a household that's already in the circle doesn't add it twice.
    if (homeId) {
      const linked = await app.prisma.participant.findFirst({ where: { workspaceId: invite.workspaceId, linkedWorkspaceId: homeId } });
      if (!linked) {
        const colors = (await app.prisma.participant.findMany({ where: { workspaceId: invite.workspaceId }, select: { color: true } })).map((p) => p.color);
        await addHomeToCircle(app.prisma, { circleId: invite.workspaceId, homeWorkspaceId: homeId, color: nextParticipantColor(colors) });
      }
    }
    return { workspaceId: invite.workspaceId, role: invite.role };
  });
}

async function findUsableInvite(app: FastifyInstance, token: string) {
  const invite = await app.prisma.workspaceInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: true, participant: { select: { name: true } } },
  });
  // One message for unknown, used and expired, so tokens can't be probed for state.
  if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) throw notFound("Invite not found or expired");
  return invite;
}
