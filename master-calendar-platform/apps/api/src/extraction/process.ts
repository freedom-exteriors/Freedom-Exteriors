// Runs extraction for an uploaded photo: pending → processing → completed | failed.
// Results are *candidates* stored on the upload; nothing touches the calendar until a
// person confirms (see routes/photos.ts).
import type { Prisma, PrismaClient } from "@mcp/db";
import type { PhotoStore } from "./photo-store.js";
import { ExtractionError, type ExtractionInput, type ScheduleExtractor } from "./extractor.js";
import { toCandidates, type ExtractionResult } from "./candidates.js";
import { isoDate, todayIn } from "../lib/recurrence.js";

export interface ExtractionDeps {
  store: PhotoStore;
  extractor: ScheduleExtractor | null;
  log?: (msg: string, extra?: object) => void;
}

const STUCK_AFTER_MS = 10 * 60_000;

export async function processUpload(prisma: PrismaClient, uploadId: string, deps: ExtractionDeps): Promise<void> {
  // Claim it: only one runner moves a given upload from pending to processing.
  const claimed = await prisma.uploadedScheduleImage.updateMany({
    where: { id: uploadId, status: "pending" },
    data: { status: "processing", errorMessage: null },
  });
  if (claimed.count === 0) return;
  const upload = await prisma.uploadedScheduleImage.findUniqueOrThrow({ where: { id: uploadId }, include: { workspace: true } });
  try {
    if (!deps.extractor) throw new ExtractionError("Photo reading isn't set up on this server yet");
    const ws = upload.workspace;
    const [people, tags, bytes] = await Promise.all([
      prisma.participant.findMany({ where: { workspaceId: ws.id }, select: { id: true, name: true } }),
      prisma.eventTagDefinition.findMany({ where: { workspaceId: ws.id }, select: { id: true, key: true, label: true } }),
      deps.store.get(upload.storagePath),
    ]);
    const today = isoDate(todayIn(ws.timeZone));
    const mediaType: ExtractionInput["mediaType"] = upload.storagePath.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
    const out = await deps.extractor.extract({ bytes, mediaType, timeZone: ws.timeZone, today, people: people.map((p) => p.name), tags });
    const result: ExtractionResult = {
      model: deps.extractor.model,
      notes: out.notes,
      candidates: toCandidates(out, { timeZone: ws.timeZone, today, people, tags }),
    };
    await prisma.uploadedScheduleImage.update({
      where: { id: uploadId },
      data: { status: "completed", extractedEvents: result as unknown as Prisma.InputJsonValue },
    });
    deps.log?.("photo extracted", { uploadId, candidates: result.candidates.length });
  } catch (err) {
    const message = err instanceof ExtractionError ? err.message : "Something went wrong reading this photo";
    deps.log?.("photo extraction failed", { uploadId, error: String(err) });
    await prisma.uploadedScheduleImage.update({ where: { id: uploadId }, data: { status: "failed", errorMessage: message } });
  }
}

/** Worker: picks up uploads whose in-request run never finished (crash, deploy) and retries them. */
export async function runPendingExtractions(prisma: PrismaClient, deps: ExtractionDeps): Promise<number> {
  await prisma.uploadedScheduleImage.updateMany({
    where: { status: "processing", updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: "pending" },
  });
  const pending = await prisma.uploadedScheduleImage.findMany({
    where: { status: "pending", createdAt: { lt: new Date(Date.now() - 60_000) } },
    select: { id: true },
    take: 5,
  });
  for (const p of pending) await processUpload(prisma, p.id, deps);
  return pending.length;
}
