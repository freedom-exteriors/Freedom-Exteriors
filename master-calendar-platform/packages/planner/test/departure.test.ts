import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GoogleRoutesTrafficProvider,
  earlierDepartureNotice,
  estimateLeaveBy,
  formatLeaveWarning,
  geocodeAddress,
  inferOrigin,
  localParts,
  nextTrafficCheck,
  shouldWarn,
  type TrafficProvider,
} from "../src/index.js";
import { TZ, at, home, park } from "./fixtures.js";

const school = { id: "school", name: "Lincoln Elementary", lat: 41.905, lng: -87.64 };

test("origin: previous stop if it just ended, otherwise home", () => {
  const eventStart = at(10, 6, 17);
  assert.equal(inferOrigin({ eventStart, home, priorBlocks: [{ end: at(10, 6, 16, 30), place: school }] }).label, "Lincoln Elementary");
  assert.equal(inferOrigin({ eventStart, home, priorBlocks: [{ end: at(10, 6, 13), place: school }] }).label, "Home");
  assert.equal(inferOrigin({ eventStart, home, priorBlocks: [] }).label, "Home");
});

test("leave-by uses rush-hour traffic at the actual departure time", async () => {
  const calls: Date[] = [];
  const provider: TrafficProvider = {
    async drivingMinutes(_o, _d, departAt) {
      calls.push(departAt);
      const m = localParts(departAt, TZ).minuteOfDay;
      return m >= 16 * 60 + 30 && m <= 18 * 60 + 30 ? { trafficMinutes: 30, typicalMinutes: 15 } : { trafficMinutes: 15, typicalMinutes: 15 };
    },
  };
  const r = await estimateLeaveBy({ provider, origin: home, destination: park, eventStart: at(10, 6, 17, 30), now: at(10, 6, 12) });
  // arrive by 5:25 (5 min to park & walk) − 30 min drive − 5 min to get out the door
  assert.equal(r.leaveBy.getTime(), at(10, 6, 16, 50).getTime());
  assert.equal(calls.length, 2);
  const msg = formatLeaveWarning({ eventTitle: "Soccer practice", leaveBy: r.leaveBy, estimate: r, originLabel: "Home", timeZone: TZ });
  assert.equal(msg.title, "Leave by 4:50 PM — Soccer practice");
  assert.equal(msg.body, "30 min drive from Home; 15 min longer than usual — heavy traffic.");
});

test("departure times in the past are clamped to now", async () => {
  const calls: Date[] = [];
  const provider: TrafficProvider = { async drivingMinutes(_o, _d, t) { calls.push(t); return { trafficMinutes: 20, typicalMinutes: 18 }; } };
  const now = at(10, 6, 16, 50);
  await estimateLeaveBy({ provider, origin: home, destination: park, eventStart: at(10, 6, 17), now });
  assert.ok(calls.every((c) => c >= now));
});

test("re-check schedule, one-time warning, and earlier-departure notice", () => {
  const leaveBy = at(10, 6, 16, 50);
  assert.equal(nextTrafficCheck(at(10, 6, 12), leaveBy)?.getTime(), at(10, 6, 14, 50).getTime());
  assert.equal(nextTrafficCheck(at(10, 6, 15), leaveBy)?.getTime(), at(10, 6, 16, 5).getTime());
  assert.equal(nextTrafficCheck(at(10, 6, 16, 40), leaveBy), null);

  const eventStart = at(10, 6, 17, 30);
  assert.equal(shouldWarn({ now: at(10, 6, 16, 39), leaveBy, eventStart, notifiedAt: null }), false);
  assert.equal(shouldWarn({ now: at(10, 6, 16, 40), leaveBy, eventStart, notifiedAt: null }), true);
  assert.equal(shouldWarn({ now: at(10, 6, 16, 45), leaveBy, eventStart, notifiedAt: at(10, 6, 16, 40) }), false);

  assert.equal(earlierDepartureNotice({ eventTitle: "Game", previousLeaveBy: leaveBy, newLeaveBy: at(10, 6, 16, 45), timeZone: TZ }), null);
  const n = earlierDepartureNotice({ eventTitle: "Game", previousLeaveBy: leaveBy, newLeaveBy: at(10, 6, 16, 35), timeZone: TZ });
  assert.equal(n?.title, "Traffic: leave 15 min earlier for Game");
  assert.equal(n?.body, "New leave-by time is 4:35 PM (was 4:50 PM).");
});

test("Google Routes client: request shape and duration parsing", async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(JSON.stringify({ routes: [{ duration: "1501s", staticDuration: "900s" }] }));
  }) as unknown as typeof fetch;
  const est = await new GoogleRoutesTrafficProvider("KEY", fetchImpl).drivingMinutes(home, park, at(10, 6, 17));
  assert.deepEqual(est, { trafficMinutes: 26, typicalMinutes: 15 });
  const headers = sent!.init.headers as Record<string, string>;
  assert.equal(headers["X-Goog-FieldMask"], "routes.duration,routes.staticDuration");
  const body = JSON.parse(sent!.init.body as string);
  assert.equal(body.routingPreference, "TRAFFIC_AWARE_OPTIMAL");
  assert.equal(body.departureTime, at(10, 6, 17).toISOString());
});

test("geocoding returns null on no results", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }))) as unknown as typeof fetch;
  assert.equal(await geocodeAddress("nowhere", "KEY", { fetchImpl }), null);
});
