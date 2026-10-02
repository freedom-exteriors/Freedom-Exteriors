import { describe, expect, it } from "vitest";
import { parseOurNumber, validateInvoiceInput } from "@/lib/invoice";
import { draftFromExtraction } from "@/lib/review";

const base = {
  customerName: "Jane", customerPhone: "", jobAddress: "1 Main", contractDate: "2026-08-01",
  invoiceDate: "2026-10-02", dueDate: "2026-11-01", scope: ["Roof", ""], contractTotal: "10,000.00",
  deposits: [{ date: "2026-08-01", description: "Deposit", amount: "3000" }, { date: "", description: "", amount: "" }],
  changeOrders: [{ description: "Decking", amount: "500.50" }], contractItems: [],
};

describe("validateInvoiceInput", () => {
  it("computes totals on the server and ignores blank rows", () => {
    const r = validateInvoiceInput({ ...base, balanceDue: "1.00" }, "generated");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.balance_due_cents).toBe(1000000 + 50050 - 300000); // client's balanceDue ignored
    expect(r.value.terms).toBe("Net 30");
    expect(r.value.items.map((i) => i.kind)).toEqual(["scope", "deposit", "change_order"]);
  });
  it("rejects bad input", () => {
    const r = validateInvoiceInput({ ...base, customerName: " ", contractTotal: "12.345", invoiceDate: "2026-02-30" }, "generated");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Customer name/);
    expect(r.errors.join(" ")).toMatch(/Contract total/);
    expect(r.errors.join(" ")).toMatch(/Invoice date/);
  });
  it("uploaded: keeps the printed balance but warns when it doesn't reconcile", () => {
    const r = validateInvoiceInput({ ...base, balanceDue: "9000" }, "uploaded");
    expect(r.ok && r.value.balance_due_cents).toBe(900000);
    expect(r.ok && r.value.reconcileWarning).toMatch(/reconcile/);
    const ok = validateInvoiceInput({ ...base, balanceDue: "7500.50" }, "uploaded");
    expect(ok.ok && ok.value.reconcileWarning).toBe(null);
  });
  it("parses our number format, including 4+ digits", () => {
    expect(parseOurNumber("FE-INV-2026-014")).toEqual({ year: 2026, number: 14 });
    expect(parseOurNumber("FE-INV-2026-1203")).toEqual({ year: 2026, number: 1203 });
    expect(parseOurNumber("INV-1001")).toBe(null);
  });
});

describe("draftFromExtraction", () => {
  it("flags missing / low-confidence fields and non-reconciling totals", () => {
    const d = draftFromExtraction({
      customer_name: "Bob", customer_phone: null, job_address: null, invoice_number: " 1043 ",
      invoice_date: "2025-05-03", due_date: "May 30", contract_date: null,
      line_items: [{ description: "Roof", amount: "12000" }], contract_total: "12,000.00",
      deposits: [{ date: "2025-04-01", description: "Deposit", amount: "4000" }], change_orders: [],
      balance_due: "7000", low_confidence_fields: ["customer_name"], notes: null,
    });
    expect(d.documentInvoiceNumber).toBe("1043");
    expect(Object.keys(d.flags).sort()).toEqual(["balance_due", "customer_name", "due_date", "job_address"]);
    expect(d.warnings[0]).toMatch(/don't reconcile/);
    expect(d.form.contractTotal).toBe("12000.00");
    expect(d.form.dueDate).toBe("");
  });
});
