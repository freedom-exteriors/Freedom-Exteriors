// iCalendar → flat list of event occurrences inside a time window.
//
// Recurring series are exploded into one occurrence each (the brief's model), keyed by
// (UID, recurrence id). Handles: RRULE/RDATE/EXDATE, RECURRENCE-ID overrides (a single
// practice moved to Thursday), cancelled occurrences, all-day events, floating times, and
// both IANA TZIDs and feed-defined VTIMEZONEs.
import ICAL from "ical.js";
import { zonedToUtc } from "@mcp/planner";
import type { Occurrence } from "./apply.js";

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;
type Event = InstanceType<typeof ICAL.Event>;

export type ParsedOccurrence = Occurrence;

export interface ParseOptions {
  /** Zone for floating times and all-day dates (the workspace's). */
  timeZone: string;
  windowStart: Date;
  windowEnd: Date;
  /** Safety cap on occurrences per feed. */
  maxOccurrences?: number;
}

export class IcsParseError extends Error {}

const MAX_ITERATIONS_PER_SERIES = 20_000;

export function parseIcs(text: string, opts: ParseOptions): ParsedOccurrence[] {
  let root: Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (err) {
    throw new IcsParseError(`Couldn't read the calendar file: ${(err as Error).message}`);
  }
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const masters = new Map<string, Event>();
  const exceptions: Event[] = [];
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(vevent);
    if (!ev.uid || !ev.startDate) continue; // malformed; skip rather than fail the feed
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  const orphans: Event[] = [];
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else orphans.push(ex); // override without its series: treat as a standalone occurrence
  }

  const out: ParsedOccurrence[] = [];
  const cap = opts.maxOccurrences ?? 20_000;
  const push = (o: ParsedOccurrence | null) => {
    if (!o) return;
    if (o.endTime <= opts.windowStart || o.startTime >= opts.windowEnd) return;
    if (out.length >= cap) throw new IcsParseError(`Calendar has more than ${cap} events in range`);
    out.push(o);
  };

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      push(occurrence(ev, ev.startDate, ev.endDate, "", opts));
      continue;
    }
    const it = ev.iterator();
    for (let i = 0, next: Time | null; (next = it.next()) && i < MAX_ITERATIONS_PER_SERIES; i++) {
      const details = ev.getOccurrenceDetails(next);
      const item = details.item;
      const start = toUtc(details.startDate, tzidOf(item, "dtstart"), opts.timeZone);
      if (start >= opts.windowEnd) break;
      push(occurrence(item, details.startDate, details.endDate, recurrenceKey(details.recurrenceId, tzidOf(ev, "dtstart"), opts.timeZone), opts));
    }
  }
  for (const ex of orphans) {
    push(occurrence(ex, ex.startDate, ex.endDate, recurrenceKey(ex.recurrenceId, tzidOf(ex, "recurrence-id"), opts.timeZone), opts));
  }
  return out;
}

function occurrence(ev: Event, startT: Time, endT: Time | null, recurrenceId: string, opts: ParseOptions): ParsedOccurrence | null {
  const status = String(ev.component.getFirstPropertyValue("status") ?? "").toUpperCase();
  if (status === "CANCELLED") return null;
  const allDay = startT.isDate;
  const startTime = toUtc(startT, tzidOf(ev, "dtstart"), opts.timeZone);
  let endTime = endT ? toUtc(endT, tzidOf(ev, "dtend") ?? tzidOf(ev, "dtstart"), opts.timeZone) : null;
  if (!endTime || endTime < startTime) {
    // No DTEND/DURATION: all-day → one day; timed → zero-length (a deadline).
    endTime = allDay ? zonedToUtc(startT.year, startT.month, startT.day + 1, 0, opts.timeZone) : startTime;
  }
  const text = (name: string, max = 2000) => {
    const v = ev.component.getFirstPropertyValue(name);
    return v == null ? null : String(v).slice(0, max);
  };
  return {
    externalUid: ev.uid,
    externalRecurrenceId: recurrenceId,
    title: (ev.summary || "(no title)").trim().slice(0, 500),
    startTime,
    endTime,
    allDay,
    location: ev.location?.trim() || null,
    // Enough to debug and to show details; not the whole VEVENT.
    raw: {
      uid: ev.uid,
      description: text("description"),
      url: text("url", 500),
      status: status || null,
      categories: ev.component.getAllProperties("categories").flatMap((p) => p.getValues().map(String)),
      lastModified: text("last-modified", 40),
    },
  };
}

function tzidOf(ev: Event, prop: string): string | null {
  const p = ev.component.getFirstProperty(prop);
  const tzid = p?.getParameter("tzid");
  return typeof tzid === "string" ? tzid : null;
}

function isIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wall-clock ICAL.Time → UTC instant. IANA TZIDs are resolved with the runtime's tz
 * database (more current than a feed's embedded VTIMEZONE rules); other TZIDs (e.g.
 * Microsoft names) use the feed's VTIMEZONE; floating times and dates use the workspace zone.
 */
function toUtc(t: Time, tzid: string | null, fallbackZone: string): Date {
  if (t.isDate) return zonedToUtc(t.year, t.month, t.day, 0, fallbackZone);
  if (t.zone === ICAL.Timezone.utcTimezone || tzid === "UTC" || tzid === "Etc/UTC") {
    return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
  }
  const seconds = t.second * 1000;
  if (tzid && isIanaZone(tzid)) return new Date(zonedToUtc(t.year, t.month, t.day, t.hour * 60 + t.minute, tzid).getTime() + seconds);
  if (tzid && t.zone && t.zone !== ICAL.Timezone.localTimezone) return t.toJSDate();
  return new Date(zonedToUtc(t.year, t.month, t.day, t.hour * 60 + t.minute, fallbackZone).getTime() + seconds);
}

function recurrenceKey(rid: Time | null | undefined, tzid: string | null, fallbackZone: string): string {
  if (!rid) return "";
  if (rid.isDate) return `${rid.year}-${String(rid.month).padStart(2, "0")}-${String(rid.day).padStart(2, "0")}`;
  return toUtc(rid, tzid, fallbackZone).toISOString();
}
