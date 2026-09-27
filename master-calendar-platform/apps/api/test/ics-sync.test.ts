import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWorkspaceFromTemplate } from "@mcp/db";
import { syncIcsSource } from "../src/ingestion/ics-sync.js";
import { runDueSyncs } from "../src/ingestion/sync-runner.js";
import { FeedError } from "../src/ingestion/safe-fetch.js";
import { FakeFeed, prisma } from "./helpers.js";

const fixture = readFileSync(path.join(import.meta.dirname, "fixtures/eastside.ics"), "utf8");
const now = () => new Date("2026-09-27T12:00:00Z");

async function setup(body = fixture) {
  const ws = await createWorkspaceFromTemplate(prisma, { name: `sync-${crypto.randomUUID()}`, vertical: "family" });
  const maya = await prisma.participant.create({ data: { workspaceId: ws.id, name: "Maya", color: "#DB2777" } });
  const alex = await prisma.participant.create({ data: { workspaceId: ws.id, name: "Alex", color: "#2563EB" } });
  const practiceTag = await prisma.eventTagDefinition.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: ws.id, key: "practice" } } });
  const source = await prisma.calendarSource.create({
    data: { workspaceId: ws.id, type: "ics_feed", feedUrl: "https://feeds.example/eastside.ics", defaultParticipantId: maya.id, defaultEventTagId: practiceTag.id },
  });
  const feed = new FakeFeed(body);
  const deps = { fetchFeed: feed.fetcher, crypter: null, now };
  return { ws, maya, alex, source, feed, deps, cleanup: () => prisma.workspace.delete({ where: { id: ws.id } }) };
}

test("first sync creates events with the source's defaults; re-sync is a no-op", async () => {
  const s = await setup();
  try {
    const first = await syncIcsSource(prisma, s.source.id, s.deps);
    assert.deepEqual([first.created, first.updated, first.deleted], [12, 0, 0]);
    const events = await prisma.event.findMany({ where: { calendarSourceId: s.source.id } });
    assert.ok(events.every((e) => e.participantId === s.maya.id && e.eventTagId === s.source.defaultEventTagId));

    const second = await syncIcsSource(prisma, s.source.id, s.deps);
    assert.deepEqual([second.created, second.updated, second.deleted, second.unchanged], [0, 0, 0, 12]);
    assert.equal(await prisma.event.count({ where: { calendarSourceId: s.source.id } }), 12);

    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: s.source.id } });
    assert.equal(src.lastSyncError, null);
    assert.equal(src.nextSyncAt!.getTime() >= now().getTime() + 30 * 60_000, true, "next poll ≥ 30 min out");
  } finally {
    await s.cleanup();
  }
});

test("feed changes update in place, deletions propagate, and people's choices survive", async () => {
  const s = await setup();
  try {
    await syncIcsSource(prisma, s.source.id, s.deps);
    const game = await prisma.event.findFirstOrThrow({ where: { calendarSourceId: s.source.id, externalUid: "game-1@eastside" } });
    const place = await prisma.place.create({ data: { workspaceId: s.ws.id, name: "Westview", latitude: 41.9, longitude: -87.7 } });
    // A person reassigns the game to Alex, sets a driver and a geocoded place.
    await prisma.event.update({ where: { id: game.id }, data: { participantId: s.alex.id, driverParticipantId: s.alex.id, placeId: place.id, eventTagId: null } });

    s.feed.body = fixture
      .replace("SUMMARY:U12 vs. Westview", "SUMMARY:U12 vs. Westview (rescheduled)")
      .replace("DTSTART:20261010T150000Z", "DTSTART:20261010T170000Z")
      .replace("DTEND:20261010T163000Z", "DTEND:20261010T183000Z")
      .replace("LOCATION:Westview HS", "LOCATION:Westview HS — Field B")
      .replace(/BEGIN:VEVENT\r\nUID:picture-day@eastside[\s\S]*?END:VEVENT\r\n/, "");
    const stats = await syncIcsSource(prisma, s.source.id, s.deps);
    assert.deepEqual([stats.created, stats.updated, stats.deleted], [0, 1, 1]);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: game.id } });
    assert.equal(after.title, "U12 vs. Westview (rescheduled)");
    assert.equal(after.startTime.toISOString(), "2026-10-10T17:00:00.000Z");
    assert.equal(after.participantId, s.alex.id, "person's assignment kept");
    assert.equal(after.driverParticipantId, s.alex.id, "driver kept");
    assert.equal(after.eventTagId, null, "person's un-tagging kept");
    assert.equal(after.placeId, null, "location text changed → place re-resolved");
    assert.equal(await prisma.event.count({ where: { calendarSourceId: s.source.id, externalUid: "picture-day@eastside" } }), 0);
  } finally {
    await s.cleanup();
  }
});

test("an empty feed doesn't wipe the calendar", async () => {
  const s = await setup();
  try {
    await syncIcsSource(prisma, s.source.id, s.deps);
    s.feed.body = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
    const stats = await syncIcsSource(prisma, s.source.id, s.deps);
    assert.equal(stats.deleted, 0);
    assert.match(stats.warning!, /came back empty/);
    assert.equal(await prisma.event.count({ where: { calendarSourceId: s.source.id } }), 12);
  } finally {
    await s.cleanup();
  }
});

test("scheduler: runs due feeds once, backs off on failure, never double-claims", async () => {
  const s = await setup();
  try {
    const run = () => runDueSyncs(prisma, { ...s.deps, google: null, limit: 1000 });
    await Promise.all([run(), run()]);
    assert.equal(s.feed.requests.length, 1, "claimed by exactly one runner");
    await run();
    assert.equal(s.feed.requests.length, 1, "not due again for 30 minutes");

    await prisma.calendarSource.update({ where: { id: s.source.id }, data: { nextSyncAt: new Date("2026-09-27T11:00:00Z") } });
    s.feed.error = new FeedError("That calendar link no longer exists");
    await run();
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: s.source.id } });
    assert.equal(src.lastSyncError, "That calendar link no longer exists");
    assert.equal(src.nextSyncAt!.toISOString(), "2026-09-27T13:00:00.000Z", "60-minute backoff");
    assert.equal(await prisma.event.count({ where: { calendarSourceId: s.source.id } }), 12, "failure keeps existing events");
  } finally {
    await s.cleanup();
  }
});
