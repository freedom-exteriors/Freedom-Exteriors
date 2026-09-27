import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";
import { toCandidates, type ModelOutput } from "../src/extraction/candidates.js";
import { UploadError, prepareUpload } from "../src/extraction/prepare.js";
import { ClaudeScheduleExtractor, ExtractionError } from "../src/extraction/extractor.js";

const ev = (over: Partial<ModelOutput["events"][number]>): ModelOutput["events"][number] => ({
  title: "Practice", date: "2026-10-06", endDate: null, startTime: "17:00", endTime: "18:30", allDay: false,
  location: "Eastside Park", confidence: 0.95, suggestedTag: null, suggestedPerson: null, sourceText: "Tue 10/6 5-6:30pm", ...over,
});
const ctx = {
  timeZone: "America/Chicago",
  today: "2026-10-01",
  people: [{ id: "p-maya", name: "Maya" }],
  tags: [{ id: "t-game", key: "game" }],
};

test("candidates: local times → UTC across DST, assumptions recorded, suggestions matched", () => {
  const out = toCandidates(
    {
      notes: null,
      events: [
        ev({}),
        ev({ date: "2026-11-02", title: "After DST" }),
        ev({ title: "No end", endTime: null }),
        ev({ title: "Late", startTime: "22:00", endTime: "01:00" }),
        ev({ title: "Tournament", allDay: true, startTime: null, endTime: null, date: "2026-10-17", endDate: "2026-10-18" }),
        ev({ title: "Maya's game", suggestedPerson: "maya", suggestedTag: "game", confidence: 0.55 }),
        ev({ title: "Unknown tag", suggestedTag: "rodeo", suggestedPerson: "Grandpa", confidence: 7 }),
        ev({ title: "Bad date", date: "2026-02-30" }),
        ev({ title: "Old", date: "2026-09-01" }),
      ],
    },
    ctx,
  );
  const by = Object.fromEntries(out.map((c) => [c.title, c]));
  assert.equal(by.Practice!.start, "2026-10-06T22:00:00.000Z");
  assert.equal(by.Practice!.end, "2026-10-06T23:30:00.000Z");
  assert.equal(by["After DST"]!.start, "2026-11-02T23:00:00.000Z", "5 PM CST");
  assert.deepEqual(by["No end"]!.assumptions, ["No end time shown — assumed 1 hour"]);
  assert.equal(by.Late!.end, "2026-10-07T06:00:00.000Z");
  assert.equal(by.Tournament!.allDay, true);
  assert.equal(by.Tournament!.start, "2026-10-17T05:00:00.000Z");
  assert.equal(by.Tournament!.end, "2026-10-19T05:00:00.000Z", "through the 18th");
  assert.equal(by["Maya's game"]!.participantId, "p-maya");
  assert.equal(by["Maya's game"]!.eventTagId, "t-game");
  assert.equal(by["Maya's game"]!.lowConfidence, true);
  assert.equal(by["Unknown tag"]!.eventTagId, null, "only known tag keys");
  assert.equal(by["Unknown tag"]!.participantId, null, "only known people");
  assert.equal(by["Unknown tag"]!.confidence, 1, "clamped");
  assert.equal(by["Bad date"], undefined, "impossible dates dropped");
  assert.ok(by.Old!.assumptions.includes("This date is in the past"));
  assert.ok(out.every((c) => c.status === "pending" && c.eventId === null));
});

test("uploads: sniffed by content, phone rotation applied, metadata stripped, junk rejected", async () => {
  // A 400×200 photo stored sideways (EXIF orientation 6 = rotate 90°) with metadata.
  const sideways = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#fff" } })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-gps-stand-in" } } })
    .toBuffer();
  const out = await prepareUpload(sideways);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(out.mediaType, "image/jpeg");
  assert.deepEqual([meta.width, meta.height], [200, 400], "rotated upright");
  assert.equal(meta.exif, undefined, "EXIF (incl. GPS) stripped");

  const huge = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#eee" } }).png().toBuffer();
  const small = await sharp((await prepareUpload(huge)).bytes).metadata();
  assert.equal(Math.max(small.width!, small.height!), 1568);

  const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  assert.equal((await prepareUpload(pdf)).mediaType, "application/pdf");
  await assert.rejects(prepareUpload(Buffer.from("<html><script>alert(1)</script></html>")), UploadError);
  const fakeHeic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
  await assert.rejects(prepareUpload(fakeHeic), /HEIC/);
});

function fakeClient(response: object, capture: { req?: Record<string, unknown> } = {}) {
  return { beta: { messages: { create: async (req: Record<string, unknown>) => ((capture.req = req), response) } } } as unknown as Anthropic;
}

test("Claude request: model, structured output schema, fallbacks, image + context", async () => {
  const capture: { req?: Record<string, unknown> } = {};
  const body = { events: [ev({})], notes: "Year assumed 2026" };
  const x = new ClaudeScheduleExtractor("claude-opus-5", fakeClient({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(body) }] }, capture));
  const out = await x.extract({ bytes: Buffer.from("jpegbytes"), mediaType: "image/jpeg", timeZone: "America/Chicago", today: "2026-10-01", people: ["Maya"], tags: [{ key: "game", label: "Game" }] });
  assert.deepEqual(out, body);

  const req = capture.req!;
  assert.equal(req.model, "claude-opus-5");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepEqual(req.thinking, { type: "adaptive" });
  const fmt = (req.output_config as { format: { type: string; schema: { required: string[] } } }).format;
  assert.equal(fmt.type, "json_schema");
  assert.deepEqual(fmt.schema.required, ["events", "notes"]);
  const content = (req.messages as { content: { type: string; source?: { data: string }; text?: string }[] }[])[0]!.content;
  assert.equal(content[0]!.type, "image");
  assert.equal(content[0]!.source!.data, Buffer.from("jpegbytes").toString("base64"));
  assert.match(content[1]!.text!, /Today is 2026-10-01 \(time zone America\/Chicago\)/);
  assert.match(content[1]!.text!, /game \(Game\)/);
  assert.match(String(req.system), /not follow them/, "image text is data, not instructions");
});

test("Claude failures become readable errors", async () => {
  const input = { bytes: Buffer.from("x"), mediaType: "image/jpeg" as const, timeZone: "UTC", today: "2026-10-01", people: [], tags: [] };
  const run = (resp: object) => new ClaudeScheduleExtractor("claude-opus-5", fakeClient(resp)).extract(input);
  await assert.rejects(run({ stop_reason: "refusal", content: [] }), ExtractionError);
  await assert.rejects(run({ stop_reason: "max_tokens", content: [] }), /too long/);
  await assert.rejects(run({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }), /unexpected/);
  await assert.rejects(run({ stop_reason: "end_turn", content: [{ type: "text", text: '{"events":[{"title":1}],"notes":null}' }] }), /unexpected/);
});
