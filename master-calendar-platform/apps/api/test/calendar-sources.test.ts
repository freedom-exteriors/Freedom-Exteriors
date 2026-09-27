import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, FakeFeed, makeApp, prisma } from "./helpers.js";
import { FeedError } from "../src/ingestion/safe-fetch.js";
import { Crypter } from "../src/lib/crypto.js";
import { TEST_KEY } from "./helpers.js";

const fixture = readFileSync(path.join(import.meta.dirname, "fixtures/eastside.ics"), "utf8");

async function family(feed: FakeFeed) {
  const app = await makeApp({}, { feedFetcher: feed.fetcher });
  const owner = new Client(app);
  const { workspaceId } = await owner.signup(`cs-owner-${crypto.randomUUID().slice(0, 6)}`, { name: "Feed Family", vertical: "family" });
  const base = `/workspaces/${workspaceId}/calendar-sources`;
  return { app, owner, workspaceId: workspaceId!, base };
}

test("connect a feed: first sync runs immediately; URL is never echoed back", async () => {
  const feed = new FakeFeed(fixture);
  const { owner, base } = await family(feed);
  const res = await owner.post(base, { name: "Eastside FC", feedUrl: "webcal://feeds.example/team/SECRET-TOKEN.ics" });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().stats.created > 0, true);
  assert.equal(feed.requests[0]!.url, "https://feeds.example/team/SECRET-TOKEN.ics");

  const list = (await owner.get(base)).json();
  assert.equal(list[0].feed, "feeds.example/…");
  assert.ok(!JSON.stringify(list).includes("SECRET-TOKEN"));
  assert.equal(list[0].eventCount, res.json().stats.created);
  assert.equal((await owner.post(base, { feedUrl: "https://feeds.example/team/SECRET-TOKEN.ics" })).statusCode, 409, "duplicate");
});

test("bad links fail up front with a readable message and leave nothing behind", async () => {
  const feed = new FakeFeed(fixture);
  const { owner, base, workspaceId } = await family(feed);
  const local = await owner.post(base, { feedUrl: "http://localhost:8080/admin" });
  assert.equal(local.statusCode, 400);
  feed.error = new FeedError("That link is a web page, not a calendar feed. Look for “Subscribe”, “iCal” or “.ics”.");
  const page = await owner.post(base, { feedUrl: "https://www.example.com/team-page" });
  assert.equal(page.statusCode, 422);
  assert.match(page.json().message, /web page, not a calendar/);
  assert.equal(await prisma.calendarSource.count({ where: { workspaceId } }), 0);
});

test("password-protected feeds: credentials encrypted at rest and sent only to the fetcher", async () => {
  const feed = new FakeFeed(fixture);
  const { owner, base, workspaceId } = await family(feed);
  assert.equal((await owner.post(base, { feedUrl: "https://cal.example/private.ics", username: "coach", password: "s3cret-pw" })).statusCode, 201);
  assert.deepEqual(feed.requests[0]!.req?.auth, { username: "coach", password: "s3cret-pw" });
  const row = await prisma.calendarSource.findFirstOrThrow({ where: { workspaceId } });
  assert.ok(!Buffer.from(row.feedPasswordEnc!).toString("latin1").includes("s3cret-pw"));
  assert.equal(new Crypter(TEST_KEY).decrypt(row.feedPasswordEnc!), "s3cret-pw");
  assert.equal((await owner.get(base)).json()[0].hasCredentials, true);
});

test("roles, cross-workspace ids, fill-in defaults, manual sync cooldown, delete", async () => {
  const feed = new FakeFeed(fixture);
  const { app, owner, base, workspaceId } = await family(feed);
  const other = await family(new FakeFeed(fixture));
  const strangerParticipant = await prisma.participant.create({ data: { workspaceId: other.workspaceId, name: "Not yours", color: "#000000" } });

  assert.equal((await owner.post(base, { feedUrl: "https://feeds.example/a.ics", defaultParticipantId: strangerParticipant.id })).statusCode, 400, "participant from another workspace");
  const { id } = (await owner.post(base, { feedUrl: "https://feeds.example/a.ics" })).json();

  // Viewer can see calendars but not change them.
  const viewer = new Client(app);
  await viewer.signup(`cs-viewer-${crypto.randomUUID().slice(0, 6)}`);
  const { token } = (await owner.post(`/workspaces/${workspaceId}/invites`, { role: "viewer" })).json();
  await viewer.post(`/invites/${token}/accept`);
  assert.equal((await viewer.get(base)).statusCode, 200);
  assert.equal((await viewer.post(base, { feedUrl: "https://feeds.example/b.ics" })).statusCode, 403);
  assert.equal((await viewer.del(`${base}/${id}`)).statusCode, 403);

  // "All events from this feed are Maya's" — fills only unassigned events.
  const maya = await prisma.participant.create({ data: { workspaceId, name: "Maya", color: "#DB2777" } });
  const leo = await prisma.participant.create({ data: { workspaceId, name: "Leo", color: "#EA580C" } });
  const oneEvent = await prisma.event.findFirstOrThrow({ where: { calendarSourceId: id } });
  await prisma.event.update({ where: { id: oneEvent.id }, data: { participantId: leo.id } });
  const patched = (await owner.patch(`${base}/${id}`, { defaultParticipantId: maya.id, applyToExisting: true })).json();
  const total = await prisma.event.count({ where: { calendarSourceId: id } });
  assert.equal(patched.assigned, total - 1);
  assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: oneEvent.id } })).participantId, leo.id, "Leo's event untouched");

  assert.equal((await owner.post(`${base}/${id}/sync`)).statusCode, 429, "just synced");
  await prisma.calendarSource.update({ where: { id }, data: { lastSyncedAt: new Date(Date.now() - 10 * 60_000) } });
  assert.equal((await owner.post(`${base}/${id}/sync`)).statusCode, 200);

  assert.equal((await owner.del(`${base}/${id}`)).statusCode, 204);
  assert.equal(await prisma.event.count({ where: { calendarSourceId: id } }), 0);
  assert.equal((await other.owner.get(`/workspaces/${workspaceId}/calendar-sources`)).statusCode, 404);
});
