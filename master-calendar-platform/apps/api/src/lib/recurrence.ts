// Recurring reminders are *date* rules ("Oct 15 every year"), so they're evaluated on
// calendar dates, not instants: we run rrule in UTC with noon anchors and read back the
// Y-M-D, then place it in the workspace's zone. No DST edge can shift a date.
import rrulePkg from "rrule";
import { localParts } from "@mcp/planner";

const { RRule } = rrulePkg;

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export function parseRule(rule: string): InstanceType<typeof RRule> {
  const opts = RRule.parseString(rule);
  if (opts.freq === undefined) throw new Error("missing FREQ");
  if (opts.freq !== RRule.YEARLY && opts.freq !== RRule.MONTHLY && opts.freq !== RRule.WEEKLY) {
    throw new Error("use a yearly, monthly or weekly rule");
  }
  // Anchor far enough back that INTERVAL-less rules behave like "every year/month/week".
  return new RRule({ ...opts, dtstart: new Date(Date.UTC(2020, 0, 1, 12)) });
}

/** The next `count` occurrence dates on or after `from`. */
export function nextDates(rule: string, from: LocalDate, count = 1): LocalDate[] {
  const r = parseRule(rule);
  const out: LocalDate[] = [];
  let cursor = new Date(Date.UTC(from.year, from.month - 1, from.day, 12) - 1);
  for (let i = 0; i < count; i++) {
    const next = r.after(cursor, false);
    if (!next) break;
    out.push({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() });
    cursor = next;
  }
  return out;
}

export function todayIn(timeZone: string, now = new Date()): LocalDate {
  const p = localParts(now, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

export const isoDate = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** Throws a readable message for rules people can't use. */
export function validateRule(rule: string): void {
  try {
    if (nextDates(rule, { year: 2026, month: 1, day: 1 }, 1).length === 0) throw new Error("never happens");
  } catch (err) {
    throw new Error(`That repeat rule doesn't work: ${(err as Error).message}`);
  }
}
