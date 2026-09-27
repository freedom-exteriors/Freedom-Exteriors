import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, email, makeApp, prisma } from "./helpers.js";
import { hashToken } from "../src/auth/session.js";

test("signup creates the user, a workspace from the template, and their participant", async () => {
  const c = new Client(await makeApp());
  const res = await c.post("/auth/signup", {
    email: email("Alex").toUpperCase(), // stored lowercased
    password: "correct horse battery",
    displayName: "Alex",
    workspace: { name: "Test Family", vertical: "family" },
  });
  assert.equal(res.statusCode, 201);
  const cookie = res.cookies.find((x) => x.name === "session")!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");

  const me = (await c.get("/auth/me")).json();
  assert.equal(me.user.email, email("alex"));
  assert.equal(me.workspaces.length, 1);
  assert.equal(me.workspaces[0].role, "owner");
  assert.ok(me.workspaces[0].participantId, "owner is linked to their participant");

  const ws = (await c.get(`/workspaces/${me.workspaces[0].id}`)).json();
  assert.equal(ws.labels.participant, "Family member");
  assert.ok(ws.shoppingCategories.includes("Produce"));
  assert.equal(await prisma.taskList.count({ where: { workspaceId: ws.id, key: "honey_do" } }), 1);
});

test("the DB stores a hash of the session token, never the token", async () => {
  const c = new Client(await makeApp());
  await c.signup("hashcheck");
  const token = c.cookie!.replace("session=", "");
  assert.equal(await prisma.session.count({ where: { id: token } }), 0);
  assert.equal(await prisma.session.count({ where: { id: hashToken(token) } }), 1);
});

test("duplicate email, weak password", async () => {
  const c = new Client(await makeApp());
  await c.signup("dupe");
  const again = await new Client(c.app).post("/auth/signup", { email: email("dupe"), password: "another good one" });
  assert.equal(again.statusCode, 409);
  const weak = await new Client(c.app).post("/auth/signup", { email: email("weak"), password: "short" });
  assert.equal(weak.statusCode, 400);
});

test("login, wrong password, unknown email, logout", async () => {
  const app = await makeApp();
  await new Client(app).signup("login");
  const c = new Client(app);

  const wrong = await c.post("/auth/login", { email: email("login"), password: "nope nope nope" });
  const unknown = await c.post("/auth/login", { email: email("nobody"), password: "nope nope nope" });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(wrong.json(), unknown.json(), "same response whether or not the account exists");

  assert.equal((await c.post("/auth/login", { email: email("login"), password: "correct horse battery" })).statusCode, 200);
  assert.equal((await c.get("/auth/me")).statusCode, 200);
  const token = c.cookie!;
  assert.equal((await c.post("/auth/logout")).statusCode, 204);

  // The old cookie is dead server-side, not just cleared in the browser.
  const replay = new Client(app);
  replay.cookie = token;
  assert.equal((await replay.get("/auth/me")).statusCode, 401);
});

test("expired sessions are rejected; sessions near expiry are extended", async () => {
  const app = await makeApp();
  const c = new Client(app);
  await c.signup("expiry");
  const id = hashToken(c.cookie!.replace("session=", ""));

  await prisma.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 2 * 86_400_000) } });
  const renewed = await c.get("/auth/me");
  assert.equal(renewed.statusCode, 200);
  assert.ok(renewed.cookies.some((x) => x.name === "session"), "cookie re-sent with new expiry");
  const row = await prisma.session.findUniqueOrThrow({ where: { id } });
  assert.ok(row.expiresAt.getTime() > Date.now() + 25 * 86_400_000);

  await prisma.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await c.get("/auth/me")).statusCode, 401);
  assert.equal(await prisma.session.count({ where: { id } }), 0, "expired row cleaned up");
});

test("CSRF: state-changing requests need our Origin", async () => {
  const c = new Client(await makeApp());
  await c.signup("csrf");
  const evil = await c.req("POST", "/workspaces", { name: "x", vertical: "family" }, { origin: "https://evil.example" });
  assert.equal(evil.statusCode, 403);
  const none = await c.app.inject({ method: "POST", url: "/workspaces", payload: { name: "x", vertical: "family" }, headers: { cookie: c.cookie! } });
  assert.equal(none.statusCode, 403);
  assert.equal((await c.get("/workspaces")).statusCode, 200, "GETs don't need an Origin");
});

test("login is rate limited per IP", async () => {
  const c = new Client(await makeApp({ authRateLimitMax: 3 }));
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await c.post("/auth/login", { email: email("rl"), password: "whatever123" })).statusCode);
  assert.deepEqual(codes, [401, 401, 401, 429]);
});
