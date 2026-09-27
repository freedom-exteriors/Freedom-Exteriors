import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, makeApp } from "./helpers.js";
import type { Geocoder } from "../src/routes/people.js";
import { isoDate, todayIn } from "../src/lib/recurrence.js";
import { localDay } from "@mcp/planner";

const geocoder: Geocoder = async (address) =>
  /target/i.test(address) ? { lat: 41.943, lng: -87.652, formattedAddress: "Target, Clark St, Chicago", googlePlaceId: "gp-target" } : null;

/** Tomorrow in Chicago, as YYYY-MM-DD, so plans never land in the past. */
function tomorrow() {
  const t = todayIn("America/Chicago");
  const d = localDay(t.year, t.month, t.day + 1, "America/Chicago");
  return isoDate(d);
}

async function setup(opts: { withHome?: boolean } = {}) {
  const app = await makeApp({}, { geocoder });
  const c = new Client(app);
  const { workspaceId } = await c.signup(`pl-${crypto.randomUUID().slice(0, 6)}`, { name: "Plan Family", vertical: "family" });
  const ws = workspaceId!;
  const alex = (await c.post(`/workspaces/${ws}/participants`, { name: "Alex", canDrive: true })).json();
  if (opts.withHome !== false) {
    await c.post(`/workspaces/${ws}/places`, { name: "Home", kind: "home", latitude: 41.9, longitude: -87.65 });
  }
  await c.put(`/workspaces/${ws}/participants/${alex.id}/availability`, {
    windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: "08:00", end: "21:00" })),
  });
  return { app, c, ws, alex };
}

test("people & places: colors, availability, geocoding, first home becomes everyone's start", async () => {
  const { c, ws, alex } = await setup();
  const people = (await c.get(`/workspaces/${ws}/participants`)).json();
  const a = people.find((p: { id: string }) => p.id === alex.id);
  assert.equal(a.availability.length, 7);
  assert.equal(a.availability[0].startMinute, 480);
  assert.equal(a.homePlace.name, "Home", "attached when the home place was created");
  const leo = (await c.post(`/workspaces/${ws}/participants`, { name: "Leo" })).json();
  assert.ok(leo.homePlaceId, "new people start from home");
  assert.notEqual(leo.color, alex.color);

  const target = await c.post(`/workspaces/${ws}/places`, { name: "Target", kind: "store", address: "Target Clark St", openingHours: [{ dayOfWeek: 1, open: "08:00", close: "22:00" }] });
  assert.equal(target.statusCode, 201);
  assert.equal(target.json().latitude, 41.943);
  assert.deepEqual(target.json().openingHours, [{ dayOfWeek: 1, startMinute: 480, endMinute: 1320 }]);
  assert.equal((await c.post(`/workspaces/${ws}/places`, { name: "?", address: "nowhere at all" })).json().error, "address_not_found");
  assert.equal((await c.put(`/workspaces/${ws}/participants/${alex.id}/availability`, { windows: [{ dayOfWeek: 1, start: "21:00", end: "08:00" }] })).statusCode, 400);
});

test("organizer: plan → suggestions (not assignments) → accept → re-plan keeps it → move → dismiss", async () => {
  const { c, ws, alex } = await setup();
  const target = (await c.post(`/workspaces/${ws}/places`, { name: "Target", kind: "store", address: "Target Clark St" })).json();
  const T = `/workspaces/${ws}/tasks`;
  const hinge = (await c.post(T, { title: "Fix hinge", estimatedMinutes: 20 })).json();
  const pickup = (await c.post(T, { title: "Target pickup", estimatedMinutes: 20, locationKind: "errand", placeId: target.id })).json();
  const honeyDo = (await c.get(`/workspaces/${ws}/task-lists`)).json().find((l: { key: string }) => l.key === "honey_do").id;
  const vague = (await c.post(T, { title: "Organize garage", taskListId: honeyDo })).json();
  // A goal step with no duration isn't a time block: the planner leaves it alone, silently.
  await c.post(`/workspaces/${ws}/goals`, { title: "Japan trip", horizon: "long_term", milestones: ["Save $8,000"] });

  const date = tomorrow();
  const plan = await c.post(`/workspaces/${ws}/plan`, { scope: "day", date });
  assert.equal(plan.statusCode, 200, plan.body);
  const body = plan.json();
  assert.deepEqual(body.placements.map((p: { title: string }) => p.title).sort(), ["Fix hinge", "Target pickup"]);
  assert.deepEqual(body.unplaced, [{ taskId: vague.id, reason: "needs_estimate", title: "Organize garage" }]);

  // Suggested, not assigned: dismissing must not leave Alex holding it.
  let h = (await c.get(`${T}?status=open`)).json().find((t: { id: string }) => t.id === hinge.id);
  assert.equal(h.scheduleStatus, "suggested");
  assert.equal(h.scheduledParticipant.id, alex.id);
  assert.equal(h.assignedParticipant, null);

  const accepted = (await c.post(`${T}/${hinge.id}/schedule`, { action: "accept" })).json();
  assert.equal(accepted.scheduleStatus, "accepted");
  assert.equal(accepted.assignedParticipant.id, alex.id, "accepting assigns");

  // Re-plan: the accepted slot is fixed; the suggestion is regenerated around it.
  const again = (await c.post(`/workspaces/${ws}/plan`, { scope: "day", date })).json();
  assert.deepEqual(again.placements.map((p: { title: string }) => p.title), ["Target pickup"]);
  const p2 = again.placements[0];
  h = (await c.get(`${T}?status=open`)).json().find((t: { id: string }) => t.id === hinge.id);
  assert.equal(h.scheduledStart, accepted.scheduledStart);
  const overlap = new Date(p2.start) < new Date(h.scheduledEnd) && new Date(p2.end) > new Date(h.scheduledStart);
  assert.equal(overlap, false, "new suggestion avoids the accepted slot");

  const agenda = (await c.get(`/workspaces/${ws}/plan?start=${date}T00:00:00-05:00&end=${date}T23:59:00-05:00`)).json();
  assert.equal(agenda.length, 2);

  const moved = (await c.post(`${T}/${pickup.id}/schedule`, { action: "move", start: `${date}T18:00:00-05:00` })).json();
  assert.equal(moved.scheduleStatus, "accepted");
  assert.equal(new Date(moved.scheduledEnd).getTime() - new Date(moved.scheduledStart).getTime(), 20 * 60_000);
  assert.equal(moved.scheduleReason, "Picked by hand");

  const dismissed = (await c.post(`${T}/${pickup.id}/schedule`, { action: "dismiss" })).json();
  assert.equal(dismissed.scheduleStatus, null);
  assert.equal(dismissed.scheduledStart, null);
  assert.equal((await c.post(`${T}/${vague.id}/schedule`, { action: "move", start: `${date}T18:00:00-05:00` })).json().error, "needs_estimate");
  assert.equal((await c.post(`${T}/${pickup.id}/schedule`, { action: "accept" })).statusCode, 400, "nothing suggested");
});

test("organizer needs a starting point; viewers can read the plan but not make one", async () => {
  const { c, ws } = await setup({ withHome: false });
  const res = await c.post(`/workspaces/${ws}/plan`, { scope: "week" });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().message, /home address/);

  const viewer = new Client(c.app);
  await viewer.signup(`pl-v-${crypto.randomUUID().slice(0, 6)}`);
  const { token } = (await c.post(`/workspaces/${ws}/invites`, { role: "viewer" })).json();
  await viewer.post(`/invites/${token}/accept`);
  assert.equal((await viewer.post(`/workspaces/${ws}/plan`, { scope: "day" })).statusCode, 403);
  assert.equal((await viewer.get(`/workspaces/${ws}/plan?start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z`)).statusCode, 200);
});
