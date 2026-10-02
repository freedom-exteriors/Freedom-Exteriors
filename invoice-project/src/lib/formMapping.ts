import type { InvoiceFormInput, InvoiceRow, LineItemRow } from "./invoice";
import { centsToPlain } from "./money";

/** Saved invoice → form values for the edit screen. */
export function formFromInvoice(inv: InvoiceRow, items: LineItemRow[]): InvoiceFormInput {
  const kind = (k: LineItemRow["kind"]) => items.filter((i) => i.kind === k).sort((a, b) => a.sort_order - b.sort_order);
  return {
    customerName: inv.customer_name,
    customerPhone: inv.customer_phone ?? "",
    jobAddress: inv.job_address ?? "",
    contractDate: inv.contract_date ?? "",
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date ?? "",
    scope: kind("scope").map((s) => s.description),
    contractTotal: centsToPlain(inv.contract_total_cents),
    deposits: kind("deposit").map((d) => ({ date: d.line_date ?? "", description: d.description, amount: centsToPlain(d.amount_cents) })),
    changeOrders: kind("change_order").map((c) => ({ description: c.description, amount: centsToPlain(c.amount_cents) })),
    contractItems: kind("contract_item").map((c) => ({ description: c.description, amount: centsToPlain(c.amount_cents) })),
    balanceDue: inv.source === "uploaded" ? centsToPlain(inv.balance_due_cents) : undefined,
  };
}
