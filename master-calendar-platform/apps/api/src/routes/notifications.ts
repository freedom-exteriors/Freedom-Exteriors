// The signed-in person's notification feed (the dashboard's bell) and preferences.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parse } from "../lib/validate.js";
import { requireUser } from "../auth/plugin.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/me/notifications", { preHandler: requireUser }, async (req) => {
    const { unread } = parse(z.object({ unread: z.enum(["true", "false"]).default("false") }), req.query);
    const rows = await app.prisma.notification.findMany({
      where: { userId: req.user!.id, channel: "in_app", ...(unread === "true" ? { readAt: null } : {}) },
      select: { id: true, workspaceId: true, kind: true, title: true, body: true, url: true, readAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const unreadCount = await app.prisma.notification.count({ where: { userId: req.user!.id, channel: "in_app", readAt: null } });
    return { unreadCount, notifications: rows };
  });

  app.post("/me/notifications/read", { preHandler: requireUser }, async (req) => {
    const body = parse(z.union([z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }), z.object({ all: z.literal(true) })]), req.body);
    const { count } = await app.prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null, ...("ids" in body ? { id: { in: body.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { marked: count };
  });

  // ─── Web push ───
  app.get("/push/config", async () => ({ vapidPublicKey: app.config.vapid?.publicKey ?? null }));

  app.post("/me/push-subscriptions", { preHandler: requireUser }, async (req, reply) => {
    const body = parse(
      z.object({
        endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "push endpoints are https"),
        keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
      }),
      req.body,
    );
    const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 300) || null;
    // The endpoint identifies the device; if another account used it before, it's this person's now.
    await app.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { userId: req.user!.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent },
      update: { userId: req.user!.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent },
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete("/me/push-subscriptions", { preHandler: requireUser }, async (req, reply) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    await app.prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } });
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: requireUser }, async (req) => {
    const u = await app.prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { id: true, email: true, emailNotifications: true, _count: { select: { pushSubscriptions: true } } },
    });
    return { id: u.id, email: u.email, emailNotifications: u.emailNotifications, pushDevices: u._count.pushSubscriptions };
  });

  app.patch("/me", { preHandler: requireUser }, async (req) => {
    const body = parse(z.object({ emailNotifications: z.boolean() }), req.body);
    const u = await app.prisma.user.update({ where: { id: req.user!.id }, data: body, select: { id: true, email: true, emailNotifications: true } });
    return u;
  });
}
