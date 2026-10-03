import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { buildEstimatePdf, buildInvoicePdf } from "@/lib/pdf/buildPdf";
import { estimatePaymentTerms } from "@/lib/estimate";
import { estimateEmail, greetingName, invoiceEmail } from "@/lib/emailText";
import { MN_LICENSE, WI_LICENSE } from "@/lib/company";
import { sampleDocxInput, SAMPLE_FORM } from "./fixtures/sampleInvoice";
import { validateInvoiceInput, type InvoiceRow } from "@/lib/invoice";
import { docxFromInvoice } from "@/lib/docx/fromInvoice";
import { PEARSON_FORM } from "./fixtures/pearsonInvoice";

/** Text drawn on the PDF's pages (pdfkit writes hex strings inside TJ arrays). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m; (m = re.exec(raw)); ) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      continue; // image or font data
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      out.push([...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], "hex").toString("latin1")).join(""));
    }
  }
  return out.join("\n");
}

/** Same, with line breaks (wrapped table cells) as plain spaces. */
const flat = (buf: Buffer) => pdfText(buf).replace(/\s+/g, " ");

const pearson = sampleDocxInput(PEARSON_FORM).docx;

describe("invoice PDF", () => {
  it("prints BOTH license numbers, even on a minimal invoice", async () => {
    const minimal = sampleDocxInput({ ...SAMPLE_FORM, subtitle: "", tag: "", scope: [], deposits: [], changeOrders: [], customerAddress: "", jobAddress: "" }).docx;
    for (const inv of [sampleDocxInput().docx, minimal]) {
      const text = pdfText(await buildInvoicePdf(inv));
      expect(text).toContain(`MN License # ${MN_LICENSE}`);
      expect(text).toContain(`WI Dwelling Contractor License # ${WI_LICENSE}`);
    }
  });

  it("has the invoice sections and server totals", async () => {
    const buf = await buildInvoicePdf({ ...pearson, invoiceNumber: "FE-INV-2026-001" });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = flat(buf);
    for (const s of ["INVOICE", "FE-INV-2026-001", "COST DETAIL", "CONTRACT TOTAL", "ACCOUNT SUMMARY", "BALANCE DUE", "PAYMENT TERMS", "$27,764.40", "$14,522.20"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("ACCEPTANCE");
  });
});

describe("uploaded invoice PDF (lines without prices, printed total)", () => {
  it("leaves unpriced amounts blank and shows no $0.00 subtotal", async () => {
    const r = validateInvoiceInput(
      {
        ...SAMPLE_FORM,
        costLines: [
          { description: "Tear off and replace roof", detail: "", qty: "", rate: "", amount: "" },
          { description: "New gutters", detail: "", qty: "", rate: "", amount: "" },
        ],
        overheadPercent: "",
        profitPercent: "",
        contractTotal: "18,500.00",
        deposits: [{ date: "2026-09-16", description: "Deposit", amount: "9,250.00" }],
        changeOrders: [],
        balanceDue: "9,250.00",
      },
      "uploaded",
    );
    if (!r.ok) throw new Error(r.errors.join(" "));
    const { items, reconcileWarning: _w, ...v } = r.value;
    const docx = docxFromInvoice({ ...v, invoice_number: "FE-INV-2026-001" } as unknown as InvoiceRow, items);
    const text = flat(await buildInvoicePdf(docx));
    expect(text).toContain("Tear off and replace roof");
    expect(text).toContain("CONTRACT TOTAL $18,500.00");
    expect(text).toContain("BALANCE DUE $9,250.00");
    expect(text).not.toContain("Subtotal");
    expect(text).not.toContain("$0.00");
    expect(text).toContain(`WI Dwelling Contractor License # ${WI_LICENSE}`);
  });
});

describe("estimate PDF", () => {
  it("prints both license numbers, the estimate title and the ACCEPTANCE block", async () => {
    const text = flat(
      await buildEstimatePdf({ ...pearson, estimateNumber: "FE-EST-2026-001", estimateDate: pearson.invoiceDate, validDays: 30, paymentTerms: estimatePaymentTerms(30) }),
    );
    for (const s of [`MN License # ${MN_LICENSE}`, `WI Dwelling Contractor License # ${WI_LICENSE}`, "ESTIMATE & SCOPE OF WORK", "FE-EST-2026-001", "30 days", "TOTAL ESTIMATE", "$27,764.40", "ACCEPTANCE", "Client"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("ACCOUNT SUMMARY");
  });

  it("doesn't break on characters the PDF fonts can't draw", async () => {
    const buf = await buildEstimatePdf({ ...pearson, customerName: "Zoë 🏠 Ng ≥", estimateNumber: "FE-EST-2026-002", estimateDate: pearson.invoiceDate, validDays: 30, paymentTerms: "" });
    expect(pdfText(buf)).toContain("Zoë  Ng ");
  });
});

describe("email text", () => {
  it("greets by first name and states the amount", () => {
    expect(greetingName("Ilene Pearson")).toBe("Ilene");
    expect(greetingName("Lakeview HOA")).toBe("Lakeview HOA");
    expect(greetingName("  ")).toBe("there");
    const inv = invoiceEmail({ invoice_number: "FE-INV-2026-001", customer_name: "Ilene Pearson", job_address: "2887 Bartelmy Ln", balance_due_cents: 1452220, due_date: "2026-10-31", status: "outstanding" });
    expect(inv.subject).toBe("Invoice FE-INV-2026-001 from Freedom Exteriors");
    expect(inv.body).toContain("Hi Ilene,");
    expect(inv.body).toContain("Balance due: $14,522.20, due October 31, 2026.");
    expect(invoiceEmail({ invoice_number: "X", customer_name: "A B", job_address: null, balance_due_cents: 0, due_date: null, status: "paid" }).body).toContain("paid in full");
    const est = estimateEmail({ estimate_number: "FE-EST-2026-001", customer_name: "Ilene Pearson", job_address: null, subtitle: "Deck rebuild", total_cents: 2776440, valid_days: 30 });
    expect(est.body).toContain("estimate FE-EST-2026-001 for Deck rebuild. Total: $27,764.40. It's good for 30 days.");
  });
});
