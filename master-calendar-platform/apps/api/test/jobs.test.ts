import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceFromTemplate } from "@mcp/db";
import type { TrafficProvider } from "@mcp/planner";
import { Client, makeApp, prisma } from "./helpers.js";
import { runAutomation } from "../src/jobs/automation.js";
import { runReminders } from "../src/jobs/reminders.js";
import { estimateOnlyTraffic, runDepartures } from "../src/jobs/departures.js";
import { deliverPending, type EmailSender } from "../src/jobs/notify.js";
import { JobScheduler } from "../src/jobs/scheduler.js";

// A fixed moment far from any real data: Mon 3 Mar 2031, 12:00 UTC (6 AM in Chicago).
const NOW = new Date("2031-03-03T12:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const min = (m: number, from = NOW) => new Date(from.getTime() + m * 60_000);

async function family() {
  const ws = await createWorkspaceFromTemplate(prisma, { name: `jobs-${crypto.randomUUID().slice(0, 6)}`, vertical: "family" });
  const home = await prisma.place.create({ data: { workspaceId: ws.id, name: "Home", kind: "home", latitude: 41.9, longitude: -87.65 } });
  const park = await prisma.place.create({ data: { workspaceId: ws.id, name: "Eastside Park", kind: "activity", latitude: 41.94, longitude: -87.65, arrivalBufferMinutes: 5 } });
  const alex = await prisma.participant.create({ data: { workspaceId: ws.id, name: "Alex", color: "#2563EB", canDrive: true, homePlaceId: home.id } });
  const maya = await prisma.participant.create({ data: { workspaceId: ws.id, name: "Maya", color: "#DB2777", homePlaceId: home.id } });
  const src = await prisma.calendarSource.create({ data: { workspaceId: ws.id, type: "ics_feed", name: "Team" } });
  const tag = async (key: string) => (await prisma.eventTagDefinition.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: ws.id, key } } })).id;
  let n = 0;
  const event = async (title: string, start: Date, extra: object = {}) =>
    prisma.event.create({ data: { calendarSourceId: src.id, externalUid: `e${n++}`, title, startTime: start, endTime: min(90, start), rawSourceData: {}, ...extra } });
  return { ws, home, park, alex, maya, tag, event, cleanup: () => prisma.workspace.delete({ where: { id: ws.id } }) };
}

test("automation: reminders and 'who's driving' flags, idempotent, self-resolving, follow moved events", async () => {
  const f = await family();
  try {
    const game = await f.event("U12 vs. Westview", h(48), { eventTagId: await f.tag("game"), participantId: f.maya.id, driverParticipantId: f.alex.id, placeId: f.park.id });
    await f.event("Far-off game", h(24 * 10), { eventTagId: await f.tag("game") });
    const practice = await f.event("U12 Practice", h(30), { eventTagId: await f.tag("practice"), participantId: f.maya.id, location: "Eastside Park" });
    await f.event("Covered practice", h(31), { eventTagId: await f.tag("practice"), participantId: f.maya.id, driverParticipantId: f.alex.id, location: "Eastside Park" });

    const first = await runAutomation(prisma, { now: NOW, workspaceId: f.ws.id });
    assert.equal(first.created, 2);
    const tasks = await prisma.task.findMany({ where: { workspaceId: f.ws.id, automationRuleId: { not: null } }, orderBy: { dueAt: "asc" } });
    const [flag, reminder] = tasks;
    assert.equal(flag!.title, "Who's driving to U12 Practice?");
    assert.equal(flag!.priority, "high");
    assert.equal(flag!.dueAt!.toISOString(), min(-720, practice.startTime).toISOString());
    assert.equal(reminder!.title, "Pack uniform & gear for U12 vs. Westview");
    assert.equal(reminder!.assignedParticipantId, f.alex.id, "reminder goes to the driver");
    assert.equal(reminder!.dueAt!.toISOString(), h(24).toISOString());

    assert.equal((await runAutomation(prisma, { now: NOW, workspaceId: f.ws.id })).created, 0, "no duplicates");

    // Someone claims the drive → the nag closes itself.
    await prisma.event.update({ where: { id: practice.id }, data: { driverParticipantId: f.alex.id } });
    // The game moves an hour later → its reminder moves too.
    await prisma.event.update({ where: { id: game.id }, data: { startTime: h(49), endTime: h(50.5) } });
    const second = await runAutomation(prisma, { now: NOW, workspaceId: f.ws.id });
    assert.deepEqual([second.resolved, second.rescheduled], [1, 1]);
    assert.ok((await prisma.task.findUniqueOrThrow({ where: { id: flag!.id } })).completedAt);
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: reminder!.id } })).dueAt!.toISOString(), h(25).toISOString());

    await prisma.automationRule.updateMany({ where: { workspaceId: f.ws.id }, data: { enabled: false } });
    await f.event("Another practice", h(20), { eventTagId: await f.tag("practice") });
    assert.equal((await runAutomation(prisma, { now: NOW, workspaceId: f.ws.id })).created, 0, "disabled rules do nothing");
  } finally {
    await f.cleanup();
  }
});

test("seasonal reminders: one task per occurrence, leadDays ahead, no pile-up", async () => {
  const f = await family();
  try {
    await prisma.recurringReminder.updateMany({ where: { workspaceId: f.ws.id }, data: { enabled: false } });
    const honeyDo = await prisma.taskList.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: f.ws.id, key: "honey_do" } } });
    await prisma.recurringReminder.create({
      data: { workspaceId: f.ws.id, title: "Rotate mattresses", rrule: "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=10", leadDays: 7, taskListId: honeyDo.id, assignedParticipantId: f.alex.id },
    });
    await prisma.recurringReminder.create({ data: { workspaceId: f.ws.id, title: "Not yet", rrule: "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=1", leadDays: 3 } });

    assert.equal((await runReminders(prisma, { now: NOW, workspaceId: f.ws.id })).created, 1);
    const [t] = await prisma.task.findMany({ where: { workspaceId: f.ws.id, recurringReminderId: { not: null } } });
    assert.equal(t!.title, "Rotate mattresses");
    assert.equal(t!.taskListId, honeyDo.id);
    assert.equal(t!.assignedParticipantId, f.alex.id);
    assert.equal(t!.occurrenceDate!.toISOString().slice(0, 10), "2031-03-10");
    assert.equal(t!.dueAt!.toISOString(), "2031-03-10T17:00:00.000Z", "midday Chicago (CDT from Mar 9)");

    assert.equal((await runReminders(prisma, { now: NOW, workspaceId: f.ws.id })).created, 0);
    // A year later with last year's task still open: don't stack another.
    assert.equal((await runReminders(prisma, { now: new Date("2032-03-05T12:00:00Z"), workspaceId: f.ws.id })).created, 0);
    await prisma.task.update({ where: { id: t!.id }, data: { completedAt: NOW } });
    assert.equal((await runReminders(prisma, { now: new Date("2032-03-05T12:00:00Z"), workspaceId: f.ws.id })).created, 1);
  } finally {
    await f.cleanup();
  }
});

test("leave-by: traffic re-checks, 'leave earlier' heads-up, one warning, to the driver", async () => {
  const app = await makeApp();
  const c = new Client(app);
  const me = await c.signup(`jobs-driver-${crypto.randomUUID().slice(0, 6)}`, { name: "Driver Family", vertical: "family" });
  const wsId = me.workspaceId!;
  const home = await prisma.place.create({ data: { workspaceId: wsId, name: "Home", kind: "home", latitude: 41.9, longitude: -87.65 } });
  const park = await prisma.place.create({ data: { workspaceId: wsId, name: "Eastside Park", kind: "activity", latitude: 41.94, longitude: -87.65, arrivalBufferMinutes: 5 } });
  const membership = await prisma.workspaceMembership.findFirstOrThrow({ where: { workspaceId: wsId, userId: me.user.id } });
  const alex = await prisma.participant.update({ where: { id: membership.participantId! }, data: { canDrive: true, homePlaceId: home.id } });
  const src = await prisma.calendarSource.create({ data: { workspaceId: wsId, type: "ics_feed" } });
  const start = new Date("2031-03-03T22:30:00Z"); // 4:30 PM CST
  const e = await prisma.event.create({ data: { calendarSourceId: src.id, externalUid: "p", title: "Soccer practice", startTime: start, endTime: min(90, start), placeId: park.id, driverParticipantId: alex.id, rawSourceData: {} } });
  await prisma.event.create({ data: { calendarSourceId: src.id, externalUid: "nodriver", title: "No driver yet", startTime: start, endTime: min(60, start), placeId: park.id, rawSourceData: {} } });

  let minutes = 20;
  const calls: Date[] = [];
  const traffic: TrafficProvider = { async drivingMinutes(_o, _d, at) { calls.push(at); return { trafficMinutes: minutes, typicalMinutes: 15 }; } };
  const run = (iso: string) => runDepartures(prisma, { traffic, live: true, now: new Date(iso), workspaceId: wsId });

  const r1 = await run("2031-03-03T21:00:00Z");
  assert.deepEqual(r1, { checked: 1, warned: 0, shifted: 0, skipped: 0 }, "the undriven event is ignored");
  let alert = await prisma.departureAlert.findFirstOrThrow({ where: { eventId: e.id } });
  assert.equal(alert.leaveBy.toISOString(), "2031-03-03T22:00:00.000Z", "4:30 − 5 parking − 20 drive − 5 out the door");
  assert.equal(alert.originLabel, "Home");
  assert.equal(alert.nextCheckAt!.toISOString(), "2031-03-03T21:15:00.000Z");

  assert.deepEqual(await run("2031-03-03T21:10:00Z"), { checked: 0, warned: 0, shifted: 0, skipped: 0 }, "not due for a re-check");

  minutes = 35; // traffic builds
  const r3 = await run("2031-03-03T21:16:00Z");
  assert.equal(r3.shifted, 1);
  alert = await prisma.departureAlert.findFirstOrThrow({ where: { eventId: e.id } });
  assert.equal(alert.leaveBy.toISOString(), "2031-03-03T21:45:00.000Z");

  assert.equal((await run("2031-03-03T21:36:00Z")).warned, 1);
  assert.equal((await run("2031-03-03T21:40:00Z")).warned, 0, "warned once");

  const feed = (await c.get("/me/notifications")).json();
  assert.equal(feed.unreadCount, 2);
  assert.deepEqual(feed.notifications.map((n: { kind: string }) => n.kind), ["leave_by", "leave_earlier"]);
  assert.equal(feed.notifications[0].title, "Leave by 3:45 PM — Soccer practice");
  assert.match(feed.notifications[0].body, /35 min drive from Home; 20 min longer than usual — heavy traffic/);
  assert.equal(feed.notifications[1].title, "Traffic: leave 15 min earlier for Soccer practice");
  assert.deepEqual((await c.post("/me/notifications/read", { all: true })).json(), { marked: 2 });
  assert.equal((await c.get("/me/notifications?unread=true")).json().unreadCount, 0);

  // Event moved after the warning → fresh check and a fresh warning for the new time.
  await prisma.event.update({ where: { id: e.id }, data: { startTime: min(60, start), endTime: min(150, start) } });
  const r5 = await run("2031-03-03T22:20:00Z");
  assert.deepEqual([r5.checked, r5.warned], [1, 0], "recomputed for 5:30; new leave-by 4:45, too early to warn");
  assert.equal((await prisma.departureAlert.findFirstOrThrow({ where: { eventId: e.id } })).leaveBy.toISOString(), "2031-03-03T22:45:00.000Z");
  assert.equal((await run("2031-03-03T22:36:00Z")).warned, 1, "fresh warning for the new time");
});

test("leave-by without a Maps key says it's an estimate", async () => {
  const f = await family();
  try {
    const member = await prisma.user.create({ data: { email: `jobs-est-${crypto.randomUUID().slice(0, 6)}@api-test.test`, passwordHash: "x" } });
    await prisma.workspaceMembership.create({ data: { userId: member.id, workspaceId: f.ws.id, role: "owner" } }); // Alex has no login → owners hear
    await f.event("Game", new Date("2031-03-03T13:00:00Z"), { placeId: f.park.id, driverParticipantId: f.alex.id });
    // 7 AM CST game, ~10 min drive → leave ≈ 6:40; the warning fires from ≈ 6:30.
    await runDepartures(prisma, { traffic: estimateOnlyTraffic, live: false, now: min(35), workspaceId: f.ws.id });
    const [n] = await prisma.notification.findMany({ where: { userId: member.id } });
    assert.match(n!.body, /estimate — no live traffic/);
    await prisma.user.delete({ where: { id: member.id } });
  } finally {
    await f.cleanup();
  }
});

test("email delivery: opted-in only, stale alerts dropped, failures recorded", async () => {
  const f = await family();
  const u = await prisma.user.create({ data: { email: `jobs-mail-${crypto.randomUUID().slice(0, 6)}@api-test.test`, passwordHash: "x", emailNotifications: true } });
  try {
    const sent: { to: string; subject: string }[] = [];
    const email: EmailSender = { async send(m) { sent.push(m); } };
    const mk = (key: string, sendAt: Date) =>
      prisma.notification.create({ data: { userId: u.id, workspaceId: f.ws.id, channel: "email", title: key, body: "b", dedupeKey: key, sendAt } });
    await mk("fresh", NOW);
    await mk("stale", min(-60));
    const r = await deliverPending(prisma, { email, now: NOW });
    assert.equal(r.sent, 1);
    assert.deepEqual(sent.map((s) => s.subject), ["fresh"]);
    assert.equal((await prisma.notification.findFirstOrThrow({ where: { userId: u.id, dedupeKey: "stale" } })).error, "expired before it could be sent");
  } finally {
    await prisma.user.delete({ where: { id: u.id } });
    await f.cleanup();
  }
});

test("scheduler: cadence per job; one failure doesn't stop the rest", async () => {
  const ran: string[] = [];
  const logs: string[] = [];
  const s = new JobScheduler(
    [
      { name: "fast", everySeconds: 60, run: async () => void ran.push("fast") },
      { name: "boom", everySeconds: 60, run: async () => { throw new Error("db down"); } },
      { name: "slow", everySeconds: 3600, run: async () => void ran.push("slow") },
    ],
    (m) => logs.push(m),
  );
  const t0 = 1_000_000;
  assert.deepEqual(await s.tick(t0), ["fast", "boom", "slow"]);
  assert.deepEqual(await s.tick(t0 + 30_000), []);
  assert.deepEqual(await s.tick(t0 + 61_000), ["fast", "boom"]);
  assert.deepEqual(ran, ["fast", "slow", "fast"]);
  assert.ok(logs.includes("boom failed"));
});
