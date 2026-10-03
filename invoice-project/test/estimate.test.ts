import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  estimatePaymentTerms,
  estimateToForm,
  estimateToInvoiceForm,
  validateEstimateInput,
  type EstimateFormInput,
  type EstimateRow,
} from "@/lib/estimate";
import { validateInvoiceInput } from "@/lib/invoice";
import { buildEstimateDocx, docxPlainText } from "@/lib/docx/buildInvoiceDocx";
import { docxFromEstimate } from "@/lib/docx/fromEstimate";
import { MN_LICENSE, WI_LICENSE } from "@/lib/company";

const PB_ID = "11111111-2222-3333-4444-555555555555";

const FORM: EstimateFormInput = {
  customerName: "Pat Pearson",
  customerPhone: "651-555-0100",
  customerAddress: "",
  jobAddress: "12 Lake St, Mahtomedi, MN 55115",
  subtitle: "Deck rebuild",
  tag: "",
  estimateDate: "2026-10-03",
  validDays: "30",
  scope: "• Remove existing deck\nBuild new deck\n\n",
  lines: [
    { priceBookItemId: PB_ID, description: "Roof Replacement", detail: "GAF", qty: "32.5", unit: "sq", rate: "650" },
    { priceBookItemId: null, description: "Dumpster", detail: "", qty: "", unit: "ea", rate: "475.00" },
    { priceBookItemId: null, description: "", detail: "", qty: "", unit: "", rate: "" }, // blank row: ignored
  ],
  overheadPercent: "10",
  profitPercent: "",
  paymentTerms: "",
};

function saved(form = FORM): EstimateRow {
  const r = validateEstimateInput(form);
  if (!r.ok) throw new Error(r.errors.join(" "));
  return {
    ...r.value,
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    estimate_number: "FE-EST-2026-001",
    status: "accepted",
    invoice_id: null,
    accepted_date: "2026-10-05",
    generated_file_path: null,
    created_at: "",
    updated_at: "",
  };
}

describe("estimate validation (server math)", () => {
  it("computes qty × price, overhead and total in integer cents", () => {
    const r = validateEstimateInput(FORM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    expect(v.items).toHaveLength(2);
    expect(v.items[0]).toMatchObject({ quantity_milli: 32500, rate_cents: 65000, amount_cents: 2112500, price_book_item_id: PB_ID, unit: "sq" });
    expect(v.items[1]).toMatchObject({ quantity_milli: 1000, amount_cents: 47500, price_book_item_id: null }); // blank qty = 1
    expect(v.subtotal_cents).toBe(2160000);
    expect(v.overhead_cents).toBe(216000);
    expect(v.profit_cents).toBe(0);
    expect(v.total_cents).toBe(2376000);
    expect(v.valid_days).toBe(30);
    expect(v.payment_terms).toBe(estimatePaymentTerms(30)); // blank → default wording
    expect(v.payment_terms).toContain("valid for 30 days");
  });

  it("ignores totals sent by the browser", () => {
    const r = validateEstimateInput({ ...FORM, total_cents: 1, subtotal: "1.00" });
    expect(r.ok && r.value.total_cents).toBe(2376000);
  });

  it("rejects a checked item with no price, bad numbers and an empty estimate", () => {
    const noPrice = validateEstimateInput({ ...FORM, lines: [{ ...FORM.lines[0], rate: "" }] });
    expect(noPrice.ok).toBe(false);
    if (!noPrice.ok) expect(noPrice.errors.join(" ")).toMatch(/needs a price/);

    const bad = validateEstimateInput({ ...FORM, lines: [{ ...FORM.lines[0], qty: "abc", rate: "-5" }] });
    expect(bad.ok).toBe(false);

    const empty = validateEstimateInput({ ...FORM, lines: [] });
    expect(empty.ok).toBe(false);

    const days = validateEstimateInput({ ...FORM, validDays: "0" });
    expect(days.ok).toBe(false);

    const name = validateEstimateInput({ ...FORM, customerName: "  " });
    expect(name.ok).toBe(false);
  });

  it("drops a price_book_item_id that isn't a UUID", () => {
    const r = validateEstimateInput({ ...FORM, lines: [{ ...FORM.lines[0], priceBookItemId: "'; drop table" }] });
    expect(r.ok && r.value.items[0].price_book_item_id).toBeNull();
  });

  it("round-trips through the edit form", () => {
    const first = validateEstimateInput(FORM);
    const again = validateEstimateInput(estimateToForm(saved()));
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    // Scope text is stored as typed; everything else must come back identical.
    expect(again.value).toEqual(first.value);
  });
});

describe("Make invoice (estimate → invoice pre-fill)", () => {
  it("carries customer, lines and percents, and the invoice total equals the estimate total", () => {
    const est = saved();
    const form = estimateToInvoiceForm(est, "2026-10-10");
    expect(form.customerName).toBe("Pat Pearson");
    expect(form.contractDate).toBe("2026-10-05"); // accepted date
    expect(form.invoiceDate).toBe("2026-10-10");
    expect(form.dueDate).toBe("2026-11-09");
    expect(form.scope).toEqual(["Remove existing deck", "Build new deck"]);
    expect(form.costLines.map((l) => [l.qty, l.rate])).toEqual([["32.5", "650.00"], ["1", "475.00"]]);
    const inv = validateInvoiceInput(form, "generated");
    expect(inv.ok).toBe(true);
    if (inv.ok) {
      expect(inv.value.contract_total_cents).toBe(est.total_cents);
      expect(inv.value.overhead_cents).toBe(est.overhead_cents);
    }
  });
});

describe("estimate .docx", () => {
  it("prints BOTH license numbers, the estimate title, and the ACCEPTANCE block", async () => {
    const buf = await buildEstimateDocx(docxFromEstimate(saved()));
    const zip = await JSZip.loadAsync(buf);
    const text = docxPlainText(await zip.file("word/document.xml")!.async("string"));
    expect(text).toContain(`MN License # ${MN_LICENSE}`);
    expect(text).toContain(`WI Dwelling Contractor License # ${WI_LICENSE}`);
    expect(text).toContain("ESTIMATE & SCOPE OF WORK");
    expect(text).toContain("FE-EST-2026-001");
    expect(text).toContain("30 days");
    expect(text).toContain("ACCEPTANCE");
    expect(text).toContain("TOTAL ESTIMATE");
    expect(text).toContain("$23,760.00");
    expect(text).toContain("Remove existing deck");
    expect(text).not.toContain("ACCOUNT SUMMARY");
  });
});
