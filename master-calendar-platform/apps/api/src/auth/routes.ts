import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createWorkspaceFromTemplate } from "@mcp/db";
import { conflict, unauthorized } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { hashPassword, verifyPassword } from "./password.js";
import { clearSessionCookie, requireUser, setSessionCookie } from "./plugin.js";
import { createSession, invalidateSession } from "./session.js";
import { nextParticipantColor } from "../lib/colors.js";

const email = z.string().trim().toLowerCase().email().max(254);
// NIST 800-63B: length over composition rules; long passphrases welcome.
const password = z.string().min(8, "must be at least 8 characters").max(256);

const signupBody = z.object({
  email,
  password,
  /** Your name — becomes your Participant in the new workspace. */
  displayName: z.string().trim().min(1).max(80).optional(),
  /** Create your first workspace now (skip when signing up to accept an invite). */
  workspace: z
    .object({ name: z.string().trim().min(1).max(120), vertical: z.enum(["family", "student", "business"]) })
    .optional(),
});

const loginBody = z.object({ email, password: z.string().max(256) });

export async function authRoutes(app: FastifyInstance) {
  const authRateLimit = { rateLimit: { max: app.config.authRateLimitMax, timeWindow: "1 minute" } };

  app.post("/auth/signup", { config: authRateLimit }, async (req, reply) => {
    const body = parse(signupBody, req.body);
    if (await app.prisma.user.findUnique({ where: { email: body.email } })) {
      throw conflict("email_taken", "An account with that email already exists");
    }
    const user = await app.prisma.user.create({
      data: { email: body.email, passwordHash: await hashPassword(body.password) },
    });

    let workspaceId: string | null = null;
    if (body.workspace) {
      const ws = await createWorkspaceFromTemplate(app.prisma, { ...body.workspace, ownerUserId: user.id });
      workspaceId = ws.id;
      if (body.displayName) {
        const participant = await app.prisma.participant.create({
          data: { workspaceId: ws.id, name: body.displayName, color: nextParticipantColor([]), canDrive: body.workspace.vertical !== "student" },
        });
        await app.prisma.workspaceMembership.update({
          where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } },
          data: { participantId: participant.id },
        });
      }
    }

    const { token, session } = await createSession(app.prisma, user.id);
    setSessionCookie(app, reply, token, session.expiresAt);
    return reply.code(201).send({ user: { id: user.id, email: user.email }, workspaceId });
  });

  app.post("/auth/login", { config: authRateLimit }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    const ok = await verifyPassword(user?.passwordHash ?? null, body.password);
    if (!user || !ok) throw unauthorized("Email or password is incorrect");
    const { token, session } = await createSession(app.prisma, user.id);
    setSessionCookie(app, reply, token, session.expiresAt);
    return { user: { id: user.id, email: user.email } };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.session) await invalidateSession(app.prisma, req.session.id);
    clearSessionCookie(app, reply);
    return reply.code(204).send();
  });

  app.get("/auth/me", { preHandler: requireUser }, async (req) => {
    const memberships = await app.prisma.workspaceMembership.findMany({
      where: { userId: req.user!.id },
      include: { workspace: { select: { id: true, name: true, vertical: true, kind: true } } },
      orderBy: { createdAt: "asc" },
    });
    return {
      user: req.user,
      workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role, participantId: m.participantId })),
    };
  });
}
