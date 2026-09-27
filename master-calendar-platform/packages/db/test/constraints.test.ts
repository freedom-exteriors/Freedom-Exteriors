// Integration tests against DATABASE_URL (a disposable dev DB). Each test builds and
// tears down its own workspace.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { addHomeToCircle, createPrismaClient, createWorkspaceFromTemplate } from "../src/index.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });
const prisma = createPrismaClient();
after(() => prisma.$disconnect());

async function withWorkspace(fn: (workspaceId: string, sourceId: string) => Promise<void>) {
  const ws = await createWorkspaceFromTemplate(prisma, { name: `test-${crypto.randomUUID()}`, vertical: "family" });
  try {
    const src = await prisma.calendarSource.create({ data: { workspaceId: ws.id, type: "ics_feed" } });
    await fn(ws.id, src.id);
  } finally {
    await prisma.workspace.delete({ where: { id: ws.id } });
  }
}

const baseEvent = { title: "Practice", startTime: new Date("2026-10-01T22:00:00Z"), endTime: new Date("2026-10-01T23:30:00Z"), rawSourceData: {} };

test("template seeding creates tags and rules", async () => {
  await withWorkspace(async (workspaceId) => {
    assert.equal(await prisma.eventTagDefinition.count({ where: { workspaceId } }), 6);
    assert.equal(await prisma.automationRule.count({ where: { workspaceId } }), 3);
  });
});

test("non-recurring events upsert on the unique key instead of duplicating", async () => {
  await withWorkspace(async (_ws, calendarSourceId) => {
    const where = { calendarSourceId_externalUid_externalRecurrenceId: { calendarSourceId, externalUid: "abc", externalRecurrenceId: "" } };
    await prisma.event.upsert({ where, create: { calendarSourceId, externalUid: "abc", ...baseEvent }, update: {} });
    await prisma.event.upsert({ where, create: { calendarSourceId, externalUid: "abc", ...baseEvent }, update: { title: "Renamed" } });
    const rows = await prisma.event.findMany({ where: { calendarSourceId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.title, "Renamed");
  });
});

test("recurring instances with distinct recurrence ids coexist", async () => {
  await withWorkspace(async (_ws, calendarSourceId) => {
    await prisma.event.createMany({
      data: ["2026-10-01T22:00:00.000Z", "2026-10-08T22:00:00.000Z"].map((rid) => ({
        calendarSourceId, externalUid: "series", externalRecurrenceId: rid, ...baseEvent,
      })),
    });
    assert.equal(await prisma.event.count({ where: { calendarSourceId } }), 2);
  });
});

test("rule engine cannot create the same task twice for one rule+event", async () => {
  await withWorkspace(async (workspaceId, calendarSourceId) => {
    const ev = await prisma.event.create({ data: { calendarSourceId, externalUid: "x", ...baseEvent } });
    const rule = await prisma.automationRule.findFirstOrThrow({ where: { workspaceId } });
    const data = { workspaceId, eventId: ev.id, automationRuleId: rule.id, title: "t" };
    await prisma.task.create({ data });
    await assert.rejects(prisma.task.create({ data }), /Unique constraint/);
  });
});

test("template seeding creates lists and seasonal reminders on their target lists", async () => {
  await withWorkspace(async (workspaceId) => {
    const honeyDo = await prisma.taskList.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId, key: "honey_do" } } });
    assert.ok(await prisma.shoppingList.count({ where: { workspaceId, key: "groceries" } }));
    assert.ok(await prisma.recurringReminder.count({ where: { workspaceId, taskListId: honeyDo.id } }) > 0);
  });
});

test("a recurring reminder generates at most one task per occurrence", async () => {
  await withWorkspace(async (workspaceId) => {
    const reminder = await prisma.recurringReminder.findFirstOrThrow({ where: { workspaceId } });
    const data = { workspaceId, recurringReminderId: reminder.id, occurrenceDate: new Date("2026-10-15"), title: reminder.title };
    await prisma.task.create({ data });
    await assert.rejects(prisma.task.create({ data }), /Unique constraint/);
    await prisma.task.create({ data: { ...data, occurrenceDate: new Date("2027-10-15") } });
  });
});

test("goal progress is derived from its milestone tasks", async () => {
  await withWorkspace(async (workspaceId) => {
    const goal = await prisma.goal.create({
      data: {
        workspaceId, title: "Clean garage", horizon: "short_term",
        milestones: { create: [{ workspaceId, title: "a", completedAt: new Date() }, { workspaceId, title: "b" }] },
      },
    });
    const [done, total] = await Promise.all([
      prisma.task.count({ where: { goalId: goal.id, completedAt: { not: null } } }),
      prisma.task.count({ where: { goalId: goal.id } }),
    ]);
    assert.deepEqual([done, total], [1, 2]);
  });
});

test("a participant can be claimed by at most one login", async () => {
  await withWorkspace(async (workspaceId) => {
    const p = await prisma.participant.create({ data: { workspaceId, name: "Kid", color: "#000000" } });
    const [u1, u2] = await Promise.all([1, 2].map((n) =>
      prisma.user.create({ data: { email: `t${n}-${crypto.randomUUID()}@x.test`, passwordHash: "x" } })));
    try {
      await prisma.workspaceMembership.create({ data: { userId: u1!.id, workspaceId, role: "viewer", participantId: p.id } });
      await assert.rejects(
        prisma.workspaceMembership.create({ data: { userId: u2!.id, workspaceId, role: "viewer", participantId: p.id } }),
        /Unique constraint/,
      );
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [u1!.id, u2!.id] } } });
    }
  });
});

test("deleting a workspace cascades to its events and tasks", async () => {
  const ws = await createWorkspaceFromTemplate(prisma, { name: "cascade-test", vertical: "business" });
  const src = await prisma.calendarSource.create({ data: { workspaceId: ws.id, type: "ics_feed" } });
  const ev = await prisma.event.create({ data: { calendarSourceId: src.id, externalUid: "c", ...baseEvent } });
  await prisma.task.create({ data: { workspaceId: ws.id, eventId: ev.id, title: "t" } });
  await prisma.workspace.delete({ where: { id: ws.id } });
  assert.equal(await prisma.event.count({ where: { id: ev.id } }), 0);
  assert.equal(await prisma.task.count({ where: { workspaceId: ws.id } }), 0);
});

test("a home joins a circle once, and only homes can join circles", async () => {
  const [home, otherHome, circle] = await Promise.all([
    createWorkspaceFromTemplate(prisma, { name: "home-a", vertical: "family" }),
    createWorkspaceFromTemplate(prisma, { name: "home-b", vertical: "family" }),
    createWorkspaceFromTemplate(prisma, { name: "circle", vertical: "family", kind: "circle" }),
  ]);
  try {
    assert.equal(circle.kind, "circle");
    assert.ok(await prisma.taskList.count({ where: { workspaceId: circle.id, key: "bring_list" } }));
    await addHomeToCircle(prisma, { circleId: circle.id, homeWorkspaceId: home.id, color: "#111111" });
    await assert.rejects(addHomeToCircle(prisma, { circleId: circle.id, homeWorkspaceId: home.id, color: "#111111" }), /Unique constraint/);
    await assert.rejects(addHomeToCircle(prisma, { circleId: otherHome.id, homeWorkspaceId: home.id, color: "#111111" }), /not a circle/);
    await assert.rejects(addHomeToCircle(prisma, { circleId: circle.id, homeWorkspaceId: circle.id, color: "#111111" }), /only homes/);
  } finally {
    await prisma.workspace.deleteMany({ where: { id: { in: [home.id, otherHome.id, circle.id] } } });
  }
});
