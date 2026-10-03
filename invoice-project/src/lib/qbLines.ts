// How an invoice becomes QuickBooks lines and payments. Used by "Send to
// QuickBooks" and by the CSV export, so both always agree.
//
// QuickBooks can't take negative invoice lines in an import, and a deposit
// already received is a payment, not a line. So the invoice total in
// QuickBooks is contract total + change orders, and each deposit becomes a
// payment against it, leaving QuickBooks' balance equal to our balance due.

import { formatPercent, parsePercentHundredths } from "./money";
import { toUsDate, todayIso } from "./dates";
import { quantityToMilli, type InvoiceRow, type LineItemRow } from "./invoice";

/**
 * The QuickBooks product/service invoice lines are filed under in the import
 * file. Create it once in QuickBooks (type: Service). The CRM's own sending
 * picks this same item by name.
 */
export const QB_SERVICE_ITEM = "Exterior Services";

export interface QbLine {
  description: string;
  qtyMilli: number | null;
  rateCents: number | null;
  /** null = a description-only line (scope text with no price). */
  amountCents: number | null;
}

export interface QbPayment {
  date: string;
  amountCents: number;
  note: string;
}

type Inv = Pick<
  InvoiceRow,
  | "contract_date" | "contract_total_cents" | "overhead_percent" | "overhead_cents" | "profit_percent" | "profit_cents"
  | "status" | "paid_date" | "balance_due_cents" | "invoice_date"
>;

const byKind = (items: LineItemRow[], k: LineItemRow["kind"]) => items.filter((i) => i.kind === k).sort((a, b) => a.sort_order - b.sort_order);
const pct = (v: number | string | null) => (v === null || v === undefined ? null : parsePercentHundredths(String(Number(v))));
const withDetail = (i: LineItemRow) => (i.detail ? `${i.description} - ${i.detail}` : i.description);

export function qbLinesFor(inv: Inv, items: LineItemRow[]): QbLine[] {
  const cost = byKind(items, "contract_item");
  const priced = cost.filter((i) => i.amount_cents !== null);
  const oh = pct(inv.overhead_percent);
  const pr = pct(inv.profit_percent);
  const itemizedTotal = priced.reduce((s, i) => s + (i.amount_cents ?? 0), 0) + (oh ? inv.overhead_cents : 0) + (pr ? inv.profit_cents : 0);
  const lines: QbLine[] = [];

  if (priced.length && itemizedTotal === inv.contract_total_cents) {
    // Lines add up to the contract total: send them as they are.
    for (const i of cost) {
      lines.push({
        description: withDetail(i),
        qtyMilli: i.amount_cents === null ? null : quantityToMilli(i.quantity),
        rateCents: i.amount_cents === null ? null : i.rate_cents,
        amountCents: i.amount_cents,
      });
    }
    if (oh) lines.push({ description: `Overhead (${formatPercent(oh)})`, qtyMilli: null, rateCents: null, amountCents: inv.overhead_cents });
    if (pr) lines.push({ description: `Profit (${formatPercent(pr)})`, qtyMilli: null, rateCents: null, amountCents: inv.profit_cents });
  } else {
    // An uploaded invoice whose lines have no prices (or don't add up to the
    // printed total): the lines go along as text, one line carries the total.
    for (const i of cost) lines.push({ description: withDetail(i), qtyMilli: null, rateCents: null, amountCents: null });
    lines.push({
      description: inv.contract_date ? `Contract total (agreement dated ${toUsDate(inv.contract_date)})` : "Contract total",
      qtyMilli: null,
      rateCents: null,
      amountCents: inv.contract_total_cents,
    });
  }
  for (const c of byKind(items, "change_order")) {
    lines.push({ description: `Change order: ${c.description}`, qtyMilli: null, rateCents: null, amountCents: c.amount_cents ?? 0 });
  }
  return lines;
}

/** Deposits received, plus the rest of the balance if the invoice is marked paid. */
export function qbPaymentsFor(inv: Inv, items: LineItemRow[]): QbPayment[] {
  const payments: QbPayment[] = byKind(items, "deposit")
    .filter((d) => (d.amount_cents ?? 0) > 0)
    .map((d) => ({ date: d.line_date ?? inv.invoice_date, amountCents: d.amount_cents!, note: d.description || "Deposit" }));
  if (inv.status === "paid" && inv.balance_due_cents > 0) {
    payments.push({ date: inv.paid_date ?? todayIso(), amountCents: inv.balance_due_cents, note: "Final payment" });
  }
  return payments;
}

/** Sum of the amounts QuickBooks will show as the invoice total. */
export function qbTotalCents(lines: QbLine[]): number {
  return lines.reduce((s, l) => s + (l.amountCents ?? 0), 0);
}
