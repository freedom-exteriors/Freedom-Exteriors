// Dates are handled as plain "YYYY-MM-DD" strings (no time zones).

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Today in Minnesota time, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const m = ISO.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** YYYY-MM-DD → MM/DD/YYYY (QuickBooks style). */
export function toUsDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = ISO.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** YYYY-MM-DD → "October 2, 2026". */
export function toLongDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = ISO.exec(iso);
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** "Net 30" etc. from invoice and due dates. */
export function termsFor(invoiceDate: string, dueDate: string | null | undefined): string {
  if (!dueDate) return "";
  const days = daysBetween(invoiceDate, dueDate);
  if (days <= 0) return "Due on receipt";
  return `Net ${days}`;
}
