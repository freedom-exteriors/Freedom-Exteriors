import { calcCommission, leadSource } from "./CommissionWorkbook";

const c = { grossRevenue: 20000, roofMaterials: 5000, roofLabor: 3000, tier: 40 };

test("no lead fee when the lead is ours", () => {
  expect(leadSource({})).toBeNull();
  const r = calcCommission(c, false);
  expect(r.commNet).toBe(9000); // 20000 − 15% − 8000
  expect(r.commission).toBe(3600);
  expect(r.leadFee).toBe(0);
});

test("paid lead costs the same as a PAR lead: 10.5% of commissionable net", () => {
  const paid = leadSource({ paidLead: true, paidLeadSource: "Storm Leads Co" });
  expect(paid).toMatchObject({ kind: "paid", short: "Paid Lead", payee: "Storm Leads Co" });
  const par = leadSource({ parLead: true });
  expect(par.kind).toBe("par");
  const r = calcCommission(c, !!paid);
  expect(r.leadFee).toBeCloseTo(945); // 35% of the 30%-tier commission (2700)
  expect(r.repNet).toBeCloseTo(2655);
  expect(calcCommission(c, !!par).leadFee).toBeCloseTo(r.leadFee);
});

test("paid lead with no company named still reads sensibly", () => {
  expect(leadSource({ paidLead: true })).toMatchObject({ title: "Paid Lead", payee: "the lead company" });
});
