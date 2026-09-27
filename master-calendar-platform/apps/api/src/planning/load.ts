// DB → schedule-organizer input for one workspace and time range.
import type { PrismaClient, Place } from "@mcp/db";
import type { BusyBlock, OrganizerParticipant, OrganizerTask, PlannerPlace } from "@mcp/planner";

export function toPlannerPlace(p: Place): PlannerPlace {
  return {
    id: p.id,
    name: p.name,
    lat: p.latitude,
    lng: p.longitude,
    arrivalBufferMinutes: p.arrivalBufferMinutes,
    openHours: (p.openingHours as PlannerPlace["openHours"]) ?? undefined,
  };
}

export interface PlanningData {
  participants: OrganizerParticipant[];
  /** People skipped because they have no home place (the organizer needs a start point). */
  skippedParticipants: string[];
  busy: BusyBlock[];
  tasks: OrganizerTask[];
  titles: Map<string, string>;
}

export async function loadPlanningData(prisma: PrismaClient, workspaceId: string, range: { start: Date; end: Date }): Promise<PlanningData> {
  const [places, people, events, accepted, open] = await Promise.all([
    prisma.place.findMany({ where: { workspaceId } }),
    prisma.participant.findMany({
      where: { workspaceId, linkedWorkspaceId: null },
      include: { availability: true, membership: { select: { role: true } } },
    }),
    prisma.event.findMany({
      where: { calendarSource: { workspaceId }, startTime: { lt: range.end }, endTime: { gt: range.start } },
      select: { participantId: true, driverParticipantId: true, startTime: true, endTime: true, placeId: true, title: true, allDay: true },
    }),
    prisma.task.findMany({
      where: { workspaceId, completedAt: null, scheduleStatus: "accepted", scheduledStart: { lt: range.end }, scheduledEnd: { gt: range.start } },
      select: { assignedParticipantId: true, scheduledParticipantId: true, scheduledStart: true, scheduledEnd: true, placeId: true, locationKind: true, title: true },
    }),
    prisma.task.findMany({
      where: { workspaceId, completedAt: null, OR: [{ scheduleStatus: null }, { scheduleStatus: "suggested" }] },
      select: { id: true, title: true, assignedParticipantId: true, estimatedMinutes: true, priority: true, dueAt: true, locationKind: true, placeId: true },
    }),
  ]);
  const placeById = new Map(places.map((p) => [p.id, toPlannerPlace(p)]));

  const participants: OrganizerParticipant[] = [];
  const skipped: string[] = [];
  for (const p of people) {
    const home = p.homePlaceId ? placeById.get(p.homePlaceId) : undefined;
    if (!home) {
      skipped.push(p.name);
      continue;
    }
    participants.push({
      id: p.id,
      name: p.name,
      home,
      canDrive: p.canDrive,
      // Adults (drivers, or people with a member/owner login) can be handed unassigned to-dos.
      takesUnassignedTasks: p.canDrive || (p.membership !== null && p.membership.role !== "viewer"),
      availability: p.availability,
      maxTaskMinutesPerDay: p.maxPlannedTaskMinutesPerDay,
    });
  }
  const homeOf = new Map(participants.map((p) => [p.id, p.home]));

  const busy: BusyBlock[] = [];
  for (const e of events) {
    if (e.allDay) continue; // "No school" doesn't make anyone busy all day
    const who = new Set([e.participantId, e.driverParticipantId].filter((x): x is string => !!x && homeOf.has(x)));
    for (const participantId of who) {
      busy.push({ participantId, start: e.startTime, end: e.endTime, place: e.placeId ? (placeById.get(e.placeId) ?? null) : null, title: e.title });
    }
  }
  for (const t of accepted) {
    const who = t.scheduledParticipantId ?? t.assignedParticipantId;
    if (!who || !homeOf.has(who)) continue;
    const place = t.locationKind === "errand" && t.placeId ? (placeById.get(t.placeId) ?? null) : t.locationKind === "home" ? homeOf.get(who)! : null;
    busy.push({ participantId: who, start: t.scheduledStart!, end: t.scheduledEnd!, place, title: t.title });
  }

  const tasks: OrganizerTask[] = open.map((t) => ({
    id: t.id,
    title: t.title,
    participantId: t.assignedParticipantId,
    estimatedMinutes: t.estimatedMinutes,
    priority: t.priority,
    dueAt: t.dueAt,
    location:
      t.locationKind === "errand" && t.placeId && placeById.has(t.placeId)
        ? { kind: "errand", place: placeById.get(t.placeId)! }
        : t.locationKind === "anywhere"
          ? { kind: "anywhere" }
          : { kind: "home" },
  }));
  return { participants, skippedParticipants: skipped, busy, tasks, titles: new Map(open.map((t) => [t.id, t.title])) };
}
