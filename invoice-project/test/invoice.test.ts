import { describe, expect, it } from "vitest";
import { parseOurNumber, validateInvoiceInput, type InvoiceFormInput } from "@/lib/invoice";
import { draftFromExtraction } from "@/lib/review";
import { COMPANY } from "@/lib/company";

const base: InvoiceFormInput = {
  customerName: "Jane", customerPhone: "", customerAddress: "", jobAddress: "1 Main", subtitle: "Roof", tag: "",
  contractDate: "2026-08-01", invoiceDate: "2026-10-02", dueDate: "2026-11-01", scope: ["Roof", ""],
  costLines: [
    { description: "Shingles", detail: "GAF", qty: "32.5", rate: "245.00", amount: "" }, // 7,962.50
    { description: "Boots", detail: "", qty: "", rate: "45", amount: "" }, // qty blank = 1 → 45.00
    { description: "", detail: "", qty: "", rate: "", amount: "" }, // blank row ignored
  ],
  overheadPercent: "10", profitPercent: "", contractTotal: "999999", // ignored for generated
  deposits: [{ date: "2026-08-01", description: "Deposit", amount: "3000" }, { date: "", description: "", amount: "" }],
  changeOrders: [{ description: "Decking", amount: "500.50" }], paymentTerms: "",
};

describe("validateInvoiceInput (generated)", () => {
  it("computes qty × rate, overhead, contract total and balance on the server", () => {
    const r = validateInvoiceInput({ ...base, balanceDue: "1.00" }, "generated");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    expect(v.items.filter((i) => i.kind === "contract_item").map((i) => [i.quantity, i.rate_cents, i.amount_cents])).toEqual([
      ["32.500", 24500, 796250],
      ["1.000", 4500, 4500],
    ]);
    expect(v.subtotal_cents).toBe(800750);
    expect(v.overhead_cents).toBe(80075);
    expect(v.profit_cents).toBe(0);
    expect(v.profit_percent).toBe(null);
    expect(v.contract_total_cents).toBe(880825); // printed contractTotal ignored
    expect(v.balance_due_cents).toBe(880825 + 50050 - 300000); // client balanceDue ignored
    expect(v.terms).toBe("Net 30");
    expect(v.payment_terms).toBe(COMPANY.defaultPaymentTerms); // default when blank
  });
  it("rounds qty × rate half-up in cents", () => {
    const r = validateInvoiceInput({ ...base, overheadPercent: "", costLines: [{ description: "x", detail: "", qty: "0.333", rate: "0.05", amount: "" }] }, "generated");
    // 0.333 × 5¢ = 1.665¢ → 2¢
    expect(r.ok && r.value.subtotal_cents).toBe(2);
  });
  it("rejects bad input", () => {
    const r = validateInvoiceInput(
      { ...base, customerName: " ", invoiceDate: "2026-02-30", overheadPercent: "150", costLines: [{ description: "x", detail: "", qty: "abc", rate: "12.345", amount: "" }] },
      "generated",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/Customer name/);
    expect(msg).toMatch(/Invoice date/);
    expect(msg).toMatch(/quantity/);
    expect(msg).toMatch(/rate/);
    expect(msg).toMatch(/Overhead/);
  });
  it("requires at least one priced line", () => {
    const r = validateInvoiceInput({ ...base, costLines: [] }, "generated");
    expect(r.ok).toBe(false);
  });
});

describe("validateInvoiceInput (uploaded)", () => {
  const up: InvoiceFormInput = {
    ...base, overheadPercent: "", contractTotal: "10000",
    costLines: [{ description: "Roof", detail: "", qty: "", rate: "", amount: "10000" }],
  };
  it("keeps printed contract total and balance, warns when they don't reconcile", () => {
    const r = validateInvoiceInput({ ...up, balanceDue: "9000" }, "uploaded");
    expect(r.ok && r.value.contract_total_cents).toBe(1000000);
    expect(r.ok && r.value.balance_due_cents).toBe(900000);
    expect(r.ok && r.value.reconcileWarning).toMatch(/reconcile/);
    const ok = validateInvoiceInput({ ...up, balanceDue: "7500.50" }, "uploaded");
    expect(ok.ok && ok.value.reconcileWarning).toBe(null);
    expect(ok.ok && ok.value.items.find((i) => i.kind === "contract_item")?.amount_cents).toBe(1000000);
  });
});

describe("parseOurNumber", () => {
  it("parses our number format, including 4+ digits", () => {
    expect(parseOurNumber("FE-INV-2026-014")).toEqual({ year: 2026, number: 14 });
    expect(parseOurNumber("FE-INV-2026-1203")).toEqual({ year: 2026, number: 1203 });
    expect(parseOurNumber("INV-1001")).toBe(null);
  });
});

describe("draftFromExtraction", () => {
  it("flags missing / low-confidence fields and non-reconciling totals", () => {
    const d = draftFromExtraction({
      customer_name: "Bob", customer_phone: null, customer_address: null, job_address: null, subtitle: null,
      invoice_number: " 1043 ", invoice_date: "2025-05-03", due_date: "May 30", contract_date: null,
      line_items: [
        { description: "Roof", detail: "30 sq", quantity: "30", rate: "400", amount: "12000" },
        { description: "Permit", detail: null, quantity: null, rate: null, amount: "150" },
      ],
      contract_total: "12,000.00",
      deposits: [{ date: "2025-04-01", description: "Deposit", amount: "4000" }], change_orders: [],
      balance_due: "7000", low_confidence_fields: ["customer_name"], notes: null,
    });
    expect(d.documentInvoiceNumber).toBe("1043");
    expect(Object.keys(d.flags).sort()).toEqual(["balance_due", "customer_name", "due_date", "job_address"]);
    expect(d.warnings[0]).toMatch(/don't reconcile/);
    expect(d.form.contractTotal).toBe("12000.00");
    expect(d.form.dueDate).toBe("");
    expect(d.form.costLines).toEqual([
      { description: "Roof", detail: "30 sq", qty: "30", rate: "400.00", amount: "12000.00" },
      { description: "Permit", detail: "", qty: "", rate: "", amount: "150.00" },
    ]);
  });
});
