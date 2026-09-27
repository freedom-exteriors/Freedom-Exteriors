import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, organizeDay, organizeSchedule, organizeWeek, type BusyBlock, type OrganizerResult } from "../src/index.js";
import { TZ, alex, at, base, goodwill, hardware, home, maya, park, target } from "./fixtures.js";

const local = (d: Date) => {
  const p = localParts(d, TZ);
  return `${p.month}/${p.day} ${String(Math.floor(p.minuteOfDay / 60)).padStart(2, "0")}:${String(p.minuteOfDay % 60).padStart(2, "0")}`;
};

function assertNoOverlaps(result: OrganizerResult, busy: BusyBlock[]) {
  for (const p of result.placements) {
    const mine = [...busy.filter((b) => b.participantId === p.participantId), ...result.placements.filter((q) => q !== p && q.participantId === p.participantId)];
    for (const b of mine) assert.ok(p.end <= b.start || p.start >= b.end, `${p.taskId} overlaps ${"title" in b ? b.title : (b as { taskId: string }).taskId}`);
  }
}

test("an errand next to practice is placed around practice, not as a separate trip", () => {
  // Tue 10/6: Alex takes Maya to practice 5:00–6:30 PM at Eastside Park; Target is next door.
  const busy: BusyBlock[] = [{ participantId: "alex", start: at(10, 6, 17), end: at(10, 6, 18, 30), place: park, title: "Practice" }];
  const r = organizeDay({
    ...base,
    date: at(10, 6, 12),
    participants: [alex],
    busy,
    tasks: [{ id: "t", title: "Target pickup", participantId: "alex", estimatedMinutes: 20, priority: "normal", dueAt: null, location: { kind: "errand", place: target } }],
  });
  const [p] = r.placements;
  assert.ok(p, "placed");
  assert.ok(p.detourMinutes <= 5, `detour ${p.detourMinutes}`);
  assert.match(p.reason, /on the way/);
  assertNoOverlaps(r, busy);
});

test("a home task skips a gap that's all driving and lands when Alex is back home", () => {
  // Sat 10/10: park 9–10 AM, then Goodwill (other side of town) 11–12.
  const busy: BusyBlock[] = [
    { participantId: "alex", start: at(10, 10, 9), end: at(10, 10, 10), place: park, title: "Game" },
    { participantId: "alex", start: at(10, 10, 11), end: at(10, 10, 12), place: goodwill, title: "Volunteer shift" },
  ];
  const r = organizeDay({
    ...base,
    date: at(10, 10, 12),
    participants: [alex],
    busy,
    tasks: [{ id: "hinge", title: "Fix squeaky hinge", participantId: "alex", estimatedMinutes: 45, priority: "normal", dueAt: null, location: { kind: "home" } }],
  });
  const [p] = r.placements;
  assert.ok(p);
  assert.ok(p.start >= at(10, 10, 12, 10), `placed at ${local(p.start)}`);
  assert.match(p.reason, /At home after Volunteer shift/);
  assertNoOverlaps(r, busy);
});

test("nearby errands chain into one trip", () => {
  const r = organizeDay({
    ...base,
    date: at(10, 10, 12),
    participants: [alex],
    busy: [],
    tasks: [
      { id: "a", title: "Target pickup", participantId: "alex", estimatedMinutes: 20, priority: "normal", dueAt: null, location: { kind: "errand", place: target } },
      { id: "b", title: "Buy furnace filter", participantId: "alex", estimatedMinutes: 15, priority: "normal", dueAt: null, location: { kind: "errand", place: hardware } },
    ],
  });
  assert.equal(r.placements.length, 2);
  const [first, second] = r.placements;
  assert.ok(second!.detourMinutes <= 5, `second detour ${second!.detourMinutes}`);
  const between = (second!.start.getTime() - first!.end.getTime()) / 60_000;
  assert.ok(between <= 25, `errands ${between} min apart`);
});

test("errands respect store hours", () => {
  // Practice ends 6:30 PM Tue next to Goodwill-like store that closes at 6 PM → not that evening.
  const closesAtSix = { ...goodwill, openHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 9 * 60, endMinute: 18 * 60 })) };
  const r = organizeSchedule({
    ...base,
    start: at(10, 6, 0),
    end: at(10, 8, 0),
    participants: [alex],
    busy: [],
    tasks: [{ id: "d", title: "Donations", participantId: "alex", estimatedMinutes: 20, priority: "normal", dueAt: null, location: { kind: "errand", place: closesAtSix } }],
  });
  // Alex is only free from 4 PM on weekdays; the store closes at 6.
  const [p] = r.placements;
  assert.ok(p && p.end <= at(10, 6, 18), `placed ${p && local(p.start)}`);
  const none = organizeDay({ ...base, date: at(10, 6, 12), participants: [{ ...alex, availability: [{ dayOfWeek: 2, startMinute: 18 * 60, endMinute: 21 * 60 }] }], busy: [], tasks: [{ id: "d", title: "Donations", participantId: "alex", estimatedMinutes: 20, priority: "normal", dueAt: null, location: { kind: "errand", place: closesAtSix } }] });
  assert.deepEqual(none.unplaced, [{ taskId: "d", reason: "no_fitting_gap" }]);
});

test("a low-priority errand next to practice isn't crowded out by a far one", () => {
  // Tue practice at the park until 6:30; Alex free 5:30–8:30 PM only. The hardware store is
  // next to the park; the far errand fits later. Both should fit that evening.
  const busy: BusyBlock[] = [{ participantId: "alex", start: at(10, 6, 17), end: at(10, 6, 18, 30), place: park, title: "Practice" }];
  const r = organizeDay({
    ...base,
    date: at(10, 6, 12),
    participants: [{ ...alex, availability: [{ dayOfWeek: 2, startMinute: 17 * 60 + 30, endMinute: 20 * 60 + 30 }] }],
    busy,
    tasks: [
      { id: "far", title: "Goodwill", participantId: "alex", estimatedMinutes: 20, priority: "normal", dueAt: null, location: { kind: "errand", place: goodwill } },
      { id: "near", title: "Paint samples", participantId: "alex", estimatedMinutes: 15, priority: "low", dueAt: null, location: { kind: "errand", place: hardware } },
    ],
  });
  const near = r.placements.find((p) => p.taskId === "near");
  assert.ok(near, "near errand placed");
  assert.ok(near.detourMinutes <= 8, `near detour ${near.detourMinutes}`); // 3-min start-up overhead per leg
  assert.ok(r.placements.some((p) => p.taskId === "far"), "far errand still placed");
  assertNoOverlaps(r, busy);
});

test("high priority goes early in the week; due dates are respected", () => {
  const r = organizeWeek({
    ...base,
    weekStart: at(10, 5, 0),
    participants: [alex],
    busy: [],
    tasks: [
      { id: "urgent", title: "Call plumber", participantId: "alex", estimatedMinutes: 15, priority: "high", dueAt: null, location: { kind: "anywhere" } },
      { id: "due-wed", title: "Return library books", participantId: "alex", estimatedMinutes: 30, priority: "low", dueAt: at(10, 7, 17), location: { kind: "errand", place: goodwill } },
      { id: "impossible", title: "Due before any free time", participantId: "alex", estimatedMinutes: 30, priority: "normal", dueAt: at(10, 5, 16, 10), location: { kind: "home" } },
    ],
  });
  const byId = Object.fromEntries(r.placements.map((p) => [p.taskId, p]));
  assert.equal(localParts(byId.urgent!.start, TZ).day, 5, "high priority on Monday");
  assert.ok(byId["due-wed"]!.end <= at(10, 7, 17), "before its due time");
  assert.deepEqual(r.unplaced, [{ taskId: "impossible", reason: "no_fitting_gap" }]);
});

test("daily limits, eligibility and missing estimates", () => {
  const task = (id: string, extra: object = {}) => ({ id, title: id, participantId: "alex", estimatedMinutes: 50, priority: "normal" as const, dueAt: null, location: { kind: "home" as const }, ...extra });
  const r = organizeDay({
    ...base,
    date: at(10, 6, 12),
    participants: [alex, maya],
    busy: [],
    tasks: [
      task("one"),
      task("two"),
      task("three"), // 150 min > Alex's 120/day
      task("maya-errand", { participantId: "maya", location: { kind: "errand", place: target } }), // Maya can't drive
      task("no-estimate", { estimatedMinutes: null }),
      task("anyone", { participantId: null, estimatedMinutes: 10 }), // only Alex takes unassigned
    ],
  });
  // Three identical 50-min tasks vs a 120-min daily limit: exactly two fit (which two is a
  // deterministic tie-break, not something to pin down here).
  const placed = r.placements.map((p) => p.taskId);
  assert.ok(placed.includes("anyone"));
  assert.equal(placed.filter((id) => ["one", "two", "three"].includes(id)).length, 2);
  assert.ok(r.placements.every((p) => p.participantId === "alex"));
  const unplaced = Object.fromEntries(r.unplaced.map((u) => [u.taskId, u.reason]));
  assert.equal(unplaced["maya-errand"], "no_one_eligible");
  assert.equal(unplaced["no-estimate"], "needs_estimate");
  assert.equal(Object.values(unplaced).filter((x) => x === "no_fitting_gap").length, 1);
});

test("a busy week: nothing overlaps, everything stays inside availability", () => {
  const busy: BusyBlock[] = [];
  for (let d = 5; d <= 9; d++) {
    busy.push({ participantId: "alex", start: at(10, d, 17), end: at(10, d, 18, 30), place: park, title: "Practice" });
    busy.push({ participantId: "maya", start: at(10, d, 17), end: at(10, d, 18, 30), place: park, title: "Practice" });
  }
  const tasks = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    participantId: i % 4 === 0 ? "maya" : "alex",
    estimatedMinutes: i % 4 === 0 ? 30 : 15 + (i % 3) * 20, // Maya's daily cap is 45
    priority: (["low", "normal", "high"] as const)[i % 3],
    dueAt: null,
    location: i % 5 === 0 && i % 4 !== 0 ? ({ kind: "errand", place: target } as const) : ({ kind: "home" } as const),
  }));
  const r = organizeSchedule({ ...base, start: at(10, 5, 0), end: at(10, 12, 0), participants: [alex, maya], busy, tasks });
  assert.equal(r.placements.length + r.unplaced.length, 12);
  assert.equal(r.unplaced.length, 0);
  assertNoOverlaps(r, busy);
  for (const p of r.placements) {
    const person = p.participantId === "alex" ? alex : maya;
    const s = localParts(p.start, TZ);
    const e = localParts(p.end, TZ);
    const dow = new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay();
    assert.ok(
      person.availability.some((w) => w.dayOfWeek === dow && s.minuteOfDay >= w.startMinute && e.minuteOfDay <= w.endMinute),
      `${p.taskId} at ${local(p.start)} is outside ${person.name}'s availability`,
    );
  }
});

test("deterministic: same input, same plan", () => {
  const input = {
    ...base,
    start: at(10, 5, 0),
    end: at(10, 12, 0),
    participants: [alex],
    busy: [],
    tasks: [
      { id: "x", title: "x", participantId: null, estimatedMinutes: 30, priority: "normal" as const, dueAt: null, location: { kind: "home" as const } },
      { id: "y", title: "y", participantId: null, estimatedMinutes: 30, priority: "normal" as const, dueAt: null, location: { kind: "errand" as const, place: target } },
    ],
  };
  assert.deepEqual(organizeSchedule(input), organizeSchedule(input));
  void home;
});
