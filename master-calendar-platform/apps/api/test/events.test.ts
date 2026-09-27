import { test } from "node:test";
import assert from "node:assert/strict";
import { addHomeToCircle, createWorkspaceFromTemplate } from "@mcp/db";
import { Client, makeApp, prisma } from "./helpers.js";

const D = (iso: string) => new Date(iso);
const WEEK = "start=2026-10-05T05:00:00Z&end=2026-10-12T05:00:00Z"; // Mon–Mon, Chicago

async function family(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
  const owner = new Client(app);
  const { workspaceId } = await owner.signup(`ev-${name}-${crypto.randomUUID().slice(0, 6)}`, { name, vertical: "family" });
  const wsId = workspaceId!;
  const [maya, alex, leo] = await Promise.all([
    prisma.participant.create({ data: { workspaceId: wsId, name: "Maya", color: "#DB2777" } }),
    prisma.participant.create({ data: { workspaceId: wsId, name: "Alex", color: "#2563EB", canDrive: true } }),
    prisma.participant.create({ data: { workspaceId: wsId, name: "Leo", color: "#EA580C" } }),
  ]);
  const tags = await prisma.eventTagDefinition.findMany({ where: { workspaceId: wsId } });
  const tag = (k: string) => tags.find((t) => t.key === k)!;
  const src = await prisma.calendarSource.create({ data: { workspaceId: wsId, type: "ics_feed", name: "Team feed" } });
  const gsrc = await prisma.calendarSource.create({ data: { workspaceId: wsId, type: "google", name: "Family (Google)" } });
  const ev = (source: string, uid: string, start: string, end: string, extra: object = {}) =>
    prisma.event.create({ data: { calendarSourceId: source, externalUid: uid, title: uid, startTime: D(start), endTime: D(end), rawSourceData: { url: `https://x/${uid}` }, ...extra } });
  await ev(src.id, "practice", "2026-10-06T22:00:00Z", "2026-10-06T23:30:00Z", { participantId: maya.id, eventTagId: tag("practice").id, location: "Eastside Park" });
  await ev(gsrc.id, "dentist", "2026-10-08T15:00:00Z", "2026-10-08T16:00:00Z", { participantId: leo.id, eventTagId: tag("medical").id, driverParticipantId: alex.id, location: "Maple Dental" });
  await ev(src.id, "swim", "2026-10-07T23:00:00Z", "2026-10-08T00:00:00Z", { location: "YMCA" }); // unassigned, no driver
  await ev(gsrc.id, "no-school", "2026-10-09T05:00:00Z", "2026-10-10T05:00:00Z", { allDay: true });
  await ev(src.id, "spans-into-week", "2026-10-04T23:00:00Z", "2026-10-05T06:00:00Z"); // overlaps the start
  await ev(src.id, "deadline", "2026-10-05T05:00:00Z", "2026-10-05T05:00:00Z"); // zero-length at range start
  await ev(src.id, "next-week", "2026-10-13T22:00:00Z", "2026-10-13T23:00:00Z");
  return { owner, wsId, maya, alex, leo, tag, base: `/workspaces/${wsId}/events` };
}

test("one list from every source, annotated for display, in time order", async () => {
  const app = await makeApp();
  const f = await family(app, "Unified");
  const res = await f.owner.get(`${f.base}?${WEEK}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.timeZone, "America/Chicago");
  // Legend: the signup's own participant plus the three added here.
  assert.deepEqual(body.participants.map((p: { name: string }) => p.name).slice(-3), ["Maya", "Alex", "Leo"]);
  const titles = body.events.map((e: { title: string }) => e.title);
  assert.deepEqual(titles, ["spans-into-week", "deadline", "practice", "swim", "dentist", "no-school"]);

  const byTitle = Object.fromEntries(body.events.map((e: { title: string }) => [e.title, e]));
  assert.deepEqual(byTitle.practice.participant, { id: f.maya.id, name: "Maya", color: "#DB2777" });
  assert.equal(byTitle.practice.tag.key, "practice");
  assert.equal(byTitle.practice.needsDriver, true);
  assert.equal(byTitle.practice.source.type, "ics_feed");
  assert.equal(byTitle.practice.url, "https://x/practice");
  assert.equal(byTitle.dentist.driver.name, "Alex");
  assert.equal(byTitle.dentist.needsDriver, false);
  assert.equal(byTitle.dentist.source.type, "google");
  assert.equal(byTitle.swim.unassigned, true);
  assert.equal(byTitle.swim.participant, null);
  assert.equal(byTitle["no-school"].allDay, true);
  assert.equal(byTitle["no-school"].needsDriver, false);
  assert.ok(byTitle.practice.editable);
});

test("filters: person, tag, unassigned-only; bad ranges and foreign ids rejected", async () => {
  const app = await makeApp();
  const f = await family(app, "Filters");
  const titles = async (qs: string) => (await f.owner.get(`${f.base}?${WEEK}&${qs}`)).json().events.map((e: { title: string }) => e.title);
  assert.deepEqual(await titles(`participantId=${f.maya.id}`), ["practice"]);
  assert.deepEqual(await titles(`tagId=${f.tag("medical").id}`), ["dentist"]);
  assert.deepEqual(await titles("assigned=unassigned"), ["spans-into-week", "deadline", "swim", "no-school"]);
  assert.deepEqual(await titles("assigned=assigned"), ["practice", "dentist"]);

  const other = await family(app, "Other");
  assert.equal((await f.owner.get(`${f.base}?${WEEK}&participantId=${other.maya.id}`)).statusCode, 400);
  assert.equal((await f.owner.get(f.base)).statusCode, 400, "range required");
  assert.equal((await f.owner.get(`${f.base}?start=2026-10-12T00:00:00Z&end=2026-10-05T00:00:00Z`)).statusCode, 400);
  assert.equal((await f.owner.get(`${f.base}?start=2026-01-01T00:00:00Z&end=2026-12-31T00:00:00Z`)).statusCode, 400, "too long");
  assert.equal((await other.owner.get(`${f.base}?${WEEK}`)).statusCode, 404, "not your workspace");
});

test("claiming: assign person, tag, driver — with scope and role checks", async () => {
  const app = await makeApp();
  const f = await family(app, "Claim");
  const swim = (await f.owner.get(`${f.base}?${WEEK}&assigned=unassigned`)).json().events.find((e: { title: string }) => e.title === "swim");

  const patched = await f.owner.patch(`${f.base}/${swim.id}`, { participantId: f.leo.id, driverParticipantId: f.alex.id, eventTagId: f.tag("practice").id });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().participant.name, "Leo");
  assert.equal(patched.json().needsDriver, false);
  assert.equal((await f.owner.patch(`${f.base}/${swim.id}`, { driverParticipantId: f.maya.id })).json().error, "not_a_driver");

  const other = await family(app, "Stranger");
  assert.equal((await f.owner.patch(`${f.base}/${swim.id}`, { participantId: other.maya.id })).statusCode, 400);
  assert.equal((await other.owner.patch(`${f.base}/${swim.id}`, { participantId: other.maya.id })).statusCode, 404);
  assert.equal((await f.owner.patch(`${f.base}/${swim.id}`, {})).statusCode, 400);

  const viewer = new Client(app);
  await viewer.signup(`ev-viewer-${crypto.randomUUID().slice(0, 6)}`);
  const { token } = (await f.owner.post(`/workspaces/${f.wsId}/invites`, { role: "viewer" })).json();
  await viewer.post(`/invites/${token}/accept`);
  assert.equal((await viewer.get(`${f.base}?${WEEK}`)).statusCode, 200);
  assert.equal((await viewer.patch(`${f.base}/${swim.id}`, { participantId: null })).statusCode, 403);
});

test("circle events: ours show on our home calendar; others' never do; unclaimed only for circle members", async () => {
  const app = await makeApp();
  const rivera = await family(app, "Rivera");
  const chen = await family(app, "Chen");
  const circle = await createWorkspaceFromTemplate(prisma, { name: `Carpool-${crypto.randomUUID().slice(0, 4)}`, vertical: "family", kind: "circle" });
  const riveraP = await addHomeToCircle(prisma, { circleId: circle.id, homeWorkspaceId: rivera.wsId, color: "#2563EB" });
  const chenP = await addHomeToCircle(prisma, { circleId: circle.id, homeWorkspaceId: chen.wsId, color: "#0D9488" });
  const riveraOwnerId = (await rivera.owner.get("/auth/me")).json().user.id;
  await prisma.workspaceMembership.create({ data: { userId: riveraOwnerId, workspaceId: circle.id, role: "owner" } });
  try {
    const src = await prisma.calendarSource.create({ data: { workspaceId: circle.id, type: "ics_feed", name: "Circle plans" } });
    const ev = (uid: string, start: string, extra: object) =>
      prisma.event.create({ data: { calendarSourceId: src.id, externalUid: uid, title: uid, startTime: D(start), endTime: new Date(D(start).getTime() + 1800_000), rawSourceData: {}, ...extra } });
    await ev("rivera-drives", "2026-10-06T21:30:00Z", { participantId: riveraP.id, location: "Eastside Park" });
    await ev("chen-drives", "2026-10-06T23:30:00Z", { participantId: chenP.id });
    await ev("nobody-drives", "2026-10-10T14:00:00Z", {});
    await ev("rivera-is-driver", "2026-10-07T21:30:00Z", { participantId: chenP.id, driverParticipantId: riveraP.id });

    const circleTitles = async (c: Client, wsId: string, qs = "") =>
      (await c.get(`/workspaces/${wsId}/events?${WEEK}${qs}`)).json().events.filter((e: { circle: unknown }) => e.circle).map((e: { title: string }) => e.title);

    // Rivera's owner is in the circle: sees Rivera's commitments + the unclaimed one.
    assert.deepEqual(await circleTitles(rivera.owner, rivera.wsId), ["rivera-drives", "rivera-is-driver", "nobody-drives"]);
    // The Chens' owner isn't a circle member (their household is): sees only Chen's, not unclaimed.
    assert.deepEqual(await circleTitles(chen.owner, chen.wsId), ["chen-drives", "rivera-is-driver"]);
    assert.deepEqual(await circleTitles(rivera.owner, rivera.wsId, "&includeCircles=false"), []);
    assert.deepEqual(await circleTitles(rivera.owner, rivera.wsId, "&assigned=unassigned"), ["nobody-drives"]);

    const e = (await rivera.owner.get(`/workspaces/${rivera.wsId}/events?${WEEK}`)).json().events.find((x: { title: string }) => x.title === "rivera-drives");
    assert.equal(e.circle.id, circle.id);
    assert.equal(e.editable, false);
    assert.equal(e.participant.color, "#2563EB");
    // Can't edit a circle event through a home workspace.
    assert.equal((await rivera.owner.patch(`/workspaces/${rivera.wsId}/events/${e.id}`, { participantId: null })).statusCode, 404);
  } finally {
    await prisma.workspace.delete({ where: { id: circle.id } });
  }
});
