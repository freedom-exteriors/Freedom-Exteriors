// Pulls one ICS feed into Event rows, and the scheduler that runs due feeds.
//
// Rules:
//  - Upsert key is (calendarSourceId, externalUid, externalRecurrenceId), so re-syncs
//    never duplicate.
//  - The feed owns title/time/location. People own participant, tag, driver and place:
//    a sync sets participant/tag only when *creating* an event (from the source's
//    defaults) and never overwrites them afterwards. If the location text changes, the
//    geocoded place is cleared so it gets re-resolved.
//  - Events that vanish from the feed inside the sync window are deleted (cancelled
//    upstream). Past events outside the window are left alone.
//  - An empty feed never wipes a calendar that had events: that's far more often a
//    broken feed than a real "everything was cancelled".
import type { Prisma, PrismaClient } from "@mcp/db";
import type { Crypter } from "../lib/crypto.js";
import { FeedError, type FeedFetcher } from "./safe-fetch.js";
import { IcsParseError, parseIcs, type ParsedOccurrence } from "./ics-parser.js";

export const SYNC_INTERVAL_MINUTES = 30; // never poll a feed more often than this
const FAILURE_BACKOFF_MINUTES = 60;
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 365;

export interface SyncDeps {
  fetchFeed: FeedFetcher;
  crypter: Crypter | null;
  now?: () => Date;
}

export interface SyncStats {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  notModified?: boolean;
  warning?: string;
}

const key = (uid: string, rid: string) => `${uid}\u0000${rid}`;
const minutesFrom = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export async function syncIcsSource(prisma: PrismaClient, sourceId: string, deps: SyncDeps): Promise<SyncStats> {
  const now = deps.now?.() ?? new Date();
  const source = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId }, include: { workspace: true } });
  if (source.type !== "ics_feed" || !source.feedUrl) throw new FeedError("This source isn't a calendar feed");

  let auth = null;
  if (source.feedUsernameEnc && source.feedPasswordEnc) {
    if (!deps.crypter) throw new FeedError("Server is missing CREDENTIALS_ENCRYPTION_KEY");
    auth = { username: deps.crypter.decrypt(source.feedUsernameEnc), password: deps.crypter.decrypt(source.feedPasswordEnc) };
  }

  const res = await deps.fetchFeed(source.feedUrl, { etag: source.httpEtag, lastModified: source.httpLastModified, auth });
  if (res.status === "not_modified") {
    const stats: SyncStats = { created: 0, updated: 0, deleted: 0, unchanged: 0, notModified: true };
    await markSynced(prisma, sourceId, now, stats, {});
    return stats;
  }

  const windowStart = minutesFrom(now, -WINDOW_PAST_DAYS * 1440);
  const windowEnd = minutesFrom(now, WINDOW_FUTURE_DAYS * 1440);
  const parsed = new Map<string, ParsedOccurrence>();
  for (const o of parseIcs(res.body, { timeZone: source.workspace.timeZone, windowStart, windowEnd })) {
    parsed.set(key(o.externalUid, o.externalRecurrenceId), o); // duplicate UIDs in a feed: last wins
  }

  const existing = await prisma.event.findMany({
    where: { calendarSourceId: sourceId, endTime: { gt: windowStart }, startTime: { lt: windowEnd } },
    select: { id: true, externalUid: true, externalRecurrenceId: true, title: true, startTime: true, endTime: true, allDay: true, location: true },
  });
  const existingByKey = new Map(existing.map((e) => [key(e.externalUid, e.externalRecurrenceId), e]));

  const stats: SyncStats = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  const toCreate: Prisma.EventCreateManyInput[] = [];
  const toUpdate: { id: string; data: Prisma.EventUpdateInput }[] = [];

  for (const [k, o] of parsed) {
    const cur = existingByKey.get(k);
    if (!cur) {
      toCreate.push({
        calendarSourceId: sourceId,
        externalUid: o.externalUid,
        externalRecurrenceId: o.externalRecurrenceId,
        title: o.title,
        startTime: o.startTime,
        endTime: o.endTime,
        allDay: o.allDay,
        location: o.location,
        rawSourceData: o.raw as Prisma.InputJsonValue,
        participantId: source.defaultParticipantId,
        eventTagId: source.defaultEventTagId,
      });
      continue;
    }
    const changed =
      cur.title !== o.title ||
      cur.startTime.getTime() !== o.startTime.getTime() ||
      cur.endTime.getTime() !== o.endTime.getTime() ||
      cur.allDay !== o.allDay ||
      cur.location !== o.location;
    if (!changed) {
      stats.unchanged++;
      continue;
    }
    toUpdate.push({
      id: cur.id,
      data: {
        title: o.title,
        startTime: o.startTime,
        endTime: o.endTime,
        allDay: o.allDay,
        location: o.location,
        rawSourceData: o.raw as Prisma.InputJsonValue,
        ...(cur.location !== o.location ? { place: { disconnect: true } } : {}),
      },
    });
  }

  let toDelete = existing.filter((e) => !parsed.has(key(e.externalUid, e.externalRecurrenceId))).map((e) => e.id);
  if (parsed.size === 0 && toDelete.length > 0) {
    stats.warning = "The feed came back empty, so existing events were kept. If the calendar really was cleared, remove this source.";
    toDelete = [];
  }

  await prisma.$transaction(async (tx) => {
    if (toCreate.length) stats.created = (await tx.event.createMany({ data: toCreate, skipDuplicates: true })).count;
    for (const u of toUpdate) await tx.event.update({ where: { id: u.id }, data: u.data });
    stats.updated = toUpdate.length;
    if (toDelete.length) stats.deleted = (await tx.event.deleteMany({ where: { id: { in: toDelete } } })).count;
  }, { timeout: 60_000 });

  await markSynced(prisma, sourceId, now, stats, { httpEtag: res.etag, httpLastModified: res.lastModified });
  return stats;
}

async function markSynced(
  prisma: PrismaClient,
  sourceId: string,
  now: Date,
  stats: SyncStats,
  http: { httpEtag?: string | null; httpLastModified?: string | null },
) {
  await prisma.calendarSource.update({
    where: { id: sourceId },
    data: {
      lastSyncedAt: now,
      nextSyncAt: minutesFrom(now, SYNC_INTERVAL_MINUTES + Math.floor(Math.random() * 5)), // jitter spreads load
      lastSyncError: stats.warning ?? null,
      lastSyncStats: stats as unknown as Prisma.InputJsonValue,
      ...http,
    },
  });
}

/** User-facing message for a failed sync; unexpected errors don't leak internals. */
export function describeSyncError(err: unknown): string {
  if (err instanceof FeedError || err instanceof IcsParseError) return err.message;
  return "Something went wrong reading this calendar";
}

/**
 * Runs every feed that's due. Each source is *claimed* first (nextSyncAt pushed out with a
 * conditional update), so two workers never sync the same feed at once.
 */
export async function runDueIcsSyncs(
  prisma: PrismaClient,
  deps: SyncDeps & { log?: (msg: string, extra?: object) => void; limit?: number },
): Promise<{ attempted: number; failed: number }> {
  const now = deps.now?.() ?? new Date();
  const due = await prisma.calendarSource.findMany({
    where: { type: "ics_feed", feedUrl: { not: null }, OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }] },
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
      const stats = await syncIcsSource(prisma, s.id, deps);
      deps.log?.("ics sync ok", { sourceId: s.id, ...stats });
    } catch (err) {
      failed++;
      deps.log?.("ics sync failed", { sourceId: s.id, error: String(err) });
      await prisma.calendarSource.update({
        where: { id: s.id },
        data: { lastSyncError: describeSyncError(err), nextSyncAt: minutesFrom(now, FAILURE_BACKOFF_MINUTES) },
      });
    }
  }
  return { attempted, failed };
}
