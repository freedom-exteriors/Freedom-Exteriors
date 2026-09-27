// Leave-by warnings. The pure parts (where you're leaving from, when to re-check traffic,
// when to notify, what to say) live here; the traffic lookup is behind TrafficProvider.
import type { GeoPoint, PlannerPlace } from "./geo.js";
import { addMinutes, formatClock, minutesBetween } from "./time.js";

export interface TrafficEstimate {
  /** Door-to-door drive time with predicted traffic at the departure time. */
  trafficMinutes: number;
  /** Same route with no traffic, for "8 min longer than usual". */
  typicalMinutes: number;
}

export interface TrafficProvider {
  drivingMinutes(origin: GeoPoint, destination: GeoPoint, departAt: Date): Promise<TrafficEstimate>;
}

export interface Origin {
  place: PlannerPlace;
  label: string;
}

/**
 * Where the driver is leaving from: the place of their previous block if it ends shortly
 * before this event (school pickup → practice), otherwise home. Live GPS isn't used —
 * the web app can't track location in the background, so this infers it from the schedule.
 */
export function inferOrigin(args: {
  eventStart: Date;
  home: PlannerPlace;
  priorBlocks: { end: Date; place: PlannerPlace | null }[];
  chainWindowMinutes?: number; // default 90
}): Origin {
  const window = args.chainWindowMinutes ?? 90;
  const prior = args.priorBlocks
    .filter((b) => b.place && b.end <= args.eventStart && minutesBetween(b.end, args.eventStart) <= window)
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  if (prior?.place && prior.place.id !== args.home.id) return { place: prior.place, label: prior.place.name };
  return { place: args.home, label: "Home" };
}

/**
 * Asks the provider for the drive time *at the time you'd actually leave*: guesses a
 * departure, then re-asks once with the departure implied by the first answer. Traffic at
 * 4:40 PM and 5:05 PM can differ a lot, so one lookup at the wrong time isn't enough.
 */
export async function estimateLeaveBy(args: {
  provider: TrafficProvider;
  origin: GeoPoint;
  destination: PlannerPlace;
  eventStart: Date;
  now: Date;
  /** Getting everyone out the door; added on top of the drive. Default 5. */
  prepMinutes?: number;
}): Promise<TrafficEstimate & { leaveBy: Date }> {
  const arriveBy = addMinutes(args.eventStart, -(args.destination.arrivalBufferMinutes ?? 5));
  const prep = args.prepMinutes ?? 5;
  const departFor = (minutes: number) => {
    const t = addMinutes(arriveBy, -minutes);
    return t < args.now ? args.now : t; // traffic APIs reject departure times in the past
  };

  let est = await args.provider.drivingMinutes(args.origin, args.destination, departFor(30));
  const refined = await args.provider.drivingMinutes(args.origin, args.destination, departFor(est.trafficMinutes));
  if (Math.abs(refined.trafficMinutes - est.trafficMinutes) >= 1) est = refined;

  const leaveBy = new Date(Math.floor(addMinutes(arriveBy, -(est.trafficMinutes + prep)).getTime() / 60_000) * 60_000);
  return { ...est, leaveBy };
}

/**
 * Next time to re-check traffic: ~2 h, 45 min and 15 min before leave-by. Returns null
 * once the last check has passed (the alert then just waits to fire).
 */
export function nextTrafficCheck(now: Date, leaveBy: Date): Date | null {
  for (const before of [120, 45, 15]) {
    const t = addMinutes(leaveBy, -before);
    if (t > now) return t;
  }
  return null;
}

/** Fire the "time to leave" warning `warnLeadMinutes` before leave-by, once. */
export function shouldWarn(args: {
  now: Date;
  leaveBy: Date;
  eventStart: Date;
  notifiedAt: Date | null;
  warnLeadMinutes?: number; // default 10
}): boolean {
  if (args.notifiedAt || args.now >= args.eventStart) return false;
  return args.now >= addMinutes(args.leaveBy, -(args.warnLeadMinutes ?? 10));
}

export function delayMinutes(est: TrafficEstimate): number {
  return Math.max(0, est.trafficMinutes - est.typicalMinutes);
}

/** Heavy = at least 5 minutes and 25% over the no-traffic time. */
export function isHeavyTraffic(est: TrafficEstimate): boolean {
  const extra = delayMinutes(est);
  return extra >= 5 && extra >= est.typicalMinutes * 0.25;
}

export function formatLeaveWarning(args: {
  eventTitle: string;
  leaveBy: Date;
  estimate: TrafficEstimate;
  originLabel: string;
  timeZone: string;
}): { title: string; body: string } {
  const extra = delayMinutes(args.estimate);
  const traffic =
    extra === 0 ? "traffic is light" : `${extra} min longer than usual${isHeavyTraffic(args.estimate) ? " — heavy traffic" : ""}`;
  return {
    title: `Leave by ${formatClock(args.leaveBy, args.timeZone)} — ${args.eventTitle}`,
    body: `${args.estimate.trafficMinutes} min drive from ${args.originLabel}; ${traffic}.`,
  };
}

/**
 * If a traffic re-check moved leave-by 10+ minutes earlier after the plan was made,
 * warn right away instead of waiting for the usual lead time.
 */
export function earlierDepartureNotice(args: {
  eventTitle: string;
  previousLeaveBy: Date;
  newLeaveBy: Date;
  timeZone: string;
  thresholdMinutes?: number; // default 10
}): { title: string; body: string } | null {
  const shift = minutesBetween(args.newLeaveBy, args.previousLeaveBy);
  if (shift < (args.thresholdMinutes ?? 10)) return null;
  return {
    title: `Traffic: leave ${Math.round(shift)} min earlier for ${args.eventTitle}`,
    body: `New leave-by time is ${formatClock(args.newLeaveBy, args.timeZone)} (was ${formatClock(args.previousLeaveBy, args.timeZone)}).`,
  };
}
