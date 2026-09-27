import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MembershipRole, Session, WorkspaceMembership, Workspace } from "@mcp/db";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { SESSION_COOKIE, validateSessionToken, type SafeUser } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SafeUser | null;
    session: Session | null;
    /** Set by requireWorkspace(): the caller's membership in :workspaceId. */
    membership: (WorkspaceMembership & { workspace: Workspace }) | null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(app: FastifyInstance, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: app.config.cookieSecure, sameSite: "lax", path: "/" });
}

export async function registerAuth(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.decorateRequest("session", null);
  app.decorateRequest("membership", null);

  app.addHook("onRequest", async (req, reply) => {
    // CSRF: cookies ride along on cross-site requests, so state-changing requests must
    // come from our own web origin. (SameSite=Lax covers most of this; this closes the rest.)
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !app.config.allowedOrigins.includes(origin)) {
        throw forbidden("Request origin not allowed");
      }
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const result = await validateSessionToken(app.prisma, token);
    if (!result) {
      clearSessionCookie(app, reply);
      return;
    }
    req.user = result.user;
    req.session = result.session;
    if (result.renewed) setSessionCookie(app, reply, token, result.session.expiresAt);
  });
}

export async function requireUser(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
}

const RANK: Record<MembershipRole, number> = { viewer: 0, member: 1, owner: 2 };

export function hasRole(role: MembershipRole, min: MembershipRole): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * THE authorization boundary. Every route under /workspaces/:workspaceId uses this: the
 * workspace comes from the caller's own membership, never from trusting the URL.
 * Non-members get 404 (not 403) so workspace IDs can't be probed.
 */
export function requireWorkspace(min: MembershipRole = "viewer") {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    const { workspaceId } = req.params as { workspaceId?: string };
    if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw notFound();
    const membership = await req.server.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
      include: { workspace: true },
    });
    if (!membership) throw notFound();
    if (!hasRole(membership.role, min)) throw forbidden();
    req.membership = membership;
  };
}
