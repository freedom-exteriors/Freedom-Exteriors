import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClock, localDaysInRange, localParts, zonedToUtc } from "../src/index.js";

test("wall time → UTC across DST in America/Chicago", () => {
  assert.equal(zonedToUtc(2026, 7, 1, 9 * 60, "America/Chicago").toISOString(), "2026-07-01T14:00:00.000Z"); // CDT
  assert.equal(zonedToUtc(2026, 12, 1, 9 * 60, "America/Chicago").toISOString(), "2026-12-01T15:00:00.000Z"); // CST
  assert.equal(zonedToUtc(2026, 11, 1, 9 * 60, "America/Chicago").toISOString(), "2026-11-01T15:00:00.000Z"); // fall-back day
});

test("DST days are 23 and 25 hours long", () => {
  const [spring] = localDaysInRange(new Date("2026-03-08T12:00:00Z"), new Date("2026-03-08T12:01:00Z"), "America/Chicago");
  const [fall] = localDaysInRange(new Date("2026-11-01T12:00:00Z"), new Date("2026-11-01T12:01:00Z"), "America/Chicago");
  assert.equal((spring!.end.getTime() - spring!.start.getTime()) / 3_600_000, 23);
  assert.equal((fall!.end.getTime() - fall!.start.getTime()) / 3_600_000, 25);
});

test("a week range yields 7 local days starting Monday", () => {
  const start = zonedToUtc(2026, 10, 5, 0, "America/Chicago");
  const days = localDaysInRange(start, zonedToUtc(2026, 10, 12, 0, "America/Chicago"), "America/Chicago");
  assert.deepEqual(days.map((d) => d.dayOfWeek), [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(localParts(days[6]!.start, "America/Chicago").day, 11);
  assert.equal(formatClock(zonedToUtc(2026, 10, 5, 17 * 60 + 5, "America/Chicago"), "America/Chicago"), "5:05 PM");
});
