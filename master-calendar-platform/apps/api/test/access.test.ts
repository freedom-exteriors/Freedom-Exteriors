import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, email, makeApp, prisma } from "./helpers.js";

test("unauthenticated and non-member access", async () => {
  const app = await makeApp();
  const owner = new Client(app);
  const { workspaceId } = await owner.signup("owner1", { name: "Owner Family", vertical: "family" });
  const stranger = new Client(app);
  await stranger.signup("stranger1");

  assert.equal((await new Client(app).get("/workspaces")).statusCode, 401);
  assert.equal((await new Client(app).get(`/workspaces/${workspaceId}`)).statusCode, 401);
  // Not a member → 404, identical to a workspace that doesn't exist.
  const theirs = await stranger.get(`/workspaces/${workspaceId}`);
  const missing = await stranger.get("/workspaces/00000000-0000-4000-8000-000000000000");
  assert.equal(theirs.statusCode, 404);
  assert.deepEqual(theirs.json(), missing.json());
  assert.deepEqual((await stranger.get("/workspaces")).json(), []);
});

test("invite a teen as a viewer who claims their participant; roles are enforced", async () => {
  const app = await makeApp();
  const parent = new Client(app);
  const { workspaceId } = await parent.signup("parent2", { name: "Invite Family", vertical: "family" });
  const maya = await prisma.participant.create({ data: { workspaceId: workspaceId!, name: "Maya", color: "#DB2777" } });

  const inv = await parent.post(`/workspaces/${workspaceId}/invites`, { role: "viewer", email: email("maya2"), participantId: maya.id });
  assert.equal(inv.statusCode, 201);
  const { token, url } = inv.json();
  assert.equal(url, `http://localhost:5173/invite/${token}`, "absolute link someone can open from a text message");
  assert.equal(await prisma.workspaceInvite.count({ where: { tokenHash: token } }), 0, "only the hash is stored");

  const preview = (await new Client(app).get(`/invites/${token}`)).json();
  assert.deepEqual(preview, { workspace: { name: "Invite Family", kind: "home" }, role: "viewer", participantName: "Maya", restrictedToEmail: true });

  const wrongPerson = new Client(app);
  await wrongPerson.signup("notmaya2");
  assert.equal((await wrongPerson.post(`/invites/${token}/accept`)).statusCode, 403);

  const teen = new Client(app);
  await teen.signup("maya2");
  assert.equal((await teen.post(`/invites/${token}/accept`)).statusCode, 200);
  assert.equal((await teen.post(`/invites/${token}/accept`)).statusCode, 404, "single use");

  const ws = (await teen.get(`/workspaces/${workspaceId}`)).json();
  assert.equal(ws.myRole, "viewer");
  assert.equal(ws.myParticipantId, maya.id);
  // Viewer: can read, can't manage.
  assert.equal((await teen.get(`/workspaces/${workspaceId}/members`)).statusCode, 403);
  assert.equal((await teen.post(`/workspaces/${workspaceId}/invites`, { role: "owner" })).statusCode, 403);
  // Maya already has a login → can't be invited again.
  assert.equal((await parent.post(`/workspaces/${workspaceId}/invites`, { participantId: maya.id })).statusCode, 409);
});

test("expired and revoked invites don't work", async () => {
  const app = await makeApp();
  const owner = new Client(app);
  const { workspaceId } = await owner.signup("owner3", { name: "Expiry Family", vertical: "family" });
  const joiner = new Client(app);
  await joiner.signup("joiner3");

  const a = (await owner.post(`/workspaces/${workspaceId}/invites`, { role: "member" })).json();
  await prisma.workspaceInvite.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await joiner.post(`/invites/${a.token}/accept`)).statusCode, 404);

  const b = (await owner.post(`/workspaces/${workspaceId}/invites`, { role: "member" })).json();
  assert.equal((await owner.get(`/workspaces/${workspaceId}/invites`)).json().length, 1);
  assert.equal((await owner.del(`/workspaces/${workspaceId}/invites/${b.id}`)).statusCode, 204);
  assert.equal((await joiner.post(`/invites/${b.token}/accept`)).statusCode, 404);
});

test("owners: can't remove or demote the last one; members can leave", async () => {
  const app = await makeApp();
  const owner = new Client(app);
  const { workspaceId } = await owner.signup("owner4", { name: "Owner Rules", vertical: "business" });
  const member = new Client(app);
  await member.signup("member4");
  const { token } = (await owner.post(`/workspaces/${workspaceId}/invites`, { role: "member" })).json();
  await member.post(`/invites/${token}/accept`);

  const members = (await owner.get(`/workspaces/${workspaceId}/members`)).json() as { id: string; role: string }[];
  const ownerRow = members.find((m) => m.role === "owner")!;
  const memberRow = members.find((m) => m.role === "member")!;

  assert.equal((await owner.patch(`/workspaces/${workspaceId}/members/${ownerRow.id}`, { role: "member" })).statusCode, 409);
  assert.equal((await owner.del(`/workspaces/${workspaceId}/members/${ownerRow.id}`)).statusCode, 409);
  assert.equal((await member.patch(`/workspaces/${workspaceId}/members/${memberRow.id}`, { role: "owner" })).statusCode, 403, "can't promote yourself");
  assert.equal((await member.del(`/workspaces/${workspaceId}/members/${ownerRow.id}`)).statusCode, 403);
  assert.equal((await member.del(`/workspaces/${workspaceId}/members/${memberRow.id}`)).statusCode, 204, "leave");
  assert.equal((await member.get(`/workspaces/${workspaceId}`)).statusCode, 404, "gone after leaving");
});

test("circles: households join once; homes stay private", async () => {
  const app = await makeApp();
  const alex = new Client(app);
  const { workspaceId: riveraHome } = await alex.signup("alex5", { name: "Rivera", vertical: "family" });
  const lee = new Client(app);
  const { workspaceId: chenHome } = await lee.signup("lee5", { name: "Chen", vertical: "family" });

  assert.equal((await alex.post("/workspaces", { name: "Carpool", vertical: "family", kind: "circle" })).statusCode, 400, "circle needs a home");
  assert.equal((await alex.post("/workspaces", { name: "Carpool", vertical: "family", kind: "circle", homeWorkspaceId: chenHome })).statusCode, 404, "not your home");
  const circleId = (await alex.post("/workspaces", { name: "Carpool", vertical: "family", kind: "circle", homeWorkspaceId: riveraHome })).json().id;

  const { token } = (await alex.post(`/workspaces/${circleId}/invites`, { role: "member" })).json();
  assert.equal((await lee.post(`/invites/${token}/accept`)).statusCode, 400, "must pick a household");
  assert.equal((await lee.post(`/invites/${token}/accept`, { homeWorkspaceId: chenHome })).statusCode, 200);

  const circle = (await lee.get(`/workspaces/${circleId}`)).json();
  assert.deepEqual(circle.participants.map((p: { linkedWorkspaceId: string }) => p.linkedWorkspaceId).sort(), [riveraHome, chenHome].sort());
  assert.notEqual(circle.participants[0].color, circle.participants[1].color);

  // A second Chen adult joining doesn't add the Chen household twice.
  const { token: t2 } = (await lee.post(`/workspaces/${chenHome}/invites`, { role: "member" })).json();
  const kim = new Client(app);
  await kim.signup("kim5");
  await kim.post(`/invites/${t2}/accept`);
  // Lee is a circle member, not owner → can't invite.
  assert.equal((await lee.post(`/workspaces/${circleId}/invites`, { role: "member" })).statusCode, 403);
  const { token: t3 } = (await alex.post(`/workspaces/${circleId}/invites`, { role: "member" })).json();
  assert.equal((await kim.post(`/invites/${t3}/accept`, { homeWorkspaceId: chenHome })).statusCode, 200);
  assert.equal(await prisma.participant.count({ where: { workspaceId: circleId } }), 2);

  // Joining a circle grants nothing in the other family's home.
  assert.equal((await lee.get(`/workspaces/${riveraHome}`)).statusCode, 404);
});
