import { describe, expect, it } from "vitest";
import { qbLinesFor, qbPaymentsFor, qbTotalCents } from "@/lib/qbLines";
import { validateInvoiceInput, invoiceColumns, type LineItemRow } from "@/lib/invoice";
import { estimateToInvoiceForm, validateEstimateInput } from "@/lib/estimate";
import { SAMPLE_FORM } from "./fixtures/sampleInvoice";

const li = (o: Partial<LineItemRow> & Pick<LineItemRow, "kind" | "description">): LineItemRow => ({
  detail: null, quantity: null, rate_cents: null, amount_cents: null, line_date: null, sort_order: 0, ...o,
});
const base = {
  contract_date: null, contract_total_cents: 0, overhead_percent: null, overhead_cents: 0, profit_percent: null, profit_cents: 0,
  status: "outstanding" as const, paid_date: null, balance_due_cents: 0, invoice_date: "2026-10-02",
};

describe("QuickBooks lines and payments", () => {
  it("Lawson (uploaded, no line prices): text lines + one contract total; deposits become payments", () => {
    // The real Lawson invoice: total $13,492.46, change order $225, deposits $2,500 + $4,000.
    const inv = { ...base, contract_total_cents: 1349246, balance_due_cents: 721746 };
    const items = [
      li({ kind: "contract_item", description: "Garage door (7' x 16') wrapped" }),
      li({ kind: "contract_item", description: "Dumpster and job site cleanup", sort_order: 1 }),
      li({ kind: "change_order", description: "Squirrel trap removal", amount_cents: 22500 }),
      li({ kind: "deposit", description: "Deposit received 1", amount_cents: 250000 }),
      li({ kind: "deposit", description: "Deposit received 2", amount_cents: 400000, line_date: "2026-09-20", sort_order: 1 }),
    ];
    const lines = qbLinesFor(inv, items);
    expect(lines.map((l) => l.amountCents)).toEqual([null, null, 1349246, 22500]);
    const payments = qbPaymentsFor(inv, items);
    expect(payments).toEqual([
      { date: "2026-10-02", amountCents: 250000, note: "Deposit received 1" }, // no date on it: invoice date
      { date: "2026-09-20", amountCents: 400000, note: "Deposit received 2" },
    ]);
    // QuickBooks' balance after the payments = our balance due.
    expect(qbTotalCents(lines) - payments.reduce((s, p) => s + p.amountCents, 0)).toBe(721746);
  });

  it("a paid invoice also sends the final payment on the paid date", () => {
    const inv = { ...base, contract_total_cents: 100000, balance_due_cents: 60000, status: "paid" as const, paid_date: "2026-10-15" };
    const items = [
      li({ kind: "contract_item", description: "Roof", quantity: "1.000", rate_cents: 100000, amount_cents: 100000 }),
      li({ kind: "deposit", description: "Deposit", amount_cents: 40000, line_date: "2026-09-01" }),
    ];
    expect(qbPaymentsFor(inv, items)).toEqual([
      { date: "2026-09-01", amountCents: 40000, note: "Deposit" },
      { date: "2026-10-15", amountCents: 60000, note: "Final payment" },
    ]);
    expect(qbLinesFor(inv, items)).toEqual([{ description: "Roof", qtyMilli: 1000, rateCents: 100000, amountCents: 100000 }]);
  });

  it("generated invoice: lines add up to the server's contract total", () => {
    const r = validateInvoiceInput(SAMPLE_FORM, "generated");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const v = r.value;
    const lines = qbLinesFor({ ...base, ...v, status: "outstanding", paid_date: null }, v.items);
    expect(qbTotalCents(lines)).toBe(v.contract_total_cents + v.change_orders_total_cents);
    expect(lines.every((l) => l.amountCents !== null)).toBe(true);
  });
});

describe("customer email and CRM job", () => {
  it("invoices: email optional, checked when given; kept out of save_invoice()", () => {
    const ok = validateInvoiceInput({ ...SAMPLE_FORM, customerEmail: " jane@example.com ", crmJobId: 1779216991968 }, "generated");
    expect(ok.ok && ok.value.customer_email).toBe("jane@example.com");
    expect(ok.ok && ok.value.crm_job_id).toBe(1779216991968);
    if (ok.ok) expect(invoiceColumns(ok.value)).not.toHaveProperty("customer_email");
    const bad = validateInvoiceInput({ ...SAMPLE_FORM, customerEmail: "jane at example" }, "generated");
    expect(bad.ok).toBe(false);
    const none = validateInvoiceInput({ ...SAMPLE_FORM, crmJobId: "abc" }, "generated");
    expect(none.ok && none.value.customer_email).toBe(null);
    expect(none.ok && none.value.crm_job_id).toBe(null);
  });

  it("Make invoice carries the estimate's email and CRM job to the invoice", () => {
    const est = validateEstimateInput({
      customerName: "Pat", customerPhone: "", customerEmail: "pat@example.com", crmJobId: 42, customerAddress: "", jobAddress: "",
      subtitle: "", tag: "", estimateDate: "2026-10-03", validDays: "30", scope: "",
      lines: [{ priceBookItemId: null, description: "Deck", detail: "", qty: "1", unit: "ea", rate: "100" }],
      overheadPercent: "", profitPercent: "", paymentTerms: "",
    });
    if (!est.ok) throw new Error(est.errors.join(" "));
    const form = estimateToInvoiceForm({ ...est.value, id: "x", estimate_number: "FE-EST-2026-001", status: "accepted", invoice_id: null, accepted_date: null, generated_file_path: null, created_at: "", updated_at: "" });
    expect(form.customerEmail).toBe("pat@example.com");
    expect(form.crmJobId).toBe(42);
  });
});
