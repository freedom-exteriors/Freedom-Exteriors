import { describe, expect, it } from "vitest";
import { draftFromEstimateExtraction, normalizeEstimateFields, parseOurEstimateNumber } from "@/lib/estimateImport";
import { validateEstimateInput } from "@/lib/estimate";
import { ESTIMATE_TOOL } from "@/lib/extractEstimate.server";
import { SUGGEST_TOOL } from "@/lib/suggest.server";
import { TOOL } from "@/lib/extract";

const base = {
  customer_name: "Pat Pearson", customer_phone: "", customer_email: "", customer_address: "", job_address: "12 Lake St, Mahtomedi, MN",
  subtitle: "", estimate_number: "Q-1042", estimate_date: "2026-08-14", valid_days: "", expiration_date: "2026-09-13",
  line_items: [] as unknown[], overhead_percent: "", overhead_amount: "", profit_percent: "", profit_amount: "", total: "",
  scope: [] as string[], payment_terms: "", signed_by_customer: "no", low_confidence_fields: [] as string[], notes: "",
};
const line = (description: string, quantity: string, rate: string, amount: string, unit = "") => ({ description, detail: "", quantity, unit, rate, amount });
const draft = (over: Partial<typeof base>) => draftFromEstimateExtraction(normalizeEstimateFields({ ...base, ...over }));
const savedTotal = (d: ReturnType<typeof draft>) => {
  const r = validateEstimateInput(d.form);
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.value.total_cents;
};

describe("draftFromEstimateExtraction", () => {
  it("keeps priced lines and percent overhead when they add up to the printed total", () => {
    const d = draft({
      line_items: [line("Roof replacement", "32.5", "650.00", "21125.00", "sq"), line("Dumpster", "", "", "475.00")],
      overhead_percent: "10", total: "23760.00",
    });
    expect(d.form.lines).toHaveLength(2);
    expect(d.form.lines[0]).toMatchObject({ qty: "32.5", unit: "sq", rate: "650.00" });
    expect(d.form.overheadPercent).toBe("10");
    expect(savedTotal(d)).toBe(2376000);
    expect(d.documentEstimateNumber).toBe("Q-1042");
    expect(d.form.validDays).toBe("30"); // from the expiration date
    expect(d.status).toBe("sent");
  });

  it("uses overhead/profit amounts as lines when there's no percent", () => {
    const d = draft({ line_items: [line("Siding", "", "", "10000.00")], overhead_amount: "1000.00", profit_amount: "1000.00", total: "12000.00" });
    expect(d.form.lines.map((l) => l.description)).toEqual(["Siding", "Overhead", "Profit"]);
    expect(savedTotal(d)).toBe(1200000);
  });

  it("falls back to one total line when prices don't add up, keeping the printed total exactly", () => {
    const d = draft({ line_items: [line("Gutters", "", "", "1200.00"), line("Tear-off and re-roof", "", "", "")], total: "15999.99", scope: ["Haul away debris"] });
    expect(d.form.lines).toEqual([expect.objectContaining({ description: "Estimate total", qty: "1", rate: "15999.99" })]);
    expect(d.form.scope.split("\n")).toEqual(["Haul away debris", "Gutters", "Tear-off and re-roof"]);
    expect(d.warnings[0]).toContain("didn't add up");
    expect(savedTotal(d)).toBe(1599999);
  });

  it("handles a discount line by saving the total", () => {
    const d = draft({ line_items: [line("Windows", "", "", "9000.00"), line("Discount", "", "", "-500.00")], total: "8500.00" });
    expect(d.form.lines).toHaveLength(1);
    expect(savedTotal(d)).toBe(850000);
    expect(d.warnings[0]).toContain("discount");
  });

  it("an amount that isn't qty × rate keeps the amount", () => {
    const d = draft({ line_items: [line("Fascia", "120", "8.00", "1000.00", "lf")], total: "1000.00" });
    expect(d.form.lines[0]).toMatchObject({ qty: "1", rate: "1000.00", detail: "120 lf" });
  });

  it("flags a missing date and an unknown validity, and reads a signature as accepted", () => {
    const d = draft({ estimate_date: "", expiration_date: "", line_items: [line("Door", "1", "1800", "1800")], total: "1800", signed_by_customer: "yes" });
    expect(d.form.estimateDate).toBe("");
    expect(d.warnings.join(" ")).toMatch(/No estimate date.*set to 30 days/);
    expect(d.status).toBe("accepted");
  });
});

it("recognises our own estimate numbers only", () => {
  expect(parseOurEstimateNumber("FE-EST-2026-004")).toEqual({ year: 2026, number: 4 });
  expect(parseOurEstimateNumber("Q-1042")).toBeNull();
});

/** Count schema properties whose type is a union (type array or anyOf/oneOf). */
function unionParams(schema: unknown): number {
  if (!schema || typeof schema !== "object") return 0;
  const s = schema as Record<string, unknown>;
  let n = Array.isArray(s.type) || s.anyOf || s.oneOf ? 1 : 0;
  for (const v of Object.values((s.properties as object) ?? {})) n += unionParams(v);
  if (s.items) n += unionParams(s.items);
  return n;
}

describe.each([["record_estimate", ESTIMATE_TOOL], ["suggest_estimate", SUGGEST_TOOL], ["record_invoice", TOOL]])("%s tool schema", (_name, tool) => {
  it("has no union types and requires every property at every level (strict mode)", () => {
    expect(tool.strict).toBe(true);
    expect(unionParams(tool.input_schema)).toBe(0);
    const check = (s: Record<string, unknown>) => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect(new Set(s.required as string[])).toEqual(new Set(Object.keys(s.properties as object)));
        for (const v of Object.values(s.properties as object)) check(v as Record<string, unknown>);
      }
      if (s.items) check(s.items as Record<string, unknown>);
    };
    check(tool.input_schema as unknown as Record<string, unknown>);
  });
});
