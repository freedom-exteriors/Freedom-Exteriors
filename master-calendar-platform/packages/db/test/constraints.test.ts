// Integration tests against DATABASE_URL (a disposable dev DB). Each test builds and
// tears down its own workspace.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPrismaClient, createWorkspaceFromTemplate } from "../src/index.js";

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
