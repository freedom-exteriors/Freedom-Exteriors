import { parseRepEmail } from "./Pipeline";

jest.mock("./supabase", () => ({ supabase: {} }));

test("reads filled-in fields from a plain reply", () => {
  const out = parseRepEmail(`ADJUSTER NAME: Pat Jones\nADJUSTER PHONE: 651-555-1212\nHOVER ID: 998877\nESTIMATE TOTAL: $18,450.50\nDOWN PAYMENT: 5,000\nDEDUCTIBLE: 1000\nNOTES: Two layers.\nNeeds new decking on north slope.\n\nSent from my iPhone\n\nOn Oct 1, 2026, Nick wrote:\n> FREEDOM EXTERIORS — JOB INFO REQUEST`);
  expect(out).toEqual({
    adjuster: "Pat Jones", adjPhone: "651-555-1212", hoverId: "998877",
    "estimate.total": 18450.5, "estimate.downPayment": 5000, "estimate.deductible": 1000,
    notes: "Two layers.\nNeeds new decking on north slope.",
  });
});

test("reads fields filled in inside a quoted reply", () => {
  const out = parseRepEmail(`> --- FILL IN AND REPLY ---\n> ADJUSTER NAME: Sam\n> HOVER ID: 42\n> NOTES: Gutters too\n> \n`);
  expect(out).toEqual({ adjuster: "Sam", hoverId: "42", notes: "Gutters too" });
});

test("blank and unreadable values are skipped", () => {
  expect(parseRepEmail(`ADJUSTER NAME: \nESTIMATE TOTAL: TBD\n`)).toEqual({});
});
