// Everything is shown in the *household's* time zone, whatever the device's zone is.
import { localDay, localParts, zonedToUtc, type LocalDay } from "@mcp/planner";

export type { LocalDay };

export function today(tz: string): LocalDay {
  const p = localParts(new Date(), tz);
  return localDay(p.year, p.month, p.day, tz);
}
export const dayOf = (d: Date, tz: string) => {
  const p = localParts(d, tz);
  return localDay(p.year, p.month, p.day, tz);
};
export const addDays = (d: LocalDay, n: number, tz: string) => localDay(d.year, d.month, d.day + n, tz);
/** Monday-start weeks. */
export const weekStart = (d: LocalDay, tz: string) => addDays(d, -((d.dayOfWeek + 6) % 7), tz);
export const monthStart = (d: LocalDay, tz: string) => localDay(d.year, d.month, 1, tz);
export const sameDay = (a: LocalDay, b: LocalDay) => a.year === b.year && a.month === b.month && a.day === b.day;
export const isoDate = (d: LocalDay) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export function fmt(d: Date | string, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(typeof d === "string" ? new Date(d) : d);
}
export const time = (d: Date | string, tz: string) => fmt(d, tz, { hour: "numeric", minute: "2-digit" });
export const dayLabel = (d: LocalDay, tz: string) => fmt(d.start, tz, { weekday: "short", month: "short", day: "numeric" });

/** <input type="datetime-local"> value (household zone) ⇄ ISO instant. */
export function toLocalInput(iso: string, tz: string) {
  const p = localParts(new Date(iso), tz);
  const hh = String(Math.floor(p.minuteOfDay / 60)).padStart(2, "0");
  const mm = String(p.minuteOfDay % 60).padStart(2, "0");
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${hh}:${mm}`;
}
export function fromLocalInput(v: string, tz: string) {
  const [date, t] = v.split("T");
  const [y, m, d] = date!.split("-").map(Number);
  const [hh, mm] = (t ?? "00:00").split(":").map(Number);
  return zonedToUtc(y!, m!, d!, hh! * 60 + mm!, tz).toISOString();
}
