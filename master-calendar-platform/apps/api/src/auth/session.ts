// Sessions, following the Lucia v3 guide (lucia-auth.com) rather than the deprecated
// package: a random token goes to the client in a cookie; the DB stores only its SHA-256,
// so a leaked Session table can't be replayed.
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, Session, User } from "@mcp/db";

export const SESSION_COOKIE = "session";
const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY;
const RENEW_WITHIN_MS = 15 * DAY; // sliding expiry: active users stay signed in

export const generateSessionToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(prisma: PrismaClient, userId: string): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const session = await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return { token, session };
}

export type SafeUser = Pick<User, "id" | "email" | "createdAt">;

/** Returns null for unknown/expired tokens. `renewed` means the cookie must be re-sent. */
export async function validateSessionToken(
  prisma: PrismaClient,
  token: string,
): Promise<{ session: Session; user: SafeUser; renewed: boolean } | null> {
  const row = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { select: { id: true, email: true, createdAt: true } } },
  });
  if (!row) return null;
  const { user, ...session } = row;
  if (Date.now() >= session.expiresAt.getTime()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.expiresAt.getTime() - Date.now() < RENEW_WITHIN_MS) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: session.expiresAt } });
    return { session, user, renewed: true };
  }
  return { session, user, renewed: false };
}

export async function invalidateSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
