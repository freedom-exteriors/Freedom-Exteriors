// Turns Claude's raw extraction into the review-screen form, and lists what
// needs a human look (missing, low-confidence, or non-reconciling fields).

import type { ExtractedInvoice } from "./extract";
import type { InvoiceFormInput } from "./invoice";
import { parseDollarsToCents, formatCents } from "./money";
import { isIsoDate } from "./dates";

export interface ReviewDraft {
  form: InvoiceFormInput;
  documentInvoiceNumber: string;
  flags: Record<string, string>; // field → reason
  warnings: string[];
}

const REQUIRED: Array<keyof ExtractedInvoice> = ["customer_name", "job_address", "invoice_date", "contract_total", "balance_due"];

function money(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const c = parseDollarsToCents(v);
  return c === null ? String(v) : (c / 100).toFixed(2);
}

export function draftFromExtraction(x: ExtractedInvoice): ReviewDraft {
  const flags: Record<string, string> = {};
  const warnings: string[] = [];

  for (const f of REQUIRED) {
    const v = x[f];
    if (v === null || v === undefined || v === "") flags[f] = "Missing on document. Please check.";
  }
  for (const f of x.low_confidence_fields ?? []) flags[f] = flags[f] ?? "Claude wasn't sure about this. Please check.";
  for (const f of ["invoice_date", "due_date", "contract_date"] as const) {
    if (x[f] && !isIsoDate(x[f])) flags[f] = `Couldn't read this as a date ("${x[f]}").`;
  }

  // Reconcile: contract total + change orders − deposits ≈ balance due.
  const total = parseDollarsToCents(x.contract_total);
  const balance = parseDollarsToCents(x.balance_due);
  const deps = (x.deposits ?? []).map((d) => parseDollarsToCents(d.amount) ?? 0).reduce((a, b) => a + b, 0);
  const cos = (x.change_orders ?? []).map((c) => parseDollarsToCents(c.amount) ?? 0).reduce((a, b) => a + b, 0);
  if (total !== null && balance !== null) {
    const expected = total + cos - deps;
    if (Math.abs(expected - balance) > 100) {
      warnings.push(
        `Totals don't reconcile: ${formatCents(total)} + ${formatCents(cos)} change orders − ${formatCents(deps)} deposits = ${formatCents(expected)}, but the document says balance due ${formatCents(balance)}.`,
      );
      flags.balance_due = flags.balance_due ?? "Doesn't match the other totals.";
    }
  }
  if (x.notes) warnings.push(`Note from Claude: ${x.notes}`);

  return {
    documentInvoiceNumber: (x.invoice_number ?? "").trim(),
    flags,
    warnings,
    form: {
      customerName: x.customer_name ?? "",
      customerPhone: x.customer_phone ?? "",
      jobAddress: x.job_address ?? "",
      contractDate: isIsoDate(x.contract_date) ? x.contract_date : "",
      invoiceDate: isIsoDate(x.invoice_date) ? x.invoice_date : "",
      dueDate: isIsoDate(x.due_date) ? x.due_date : "",
      scope: [],
      contractTotal: money(x.contract_total),
      deposits: (x.deposits ?? []).map((d) => ({ date: isIsoDate(d.date) ? d.date! : "", description: d.description ?? "", amount: money(d.amount) })),
      changeOrders: (x.change_orders ?? []).map((c) => ({ description: c.description ?? "", amount: money(c.amount) })),
      contractItems: (x.line_items ?? []).map((l) => ({ description: l.description ?? "", amount: money(l.amount) })),
      balanceDue: money(x.balance_due),
    },
  };
}
