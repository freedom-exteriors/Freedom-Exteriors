import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, makeApp } from "./helpers.js";

async function owner() {
  const app = await makeApp();
  const c = new Client(app);
  const { workspaceId } = await c.signup(`gl-${crypto.randomUUID().slice(0, 6)}`, { name: "Goal Family", vertical: "family" });
  return { c, ws: workspaceId! };
}

test("goals with milestones: progress, achieve, delete", async () => {
  const { c, ws } = await owner();
  const G = `/workspaces/${ws}/goals`;
  const goal = (await c.post(G, { title: "Clean out the garage", horizon: "short_term", targetDate: "2026-11-01", milestones: ["Sort", "Donate", "Hooks"] })).json();
  assert.equal(goal.milestones.length, 3);

  await c.patch(`/workspaces/${ws}/tasks/${goal.milestones[0].id}`, { completed: true });
  let [g] = (await c.get(G)).json();
  assert.deepEqual(g.progress, { done: 1, total: 3, percent: 33 });
  assert.equal(g.targetDate.slice(0, 10), "2026-11-01");

  // A milestone added later through the tasks API counts too.
  await c.post(`/workspaces/${ws}/tasks`, { title: "Sell old bike", goalId: goal.id });
  [g] = (await c.get(G)).json();
  assert.equal(g.progress.total, 4);

  const achieved = (await c.patch(`${G}/${goal.id}`, { status: "achieved" })).json();
  assert.ok(achieved.achievedAt);
  assert.equal((await c.get(`${G}?status=active`)).json().length, 0);

  assert.equal((await c.del(`${G}/${goal.id}`)).statusCode, 204);
  assert.equal((await c.get(`/workspaces/${ws}/tasks?goalId=${goal.id}&status=all`)).json().length, 0);
});

test("seasonal reminders: template ones listed by next date; rules validated", async () => {
  const { c, ws } = await owner();
  const R = `/workspaces/${ws}/recurring-reminders`;
  const list = (await c.get(R)).json();
  assert.equal(list.length, 10, "family template");
  const dates = list.map((r: { nextDate: string }) => r.nextDate);
  assert.deepEqual([...dates].sort(), dates, "soonest first");
  assert.ok(list.find((r: { title: string }) => r.title === "Replace HVAC filter").taskList.name === "Honey-do");

  assert.equal((await c.post(R, { title: "x", rrule: "not a rule" })).statusCode, 400);
  assert.equal((await c.post(R, { title: "x", rrule: "FREQ=DAILY" })).statusCode, 400, "reminders are weekly or slower");
  const made = await c.post(R, { title: "Rotate mattresses", rrule: "FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=1", leadDays: 3 });
  assert.equal(made.statusCode, 201);
  const mine = (await c.get(R)).json().find((r: { id: string }) => r.id === made.json().id);
  assert.match(mine.nextDate, /^\d{4}-(03|09)-01$/);

  assert.equal((await c.patch(`${R}/${mine.id}`, { enabled: false })).json().enabled, false);
  assert.equal((await c.del(`${R}/${mine.id}`)).statusCode, 204);
});
