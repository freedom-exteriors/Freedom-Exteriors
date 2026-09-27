// Notification outbox. Jobs call notify(); in-app rows are delivered on creation (the
// dashboard reads them), email rows are sent by deliverPending() when configured.
// (userId, dedupeKey, channel) is unique, so a job that runs twice never double-notifies.
import type { PrismaClient } from "@mcp/db";
import webpush from "web-push";

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

export interface PushSender {
  /** Returns "gone" when the push service says the subscription no longer exists. */
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url: string | null }, ttlSeconds: number): Promise<"ok" | "gone">;
}

/** Standard Web Push (VAPID) — works in Chrome, Edge, Firefox, and Safari/iOS 16.4+ home-screen apps. */
export class VapidPushSender implements PushSender {
  constructor(vapid: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }
  async send(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url: string | null }, ttlSeconds: number) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: ttlSeconds, urgency: "high" });
      return "ok" as const;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone" as const;
      throw err;
    }
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
  const pushUsers = await prisma.user.findMany({ where: { id: { in: n.userIds }, pushSubscriptions: { some: {} } }, select: { id: true } });
  const base = { workspaceId: n.workspaceId, kind: n.kind, title: n.title, body: n.body, url: n.url ?? null, dedupeKey: n.dedupeKey, sendAt: now };
  const { count } = await prisma.notification.createMany({
    data: [
      ...n.userIds.map((userId) => ({ ...base, userId, channel: "in_app" as const, sentAt: now })),
      ...emailUsers.map((u) => ({ ...base, userId: u.id, channel: "email" as const })),
      ...pushUsers.map((u) => ({ ...base, userId: u.id, channel: "web_push" as const })),
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

/**
 * Sends due email and push notifications. Stale time-sensitive ones (past their moment)
 * are dropped, not sent late: a "leave now" an hour late is worse than none.
 */
export async function deliverPending(
  prisma: PrismaClient,
  deps: { email: EmailSender | null; push?: PushSender | null; now?: Date; maxAgeMinutes?: number; publicWebUrl?: string },
) {
  const now = deps.now ?? new Date();
  const maxAgeMs = (deps.maxAgeMinutes ?? 30) * 60_000;
  const due = await prisma.notification.findMany({
    where: { channel: { in: ["email", "web_push"] }, sentAt: null, error: null, sendAt: { lte: now } },
    include: { user: { select: { email: true, pushSubscriptions: true } } },
    take: 100,
  });
  let sent = 0;
  const fail = (id: string, error: string) => prisma.notification.update({ where: { id }, data: { error } });
  for (const n of due) {
    if (now.getTime() - n.sendAt.getTime() > maxAgeMs) {
      await fail(n.id, "expired before it could be sent");
      continue;
    }
    try {
      if (n.channel === "email") {
        if (!deps.email) {
          await fail(n.id, "email not configured");
          continue;
        }
        const link = n.url && deps.publicWebUrl ? `\n\n${deps.publicWebUrl}${n.url}` : "";
        await deps.email.send({ to: n.user.email, subject: n.title, text: `${n.body}${link}\n` });
      } else {
        if (!deps.push) {
          await fail(n.id, "push not configured");
          continue;
        }
        const ttl = Math.max(60, Math.floor((maxAgeMs - (now.getTime() - n.sendAt.getTime())) / 1000));
        let delivered = 0;
        for (const sub of n.user.pushSubscriptions) {
          const r = await deps.push.send(sub, { title: n.title, body: n.body, url: n.url }, ttl);
          if (r === "gone") await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          else {
            delivered++;
            await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: now } });
          }
        }
        if (delivered === 0) {
          await fail(n.id, "no active devices");
          continue;
        }
      }
      await prisma.notification.update({ where: { id: n.id }, data: { sentAt: new Date() } });
      sent++;
    } catch (err) {
      await fail(n.id, String(err).slice(0, 500));
    }
  }
  return { sent };
}
