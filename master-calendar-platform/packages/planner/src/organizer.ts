// Schedule organizer: fits to-dos (honey-do, errands, calls) into the gaps between each
// person's events where it makes the most logistical sense.
//
// It is pure and deterministic: same input → same plan. Output is a set of *suggested*
// placements that a person accepts or moves; accepted ones come back in as `busy`.
//
// How a slot is judged, for a task at location X in the gap between block A (ending at
// place LA) and block B (starting at place LB):
//   travelBefore = LA → X,   travelAfter = X → LB
//   detour       = travelBefore + travelAfter − (LA → LB)   (extra driving the task costs)
// so an errand next to where you already are costs ~0, and a home task in a 40-minute
// gap between two far-away events doesn't fit at all. Placed tasks become blocks
// themselves, so errands near each other naturally chain into one trip.
import {
  addMinutes,
  ceilToMinutes,
  localDaysInRange,
  minutesBetween,
  zonedToUtc,
  type LocalDay,
} from "./time.js";
import type { PlannerPlace, TravelMinutes } from "./geo.js";

export type Priority = "low" | "normal" | "high";

export interface OrganizerParticipant {
  id: string;
  name: string;
  home: PlannerPlace;
  /** Errands need a driver. Home tasks and calls don't. */
  canDrive: boolean;
  /** Whether unassigned tasks may be suggested for this person (e.g. adults only). */
  takesUnassignedTasks: boolean;
  /** Local-time windows when this person is free for tasks. */
  availability: { dayOfWeek: number; startMinute: number; endMinute: number }[];
  maxTaskMinutesPerDay: number;
}

export interface BusyBlock {
  participantId: string;
  start: Date;
  end: Date;
  /** Where the person is during the block; null = not geocoded (assumed `unknownTravelMinutes` away). */
  place: PlannerPlace | null;
  title: string;
}

export type TaskLocation =
  | { kind: "home" }
  | { kind: "anywhere" }
  | { kind: "errand"; place: PlannerPlace };

export interface OrganizerTask {
  id: string;
  title: string;
  /** Assigned person; null = anyone with `takesUnassignedTasks`. */
  participantId: string | null;
  estimatedMinutes: number | null;
  priority: Priority;
  dueAt: Date | null;
  location: TaskLocation;
}

export interface OrganizerOptions {
  /** Transition time around every move (loading the car, finding keys). Default 10. */
  bufferMinutes?: number;
  /** Assumed travel to or from a block with no geocoded place. Default 20. */
  unknownTravelMinutes?: number;
  /** Start times snap to this many minutes. Default 5. */
  snapMinutes?: number;
}

export interface OrganizerInput {
  timeZone: string;
  start: Date;
  end: Date;
  now: Date;
  participants: OrganizerParticipant[];
  busy: BusyBlock[];
  tasks: OrganizerTask[];
  travelMinutes: TravelMinutes;
  options?: OrganizerOptions;
}

export interface Placement {
  taskId: string;
  participantId: string;
  start: Date;
  end: Date;
  travelBeforeMinutes: number;
  detourMinutes: number;
  reason: string;
}

export type UnplacedReason =
  | "needs_estimate" // no estimatedMinutes
  | "no_one_eligible" // e.g. an errand assigned to someone who can't drive
  | "no_fitting_gap"; // nothing fits before it's due / within the range and daily limits

export interface Unplaced {
  taskId: string;
  reason: UnplacedReason;
}

export interface OrganizerResult {
  placements: Placement[];
  unplaced: Unplaced[];
}

interface Candidate {
  participant: OrganizerParticipant;
  dayIndex: number;
  start: Date;
  end: Date;
  place: PlannerPlace | null;
  travelBefore: number;
  detour: number;
  leftover: number;
  score: number;
  reason: string;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
// How strongly each priority pulls toward the earliest day (score points per day later).
const DAY_WEIGHT: Record<Priority, number> = { high: 60, normal: 15, low: 4 };

/**
 * Greedy placement is order-sensitive: a normal-priority errand can grab the slot right
 * after practice that a low-priority errand next door needed. So it plans with a few
 * task orderings and keeps the plan with the best total (fewest unplaced tasks weighted
 * by priority, then least driving and lateness). Still deterministic.
 */
export function organizeSchedule(input: OrganizerInput): OrganizerResult {
  const anchors = input.busy.flatMap((b) => (b.place ? [b.place] : []));
  const byDefault = (a: OrganizerTask, b: OrganizerTask) =>
    effectiveRank(a, input.now) - effectiveRank(b, input.now) ||
    (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
    (b.estimatedMinutes ?? 0) - (a.estimatedMinutes ?? 0) ||
    a.id.localeCompare(b.id);
  // Errands that can piggyback on a trip already on the calendar go first.
  const piggyback = (t: OrganizerTask) =>
    t.location.kind === "errand"
      ? Math.min(Infinity, ...anchors.map((a) => input.travelMinutes(a, (t.location as { place: PlannerPlace }).place)))
      : Infinity;
  const orderings: ((a: OrganizerTask, b: OrganizerTask) => number)[] = [
    byDefault,
    (a, b) => piggyback(a) - piggyback(b) || byDefault(a, b),
    (a, b) => (a.estimatedMinutes ?? 0) - (b.estimatedMinutes ?? 0) || byDefault(a, b),
  ];

  let best: { result: OrganizerResult; cost: number } | null = null;
  for (const order of orderings) {
    const attempt = planOnce(input, [...input.tasks].sort(order));
    const byId = new Map(input.tasks.map((t) => [t.id, t]));
    const cost =
      attempt.cost +
      attempt.result.unplaced.reduce(
        (sum, u) => sum + (u.reason === "no_fitting_gap" ? UNPLACED_COST[byId.get(u.taskId)!.priority] : 0),
        0,
      );
    if (!best || cost < best.cost - 1e-9) best = { result: attempt.result, cost };
  }
  return best!.result;
}

const UNPLACED_COST: Record<Priority, number> = { high: 5000, normal: 2000, low: 800 };

function planOnce(input: OrganizerInput, ordered: OrganizerTask[]): { result: OrganizerResult; cost: number } {
  let totalScore = 0;
  const buffer = input.options?.bufferMinutes ?? 10;
  const unknownTravel = input.options?.unknownTravelMinutes ?? 20;
  const snap = input.options?.snapMinutes ?? 5;

  const travel = (a: PlannerPlace | null, b: PlannerPlace | null): number => {
    if (a && b) return a.id === b.id ? 0 : input.travelMinutes(a, b);
    return a === b ? 0 : unknownTravel;
  };
  const arrival = (p: PlannerPlace | null) => p?.arrivalBufferMinutes ?? 0;

  const days = localDaysInRange(input.start, input.end, input.timeZone);
  const busyByPerson = new Map<string, BusyBlock[]>();
  for (const p of input.participants) busyByPerson.set(p.id, []);
  for (const b of input.busy) busyByPerson.get(b.participantId)?.push(b);
  const plannedMinutes = new Map<string, number>(); // `${participantId}:${dayIndex}` → minutes

  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];

  for (const task of ordered) {
    const duration = task.estimatedMinutes;
    if (!duration || duration <= 0) {
      unplaced.push({ taskId: task.id, reason: "needs_estimate" });
      continue;
    }
    const people = input.participants.filter(
      (p) =>
        (task.participantId ? p.id === task.participantId : p.takesUnassignedTasks) &&
        (task.location.kind !== "errand" || p.canDrive),
    );
    if (people.length === 0) {
      unplaced.push({ taskId: task.id, reason: "no_one_eligible" });
      continue;
    }
    const overdue = task.dueAt !== null && task.dueAt <= input.now;
    const deadline = task.dueAt && !overdue ? task.dueAt : null;

    let best: Candidate | null = null;
    for (const person of people) {
      days.forEach((day, dayIndex) => {
        const used = plannedMinutes.get(`${person.id}:${dayIndex}`) ?? 0;
        if (used + duration > person.maxTaskMinutesPerDay) return;
        for (const c of candidatesForDay(person, day, dayIndex, used)) {
          if (!best || c.score < best.score) best = c;
        }
      });
    }

    if (!best) {
      unplaced.push({ taskId: task.id, reason: "no_fitting_gap" });
      continue;
    }
    const chosen: Candidate = best;
    totalScore += chosen.score;
    placements.push({
      taskId: task.id,
      participantId: chosen.participant.id,
      start: chosen.start,
      end: chosen.end,
      travelBeforeMinutes: chosen.travelBefore,
      detourMinutes: chosen.detour,
      reason: overdue ? `Overdue — ${lowerFirst(chosen.reason)}` : chosen.reason,
    });
    busyByPerson.get(chosen.participant.id)!.push({
      participantId: chosen.participant.id,
      start: chosen.start,
      end: chosen.end,
      place: chosen.place,
      title: task.title,
    });
    const key = `${chosen.participant.id}:${chosen.dayIndex}`;
    plannedMinutes.set(key, (plannedMinutes.get(key) ?? 0) + duration);

    function candidatesForDay(person: OrganizerParticipant, day: LocalDay, dayIndex: number, used: number): Candidate[] {
      const out: Candidate[] = [];
      const windows = person.availability
        .filter((w) => w.dayOfWeek === day.dayOfWeek)
        .map((w) => ({
          start: zonedToUtc(day.year, day.month, day.day, w.startMinute, input.timeZone),
          end: zonedToUtc(day.year, day.month, day.day, w.endMinute, input.timeZone),
        }));
      if (windows.length === 0) return out;
      const hours = task.location.kind === "errand" ? task.location.place.openHours : undefined;
      if (hours) {
        const open = hours
          .filter((h) => h.dayOfWeek === day.dayOfWeek)
          .map((h) => ({
            start: zonedToUtc(day.year, day.month, day.day, h.startMinute, input.timeZone),
            end: zonedToUtc(day.year, day.month, day.day, h.endMinute, input.timeZone),
          }));
        const clipped = windows.flatMap((w) =>
          open
            .map((o) => ({ start: new Date(Math.max(w.start.getTime(), o.start.getTime())), end: new Date(Math.min(w.end.getTime(), o.end.getTime())) }))
            .filter((x) => x.end > x.start),
        );
        windows.splice(0, windows.length, ...clipped);
        if (windows.length === 0) return out;
      }

      // The person's day as alternating blocks: home at both ends, their busy blocks between.
      const blocks = busyByPerson
        .get(person.id)!
        .filter((b) => b.end > day.start && b.start < day.end)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      const timeline: { end: Date; place: PlannerPlace | null; title: string | null }[] = [
        { end: day.start, place: person.home, title: null },
      ];
      const gaps: { from: Date; to: Date; fromPlace: PlannerPlace | null; toPlace: PlannerPlace | null; before: string | null; after: string | null }[] = [];
      for (const b of blocks) {
        const prev = timeline[timeline.length - 1]!;
        if (b.start > prev.end) {
          gaps.push({ from: prev.end, to: b.start, fromPlace: prev.place, toPlace: b.place, before: prev.title, after: b.title });
        }
        if (b.end > prev.end) timeline.push({ end: b.end, place: b.place, title: b.title });
      }
      const last = timeline[timeline.length - 1]!;
      if (day.end > last.end) {
        gaps.push({ from: last.end, to: day.end, fromPlace: last.place, toPlace: person.home, before: last.title, after: null });
      }

      const x: PlannerPlace | null =
        task.location.kind === "home" ? person.home : task.location.kind === "errand" ? task.location.place : null;

      for (const gap of gaps) {
        const place = x ?? gap.fromPlace; // "anywhere" tasks happen wherever you are
        const direct = travel(gap.fromPlace, gap.toPlace);
        const travelBefore = x ? travel(gap.fromPlace, x) : 0;
        const travelAfter = x ? travel(x, gap.toPlace) : direct;
        const detour = x ? Math.max(0, travelBefore + travelAfter - direct) : 0;
        // Leaving the previous block needs a buffer; the start of the day doesn't.
        const leadIn = gap.before === null ? travelBefore : travelBefore + buffer + arrival(x);
        const leadOut = gap.after === null ? 0 : travelAfter + buffer + arrival(gap.toPlace);

        for (const w of windows) {
          const earliest = ceilToMinutes(
            new Date(Math.max(addMinutes(gap.from, leadIn).getTime(), w.start.getTime(), input.now.getTime())),
            snap,
          );
          let latestEnd = new Date(Math.min(addMinutes(gap.to, -leadOut).getTime(), w.end.getTime()));
          if (deadline && deadline < latestEnd) latestEnd = deadline;
          const end = addMinutes(earliest, duration!);
          if (end > latestEnd) continue;

          const leftover = minutesBetween(end, latestEnd);
          const score =
            detour * 1.5 +
            dayIndex * DAY_WEIGHT[task.priority] +
            used * 0.2 + // spread work across days
            Math.min(leftover, 240) * 0.02; // mild best-fit: prefer snug gaps, keep big ones open
          out.push({
            participant: person,
            dayIndex,
            start: earliest,
            end,
            place,
            travelBefore,
            detour,
            leftover,
            score,
            reason: describe(task.location, gap, detour, travelBefore, person),
          });
        }
      }
      return out;
    }
  }

  placements.sort((a, b) => a.start.getTime() - b.start.getTime() || a.taskId.localeCompare(b.taskId));
  unplaced.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return { result: { placements, unplaced }, cost: totalScore };
}

function effectiveRank(task: OrganizerTask, now: Date): number {
  return task.dueAt && task.dueAt <= now ? -1 : PRIORITY_RANK[task.priority];
}

function describe(
  location: TaskLocation,
  gap: { fromPlace: PlannerPlace | null; toPlace: PlannerPlace | null; before: string | null; after: string | null },
  detour: number,
  travelBefore: number,
  person: OrganizerParticipant,
): string {
  const between =
    gap.before && gap.after
      ? `between ${gap.before} and ${gap.after}`
      : gap.before
        ? `after ${gap.before}`
        : gap.after
          ? `before ${gap.after}`
          : "free day";
  if (location.kind === "errand") {
    const from = gap.fromPlace?.id === person.home.id ? "home" : (gap.fromPlace?.name ?? "your last stop");
    if (detour <= 5) return `${location.place.name} is on the way (${between}): +${detour} min`;
    if (between === "free day") return `Round trip from home: ${detour} min of driving`;
    return `${travelBefore} min from ${from}, ${between}: +${detour} min of driving`;
  }
  if (location.kind === "home") return between === "free day" ? "Open time at home" : `At home ${between}`;
  return between === "free day" ? "Open time" : `Free time ${between}`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Plans one local day (the daily organizer). `date` is any instant within that day. */
export function organizeDay(input: Omit<OrganizerInput, "start" | "end"> & { date: Date }): OrganizerResult {
  const [day] = localDaysInRange(input.date, addMinutes(input.date, 1), input.timeZone);
  return organizeSchedule({ ...input, start: day!.start, end: day!.end });
}

/** Plans seven local days starting with the day containing `weekStart`. */
export function organizeWeek(input: Omit<OrganizerInput, "start" | "end"> & { weekStart: Date }): OrganizerResult {
  const [first] = localDaysInRange(input.weekStart, addMinutes(input.weekStart, 1), input.timeZone);
  const end = zonedToUtc(first!.year, first!.month, first!.day + 7, 0, input.timeZone);
  return organizeSchedule({ ...input, start: first!.start, end });
}
