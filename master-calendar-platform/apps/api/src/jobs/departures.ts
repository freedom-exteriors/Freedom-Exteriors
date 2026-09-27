// Leave-by alerts. For each upcoming event (next 3 h) with a place and a driver:
//   1. work out where the driver leaves from (previous stop, else home),
//   2. ask for the drive time at the real departure time (live traffic if configured),
//   3. re-check at ~2 h / 45 min / 15 min before leave-by, and immediately if the event moved,
//   4. warn 10 min before leave-by, once — and right away if traffic pulls it 10+ min earlier.
// One DepartureAlert per (event, driver); notifications are deduped.
import type { PrismaClient } from "@mcp/db";
import {
  addMinutes,
  earlierDepartureNotice,
  estimateDrivingMinutes,
  estimateLeaveBy,
  formatClock,
  formatLeaveWarning,
  inferOrigin,
  nextTrafficCheck,
  shouldWarn,
  type TrafficProvider,
} from "@mcp/planner";
import { toPlannerPlace } from "../planning/load.js";
import { notify, recipientsFor } from "./notify.js";

export const LOOKAHEAD_MINUTES = 180;

/** No Maps key: plain drive-time estimate, reported honestly as "no live traffic". */
export const estimateOnlyTraffic: TrafficProvider = {
  async drivingMinutes(o, d) {
    const m = estimateDrivingMinutes(o, d);
    return { trafficMinutes: m, typicalMinutes: m };
  },
};

export async function runDepartures(prisma: PrismaClient, deps: { traffic: TrafficProvider; live: boolean; now?: Date; workspaceId?: string }) {
  const now = deps.now ?? new Date();
  const stats = { checked: 0, warned: 0, shifted: 0, skipped: 0 };
  const events = await prisma.event.findMany({
    where: {
      startTime: { gt: now, lte: addMinutes(now, LOOKAHEAD_MINUTES) },
      allDay: false,
      placeId: { not: null },
      driverParticipantId: { not: null },
      calendarSource: { workspace: { kind: "home", ...(deps.workspaceId ? { id: deps.workspaceId } : {}) } },
    },
    include: {
      place: true,
      driver: { include: { homePlace: true } },
      calendarSource: { select: { workspace: { select: { id: true, timeZone: true } } } },
      departureAlerts: true,
    },
  });

  for (const e of events) {
    const driver = e.driver!;
    const ws = e.calendarSource.workspace;
    if (!driver.canDrive || !driver.homePlace || !e.place) {
      stats.skipped++;
      continue;
    }
    let alert = e.departureAlerts.find((a) => a.participantId === driver.id) ?? null;
    const eventChanged = alert !== null && (alert.computedForStart.getTime() !== e.startTime.getTime() || alert.computedForPlaceId !== e.placeId);
    if (alert?.status === "notified" && !eventChanged) continue; // already warned for this version of the event

    const due = !alert || eventChanged || (alert.nextCheckAt !== null && alert.nextCheckAt <= now);
    if (due) {
      const prior = await prisma.event.findMany({
        where: {
          calendarSource: { workspaceId: ws.id },
          OR: [{ participantId: driver.id }, { driverParticipantId: driver.id }],
          endTime: { lte: e.startTime, gte: addMinutes(e.startTime, -180) },
          id: { not: e.id },
          placeId: { not: null },
        },
        include: { place: true },
      });
      const origin = inferOrigin({
        eventStart: e.startTime,
        home: toPlannerPlace(driver.homePlace),
        priorBlocks: prior.map((x) => ({ end: x.endTime, place: toPlannerPlace(x.place!) })),
      });
      const est = await estimateLeaveBy({ provider: deps.traffic, origin: origin.place, destination: toPlannerPlace(e.place), eventStart: e.startTime, now });
      stats.checked++;
      const data = {
        originLabel: origin.label,
        originLatitude: origin.place.lat,
        originLongitude: origin.place.lng,
        leaveBy: est.leaveBy,
        trafficMinutes: est.trafficMinutes,
        typicalMinutes: est.typicalMinutes,
        nextCheckAt: nextTrafficCheck(now, est.leaveBy),
        lastCheckedAt: now,
        computedForStart: e.startTime,
        computedForPlaceId: e.placeId,
      };
      const previous = alert;
      alert = previous
        ? await prisma.departureAlert.update({ where: { id: previous.id }, data: { ...data, ...(eventChanged ? { status: "scheduled", notifiedAt: null } : {}) } })
        : await prisma.departureAlert.upsert({
            where: { eventId_participantId: { eventId: e.id, participantId: driver.id } },
            create: { ...data, eventId: e.id, participantId: driver.id },
            update: data,
          });

      // Traffic got worse after the plan was made: say so now, not at the usual time.
      // (Not when the event itself moved — the person who moved it knows.)
      const shift = previous && previous.notifiedAt === null && !eventChanged
        ? earlierDepartureNotice({ eventTitle: e.title, previousLeaveBy: previous.leaveBy, newLeaveBy: est.leaveBy, timeZone: ws.timeZone })
        : null;
      if (shift && est.leaveBy > now) {
        await notify(prisma, {
          workspaceId: ws.id,
          userIds: await recipientsFor(prisma, ws.id, driver.id),
          kind: "leave_earlier",
          ...shift,
          url: `/w/${ws.id}/events/${e.id}`,
          dedupeKey: `leave-earlier:${alert.id}:${est.leaveBy.toISOString()}`,
          now,
        });
        stats.shifted++;
      }
    }

    if (alert && shouldWarn({ now, leaveBy: alert.leaveBy, eventStart: e.startTime, notifiedAt: alert.notifiedAt })) {
      const estimate = { trafficMinutes: alert.trafficMinutes, typicalMinutes: alert.typicalMinutes };
      const msg = deps.live
        ? formatLeaveWarning({ eventTitle: e.title, leaveBy: alert.leaveBy, estimate, originLabel: alert.originLabel, timeZone: ws.timeZone })
        : {
            title: `Leave by ${formatClock(alert.leaveBy, ws.timeZone)} — ${e.title}`,
            body: `About ${alert.trafficMinutes} min drive from ${alert.originLabel} (estimate — no live traffic).`,
          };
      await notify(prisma, {
        workspaceId: ws.id,
        userIds: await recipientsFor(prisma, ws.id, driver.id),
        kind: "leave_by",
        ...msg,
        url: `/w/${ws.id}/events/${e.id}`,
        dedupeKey: `leave:${alert.id}:${e.startTime.toISOString()}`,
        now,
      });
      await prisma.departureAlert.update({ where: { id: alert.id }, data: { notifiedAt: now, status: "notified" } });
      stats.warned++;
    }
  }
  return stats;
}
