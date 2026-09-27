// Photo → calendar: upload a schedule photo, a vision model proposes candidate events,
// a person reviews/edits them, and only confirmed candidates become Event rows (in the
// workspace's "Photo imports" source). Nothing is ever auto-added.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma, UploadedScheduleImage } from "@mcp/db";
import { z } from "zod";
import { HttpError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { assertParticipantIn, assertTagIn } from "../lib/scope.js";
import { requireWorkspace } from "../auth/plugin.js";
import { UploadError, prepareUpload } from "../extraction/prepare.js";
import { processUpload } from "../extraction/process.js";
import type { Candidate, ExtractionResult } from "../extraction/candidates.js";

const uuid = z.string().uuid();
const photoParams = z.object({ workspaceId: uuid, photoId: uuid });
const candidateParams = photoParams.extend({ candidateId: uuid });
const iso = z.iso.datetime({ offset: true });
const candidatePatch = z
  .object({
    title: z.string().trim().min(1).max(300),
    start: iso,
    end: iso,
    allDay: z.boolean(),
    location: z.string().trim().max(300).nullable(),
    participantId: uuid.nullable(),
    eventTagId: uuid.nullable(),
  })
  .partial();
const confirmBody = z.object({
  candidateIds: z.array(uuid).min(1).max(100),
  /** Required to confirm unedited low-confidence candidates (the UI asks first). */
  confirmLowConfidence: z.boolean().default(false),
});
const rejectBody = z.object({ candidateIds: z.array(uuid).min(1).max(100) });

type StoredCandidate = Candidate & { edited?: boolean };
type Stored = Omit<ExtractionResult, "candidates"> & { candidates: StoredCandidate[] };

export async function photoRoutes(app: FastifyInstance) {
  const p = app.prisma;
  const deps = () => ({ store: app.photoStore, extractor: app.extractor, log: (msg: string, extra?: object) => app.log.info(extra ?? {}, msg) });

  async function findPhoto(workspaceId: string, photoId: string) {
    const photo = await p.uploadedScheduleImage.findFirst({ where: { id: photoId, workspaceId } });
    if (!photo) throw notFound("Photo not found");
    return photo;
  }
  const stored = (photo: UploadedScheduleImage): Stored | null => (photo.extractedEvents as unknown as Stored | null) ?? null;

  /** Optimistic write of the candidate list: fails with 409 if someone else changed it meanwhile. */
  async function saveCandidates(photo: UploadedScheduleImage, next: Stored) {
    const { count } = await p.uploadedScheduleImage.updateMany({
      where: { id: photo.id, updatedAt: photo.updatedAt },
      data: { extractedEvents: next as unknown as Prisma.InputJsonValue },
    });
    if (count === 0) throw conflict("stale", "Someone else just changed this — reload and try again");
  }

  function present(photo: UploadedScheduleImage & { uploadedBy?: { email: string } | null }) {
    const s = stored(photo);
    const cands = s?.candidates ?? [];
    return {
      id: photo.id,
      status: photo.status,
      errorMessage: photo.errorMessage,
      createdAt: photo.createdAt,
      uploadedBy: photo.uploadedBy?.email ?? null,
      imageUrl: `/workspaces/${photo.workspaceId}/schedule-photos/${photo.id}/image`,
      notes: s?.notes ?? null,
      counts: {
        pending: cands.filter((c) => c.status === "pending").length,
        confirmed: cands.filter((c) => c.status === "confirmed").length,
        rejected: cands.filter((c) => c.status === "rejected").length,
      },
    };
  }

  app.post(
    "/workspaces/:workspaceId/schedule-photos",
    {
      preHandler: requireWorkspace(), // kids can snap a flyer too; confirming needs a member
      config: { rateLimit: { max: 30, timeWindow: "1 hour", keyGenerator: (req) => req.user?.id ?? req.ip } },
    },
    async (req, reply) => {
      const { wait } = parse(z.object({ wait: z.enum(["true", "false"]).default("false") }), req.query);
      const ws = req.membership!.workspaceId;
      if (!req.isMultipart()) throw badRequest("file_required", "Attach a photo");
      const file = await req.file();
      if (!file) throw badRequest("file_required", "Attach a photo");
      let raw: Buffer;
      try {
        raw = await file.toBuffer();
      } catch {
        throw new HttpError(413, "too_large", "That file is too big (15 MB max)");
      }
      let prepared;
      try {
        prepared = await prepareUpload(raw);
      } catch (err) {
        if (err instanceof UploadError) throw badRequest("unsupported_file", err.message);
        throw err;
      }
      const id = randomUUID();
      const storagePath = `${ws}/${id}.${prepared.ext}`;
      await app.photoStore.put(storagePath, prepared.bytes, prepared.mediaType);
      await p.uploadedScheduleImage.create({ data: { id, workspaceId: ws, storagePath, uploadedByUserId: req.user!.id } });

      const run = processUpload(p, id, deps());
      if (wait === "true") await run;
      else run.catch((err) => req.log.error({ err }, "background extraction crashed")); // the worker retries stragglers
      const photo = await p.uploadedScheduleImage.findUniqueOrThrow({ where: { id } });
      return reply.code(wait === "true" ? 201 : 202).send(present(photo));
    },
  );

  app.get("/workspaces/:workspaceId/schedule-photos", { preHandler: requireWorkspace() }, async (req) => {
    const rows = await p.uploadedScheduleImage.findMany({
      where: { workspaceId: req.membership!.workspaceId },
      include: { uploadedBy: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(present);
  });

  app.get("/workspaces/:workspaceId/schedule-photos/:photoId", { preHandler: requireWorkspace() }, async (req) => {
    const { photoId } = parse(photoParams, req.params);
    const photo = await p.uploadedScheduleImage.findFirst({
      where: { id: photoId, workspaceId: req.membership!.workspaceId },
      include: { uploadedBy: { select: { email: true } } },
    });
    if (!photo) throw notFound("Photo not found");
    return { ...present(photo), model: stored(photo)?.model ?? null, candidates: stored(photo)?.candidates ?? [] };
  });

  app.get("/workspaces/:workspaceId/schedule-photos/:photoId/image", { preHandler: requireWorkspace() }, async (req, reply) => {
    const { photoId } = parse(photoParams, req.params);
    const photo = await findPhoto(req.membership!.workspaceId, photoId);
    const bytes = await app.photoStore.get(photo.storagePath);
    return reply
      .header("Content-Type", photo.storagePath.endsWith(".pdf") ? "application/pdf" : "image/jpeg")
      .header("Cache-Control", "private, max-age=3600")
      .header("X-Content-Type-Options", "nosniff")
      .send(bytes);
  });

  // Fix what the model got wrong before confirming (wrong date, missing location, who it's for).
  app.patch("/workspaces/:workspaceId/schedule-photos/:photoId/candidates/:candidateId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { photoId, candidateId } = parse(candidateParams, req.params);
    const body = parse(candidatePatch, req.body);
    const ws = req.membership!.workspaceId;
    const photo = await findPhoto(ws, photoId);
    const s = stored(photo);
    const cand = s?.candidates.find((c) => c.id === candidateId);
    if (!s || !cand) throw notFound("Candidate not found");
    if (cand.status !== "pending") throw conflict("already_reviewed", "This one was already confirmed or skipped");
    await assertParticipantIn(p, ws, body.participantId);
    await assertTagIn(p, ws, body.eventTagId);
    const next: StoredCandidate = {
      ...cand,
      ...body,
      ...(body.start ? { start: new Date(body.start).toISOString() } : {}),
      ...(body.end ? { end: new Date(body.end).toISOString() } : {}),
      edited: true,
    };
    if (new Date(next.end) < new Date(next.start)) throw badRequest("invalid_range", "End must be after start");
    await saveCandidates(photo, { ...s, candidates: s.candidates.map((c) => (c.id === candidateId ? next : c)) });
    return next;
  });

  app.post("/workspaces/:workspaceId/schedule-photos/:photoId/confirm", { preHandler: requireWorkspace("member") }, async (req) => {
    const { photoId } = parse(photoParams, req.params);
    const body = parse(confirmBody, req.body);
    const ws = req.membership!.workspaceId;
    const photo = await findPhoto(ws, photoId);
    const s = stored(photo);
    if (photo.status !== "completed" || !s) throw conflict("not_ready", "This photo hasn't been read yet");

    const wanted = new Set(body.candidateIds);
    const results: { candidateId: string; ok: boolean; eventId?: string; reason?: string }[] = [];
    const toCreate: StoredCandidate[] = [];
    for (const id of wanted) {
      const c = s.candidates.find((x) => x.id === id);
      if (!c) results.push({ candidateId: id, ok: false, reason: "not_found" });
      else if (c.status !== "pending") results.push({ candidateId: id, ok: false, reason: `already_${c.status}` });
      else if (c.lowConfidence && !c.edited && !body.confirmLowConfidence) results.push({ candidateId: id, ok: false, reason: "low_confidence_needs_confirmation" });
      else toCreate.push(c);
    }
    // Re-check references at confirm time (a person may have been deleted since editing).
    for (const c of toCreate) {
      await assertParticipantIn(p, ws, c.participantId);
      await assertTagIn(p, ws, c.eventTagId);
    }

    const source =
      (await p.calendarSource.findFirst({ where: { workspaceId: ws, type: "photo_extraction" } })) ??
      (await p.calendarSource.create({ data: { workspaceId: ws, type: "photo_extraction", name: "Photo imports" } }));
    const eventIds = new Map<string, string>();
    await p.$transaction(async (tx) => {
      for (const c of toCreate) {
        const e = await tx.event.create({
          data: {
            calendarSourceId: source.id,
            externalUid: `photo:${photo.id}`,
            externalRecurrenceId: c.id,
            title: c.title,
            startTime: new Date(c.start),
            endTime: new Date(c.end),
            allDay: c.allDay,
            location: c.location,
            participantId: c.participantId,
            eventTagId: c.eventTagId,
            rawSourceData: { photoId: photo.id, confidence: c.confidence, sourceText: c.sourceText, assumptions: c.assumptions, model: s.model, confirmedBy: req.user!.id } as Prisma.InputJsonValue,
          },
        });
        eventIds.set(c.id, e.id);
      }
      const { count } = await tx.uploadedScheduleImage.updateMany({
        where: { id: photo.id, updatedAt: photo.updatedAt },
        data: {
          extractedEvents: {
            ...s,
            candidates: s.candidates.map((c) => (eventIds.has(c.id) ? { ...c, status: "confirmed", eventId: eventIds.get(c.id)! } : c)),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      if (count === 0) throw conflict("stale", "Someone else just changed this — reload and try again");
    });
    for (const c of toCreate) results.push({ candidateId: c.id, ok: true, eventId: eventIds.get(c.id)! });
    return { results };
  });

  app.post("/workspaces/:workspaceId/schedule-photos/:photoId/reject", { preHandler: requireWorkspace("member") }, async (req) => {
    const { photoId } = parse(photoParams, req.params);
    const body = parse(rejectBody, req.body);
    const photo = await findPhoto(req.membership!.workspaceId, photoId);
    const s = stored(photo);
    if (!s) throw conflict("not_ready", "This photo hasn't been read yet");
    const ids = new Set(body.candidateIds);
    let rejected = 0;
    const candidates = s.candidates.map((c) => {
      if (!ids.has(c.id) || c.status !== "pending") return c;
      rejected++;
      return { ...c, status: "rejected" as const };
    });
    await saveCandidates(photo, { ...s, candidates });
    return { rejected };
  });

  app.post("/workspaces/:workspaceId/schedule-photos/:photoId/retry", { preHandler: requireWorkspace("member") }, async (req) => {
    const { photoId } = parse(photoParams, req.params);
    const photo = await findPhoto(req.membership!.workspaceId, photoId);
    if (photo.status !== "failed") throw conflict("not_failed", "Only photos that couldn't be read can be retried");
    await p.uploadedScheduleImage.update({ where: { id: photo.id }, data: { status: "pending", errorMessage: null } });
    await processUpload(p, photo.id, deps());
    return present(await p.uploadedScheduleImage.findUniqueOrThrow({ where: { id: photo.id } }));
  });

  // Removes the photo; events already confirmed from it stay on the calendar.
  app.delete("/workspaces/:workspaceId/schedule-photos/:photoId", { preHandler: requireWorkspace() }, async (req, reply) => {
    const { photoId } = parse(photoParams, req.params);
    const m = req.membership!;
    const photo = await findPhoto(m.workspaceId, photoId);
    if (m.role === "viewer" && photo.uploadedByUserId !== req.user!.id) throw forbidden();
    await app.photoStore.remove(photo.storagePath);
    await p.uploadedScheduleImage.delete({ where: { id: photo.id } });
    return reply.code(204).send();
  });
}
