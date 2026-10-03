import { parsePercentHundredths } from "../money";
import { scopeLines, type EstimateRow } from "../estimate";
import type { DocxEstimate } from "./buildInvoiceDocx";

const pct = (v: number | string | null) => (v === null || v === undefined ? null : parsePercentHundredths(String(Number(v))));

/** A saved estimate → the data the letterhead prints. */
export function docxFromEstimate(e: EstimateRow): DocxEstimate {
  return {
    estimateNumber: e.estimate_number,
    estimateDate: e.estimate_date,
    validDays: e.valid_days,
    subtitle: e.subtitle,
    tag: e.tag,
    customerName: e.customer_name,
    customerPhone: e.customer_phone,
    customerAddress: e.customer_address,
    jobAddress: e.job_address,
    scope: scopeLines(e.scope_text),
    costLines: e.items.map((i) => ({
      description: i.description,
      detail: i.detail,
      quantityMilli: i.quantity_milli,
      rateCents: i.rate_cents,
      amountCents: i.amount_cents,
    })),
    subtotalCents: e.subtotal_cents,
    overheadPercentHundredths: pct(e.overhead_percent),
    overheadCents: e.overhead_cents,
    profitPercentHundredths: pct(e.profit_percent),
    profitCents: e.profit_cents,
    contractTotalCents: e.total_cents,
    paymentTerms: e.payment_terms,
  };
}
