import { quantityToMilli, type InvoiceFormInput, type InvoiceRow, type LineItemRow } from "./invoice";
import { centsToPlain, formatQuantity } from "./money";

/** Saved invoice → form values for the edit screen. */
export function formFromInvoice(inv: InvoiceRow, items: LineItemRow[]): InvoiceFormInput {
  const kind = (k: LineItemRow["kind"]) => items.filter((i) => i.kind === k).sort((a, b) => a.sort_order - b.sort_order);
  const pct = (v: number | string | null) => (v === null || v === undefined ? "" : String(Number(v)));
  return {
    customerName: inv.customer_name,
    customerPhone: inv.customer_phone ?? "",
    customerEmail: inv.customer_email ?? "",
    crmJobId: inv.crm_job_id ?? null,
    customerAddress: inv.customer_address ?? "",
    jobAddress: inv.job_address ?? "",
    subtitle: inv.subtitle ?? "",
    tag: inv.tag ?? "",
    contractDate: inv.contract_date ?? "",
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date ?? "",
    scope: kind("scope").map((s) => s.description),
    costLines: kind("contract_item").map((c) => {
      const milli = quantityToMilli(c.quantity);
      return {
        description: c.description,
        detail: c.detail ?? "",
        qty: milli === null ? "" : formatQuantity(milli).replace(/,/g, ""),
        rate: c.rate_cents === null ? "" : centsToPlain(c.rate_cents),
        amount: c.rate_cents === null ? centsToPlain(c.amount_cents) : "",
      };
    }),
    overheadPercent: pct(inv.overhead_percent),
    profitPercent: pct(inv.profit_percent),
    contractTotal: inv.source === "uploaded" ? centsToPlain(inv.contract_total_cents) : "",
    deposits: kind("deposit").map((d) => ({ date: d.line_date ?? "", description: d.description, amount: centsToPlain(d.amount_cents) })),
    changeOrders: kind("change_order").map((c) => ({ description: c.description, amount: centsToPlain(c.amount_cents) })),
    paymentTerms: inv.payment_terms ?? "",
    balanceDue: inv.source === "uploaded" ? centsToPlain(inv.balance_due_cents) : undefined,
  };
}
