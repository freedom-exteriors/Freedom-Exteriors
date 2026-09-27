// Participants (the people on the calendar), their free-time windows, and places.
// These feed the schedule organizer and leave-by alerts.
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@mcp/db";
import { z } from "zod";
import { HttpError, badRequest, conflict, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireWorkspace } from "../auth/plugin.js";
import { nextParticipantColor } from "../lib/colors.js";

const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "use HH:MM");
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "use a hex color like #2563EB");

const participantBody = z.object({
  name: z.string().trim().min(1).max(80),
  color: color.optional(),
  canDrive: z.boolean().optional(),
  homePlaceId: uuid.nullable().optional(),
  maxPlannedTaskMinutesPerDay: z.number().int().min(0).max(24 * 60).optional(),
});
const windows = z
  .array(z.object({ dayOfWeek: z.number().int().min(0).max(6), start: hhmm, end: hhmm }))
  .max(50)
  .refine((ws) => ws.every((w) => toMin(w.start) < toMin(w.end)), "each window must end after it starts");
const hoursSchema = z
  .array(z.object({ dayOfWeek: z.number().int().min(0).max(6), open: hhmm, close: hhmm }))
  .max(30)
  .refine((hs) => hs.every((h) => toMin(h.open) < toMin(h.close)), "closing time must be after opening time");
const placeBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["home", "work", "school", "activity", "store", "other"]).default("other"),
  address: z.string().trim().max(300).nullable().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  arrivalBufferMinutes: z.number().int().min(0).max(60).optional(),
  openingHours: hoursSchema.nullable().optional(),
});

export type Geocoder = (address: string, near?: { lat: number; lng: number }) => Promise<{ lat: number; lng: number; formattedAddress: string; googlePlaceId: string } | null>;

export async function peopleRoutes(app: FastifyInstance) {
  const p = app.prisma;

  async function assertPlace(ws: string, id: string | null | undefined) {
    if (id && !(await p.place.count({ where: { id, workspaceId: ws } }))) throw badRequest("invalid_place", "That place isn't in this workspace");
  }

  // ─── Participants ───
  app.get("/workspaces/:workspaceId/participants", { preHandler: requireWorkspace() }, async (req) => {
    const rows = await p.participant.findMany({
      where: { workspaceId: req.membership!.workspaceId },
      include: { availability: { orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] }, homePlace: { select: { id: true, name: true } }, membership: { select: { role: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(({ membership, ...r }) => ({ ...r, hasLogin: membership !== null, loginRole: membership?.role ?? null }));
  });

  app.post("/workspaces/:workspaceId/participants", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const body = parse(participantBody, req.body);
    const ws = req.membership!.workspaceId;
    await assertPlace(ws, body.homePlaceId);
    const used = (await p.participant.findMany({ where: { workspaceId: ws }, select: { color: true } })).map((x) => x.color);
    // New people start from the household's home, if one's set up.
    const home = body.homePlaceId === undefined ? await p.place.findFirst({ where: { workspaceId: ws, kind: "home" } }) : null;
    const row = await p.participant.create({
      data: { ...body, color: body.color ?? nextParticipantColor(used), workspaceId: ws, homePlaceId: body.homePlaceId ?? home?.id ?? null },
    });
    return reply.code(201).send(row);
  });

  app.patch("/workspaces/:workspaceId/participants/:participantId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { participantId } = parse(z.object({ participantId: uuid }), req.params);
    const body = parse(participantBody.partial(), req.body);
    const ws = req.membership!.workspaceId;
    if (!(await p.participant.count({ where: { id: participantId, workspaceId: ws } }))) throw notFound("Person not found");
    await assertPlace(ws, body.homePlaceId);
    return p.participant.update({ where: { id: participantId }, data: body });
  });

  app.delete("/workspaces/:workspaceId/participants/:participantId", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const { participantId } = parse(z.object({ participantId: uuid }), req.params);
    const row = await p.participant.findFirst({ where: { id: participantId, workspaceId: req.membership!.workspaceId } });
    if (!row) throw notFound("Person not found");
    if (row.linkedWorkspaceId) throw conflict("linked_household", "Households leave a circle by leaving it, not by being deleted");
    await p.participant.delete({ where: { id: participantId } }); // their events/tasks become unassigned
    return reply.code(204).send();
  });

  // Replaces the whole weekly pattern (simplest thing for a "free time" editor to send).
  app.put("/workspaces/:workspaceId/participants/:participantId/availability", { preHandler: requireWorkspace("member") }, async (req) => {
    const { participantId } = parse(z.object({ participantId: uuid }), req.params);
    const body = parse(z.object({ windows }), req.body);
    if (!(await p.participant.count({ where: { id: participantId, workspaceId: req.membership!.workspaceId } }))) throw notFound("Person not found");
    await p.$transaction([
      p.availabilityWindow.deleteMany({ where: { participantId } }),
      p.availabilityWindow.createMany({ data: body.windows.map((w) => ({ participantId, dayOfWeek: w.dayOfWeek, startMinute: toMin(w.start), endMinute: toMin(w.end) })) }),
    ]);
    return p.availabilityWindow.findMany({ where: { participantId }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] });
  });

  // ─── Places ───
  app.get("/workspaces/:workspaceId/places", { preHandler: requireWorkspace() }, async (req) =>
    p.place.findMany({ where: { workspaceId: req.membership!.workspaceId }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
  );

  async function resolveCoords(ws: string, b: { address?: string | null; latitude?: number; longitude?: number }) {
    if (b.latitude !== undefined && b.longitude !== undefined) return { latitude: b.latitude, longitude: b.longitude, googlePlaceId: null as string | null };
    if (!b.address) throw badRequest("location_required", "Give an address (or coordinates)");
    if (!app.geocoder) throw new HttpError(503, "not_configured", "Address lookup isn't set up on this server — enter coordinates instead");
    const home = await p.place.findFirst({ where: { workspaceId: ws, kind: "home" } });
    const hit = await app.geocoder(b.address, home ? { lat: home.latitude, lng: home.longitude } : undefined);
    if (!hit) throw badRequest("address_not_found", "Couldn't find that address — try adding the city");
    return { latitude: hit.lat, longitude: hit.lng, googlePlaceId: hit.googlePlaceId, formattedAddress: hit.formattedAddress };
  }
  const hoursJson = (h: z.infer<typeof hoursSchema> | null | undefined) =>
    h === undefined ? undefined : h === null ? (null as unknown as Prisma.InputJsonValue) : (h.map((x) => ({ dayOfWeek: x.dayOfWeek, startMinute: toMin(x.open), endMinute: toMin(x.close) })) as Prisma.InputJsonValue);

  app.post("/workspaces/:workspaceId/places", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const body = parse(placeBody, req.body);
    const ws = req.membership!.workspaceId;
    const coords = await resolveCoords(ws, body);
    const { latitude: _a, longitude: _b, openingHours, ...rest } = body;
    const place = await p.place.create({
      data: {
        ...rest,
        address: body.address ?? ("formattedAddress" in coords ? coords.formattedAddress : null),
        latitude: coords.latitude,
        longitude: coords.longitude,
        googlePlaceId: coords.googlePlaceId,
        openingHours: hoursJson(openingHours),
        workspaceId: ws,
      },
    });
    // First home place becomes everyone's starting point.
    if (place.kind === "home") await p.participant.updateMany({ where: { workspaceId: ws, homePlaceId: null, linkedWorkspaceId: null }, data: { homePlaceId: place.id } });
    return reply.code(201).send(place);
  });

  app.patch("/workspaces/:workspaceId/places/:placeId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { placeId } = parse(z.object({ placeId: uuid }), req.params);
    const body = parse(placeBody.partial(), req.body);
    const ws = req.membership!.workspaceId;
    const existing = await p.place.findFirst({ where: { id: placeId, workspaceId: ws } });
    if (!existing) throw notFound("Place not found");
    const moved = body.latitude !== undefined || body.longitude !== undefined || (body.address && body.address !== existing.address);
    const coords = moved ? await resolveCoords(ws, { ...body, address: body.address ?? existing.address }) : null;
    const { latitude: _a, longitude: _b, openingHours, ...rest } = body;
    return p.place.update({
      where: { id: placeId },
      data: { ...rest, ...(coords ? { latitude: coords.latitude, longitude: coords.longitude, googlePlaceId: coords.googlePlaceId } : {}), openingHours: hoursJson(openingHours) },
    });
  });

  app.delete("/workspaces/:workspaceId/places/:placeId", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const { placeId } = parse(z.object({ placeId: uuid }), req.params);
    const { count } = await p.place.deleteMany({ where: { id: placeId, workspaceId: req.membership!.workspaceId } });
    if (!count) throw notFound("Place not found");
    return reply.code(204).send();
  });
}
