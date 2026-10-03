import { describe, expect, it } from "vitest";
import { normalizeFields, TOOL } from "@/lib/extract";

/** Count schema properties whose type is a union (type array or anyOf/oneOf). */
function unionParams(schema: unknown): number {
  if (!schema || typeof schema !== "object") return 0;
  const s = schema as Record<string, unknown>;
  let n = Array.isArray(s.type) || s.anyOf || s.oneOf ? 1 : 0;
  for (const v of Object.values((s.properties as object) ?? {})) n += unionParams(v);
  if (s.items) n += unionParams(s.items);
  return n;
}

describe("extraction tool schema", () => {
  it("stays within the API's strict-mode limit of 16 union-typed parameters (we use none)", () => {
    // The live API rejected 19 with: "Schemas contains too many parameters with union types".
    expect(unionParams(TOOL.input_schema)).toBe(0);
  });
  it("is strict and requires every property, at every level", () => {
    expect(TOOL.strict).toBe(true);
    const check = (s: Record<string, unknown>) => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect(new Set(s.required as string[])).toEqual(new Set(Object.keys(s.properties as object)));
        for (const v of Object.values(s.properties as object)) check(v as Record<string, unknown>);
      }
      if (s.items) check(s.items as Record<string, unknown>);
    };
    check(TOOL.input_schema as unknown as Record<string, unknown>);
  });
});

describe("normalizeFields", () => {
  it('turns "" into null (missing) and keeps real values', () => {
    const f = normalizeFields({
      customer_name: "David Lawson", customer_phone: "", customer_address: " ", job_address: "231 Longfellow St NE",
      subtitle: "", invoice_number: "", invoice_date: "2026-09-17", due_date: "", contract_date: "",
      line_items: [{ description: "Garage door wrap", detail: "", quantity: "", rate: "", amount: "" }],
      contract_total: "13566.00", deposits: [{ date: "", description: "Down payment", amount: "6500.00" }],
      change_orders: [{ description: "Discount", amount: "-1350.00" }], balance_due: "",
      low_confidence_fields: ["customer_name"], notes: "",
    });
    expect(f.customer_phone).toBe(null);
    expect(f.customer_address).toBe(null);
    expect(f.invoice_number).toBe(null);
    expect(f.balance_due).toBe(null);
    expect(f.customer_name).toBe("David Lawson");
    expect(f.line_items[0]).toEqual({ description: "Garage door wrap", detail: null, quantity: null, rate: null, amount: null });
    expect(f.deposits[0].date).toBe(null);
    expect(f.change_orders[0].amount).toBe("-1350.00");
  });
});
