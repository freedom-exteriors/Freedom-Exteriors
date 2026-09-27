import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, makeApp, prisma } from "./helpers.js";
import { redactWallToken } from "../src/routes/wall.js";

async function household() {
  const app = await makeApp();
  const owner = new Client(app);
  const { workspaceId } = await owner.signup(`wall-${crypto.randomUUID().slice(0, 6)}`, { name: "Wall Family", vertical: "family" });
  const ws = workspaceId!;
  const maya = await prisma.participant.create({ data: { workspaceId: ws, name: "Maya", color: "#DB2777" } });
  const src = await prisma.calendarSource.create({ data: { workspaceId: ws, type: "ics_feed" } });
  const soon = (h: number) => new Date(Date.now() + h * 3_600_000);
  await prisma.event.create({
    data: {
      calendarSourceId: src.id, externalUid: "a", title: "Soccer practice", startTime: soon(3), endTime: soon(4.5),
      location: "Eastside Park", participantId: maya.id, rawSourceData: { description: "Gate code 4411", url: "https://private.example/x" },
    },
  });
  await prisma.event.create({ data: { calendarSourceId: src.id, externalUid: "b", title: "Far future", startTime: soon(24 * 20), endTime: soon(24 * 20 + 1), rawSourceData: {} } });
  const chores = await prisma.taskList.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: ws, key: "chores" } } });
  await prisma.task.create({ data: { workspaceId: ws, taskListId: chores.id, title: "Feed the cat", assignedParticipantId: maya.id } });
  const groceries = await prisma.shoppingList.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: ws, key: "groceries" } } });
  await prisma.shoppingItem.create({ data: { shoppingListId: groceries.id, name: "Milk", quantity: "1 gal" } });
  return { app, owner, ws };
}

test("owners make a link per screen; the wall shows the next few days, chores and groceries", async () => {
  const h = await household();
  const made = await h.owner.post(`/workspaces/${h.ws}/wall-displays`, { name: "Kitchen tablet", daysAhead: 3 });
  assert.equal(made.statusCode, 201);
  const url = new URL(made.json().url);
  assert.match(url.pathname, /^\/wall\/[\w-]{40,}$/);
  assert.ok(!url.pathname.includes(h.ws), "the link is not the workspace id");
  const token = url.pathname.split("/").pop()!;
  assert.equal(await prisma.wallDisplay.count({ where: { tokenHash: token } }), 0, "only the hash is stored");

  const anon = new Client(h.app); // no login
  const res = await anon.get(`/wall/${token}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  const wall = res.json();
  assert.equal(wall.household, "Wall Family");
  assert.equal(wall.days.length, 3);
  const all = wall.days.flatMap((d: { events: unknown[] }) => d.events);
  assert.deepEqual(all.map((e: { title: string }) => e.title), ["Soccer practice"], "only the next 3 days");
  assert.deepEqual(all[0].person, { name: "Maya", color: "#DB2777" });
  assert.equal(all[0].location, "Eastside Park");
  assert.deepEqual(wall.chores.map((c: { title: string }) => c.title), ["Feed the cat"]);
  assert.deepEqual(wall.groceries, ["Milk (1 gal)"]);

  // Nothing private on a kitchen wall.
  const body = res.body;
  for (const secret of ["Gate code", "private.example", "@api-test.test", "passwordHash", h.ws]) assert.ok(!body.includes(secret), `leaks ${secret}`);

  const listed = (await h.owner.get(`/workspaces/${h.ws}/wall-displays`)).json();
  assert.equal(listed.length, 1);
  assert.ok(listed[0].lastSeenAt, "heartbeat recorded");
});

test("screens are switched off one at a time; hide-locations; owners only", async () => {
  const h = await household();
  const a = (await h.owner.post(`/workspaces/${h.ws}/wall-displays`, { name: "Kitchen", showLocations: false })).json();
  const b = (await h.owner.post(`/workspaces/${h.ws}/wall-displays`, { name: "Hallway" })).json();
  const tok = (u: string) => new URL(u).pathname.split("/").pop()!;
  const anon = new Client(h.app);
  const kitchen = (await anon.get(`/wall/${tok(a.url)}`)).json();
  assert.equal(kitchen.days[0].events[0].location, null, "locations hidden on this screen");

  assert.equal((await h.owner.del(`/workspaces/${h.ws}/wall-displays/${a.id}`)).statusCode, 204);
  const off = await anon.get(`/wall/${tok(a.url)}`);
  assert.equal(off.statusCode, 404);
  assert.match(off.json().message, /turned off/);
  assert.equal((await anon.get(`/wall/${tok(b.url)}`)).statusCode, 200, "the other screen keeps working");
  assert.equal((await anon.get(`/wall/${"x".repeat(43)}`)).statusCode, 404);

  const viewer = new Client(h.app);
  await viewer.signup(`wall-v-${crypto.randomUUID().slice(0, 6)}`);
  const { token } = (await h.owner.post(`/workspaces/${h.ws}/invites`, { role: "member" })).json();
  await viewer.post(`/invites/${token}/accept`);
  assert.equal((await viewer.post(`/workspaces/${h.ws}/wall-displays`, {})).statusCode, 403, "members can't mint wall links");
});

test("wall tokens never reach the logs", () => {
  assert.equal(redactWallToken("/wall/abcDEF123_-xyz?x=1"), "/wall/[redacted]?x=1");
  assert.equal(redactWallToken("/workspaces/1/events"), "/workspaces/1/events");
});
