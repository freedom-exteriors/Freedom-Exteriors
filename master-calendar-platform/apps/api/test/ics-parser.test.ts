import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IcsParseError, parseIcs } from "../src/ingestion/ics-parser.js";

const ics = readFileSync(path.join(import.meta.dirname, "fixtures/eastside.ics"), "utf8");
const opts = { timeZone: "America/Chicago", windowStart: new Date("2026-09-01T00:00:00Z"), windowEnd: new Date("2027-03-01T00:00:00Z") };
const events = parseIcs(ics, opts);
const byTitle = (t: string) => events.filter((e) => e.title === t);

test("recurring series: exploded, EXDATE skipped, cancelled override dropped, DST-correct", () => {
  const practice = byTitle("U12 Practice");
  // COUNT=10 → minus EXDATE (Oct 12), minus moved (Oct 14, reported separately), minus cancelled (Oct 21) = 7
  assert.equal(practice.length, 7);
  assert.deepEqual(
    practice.map((e) => e.startTime.toISOString()),
    [
      "2026-10-05T22:00:00.000Z", "2026-10-07T22:00:00.000Z", "2026-10-19T22:00:00.000Z",
      "2026-10-26T22:00:00.000Z", "2026-10-28T22:00:00.000Z",
      "2026-11-02T23:00:00.000Z", "2026-11-04T23:00:00.000Z", // 5 PM CST after Nov 1: 23:00Z, not 22:00Z
    ],
  );
  assert.ok(practice.every((e) => e.externalUid === "practice-series@eastside"));
  assert.equal(new Set(practice.map((e) => e.externalRecurrenceId)).size, 7, "one key per occurrence");
  assert.equal(practice[0]!.externalRecurrenceId, "2026-10-05T22:00:00.000Z");
  assert.equal(practice[0]!.location, "Eastside Park, Field 3", "escaped comma unescaped");
  assert.match(String(practice[0]!.raw.description), /that it gets folded/, "folded line joined");
  assert.equal(practice[0]!.endTime.toISOString(), "2026-10-05T23:30:00.000Z");
});

test("a moved occurrence keeps its original recurrence id (so sync updates it in place)", () => {
  const [moved] = byTitle("U12 Practice (moved to Thursday)");
  assert.ok(moved);
  assert.equal(moved.externalRecurrenceId, "2026-10-14T22:00:00.000Z");
  assert.equal(moved.startTime.toISOString(), "2026-10-15T23:00:00.000Z");
  assert.equal(moved.location, "Eastside Park, Field 1");
});

test("one-offs: UTC, all-day, floating, Outlook zone names; cancelled and out-of-window dropped", () => {
  const [game] = byTitle("U12 vs. Westview");
  assert.equal(game!.externalRecurrenceId, "");
  assert.equal(game!.startTime.toISOString(), "2026-10-10T15:00:00.000Z");
  assert.deepEqual(game!.raw.categories, ["Game", "Home"]);

  const [pictures] = byTitle("Picture day");
  assert.equal(pictures!.allDay, true);
  assert.equal(pictures!.startTime.toISOString(), "2026-10-16T05:00:00.000Z", "local midnight in the workspace zone");
  assert.equal(pictures!.endTime.toISOString(), "2026-10-17T05:00:00.000Z", "no DTEND → one day");

  assert.equal(byTitle("Team breakfast")[0]!.startTime.toISOString(), "2026-10-20T14:00:00.000Z", "floating → workspace zone");
  assert.equal(byTitle("Coaches meeting")[0]!.startTime.toISOString(), "2026-11-04T01:00:00.000Z", "VTIMEZONE-defined zone");
  assert.equal(byTitle("Scrimmage").length, 0);
  assert.equal(byTitle("Last season banquet").length, 0);
  assert.equal(events.length, 12);
});

test("garbage input is a clear error; empty calendars are fine", () => {
  assert.throws(() => parseIcs("<html>not a calendar</html>", opts), IcsParseError);
  assert.deepEqual(parseIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n", opts), []);
});

test("occurrence cap protects against runaway feeds", () => {
  const daily = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:d\r\nSUMMARY:x\r\nDTSTART:20260901T120000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  assert.throws(() => parseIcs(daily, { ...opts, maxOccurrences: 50 }), /more than 50/);
});
