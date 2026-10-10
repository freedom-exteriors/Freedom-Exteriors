import { parsePercentHundredths } from "../money";
import { quantityToMilli, type InvoiceRow, type LineItemRow } from "../invoice";
import type { DocxInvoice } from "./buildInvoiceDocx";

type DocxSource = Pick<
  InvoiceRow,
  | "invoice_number" | "invoice_date" | "due_date" | "contract_date" | "terms" | "subtitle" | "tag"
  | "customer_name" | "customer_phone" | "customer_address" | "job_address" | "subtotal_cents"
  | "overhead_percent" | "overhead_cents" | "profit_percent" | "profit_cents" | "contract_total_cents"
  | "balance_due_cents" | "payment_terms" | "status" | "paid_date"
>;

/**
 * A saved invoice + its line items → the data the letterhead prints.
 * A PAID invoice prints the final payment and a $0.00 balance, marked
 * PAID IN FULL, so it can be sent to the customer as a receipt.
 */
export function docxFromInvoice(invoice: DocxSource, items: LineItemRow[]): DocxInvoice {
  const paid = invoice.status === "paid";
  const kind = (k: LineItemRow["kind"]) => items.filter((i) => i.kind === k).sort((a, b) => a.sort_order - b.sort_order);
  const pct = (v: number | string | null) => (v === null || v === undefined ? null : parsePercentHundredths(String(Number(v))));
  return {
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    contractDate: invoice.contract_date,
    terms: invoice.terms,
    subtitle: invoice.subtitle,
    tag: paid ? [invoice.tag, "PAID IN FULL"].filter(Boolean).join(" · ") : invoice.tag,
    customerName: invoice.customer_name,
    customerPhone: invoice.customer_phone,
    customerAddress: invoice.customer_address,
    jobAddress: invoice.job_address,
    scope: kind("scope").map((s) => s.description),
    costLines: kind("contract_item").map((c) => ({
      description: c.description,
      detail: c.detail,
      quantityMilli: quantityToMilli(c.quantity),
      rateCents: c.rate_cents,
      amountCents: c.amount_cents,
    })),
    subtotalCents: invoice.subtotal_cents,
    overheadPercentHundredths: pct(invoice.overhead_percent),
    overheadCents: invoice.overhead_cents,
    profitPercentHundredths: pct(invoice.profit_percent),
    profitCents: invoice.profit_cents,
    contractTotalCents: invoice.contract_total_cents,
    deposits: kind("deposit").map((d) => ({ date: d.line_date, description: d.description, amountCents: d.amount_cents ?? 0 })),
    changeOrders: kind("change_order").map((c) => ({ description: c.description, amountCents: c.amount_cents ?? 0 })),
    finalPayment: paid && invoice.balance_due_cents > 0 ? { date: invoice.paid_date, amountCents: invoice.balance_due_cents } : null,
    paidDate: paid ? invoice.paid_date : null,
    balanceDueCents: paid ? 0 : invoice.balance_due_cents,
    paymentTerms: invoice.payment_terms,
  };
}
