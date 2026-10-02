// QuickBooks-style invoice CSV: one row per line item, invoice-level fields
// repeated on every row. See docs/field-mapping.md.

import { centsToPlain } from "./money";
import { toUsDate } from "./dates";
import type { InvoiceRow, LineItemRow } from "./invoice";

export const CSV_COLUMNS = [
  "Customer",
  "Invoice No.",
  "Invoice Date",
  "Due Date",
  "Terms",
  "Item/Description",
  "Amount",
  "Balance",
  "Memo",
  "Status",
] as const;

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

/** Money cells are numbers we produced ourselves, so a leading "-" is safe. */
function moneyCell(cents: number | null | undefined): string {
  return centsToPlain(cents ?? 0);
}

const STATUS_LABEL = { outstanding: "Outstanding", paid: "Paid", void: "Void" } as const;

export function invoiceCsvLines(inv: InvoiceRow, items: LineItemRow[]): string[][] {
  const lines: Array<{ desc: string; cents: number }> = [];
  const byKind = (k: LineItemRow["kind"]) =>
    items.filter((i) => i.kind === k).sort((a, b) => a.sort_order - b.sort_order);

  const contractItems = byKind("contract_item").filter((i) => i.amount_cents !== null);
  if (inv.source === "uploaded" && contractItems.length) {
    for (const i of contractItems) lines.push({ desc: i.description, cents: i.amount_cents! });
  } else {
    const desc = inv.contract_date ? `Contract total (agreement dated ${toUsDate(inv.contract_date)})` : "Contract total";
    lines.push({ desc, cents: inv.contract_total_cents });
  }
  for (const c of byKind("change_order")) lines.push({ desc: `Change order: ${c.description}`, cents: c.amount_cents ?? 0 });
  for (const d of byKind("deposit")) {
    const when = d.line_date ? ` ${toUsDate(d.line_date)}` : "";
    lines.push({ desc: `Deposit received${when}${d.description ? ` - ${d.description}` : ""}`, cents: -(d.amount_cents ?? 0) });
  }

  return lines.map((l) => [
    csvCell(inv.customer_name),
    csvCell(inv.invoice_number),
    toUsDate(inv.invoice_date),
    toUsDate(inv.due_date),
    csvCell(inv.terms),
    csvCell(l.desc),
    moneyCell(l.cents),
    moneyCell(inv.balance_due_cents),
    csvCell(inv.job_address),
    STATUS_LABEL[inv.status],
  ]);
}

export function buildCsv(rows: Array<{ invoice: InvoiceRow; items: LineItemRow[] }>): string {
  const out = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const r of rows) for (const line of invoiceCsvLines(r.invoice, r.items)) out.push(line.join(","));
  // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180.
  return "﻿" + out.join("\r\n") + "\r\n";
}
