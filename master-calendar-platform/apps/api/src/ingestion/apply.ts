// Source-agnostic half of syncing: diff a source's occurrences (from ICS or Google) against
// its Event rows and apply the changes. Rules (same for every source type):
//  - Upsert key is (calendarSourceId, externalUid, externalRecurrenceId), so re-syncs
//    never duplicate.
//  - The source owns title/time/location. People own participant, tag, driver and place:
//    a sync sets participant/tag only when *creating* an event (from the source's
//    defaults) and never overwrites them afterwards. If the location text changes, the
//    geocoded place is cleared so it gets re-resolved.
//  - Events that vanish upstream inside the sync window are deleted. Past events outside
//    the window are left alone.
//  - An empty result never wipes a calendar that had events: that's far more often a
//    broken feed than a real "everything was cancelled".
import type { Prisma, PrismaClient } from "@mcp/db";

export interface Occurrence {
  externalUid: string;
  /** "" for one-off events; the occurrence's original start for instances of a series. */
  externalRecurrenceId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  location: string | null;
  raw: Record<string, unknown>;
}

export interface SyncStats {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  notModified?: boolean;
  warning?: string;
}

export const SYNC_INTERVAL_MINUTES = 30; // never poll a source more often than this
export const FAILURE_BACKOFF_MINUTES = 60;
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 365;

export const minutesFrom = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export function syncWindow(now: Date) {
  return { windowStart: minutesFrom(now, -WINDOW_PAST_DAYS * 1440), windowEnd: minutesFrom(now, WINDOW_FUTURE_DAYS * 1440) };
}

const key = (uid: string, rid: string) => `${uid}\u0000${rid}`;

export async function applyOccurrences(
  prisma: PrismaClient,
  source: { id: string; defaultParticipantId: string | null; defaultEventTagId: string | null },
  occurrences: Occurrence[],
  window: { windowStart: Date; windowEnd: Date },
): Promise<SyncStats> {
  const incoming = new Map<string, Occurrence>();
  for (const o of occurrences) incoming.set(key(o.externalUid, o.externalRecurrenceId), o); // duplicates: last wins

  const existing = await prisma.event.findMany({
    where: { calendarSourceId: source.id, endTime: { gt: window.windowStart }, startTime: { lt: window.windowEnd } },
    select: { id: true, externalUid: true, externalRecurrenceId: true, title: true, startTime: true, endTime: true, allDay: true, location: true },
  });
  const existingByKey = new Map(existing.map((e) => [key(e.externalUid, e.externalRecurrenceId), e]));

  const stats: SyncStats = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  const toCreate: Prisma.EventCreateManyInput[] = [];
  const toUpdate: { id: string; data: Prisma.EventUpdateInput }[] = [];

  for (const [k, o] of incoming) {
    const cur = existingByKey.get(k);
    if (!cur) {
      toCreate.push({
        calendarSourceId: source.id,
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

  let toDelete = existing.filter((e) => !incoming.has(key(e.externalUid, e.externalRecurrenceId))).map((e) => e.id);
  if (incoming.size === 0 && toDelete.length > 0) {
    stats.warning = "The calendar came back empty, so existing events were kept. If it really was cleared, remove this calendar.";
    toDelete = [];
  }

  await prisma.$transaction(
    async (tx) => {
      if (toCreate.length) stats.created = (await tx.event.createMany({ data: toCreate, skipDuplicates: true })).count;
      for (const u of toUpdate) await tx.event.update({ where: { id: u.id }, data: u.data });
      stats.updated = toUpdate.length;
      if (toDelete.length) stats.deleted = (await tx.event.deleteMany({ where: { id: { in: toDelete } } })).count;
    },
    { timeout: 60_000 },
  );
  return stats;
}

export async function markSynced(
  prisma: PrismaClient,
  sourceId: string,
  now: Date,
  stats: SyncStats,
  extra: Prisma.CalendarSourceUpdateInput = {},
) {
  await prisma.calendarSource.update({
    where: { id: sourceId },
    data: {
      lastSyncedAt: now,
      nextSyncAt: minutesFrom(now, SYNC_INTERVAL_MINUTES + Math.floor(Math.random() * 5)), // jitter spreads load
      lastSyncError: stats.warning ?? null,
      lastSyncStats: stats as unknown as Prisma.InputJsonValue,
      ...extra,
    },
  });
}
