// Notification outbox. Jobs call notify(); in-app rows are delivered on creation (the
// dashboard reads them), email rows are sent by deliverPending() when configured.
// (userId, dedupeKey, channel) is unique, so a job that runs twice never double-notifies.
import type { PrismaClient } from "@mcp/db";

export interface EmailSender {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

/** Resend (resend.com) transactional email over its HTTP API. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: { to: string; subject: string; text: string }) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export interface NotifyInput {
  workspaceId: string;
  userIds: string[];
  kind: string;
  title: string;
  body: string;
  url?: string | null;
  dedupeKey: string;
  now?: Date;
}

export async function notify(prisma: PrismaClient, n: NotifyInput): Promise<number> {
  if (n.userIds.length === 0) return 0;
  const now = n.now ?? new Date();
  const emailUsers = await prisma.user.findMany({ where: { id: { in: n.userIds }, emailNotifications: true }, select: { id: true } });
  const base = { workspaceId: n.workspaceId, kind: n.kind, title: n.title, body: n.body, url: n.url ?? null, dedupeKey: n.dedupeKey, sendAt: now };
  const { count } = await prisma.notification.createMany({
    data: [
      ...n.userIds.map((userId) => ({ ...base, userId, channel: "in_app" as const, sentAt: now })),
      ...emailUsers.map((u) => ({ ...base, userId: u.id, channel: "email" as const })),
    ],
    skipDuplicates: true,
  });
  return count;
}

/**
 * Who hears about something a given person has to do: their own login if they have
 * one; otherwise (grandma drives but has no account) the household's adults.
 */
export async function recipientsFor(prisma: PrismaClient, workspaceId: string, participantId: string | null): Promise<string[]> {
  if (participantId) {
    const own = await prisma.workspaceMembership.findFirst({ where: { workspaceId, participantId }, select: { userId: true } });
    if (own) return [own.userId];
  }
  const adults = await prisma.workspaceMembership.findMany({ where: { workspaceId, role: { in: ["owner", "member"] } }, select: { userId: true } });
  return adults.map((a) => a.userId);
}

/** Sends due email notifications. Stale time-sensitive ones (past their moment) are dropped, not sent late. */
export async function deliverPending(prisma: PrismaClient, deps: { email: EmailSender | null; now?: Date; maxAgeMinutes?: number }) {
  const now = deps.now ?? new Date();
  const due = await prisma.notification.findMany({
    where: { channel: "email", sentAt: null, error: null, sendAt: { lte: now } },
    include: { user: { select: { email: true } } },
    take: 100,
  });
  let sent = 0;
  for (const n of due) {
    if (!deps.email) {
      await prisma.notification.update({ where: { id: n.id }, data: { error: "email not configured" } });
      continue;
    }
    if (now.getTime() - n.sendAt.getTime() > (deps.maxAgeMinutes ?? 30) * 60_000) {
      await prisma.notification.update({ where: { id: n.id }, data: { error: "expired before it could be sent" } });
      continue;
    }
    try {
      await deps.email.send({ to: n.user.email, subject: n.title, text: `${n.body}\n` });
      await prisma.notification.update({ where: { id: n.id }, data: { sentAt: new Date() } });
      sent++;
    } catch (err) {
      await prisma.notification.update({ where: { id: n.id }, data: { error: String(err).slice(0, 500) } });
    }
  }
  return { sent };
}
