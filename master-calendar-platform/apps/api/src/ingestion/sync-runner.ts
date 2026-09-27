// One entry point for "sync this source" and "sync everything that's due", whatever the
// source type. The worker and the manual-sync route both go through here.
import type { PrismaClient } from "@mcp/db";
import { FeedError } from "./safe-fetch.js";
import { IcsParseError } from "./ics-parser.js";
import { syncIcsSource, type IcsSyncDeps } from "./ics-sync.js";
import { FAILURE_BACKOFF_MINUTES, minutesFrom, type SyncStats } from "./apply.js";
import { GoogleSyncError, syncGoogleSource } from "../integrations/google-sync.js";
import type { GoogleApi } from "../integrations/google-api.js";

export interface SyncDeps extends IcsSyncDeps {
  google: GoogleApi | null;
}

export async function syncSource(prisma: PrismaClient, sourceId: string, deps: SyncDeps): Promise<SyncStats> {
  const s = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId }, select: { type: true } });
  if (s.type === "ics_feed") return syncIcsSource(prisma, sourceId, deps);
  if (s.type === "google") return syncGoogleSource(prisma, sourceId, deps);
  throw new FeedError("This calendar type can't be synced");
}

/** User-facing message for a failed sync; unexpected errors don't leak internals. */
export function describeSyncError(err: unknown): string {
  if (err instanceof FeedError || err instanceof IcsParseError || err instanceof GoogleSyncError) return err.message;
  return "Something went wrong reading this calendar";
}

/**
 * Runs every source that's due. Each is *claimed* first (nextSyncAt pushed out with a
 * conditional update), so two workers never sync the same source at once. Google
 * sources whose connection needs re-auth are skipped until the person reconnects.
 */
export async function runDueSyncs(
  prisma: PrismaClient,
  deps: SyncDeps & { log?: (msg: string, extra?: object) => void; limit?: number },
): Promise<{ attempted: number; failed: number }> {
  const now = deps.now?.() ?? new Date();
  const due = await prisma.calendarSource.findMany({
    where: {
      AND: [
        { OR: [{ type: "ics_feed", feedUrl: { not: null } }, { type: "google", oauthConnection: { status: "active" } }] },
        { OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }] },
      ],
    },
    select: { id: true, nextSyncAt: true },
    orderBy: { nextSyncAt: { sort: "asc", nulls: "first" } },
    take: deps.limit ?? 25,
  });
  let attempted = 0;
  let failed = 0;
  for (const s of due) {
    const claimed = await prisma.calendarSource.updateMany({
      where: { id: s.id, nextSyncAt: s.nextSyncAt },
      data: { nextSyncAt: minutesFrom(now, 10) }, // lease; overwritten on completion
    });
    if (claimed.count === 0) continue;
    attempted++;
    try {
      const stats = await syncSource(prisma, s.id, deps);
      deps.log?.("sync ok", { sourceId: s.id, ...stats });
    } catch (err) {
      failed++;
      deps.log?.("sync failed", { sourceId: s.id, error: String(err) });
      await prisma.calendarSource.update({
        where: { id: s.id },
        data: { lastSyncError: describeSyncError(err), nextSyncAt: minutesFrom(now, FAILURE_BACKOFF_MINUTES) },
      });
    }
  }
  return { attempted, failed };
}
