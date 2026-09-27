import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client, makeApp, prisma } from "./helpers.js";
import { FakeGoogle, day } from "./fake-google.js";
import { toOccurrence } from "../src/integrations/google-sync.js";
import { runDueSyncs } from "../src/ingestion/sync-runner.js";
import { Crypter } from "../src/lib/crypto.js";
import { TEST_KEY } from "./helpers.js";

const FAMILY_CAL = "family123@group.calendar.google.com";

async function setup() {
  const google = new FakeGoogle();
  const app = await makeApp({}, { google });
  const alex = new Client(app);
  const { workspaceId } = await alex.signup(`g-alex-${crypto.randomUUID().slice(0, 6)}`, { name: "Google Family", vertical: "family" });
  const base = `/workspaces/${workspaceId}/integrations/google`;
  /** Runs the whole OAuth dance for `who`; returns the redirect Location. */
  const connect = async (who: Client, code = "good-code") => {
    const { url } = (await who.post(`${base}/start`)).json();
    const state = new URL(url).searchParams.get("state")!;
    const res = await who.get(`/integrations/google/callback?state=${state}&code=${code}`);
    assert.equal(res.statusCode, 302);
    return new URL(res.headers.location as string);
  };
  return { app, google, alex, workspaceId: workspaceId!, base, connect };
}

test("Google event mapping: times, all-day, recurring identity, skipped kinds", () => {
  const g = new FakeGoogle();
  const occ = g.events[FAMILY_CAL]!.map((e) => toOccurrence(e, "America/Chicago"));
  const [dentist, noschool, piano1, piano2, cancelled, wfh] = occ;
  assert.equal(dentist!.externalRecurrenceId, "");
  assert.equal(noschool!.allDay, true);
  assert.equal(noschool!.startTime.toISOString(), `${day(5)}T05:00:00.000Z`, "local midnight, Chicago (CDT)");
  assert.equal(piano1!.externalUid, "piano");
  assert.notEqual(piano1!.externalRecurrenceId, piano2!.externalRecurrenceId);
  assert.equal(piano2!.title, "Piano (moved)");
  assert.equal(cancelled, null);
  assert.equal(wfh, null);
});

test("OAuth: PKCE + single-use state; tokens stored encrypted; account identified", async () => {
  const { google, alex, base, workspaceId, connect } = await setup();
  const { url } = (await alex.post(`${base}/start`)).json();
  const u = new URL(url);
  const state = u.searchParams.get("state")!;
  const row = await prisma.oAuthState.findFirstOrThrow({ where: { workspaceId } });
  assert.notEqual(row.stateHash, state, "state stored hashed");
  assert.equal(u.searchParams.get("code_challenge"), createHash("sha256").update(row.codeVerifier).digest("base64url"));

  const done = await alex.get(`/integrations/google/callback?state=${state}&code=good-code`);
  const loc = new URL(done.headers.location as string);
  assert.equal(loc.pathname, `/w/${workspaceId}/settings/calendars`);
  assert.equal(loc.searchParams.get("google"), "connected");
  assert.deepEqual(google.exchanges, [row.codeVerifier], "verifier sent with the code");

  const conn = await prisma.oAuthConnection.findFirstOrThrow({ where: { workspaceId } });
  assert.equal(conn.accountEmail, "alex.rivera@gmail.com");
  assert.ok(!Buffer.from(conn.refreshTokenEnc).toString("latin1").includes("refresh-1"));
  assert.equal(new Crypter(TEST_KEY).decrypt(conn.refreshTokenEnc), "refresh-1");

  // Replaying the same state fails.
  const replay = new URL((await alex.get(`/integrations/google/callback?state=${state}&code=good-code`)).headers.location as string);
  assert.equal(replay.searchParams.get("reason"), "expired");
  // Connecting the same Google account again updates, not duplicates.
  await connect(alex);
  assert.equal(await prisma.oAuthConnection.count({ where: { workspaceId } }), 1);
});

test("OAuth failures: wrong browser user, denied consent, calendar box unticked", async () => {
  const { app, google, alex, base } = await setup();
  const start = async () => new URL((await alex.post(`${base}/start`)).json().url).searchParams.get("state")!;

  const mallory = new Client(app);
  await mallory.signup(`g-mallory-${crypto.randomUUID().slice(0, 6)}`);
  const s1 = await start();
  const wrong = new URL((await mallory.get(`/integrations/google/callback?state=${s1}&code=good-code`)).headers.location as string);
  assert.equal(wrong.searchParams.get("reason"), "wrong_account");

  const s2 = await start();
  const denied = new URL((await alex.get(`/integrations/google/callback?state=${s2}&error=access_denied`)).headers.location as string);
  assert.equal(denied.searchParams.get("reason"), "denied");

  google.scope = "openid email";
  const s3 = await start();
  const noCal = new URL((await alex.get(`/integrations/google/callback?state=${s3}&code=good-code`)).headers.location as string);
  assert.equal(noCal.searchParams.get("reason"), "calendar_scope_missing");
  assert.equal(google.revoked.length, 1, "partial grant is revoked, not kept");
  assert.equal(await prisma.oAuthConnection.count({ where: { connectedByUserId: (await alex.get("/auth/me")).json().user.id } }), 0);
});

test("pick calendars: only the account's owner can; events sync with the shared rules", async () => {
  const { app, google, alex, base, workspaceId, connect } = await setup();
  const connectionId = (await connect(alex)).searchParams.get("connectionId")!;

  // Another adult in the family can't browse Alex's Google calendars.
  const sam = new Client(app);
  await sam.signup(`g-sam-${crypto.randomUUID().slice(0, 6)}`);
  const { token } = (await alex.post(`/workspaces/${workspaceId}/invites`, { role: "member" })).json();
  await sam.post(`/invites/${token}/accept`);
  assert.equal((await sam.get(`${base}/${connectionId}/calendars`)).statusCode, 403);
  assert.equal((await sam.get(base)).json()[0].mine, false);

  const cals = (await alex.get(`${base}/${connectionId}/calendars`)).json();
  assert.equal(cals.length, 2);
  const add = await alex.post(`${base}/${connectionId}/calendars`, {
    calendars: [{ calendarId: FAMILY_CAL }, { calendarId: "someone-elses@gmail.com" }],
  });
  assert.equal(add.statusCode, 201);
  const [ok, notMine] = add.json().results;
  assert.equal(ok.ok, true);
  assert.equal(ok.stats.created, 4, "dentist, no school, 2 piano instances; cancelled + working-location skipped");
  assert.equal(notMine.ok, false);

  assert.equal((await alex.post(`${base}/${connectionId}/calendars`, { calendars: [{ calendarId: FAMILY_CAL }] })).json().results[0].error, "Already added");
  assert.equal((await alex.get(`${base}/${connectionId}/calendars`)).json().find((c: { id: string }) => c.id === FAMILY_CAL).sourceId, ok.sourceId);

  // Sam sees the events' calendar in the workspace list (it's shared with the family)...
  const sources = (await sam.get(`/workspaces/${workspaceId}/calendar-sources`)).json();
  assert.equal(sources[0].googleAccount.email, "alex.rivera@gmail.com");
  // ...and a moved instance updates in place on the next sync.
  google.events[FAMILY_CAL]![2]!.summary = "Piano lesson";
  await prisma.calendarSource.update({ where: { id: ok.sourceId }, data: { lastSyncedAt: new Date(Date.now() - 600_000) } });
  const resync = (await alex.post(`/workspaces/${workspaceId}/calendar-sources/${ok.sourceId}/sync`)).json();
  assert.deepEqual([resync.stats.created, resync.stats.updated, resync.stats.deleted], [0, 1, 0]);
});

test("token refresh, revoked access → reconnect, and disconnect", async () => {
  const { app, google, alex, base, workspaceId, connect } = await setup();
  const connectionId = (await connect(alex)).searchParams.get("connectionId")!;
  const { results } = (await alex.post(`${base}/${connectionId}/calendars`, { calendars: [{ calendarId: FAMILY_CAL }] })).json();
  const sourceId = results[0].sourceId as string;
  const deps = { fetchFeed: app.feedFetcher, crypter: app.crypter, google, limit: 1000 };

  // Expired access token → refreshed transparently and stored (encrypted).
  await prisma.oAuthConnection.update({ where: { id: connectionId }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
  await prisma.calendarSource.update({ where: { id: sourceId }, data: { nextSyncAt: new Date(Date.now() - 1000) } });
  await runDueSyncs(prisma, deps);
  assert.equal(google.refreshCalls, 1);
  const refreshed = await prisma.oAuthConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.ok(refreshed.tokenExpiresAt > new Date());
  assert.equal(google.tokensSeen.at(-1), new Crypter(TEST_KEY).decrypt(refreshed.accessTokenEnc));

  // The person revokes access in their Google account.
  google.revokeAccess();
  await prisma.oAuthConnection.update({ where: { id: connectionId }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
  await prisma.calendarSource.update({ where: { id: sourceId }, data: { nextSyncAt: new Date(Date.now() - 1000) } });
  await runDueSyncs(prisma, deps);
  assert.equal((await prisma.oAuthConnection.findUniqueOrThrow({ where: { id: connectionId } })).status, "needs_reauth");
  const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.match(src.lastSyncError!, /reconnect/i);
  assert.ok((await prisma.event.count({ where: { calendarSourceId: sourceId } })) > 0, "existing events kept");
  const before = google.refreshCalls;
  await prisma.calendarSource.update({ where: { id: sourceId }, data: { nextSyncAt: new Date(Date.now() - 1000) } });
  await runDueSyncs(prisma, deps);
  assert.equal(google.refreshCalls, before, "paused until reconnect — no hammering Google");

  // Reconnect clears it.
  google.refreshError = null;
  await connect(alex);
  assert.equal((await prisma.oAuthConnection.findUniqueOrThrow({ where: { id: connectionId } })).status, "active");
  assert.equal((await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } })).lastSyncError, null);

  // Disconnect revokes at Google and removes the calendars + events.
  assert.equal((await alex.del(`${base}/${connectionId}`)).statusCode, 204);
  assert.ok(google.revoked.includes("refresh-1"));
  assert.equal(await prisma.calendarSource.count({ where: { id: sourceId } }), 0);
  assert.equal(await prisma.event.count({ where: { calendarSourceId: sourceId } }), 0);
});

test("Google not configured → a clear 503", async () => {
  const app = await makeApp({}, { google: null });
  const c = new Client(app);
  const { workspaceId } = await c.signup(`g-off-${crypto.randomUUID().slice(0, 6)}`, { name: "No Google", vertical: "family" });
  const res = await c.post(`/workspaces/${workspaceId}/integrations/google/start`);
  assert.equal(res.statusCode, 503);
  assert.match(res.json().message, /isn't set up/);
});
