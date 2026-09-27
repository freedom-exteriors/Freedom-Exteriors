// Runs the schedule organizer + leave-by logic against the seeded Rivera family and
// prints the week. This is the prototype of the API's planning service (step 8): the
// DB → planner mapping below moves there more or less as-is.
//
//   npm run demo:organizer                # simulated traffic
//   GOOGLE_MAPS_API_KEY=… npm run demo:organizer   # live Google Routes traffic
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "@mcp/db";
import {
  GoogleRoutesTrafficProvider,
  addMinutes,
  estimateDrivingMinutes,
  estimateLeaveBy,
  estimatedTravel,
  formatClock,
  formatLeaveWarning,
  inferOrigin,
  localParts,
  organizeWeek,
  type BusyBlock,
  type OrganizerParticipant,
  type OrganizerTask,
  type PlannerPlace,
  type TrafficProvider,
} from "@mcp/planner";

loadEnv({ path: path.resolve(import.meta.dirname, "../.env") });
const prisma = createPrismaClient();

/** Without an API key: traffic-free estimate, ×1.5 in weekday rush hours. Clearly fake. */
function simulatedTraffic(timeZone: string): TrafficProvider {
  return {
    async drivingMinutes(o, d, departAt) {
      const typical = estimateDrivingMinutes(o, d);
      const m = localParts(departAt, timeZone).minuteOfDay;
      const rush = (m >= 7 * 60 && m <= 9 * 60) || (m >= 16 * 60 && m <= 18 * 60 + 30);
      return { typicalMinutes: typical, trafficMinutes: rush ? Math.ceil(typical * 1.5) : typical };
    },
  };
}

async function main() {
  const ws = await prisma.workspace.findFirstOrThrow({
    where: { name: "Rivera Family", kind: "home" },
    include: { places: true, participants: { include: { availability: true } } },
  });
  const tz = ws.timeZone;
  const toPlace = (p: (typeof ws.places)[number]): PlannerPlace => ({
    id: p.id,
    name: p.name,
    lat: p.latitude,
    lng: p.longitude,
    arrivalBufferMinutes: p.arrivalBufferMinutes,
    openHours: (p.openingHours as PlannerPlace["openHours"]) ?? undefined,
  });
  const places = new Map(ws.places.map((p) => [p.id, toPlace(p)]));
  const now = new Date();
  const weekStart = now;
  const weekEnd = addMinutes(now, 8 * 24 * 60);

  const participants: OrganizerParticipant[] = ws.participants
    .filter((p) => p.homePlaceId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      home: places.get(p.homePlaceId!)!,
      canDrive: p.canDrive,
      takesUnassignedTasks: p.canDrive, // adults; the API will use membership role
      availability: p.availability,
      maxTaskMinutesPerDay: p.maxPlannedTaskMinutesPerDay,
    }));
  const nameOf = new Map(ws.participants.map((p) => [p.id, p.name]));

  const events = await prisma.event.findMany({
    where: { calendarSource: { workspaceId: ws.id }, startTime: { gte: weekStart, lt: weekEnd } },
    orderBy: { startTime: "asc" },
  });
  // Both the participant and their driver are tied up for the event, at its place.
  const busy: BusyBlock[] = events.flatMap((e) =>
    [...new Set([e.participantId, e.driverParticipantId].filter((x): x is string => !!x))].map((participantId) => ({
      participantId,
      start: e.startTime,
      end: e.endTime,
      place: e.placeId ? places.get(e.placeId)! : null,
      title: e.title,
    })),
  );

  const taskRows = await prisma.task.findMany({
    where: { workspaceId: ws.id, completedAt: null, taskList: { key: { in: ["honey_do", "chores"] } } },
  });
  const tasks: OrganizerTask[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    participantId: t.assignedParticipantId,
    estimatedMinutes: t.estimatedMinutes,
    priority: t.priority,
    dueAt: t.dueAt,
    location:
      t.locationKind === "errand" && t.placeId
        ? { kind: "errand", place: places.get(t.placeId)! }
        : t.locationKind === "anywhere"
          ? { kind: "anywhere" }
          : { kind: "home" },
  }));

  const plan = organizeWeek({ timeZone: tz, weekStart, now, participants, busy, tasks, travelMinutes: estimatedTravel });
  const title = new Map(taskRows.map((t) => [t.id, t.title]));
  const dayLabel = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);

  console.log(`\n== Week plan for ${ws.name} (${tz}) — suggestions, not yet accepted ==\n`);
  const rows = [
    ...events.map((e) => ({ at: e.startTime, line: `  ${formatClock(e.startTime, tz).padStart(8)}  📅 ${e.title}${e.participantId ? ` (${nameOf.get(e.participantId)})` : " (unassigned)"}` })),
    ...plan.placements.map((p) => ({
      at: p.start,
      line: `  ${formatClock(p.start, tz).padStart(8)}  🔧 ${title.get(p.taskId)} → ${nameOf.get(p.participantId)}, ${formatClock(p.start, tz)}–${formatClock(p.end, tz)}\n              ${p.reason}`,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  let lastDay = "";
  for (const r of rows) {
    const d = dayLabel(r.at);
    if (d !== lastDay) console.log(`${d}`), (lastDay = d);
    console.log(r.line);
  }
  if (plan.unplaced.length) {
    console.log("\nCouldn't place:");
    for (const u of plan.unplaced) console.log(`  • ${title.get(u.taskId)} — ${u.reason.replaceAll("_", " ")}`);
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  const provider = key ? new GoogleRoutesTrafficProvider(key) : simulatedTraffic(tz);
  console.log(`\n== Leave-by warnings (${key ? "live Google traffic" : "SIMULATED traffic — set GOOGLE_MAPS_API_KEY for real"}) ==\n`);
  for (const e of events) {
    if (!e.placeId || !e.driverParticipantId) continue;
    const driver = participants.find((p) => p.id === e.driverParticipantId);
    if (!driver) continue;
    const origin = inferOrigin({
      eventStart: e.startTime,
      home: driver.home,
      priorBlocks: [...busy, ...plan.placements.map((p) => ({ ...p, place: null }))]
        .filter((b) => b.participantId === driver.id && b.end <= e.startTime),
    });
    const est = await estimateLeaveBy({ provider, origin: origin.place, destination: places.get(e.placeId)!, eventStart: e.startTime, now });
    const msg = formatLeaveWarning({ eventTitle: e.title, leaveBy: est.leaveBy, estimate: est, originLabel: origin.label, timeZone: tz });
    console.log(`  ${dayLabel(e.startTime)} → ${driver.name}: "${msg.title}"\n      ${msg.body}  (warning at ${formatClock(addMinutes(est.leaveBy, -10), tz)})`);
  }
  const unassignedDrives = events.filter((e) => e.placeId && !e.driverParticipantId);
  for (const e of unassignedDrives) console.log(`  ${dayLabel(e.startTime)} ⚠ No driver for "${e.title}" — no leave-by warning until someone claims it.`);
  console.log();
}

main().finally(() => prisma.$disconnect());
