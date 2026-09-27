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

  app.patch("/me", { preHandler: requireUser }, async (req) => {
    const body = parse(z.object({ emailNotifications: z.boolean() }), req.body);
    const u = await app.prisma.user.update({ where: { id: req.user!.id }, data: body, select: { id: true, email: true, emailNotifications: true } });
    return u;
  });
}
