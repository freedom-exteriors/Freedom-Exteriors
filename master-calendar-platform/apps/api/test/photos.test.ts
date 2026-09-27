import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { Client, makeApp, prisma } from "./helpers.js";
import { MemoryPhotoStore } from "../src/extraction/photo-store.js";
import { ExtractionError, type ExtractionInput, type ScheduleExtractor } from "../src/extraction/extractor.js";
import type { ModelOutput } from "../src/extraction/candidates.js";

class FakeExtractor implements ScheduleExtractor {
  readonly model = "fake-vision";
  calls: ExtractionInput[] = [];
  fail: Error | null = null;
  output: ModelOutput = {
    notes: "Year not shown; assumed 2026.",
    events: [
      { title: "U12 vs. Westview", date: "2026-10-10", endDate: null, startTime: "10:00", endTime: "11:30", allDay: false, location: "Westview HS", confidence: 0.95, suggestedTag: "game", suggestedPerson: "Maya", sourceText: "Sat 10/10 10am @ Westview" },
      { title: "Team photos", date: "2026-10-16", endDate: null, startTime: null, endTime: null, allDay: true, location: null, confidence: 0.9, suggestedTag: null, suggestedPerson: null, sourceText: "Picture day Oct 16" },
      { title: "Scrimmage?", date: "2026-10-18", endDate: null, startTime: "14:00", endTime: null, allDay: false, location: null, confidence: 0.45, suggestedTag: null, suggestedPerson: null, sourceText: "Scrim 10/1? 2pm (smudged)" },
    ],
  };
  async extract(input: ExtractionInput) {
    this.calls.push(input);
    if (this.fail) throw this.fail;
    return this.output;
  }
}

async function photo() {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: "#fafafa" } }).jpeg().toBuffer();
}

function multipart(file: Buffer, filename = "flyer.jpg", type = "image/jpeg") {
  const boundary = "----test" + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
  return { body: Buffer.concat([head, file, Buffer.from(`\r\n--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function setup(extractor: ScheduleExtractor | null = new FakeExtractor()) {
  const store = new MemoryPhotoStore();
  const app = await makeApp({}, { photoStore: store, extractor });
  const parent = new Client(app);
  const { workspaceId } = await parent.signup(`ph-${crypto.randomUUID().slice(0, 6)}`, { name: "Photo Family", vertical: "family" });
  const ws = workspaceId!;
  const maya = (await parent.post(`/workspaces/${ws}/participants`, { name: "Maya" })).json();
  const kid = new Client(app);
  await kid.signup(`ph-kid-${crypto.randomUUID().slice(0, 6)}`);
  const { token } = (await parent.post(`/workspaces/${ws}/invites`, { role: "viewer", participantId: maya.id })).json();
  await kid.post(`/invites/${token}/accept`);
  const upload = async (who: Client, file: Buffer, wait = true) => {
    const mp = multipart(file);
    return app.inject({
      method: "POST",
      url: `/workspaces/${ws}/schedule-photos${wait ? "?wait=true" : ""}`,
      payload: mp.body,
      headers: { "content-type": mp.contentType, origin: "http://localhost:5173", cookie: who.cookie! },
    });
  };
  return { app, store, parent, kid, ws, maya, upload, base: `/workspaces/${ws}/schedule-photos` };
}

test("photo → candidates → review → confirm; nothing reaches the calendar unconfirmed", async () => {
  const extractor = new FakeExtractor();
  const s = await setup(extractor);
  const up = await s.upload(s.kid, await photo()); // a kid snapped the flyer
  assert.equal(up.statusCode, 201, up.body);
  const photoId = up.json().id;
  assert.equal(up.json().status, "completed");
  assert.deepEqual(up.json().counts, { pending: 3, confirmed: 0, rejected: 0 });
  assert.equal(extractor.calls[0]!.timeZone, "America/Chicago");
  assert.ok(extractor.calls[0]!.people.includes("Maya"));
  assert.equal(await prisma.event.count({ where: { calendarSource: { workspaceId: s.ws } } }), 0, "no events yet");

  const detail = (await s.parent.get(`${s.base}/${photoId}`)).json();
  assert.equal(detail.notes, "Year not shown; assumed 2026.");
  const [game, pictures, scrim] = detail.candidates;
  assert.equal(game.title, "U12 vs. Westview");
  assert.equal(game.participantId, s.maya.id, "suggested person matched");
  assert.equal(scrim.lowConfidence, true);
  assert.deepEqual(scrim.assumptions, ["No end time shown — assumed 1 hour"]);
  assert.equal((await s.parent.get(detail.imageUrl)).headers["content-type"], "image/jpeg");

  // Kids can upload but not confirm.
  assert.equal((await s.kid.post(`${s.base}/${photoId}/confirm`, { candidateIds: [game.id] })).statusCode, 403);

  // Confirm everything: the smudged low-confidence one is held back.
  const r1 = (await s.parent.post(`${s.base}/${photoId}/confirm`, { candidateIds: [game.id, pictures.id, scrim.id] })).json().results;
  assert.deepEqual(r1.map((r: { ok: boolean; reason?: string }) => r.ok || r.reason).sort(), [true, true, "low_confidence_needs_confirmation"].sort());

  // Fix the smudged date, then confirm — editing counts as reviewing it.
  const fixed = await s.parent.patch(`${s.base}/${photoId}/candidates/${scrim.id}`, { title: "Scrimmage", start: "2026-10-11T14:00:00-05:00", end: "2026-10-11T15:30:00-05:00" });
  assert.equal(fixed.statusCode, 200);
  const r2 = (await s.parent.post(`${s.base}/${photoId}/confirm`, { candidateIds: [scrim.id, game.id] })).json().results;
  assert.ok(r2.some((r: { candidateId: string; ok: boolean }) => r.candidateId === scrim.id && r.ok));
  assert.ok(r2.some((r: { candidateId: string; reason?: string }) => r.candidateId === game.id && r.reason === "already_confirmed"));

  // They're real events now, on the unified calendar, attributed to the photo import.
  const events = (await s.parent.get(`/workspaces/${s.ws}/events?start=2026-10-01T00:00:00Z&end=2026-10-31T00:00:00Z`)).json().events;
  const titles = events.map((e: { title: string }) => e.title);
  assert.deepEqual(titles, ["U12 vs. Westview", "Scrimmage", "Team photos"]);
  const g = events.find((e: { title: string }) => e.title === "U12 vs. Westview");
  assert.equal(g.source.type, "photo_extraction");
  assert.equal(g.participant.name, "Maya");
  assert.equal(g.tag.key, "game");
  assert.equal(g.start, "2026-10-10T15:00:00.000Z");

  // Deleting the photo keeps the confirmed events.
  assert.equal((await s.kid.del(`${s.base}/${photoId}`)).statusCode, 204, "uploader may delete");
  assert.equal(s.store.files.size, 0);
  assert.equal(await prisma.event.count({ where: { calendarSource: { workspaceId: s.ws } } }), 3);
});

test("reject, low-confidence override, failures and retry", async () => {
  const extractor = new FakeExtractor();
  const s = await setup(extractor);
  const photoId = (await s.upload(s.parent, await photo())).json().id;
  const [game, , scrim] = (await s.parent.get(`${s.base}/${photoId}`)).json().candidates;
  assert.deepEqual((await s.parent.post(`${s.base}/${photoId}/reject`, { candidateIds: [game.id] })).json(), { rejected: 1 });
  assert.equal((await s.parent.post(`${s.base}/${photoId}/confirm`, { candidateIds: [game.id] })).json().results[0].reason, "already_rejected");
  const forced = (await s.parent.post(`${s.base}/${photoId}/confirm`, { candidateIds: [scrim.id], confirmLowConfidence: true })).json().results[0];
  assert.equal(forced.ok, true);

  extractor.fail = new ExtractionError("This image couldn't be read");
  const bad = (await s.upload(s.parent, await photo())).json();
  assert.equal(bad.status, "failed");
  assert.equal(bad.errorMessage, "This image couldn't be read");
  extractor.fail = null;
  const retried = (await s.parent.post(`${s.base}/${bad.id}/retry`)).json();
  assert.equal(retried.status, "completed");

  const other = await setup();
  assert.equal((await other.parent.get(`${s.base}/${photoId}`)).statusCode, 404);
  assert.equal((await other.parent.get(`${s.base}/${photoId}/image`)).statusCode, 404);
});

test("bad files are refused; no model configured fails clearly", async () => {
  const s = await setup(null);
  const junk = await s.upload(s.parent, Buffer.from("<html>not an image</html>"));
  assert.equal(junk.statusCode, 400);
  assert.match(junk.json().message, /isn't a photo or PDF/);
  const noModel = (await s.upload(s.parent, await photo())).json();
  assert.equal(noModel.status, "failed");
  assert.match(noModel.errorMessage, /isn't set up/);
});
