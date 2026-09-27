// Candidate events read from a photo. The model returns local wall-clock dates/times
// (never offsets — models are bad at DST); we convert them to UTC in the workspace's
// zone and record every assumption so the reviewer can see what was guessed.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zonedToUtc } from "@mcp/planner";

/** Below this, a candidate is flagged and needs an explicit extra confirmation. */
export const LOW_CONFIDENCE = 0.7;
export const MAX_CANDIDATES = 100;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

/** JSON schema handed to the model via structured outputs (output_config.format). */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events", "notes"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "date", "endDate", "startTime", "endTime", "allDay", "location", "confidence", "suggestedTag", "suggestedPerson", "sourceText"],
        properties: {
          title: { type: "string", description: "Short event title, e.g. 'U12 Soccer vs. Westview'" },
          date: { type: "string", description: "Local date, YYYY-MM-DD" },
          endDate: { ...nullableString, description: "Last day (YYYY-MM-DD) for multi-day events, else null" },
          startTime: { ...nullableString, description: "Local start time, 24-hour HH:MM, exactly as written; null for all-day" },
          endTime: { ...nullableString, description: "Local end time, 24-hour HH:MM; null if not shown" },
          allDay: { type: "boolean" },
          location: nullableString,
          confidence: { type: "number", description: "0 to 1" },
          suggestedTag: { ...nullableString, description: "One of the provided tag keys, or null" },
          suggestedPerson: { ...nullableString, description: "One of the provided people's names if the image clearly refers to them, else null" },
          sourceText: { type: "string", description: "The exact words read from the image for this event" },
        },
      },
    },
    notes: { ...nullableString, description: "Anything the reviewer should know (assumed year, unreadable parts, no schedule found)" },
  },
} as const;

const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** What we accept from the model (validated again even though output is schema-constrained). */
export const modelOutput = z.object({
  events: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        date: ymd,
        endDate: ymd.nullable(),
        startTime: hhmm.nullable(),
        endTime: hhmm.nullable(),
        allDay: z.boolean(),
        location: z.string().trim().max(300).nullable(),
        confidence: z.number(),
        suggestedTag: z.string().nullable(),
        suggestedPerson: z.string().nullable(),
        sourceText: z.string().max(1000),
      }),
    )
    .max(MAX_CANDIDATES * 2),
  notes: z.string().max(2000).nullable(),
});
export type ModelOutput = z.infer<typeof modelOutput>;

export type CandidateStatus = "pending" | "confirmed" | "rejected";

export interface Candidate {
  id: string;
  title: string;
  start: string; // ISO UTC
  end: string;
  allDay: boolean;
  location: string | null;
  confidence: number;
  lowConfidence: boolean;
  /** Reviewer-editable; start as the model's suggestion. */
  participantId: string | null;
  eventTagId: string | null;
  sourceText: string;
  assumptions: string[];
  status: CandidateStatus;
  eventId: string | null;
}

export interface ExtractionResult {
  model: string;
  notes: string | null;
  candidates: Candidate[];
}

const toMin = (s: string) => Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
const parseYmd = (s: string) => s.split("-").map(Number) as [number, number, number];

export function toCandidates(
  out: ModelOutput,
  ctx: {
    timeZone: string;
    today: string; // YYYY-MM-DD in the workspace zone
    people: { id: string; name: string }[];
    tags: { id: string; key: string }[];
  },
): Candidate[] {
  const byName = new Map(ctx.people.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const byKey = new Map(ctx.tags.map((t) => [t.key, t.id]));
  const result: Candidate[] = [];
  for (const e of out.events.slice(0, MAX_CANDIDATES)) {
    const [y, m, d] = parseYmd(e.date);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) continue; // "2026-02-30"
    const assumptions: string[] = [];
    let start: Date;
    let end: Date;
    const allDay = e.allDay || e.startTime === null;
    if (allDay) {
      if (!e.allDay) assumptions.push("No time shown — added as an all-day event");
      start = zonedToUtc(y, m, d, 0, ctx.timeZone);
      const [ey, em, ed] = e.endDate ? parseYmd(e.endDate) : [y, m, d];
      end = zonedToUtc(ey, em, ed + 1, 0, ctx.timeZone);
      if (end <= start) end = zonedToUtc(y, m, d + 1, 0, ctx.timeZone);
    } else {
      const s = toMin(e.startTime!);
      start = zonedToUtc(y, m, d, s, ctx.timeZone);
      if (e.endTime) {
        const en = toMin(e.endTime);
        end = zonedToUtc(y, m, en <= s ? d + 1 : d, en, ctx.timeZone);
        if (en <= s) assumptions.push("Ends after midnight");
      } else {
        end = new Date(start.getTime() + 60 * 60_000);
        assumptions.push("No end time shown — assumed 1 hour");
      }
    }
    if (e.date < ctx.today) assumptions.push("This date is in the past");
    const confidence = Math.min(1, Math.max(0, Number.isFinite(e.confidence) ? e.confidence : 0));
    const participantId = e.suggestedPerson ? (byName.get(e.suggestedPerson.trim().toLowerCase()) ?? null) : null;
    const eventTagId = e.suggestedTag ? (byKey.get(e.suggestedTag) ?? null) : null;
    result.push({
      id: randomUUID(),
      title: e.title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay,
      location: e.location || null,
      confidence,
      lowConfidence: confidence < LOW_CONFIDENCE,
      participantId,
      eventTagId,
      sourceText: e.sourceText,
      assumptions,
      status: "pending",
      eventId: null,
    });
  }
  return result.sort((a, b) => a.start.localeCompare(b.start));
}
