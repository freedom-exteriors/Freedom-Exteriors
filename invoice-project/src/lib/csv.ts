// QuickBooks Online invoice-import CSV: one row per line, invoice fields
// repeated on every row. See docs/field-mapping.md. "Send to QuickBooks" on
// an invoice is the easier path; this file is the by-hand alternative.

import { centsToPlain, formatQuantity } from "./money";
import { toUsDate } from "./dates";
import type { InvoiceRow, LineItemRow } from "./invoice";
import { QB_SERVICE_ITEM, qbLinesFor, type QbLine } from "./qbLines";

// Column names exactly as in QuickBooks Online's own invoice-import sample
// file, so the import maps them without any matching by hand.
export const CSV_COLUMNS = [
  "InvoiceNo",
  "Customer",
  "InvoiceDate",
  "DueDate",
  "Terms",
  "Memo",
  "Item(Product/Service)",
  "ItemDescription",
  "ItemQuantity",
  "ItemRate",
  "ItemAmount",
] as const;

/** QuickBooks' own terms; anything else is left blank rather than rejected. */
const QB_TERMS = new Set(["Due on receipt", "Net 15", "Net 30", "Net 60"]);

/** QuickBooks imports at most 100 invoices per file. */
export const QB_IMPORT_MAX_INVOICES = 100;

/** Escape one CSV cell, neutralizing spreadsheet formulas. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Formula injection guard: a cell starting with = + - @ (or tab / CR,
  // which some spreadsheet apps strip first) is prefixed with a quote so
  // Excel/Sheets show it as text instead of running it.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function invoiceCsvLines(inv: InvoiceRow, items: LineItemRow[]): string[][] {
  // Same lines as "Send to QuickBooks". The import needs an amount on every
  // row, so text-only lines (no price) ride along in the next priced line's
  // description (or the last one, if they come at the end).
  const rows: QbLine[] = [];
  let pending: string[] = [];
  for (const l of qbLinesFor(inv, items)) {
    if (l.amountCents === null) {
      pending.push(l.description);
      continue;
    }
    rows.push(pending.length ? { ...l, description: `${pending.join("; ")}; ${l.description}` } : l);
    pending = [];
  }
  if (pending.length && rows.length) {
    const last = rows[rows.length - 1];
    rows[rows.length - 1] = { ...last, description: `${last.description}; ${pending.join("; ")}` };
  }
  const exact = (l: QbLine) => l.qtyMilli !== null && l.rateCents !== null && l.qtyMilli * l.rateCents === (l.amountCents ?? 0) * 1000;
  return rows.map((l) => [
    csvCell(inv.invoice_number),
    csvCell(inv.customer_name),
    toUsDate(inv.invoice_date),
    toUsDate(inv.due_date ?? inv.invoice_date), // QuickBooks requires a due date
    inv.terms && QB_TERMS.has(inv.terms) ? inv.terms : "",
    csvCell(inv.job_address ? `Job site: ${inv.job_address}` : ""),
    QB_SERVICE_ITEM,
    csvCell(l.description),
    exact(l) ? formatQuantity(l.qtyMilli!).replace(/,/g, "") : "1",
    exact(l) ? centsToPlain(l.rateCents) : centsToPlain(l.amountCents),
    centsToPlain(l.amountCents),
  ]);
}

/**
 * Invoices that can go into a QuickBooks import file: not void, not already
 * in QuickBooks (it would be a duplicate), and with a total above $0
 * (QuickBooks can't import negative or empty invoices).
 */
export function importable(inv: InvoiceRow): boolean {
  return inv.status !== "void" && !inv.qb_invoice_id && inv.contract_total_cents + inv.change_orders_total_cents > 0;
}

export function buildCsv(rows: Array<{ invoice: InvoiceRow; items: LineItemRow[] }>): string {
  const out = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const r of rows) {
    if (!importable(r.invoice)) continue;
    for (const line of invoiceCsvLines(r.invoice, r.items)) out.push(line.join(","));
  }
  // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180.
  return "\uFEFF" + out.join("\r\n") + "\r\n";
}
