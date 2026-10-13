import { buildReports, daysInStage, solarAccuracy, leadSourceReport } from "./reportCalc";

const STAGES = [
  { id: "lead", label: "New", color: "#000", icon: "" },
  { id: "inspection", label: "Insp", color: "#000", icon: "" },
  { id: "approved", label: "Appr", color: "#000", icon: "" },
  { id: "installed", label: "Inst", color: "#000", icon: "" },
  { id: "collected", label: "Paid", color: "#000", icon: "" },
];
const NOW = Date.parse("2026-10-13T12:00:00Z");

test("days in stage uses stageAt, falling back to added", () => {
  expect(daysInStage({ stageAt: "2026-10-03T12:00:00Z" }, NOW)).toBe(10);
  expect(daysInStage({ added: "2026-10-10" }, NOW)).toBe(3);
  expect(daysInStage({}, NOW)).toBeNull();
});

test("closing % counts Approved and later per rep", () => {
  const jobs = [
    { assigned: "Nick", stage: "lead", estimate: { total: 1000 }, added: "2026-10-01" },
    { assigned: "Nick", stage: "approved", estimate: { total: 9000 }, added: "2026-10-01" },
    { assigned: "Victor", stage: "collected", estimate: { total: 5000 }, added: "2026-10-01" },
  ];
  const r = buildReports(jobs, STAGES, NOW);
  const nick = r.repRows.find(x => x.name === "Nick");
  expect(nick.closePct).toBe(50);
  expect(nick.wonValue).toBe(9000);
  expect(r.totals.open).toBe(2);
});

test("stale estimates and receivables", () => {
  const jobs = [
    { stage: "inspection", estimate: { total: 8000 }, stageAt: "2026-10-01T00:00:00Z" },
    { stage: "installed", estimate: { total: 10000 }, depositPaid: true, depositAmountPaid: 3000, stageAt: "2026-10-10T00:00:00Z" },
  ];
  const r = buildReports(jobs, STAGES, NOW);
  expect(r.staleEstimates).toHaveLength(1);
  expect(r.receivables[0].owed).toBe(7000);
  expect(r.totals.owed).toBe(7000);
});

test("solar accuracy compares Solar area to the measurement report", () => {
  const mk = (solar, real) => ({ solarEstimate: { totalAreaSqFt: solar, pitchRisePerTwelve: 6 }, eagleviewMeasurements: { totalRoofArea: real, predominantPitch: "6/12" } });
  const r = solarAccuracy([mk(2200, 2000), mk(1800, 2000), mk(2000, 2000), { eagleviewMeasurements: { totalRoofArea: 1000 } }]);
  expect(r.n).toBe(3);
  expect(r.rows[0].errPct).toBeCloseTo(10);
  expect(r.bias).toBeCloseTo(0);
  expect(r.within10).toBe(100);
  expect(solarAccuracy([]).n).toBe(0);
});

test("lead sources: close %, cost per sale, unrecorded kept apart", () => {
  const jobs = [
    { stage: "approved", leadSource: "paid_lead", leadCost: "100", estimate: { total: 10000 } },
    { stage: "lead", leadSource: "paid_lead", leadCost: "100", estimate: { total: 0 } },
    { stage: "installed", leadSource: "customer_referral", leadSourceDetail: "Dave Smith ", estimate: { total: 8000 } },
    { stage: "collected", leadSource: "customer_referral", leadSourceDetail: "dave  smith", estimate: { total: 6000 } },
    { stage: "lead", leadSource: "customer_referral", leadSourceDetail: "Ann", estimate: { total: 0 } },
    { stage: "approved", estimate: { total: 5000 } },
    { stage: "approved", leadSource: "old_free_text", estimate: { total: 2000 } },
  ];
  const r = leadSourceReport(jobs, STAGES);
  const paid = r.rows.find(x => x.key === "paid_lead");
  expect(paid).toMatchObject({ jobs: 2, won: 1, closePct: 50, wonValue: 10000, spent: 200, costPerSale: 200, costPerLead: 100, returnPerDollar: 50 });
  const ref = r.rows.find(x => x.key === "customer_referral");
  expect(ref).toMatchObject({ jobs: 3, won: 2, wonValue: 14000, spent: 0, costPerSale: null, returnPerDollar: null });
  expect(r.rows.find(x => x.key === "old_free_text")).toBeTruthy();
  expect(r.rows[0].key).toBe("customer_referral"); // most closed dollars first
  expect(r.notRecorded).toMatchObject({ jobs: 1, wonValue: 5000 });
  expect(r.coverage).toBe(86);
  expect(r.topPeople[0]).toMatchObject({ name: "Dave Smith", jobs: 2, won: 2, wonValue: 14000 });
});

test("lead sources: empty list does not divide by zero", () => {
  const r = leadSourceReport([], STAGES);
  expect(r).toMatchObject({ rows: [], notRecorded: null, coverage: 0, total: 0 });
});
