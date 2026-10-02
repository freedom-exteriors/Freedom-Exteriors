// node --test test/   (API helpers; the React tests run under `npm test`)
// Fixtures are EagleView's sandbox sample reports, as returned to our sandbox app.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  measureEvJson, measureGetReport, toJobMeasurements, parseFeet, orderBody, quotedPrice, stateName, verifyWebhook,
} from "../api/_lib/eagleviewApi.js";

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/eagleview/${name}.json`, import.meta.url)));

test("Roof report JSON matches EagleView's own summary", () => {
  const t = measureEvJson(fx("evjson-roof-68789287"));
  assert.equal(t.totalRoofArea, 4786.9);
  assert.equal(t.facets, 13);
  assert.deepEqual(t.lengths, { ridges: 146.5, hips: 0, valleys: 0, eaves: 343.3, rakes: 245.2, flashing: 49.5, stepFlashing: 108.4, parapets: 0 });
  assert.equal(t.pitches[0].pitch, "5/12");
  assert.equal(t.pitches[0].area, 4016.2);
  assert.equal(t.penetrations, 6);
});

test("Bid Perfect JSON (no summary) is measured from its geometry", () => {
  const t = measureEvJson(fx("evjson-bidperfect-69153261"));
  const r = fx("getreport-bidperfect-69153261");
  assert.equal(t.totalRoofArea, 4340.8); // GetReport: "4340.8 sq. ft"
  assert.equal(t.facets, 22);
  // GetReport rounds up to whole feet: 79' ridge, 197' hip, 121' valley, 282' eave, 85' rake
  for (const [k, field] of [["ridges", "LengthRidge"], ["hips", "LengthHip"], ["valleys", "LengthValley"], ["eaves", "LengthEave"], ["rakes", "LengthRake"]]) {
    assert.ok(Math.abs(t.lengths[k] - parseFeet(r[field])) <= 1, `${k}: ${t.lengths[k]} vs ${r[field]}`);
  }
  assert.equal(t.lengths.parapets, null); // no parapet lines in this report
  assert.equal(t.pitches[0].pitch, "10/12");
  assert.equal(t.address, "419 Prairie Ridge Ln, North Aurora, IL 60542");
});

test("GetReport fallback and length formats", () => {
  assert.equal(parseFeet("46 ft"), 46);
  assert.equal(parseFeet(`79' 6"`), 79.5);
  assert.equal(parseFeet(""), null);
  const t = measureGetReport(fx("getreport-order-52191405"));
  assert.equal(t.totalRoofArea, 1522.4);
  assert.equal(t.lengths.ridges, 46);
  assert.equal(t.pitches[0].pitch, "6/12");
});

test("job measurements keep the Hover shape", () => {
  const report = fx("getreport-order-52191405");
  const m = toJobMeasurements(measureGetReport(report), report, { reportId: 52191405, now: new Date("2026-10-02T00:00:00Z") });
  assert.equal(m.source, "eagleview");
  assert.equal(m.squares, 15.22);
  assert.equal(m.ridgeHipLength, 46);
  assert.equal(m.dripEdgeLength, 258); // eaves 96 + rakes 162
  assert.equal(m.lowSlopeArea, 0);
  assert.equal(m.reportNumber, "52191405");
  assert.equal(m.reportType, "Claims Ready - Residential");
  assert.deepEqual(m.walls, { wallsArea: 2611, sidingArea: 2043, masonryArea: 568, openingsArea: 296 });
  assert.equal(m.warnings.length, 0);
});

test("order body uses Bid Perfect's own delivery option and full state names", () => {
  assert.equal(stateName("MN"), "Minnesota");
  const b = orderBody({ address: { Address: "1 Main St", City: "Stillwater", State: stateName("MN"), Zip: "55082" }, productId: 110, referenceId: "FE-1-x" });
  const r = b.OrderReports[0];
  assert.equal(r.DeliveryProductId, 45);
  assert.equal(r.PrimaryProductId, 110);
  assert.equal(r.ReportAddresses[0].State, "Minnesota");
  assert.equal(orderBody({ address: {}, productId: 106, referenceId: "x" }).OrderReports[0].DeliveryProductId, 8);
  assert.throws(() => orderBody({ address: {}, productId: 999, referenceId: "x" }));
  assert.equal(quotedPrice({ OrderReports: [{ Price: 18 }], TotalPrice: 18 }), 18);
  assert.equal(quotedPrice({}), null);
});

test("webhook tokens: signature, client, expiry and signed query", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = 1_790_000_000_000;
  const sign = (claims) => {
    const unsigned = `${enc({ alg: "RS256", kid: "k1" })}.${enc(claims)}`;
    return `Bearer ${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
  };
  const claims = {
    iss: "https://auth.eagleview.com", exp: now / 1000 + 300, x_target_client: "our-client",
    x_query_parameter: Buffer.from("RefId=FE-1-x&ReportId=52191405&StatusId=5").toString("base64"),
  };
  const opts = { now, clientId: "our-client", getKey: async () => publicKey };
  const query = { RefId: "FE-1-x", ReportId: "52191405", StatusId: "5" };
  assert.equal((await verifyWebhook(sign(claims), query, opts)).x_target_client, "our-client");
  await assert.rejects(verifyWebhook(sign(claims), { ...query, StatusId: "4" }, opts), /StatusId/);
  await assert.rejects(verifyWebhook(sign({ ...claims, x_target_client: "someone-else" }), query, opts), /different client/);
  await assert.rejects(verifyWebhook(sign({ ...claims, exp: now / 1000 - 120 }), query, opts), /expired/);
  await assert.rejects(verifyWebhook(sign(claims).slice(0, -4) + "AAAA", query, opts), /signature/);
  await assert.rejects(verifyWebhook("", query, opts), /missing/);
});
