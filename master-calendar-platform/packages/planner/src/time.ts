// Time-zone math with Intl only (no dependency). Storage and inputs are UTC Dates; the
// workspace's IANA zone decides where a "day" starts and what "Sat 9:00" means.

const MINUTE = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  minuteOfDay: number;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    minuteOfDay: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (Chicago in summer → -300). */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minuteOfDay);
  return Math.round((asUtc - Math.floor(date.getTime() / MINUTE) * MINUTE) / MINUTE);
}

/** The UTC instant of a local wall-clock time. `minuteOfDay` may be 1440 (next midnight). */
export function zonedToUtc(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * MINUTE;
  const second = guess - offsetMinutes(new Date(first), timeZone) * MINUTE;
  return new Date(second);
}

export interface LocalDay {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0 = Sunday
  start: Date; // local midnight, as UTC
  end: Date; // next local midnight, as UTC (23 or 25 h away on DST days)
}

export function localDay(year: number, month: number, day: number, timeZone: string): LocalDay {
  const civil = new Date(Date.UTC(year, month - 1, day));
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: civil.getUTCFullYear(),
    month: civil.getUTCMonth() + 1,
    day: civil.getUTCDate(),
    dayOfWeek: civil.getUTCDay(),
    start: zonedToUtc(civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate(), 0, timeZone),
    end: zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, timeZone),
  };
}

/** Local days overlapping [start, end). */
export function localDaysInRange(start: Date, end: Date, timeZone: string): LocalDay[] {
  const days: LocalDay[] = [];
  const p = localParts(start, timeZone);
  for (let i = 0; ; i++) {
    const d = localDay(p.year, p.month, p.day + i, timeZone);
    if (d.start >= end) break;
    days.push(d);
  }
  return days;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MINUTE;
}

/** Rounds up to the next multiple of `step` minutes (UTC-aligned, fine for 5/15-min steps). */
export function ceilToMinutes(date: Date, step: number): Date {
  const ms = step * MINUTE;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

export function formatClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}
