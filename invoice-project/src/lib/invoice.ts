// Shared invoice shapes and the server-side validator. The browser sends
// amounts, quantities and percents as TEXT; the server parses them to
// integers here and computes every total itself. Client-calculated totals
// are never trusted.

import {
  computeCostTotals,
  computeTotals,
  lineAmountCents,
  parseDollarsToCents,
  parsePercentHundredths,
  parseQuantityMilli,
} from "./money";
import { isIsoDate, termsFor } from "./dates";
import { COMPANY } from "./company";

export type LineKind = "scope" | "deposit" | "change_order" | "contract_item";
export type InvoiceStatus = "outstanding" | "paid" | "void";
export type InvoiceSource = "generated" | "uploaded";

export interface CostLineInput {
  description: string;
  detail: string;
  qty: string;
  rate: string;
  /** Uploaded invoices only, when the document shows no qty/rate. */
  amount: string;
}

/** What the forms send. Amounts are dollar strings like "12,500.00". */
export interface InvoiceFormInput {
  customerName: string;
  customerPhone: string;
  /** Optional: for QuickBooks and the Email PDF message. */
  customerEmail?: string;
  /** Set when the invoice was started from a CRM job. */
  crmJobId?: number | null;
  customerAddress: string;
  jobAddress: string;
  subtitle: string;
  tag: string;
  contractDate: string;
  invoiceDate: string;
  dueDate: string;
  scope: string[];
  costLines: CostLineInput[];
  overheadPercent: string;
  profitPercent: string;
  /** Uploaded invoices only: contract total as printed. Generated: ignored. */
  contractTotal: string;
  deposits: Array<{ date: string; description: string; amount: string }>;
  changeOrders: Array<{ description: string; amount: string }>;
  paymentTerms: string;
  /** Uploaded invoices only: balance as printed on the document. */
  balanceDue?: string;
}

export interface LineItemRow {
  kind: LineKind;
  description: string;
  detail: string | null;
  /** Thousandths in memory; written to the numeric(12,3) column as text. */
  quantity: string | null;
  rate_cents: number | null;
  amount_cents: number | null;
  line_date: string | null;
  sort_order: number;
}

export interface CleanInvoice {
  customer_name: string;
  customer_phone: string | null;
  /** Saved after save_invoice() runs (that function doesn't know these). */
  customer_email: string | null;
  crm_job_id: number | null;
  customer_address: string | null;
  job_address: string | null;
  subtitle: string | null;
  tag: string | null;
  payment_terms: string | null;
  contract_date: string | null;
  invoice_date: string;
  due_date: string | null;
  terms: string | null;
  subtotal_cents: number;
  overhead_percent: string | null;
  overhead_cents: number;
  profit_percent: string | null;
  profit_cents: number;
  contract_total_cents: number;
  deposits_total_cents: number;
  change_orders_total_cents: number;
  balance_due_cents: number;
  items: LineItemRow[];
  /** Uploaded only: computed balance differs from the entered balance. */
  reconcileWarning: string | null;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_number_source: "assigned" | "from_document";
  document_invoice_number: string | null;
  duplicate_number_flag: boolean;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  crm_job_id: number | null;
  qb_invoice_id: string | null;
  qb_doc_number: string | null;
  qb_link: string | null;
  qb_sent_at: string | null;
  customer_address: string | null;
  job_address: string | null;
  subtitle: string | null;
  tag: string | null;
  payment_terms: string | null;
  contract_date: string | null;
  invoice_date: string;
  due_date: string | null;
  terms: string | null;
  subtotal_cents: number;
  overhead_percent: number | string | null;
  overhead_cents: number;
  profit_percent: number | string | null;
  profit_cents: number;
  contract_total_cents: number;
  deposits_total_cents: number;
  change_orders_total_cents: number;
  balance_due_cents: number;
  status: InvoiceStatus;
  paid_date: string | null;
  source: InvoiceSource;
  original_file_path: string | null;
  generated_file_path: string | null;
  extraction_json: unknown;
  extraction_warnings: unknown;
  created_at: string;
  updated_at: string;
}

const LIMITS = { text: 300, longText: 2000, lines: 100 };

function str(v: unknown, max = LIMITS.text): string {
  return typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "";
}

/** Optional email: "" → null; anything that isn't an address → error. */
export function cleanEmail(v: unknown, errors: string[]): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 100) : "";
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    errors.push(`Customer email "${s}" isn't a valid email address.`);
    return null;
  }
  return s;
}

/** CRM job id (a positive whole number) or null. */
export function cleanCrmJobId(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v.slice(0, LIMITS.lines) : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Thousandths → "32.500" for the numeric column. */
function milliToText(milli: number): string {
  return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, "0")}`;
}

export function validateInvoiceInput(
  body: unknown,
  source: InvoiceSource,
): { ok: true; value: CleanInvoice } | { ok: false; errors: string[] } {
  const b = obj(body);
  const errors: string[] = [];

  const customer_name = str(b.customerName);
  if (!customer_name) errors.push("Customer name is required.");

  const invoice_date = str(b.invoiceDate);
  if (!isIsoDate(invoice_date)) errors.push("Invoice date is required.");

  const optDate = (label: string, v: unknown): string | null => {
    const s = str(v);
    if (!s) return null;
    if (!isIsoDate(s)) {
      errors.push(`${label} is not a valid date.`);
      return null;
    }
    return s;
  };
  const contract_date = optDate("Contract date", b.contractDate);
  const due_date = optDate("Due date", b.dueDate);
  if (due_date && isIsoDate(invoice_date) && due_date < invoice_date) {
    errors.push("Due date is before the invoice date.");
  }

  const money = (label: string, v: unknown, required: boolean): number | null => {
    const text = str(v);
    if (!text) {
      if (required) errors.push(`${label} is required.`);
      return null;
    }
    const cents = parseDollarsToCents(text);
    if (cents === null) errors.push(`${label} is not a valid amount ("${text}").`);
    return cents;
  };

  const percent = (label: string, v: unknown): number | null => {
    const text = str(v);
    if (!text) return null;
    const h = parsePercentHundredths(text);
    if (h === null) errors.push(`${label} must be a percent between 0 and 100 ("${text}").`);
    return h || null; // 0% counts as "not used"
  };

  const items: LineItemRow[] = [];
  const blankItem = { detail: null, quantity: null, rate_cents: null, amount_cents: null, line_date: null };

  arr(b.scope).forEach((line, i) => {
    const description = str(line, LIMITS.longText);
    if (description) items.push({ ...blankItem, kind: "scope", description, sort_order: i });
  });

  // Cost lines: amount = qty × rate, computed here in integer cents.
  const lineAmounts: number[] = [];
  arr(b.costLines).forEach((raw, i) => {
    const c = obj(raw);
    const description = str(c.description, LIMITS.longText);
    const detail = str(c.detail, LIMITS.longText);
    const qtyText = str(c.qty);
    const rateText = str(c.rate);
    const amountText = str(c.amount);
    if (!description && !detail && !qtyText && !rateText && !amountText) return; // blank row
    const n = i + 1;
    if (!description) errors.push(`Line ${n} needs a description.`);

    let quantityMilli: number | null = null;
    let rate: number | null = null;
    let amount: number | null = null;
    if (rateText || source === "generated") {
      quantityMilli = qtyText ? parseQuantityMilli(qtyText) : 1000; // blank qty = 1
      if (quantityMilli === null) errors.push(`Line ${n} quantity is not a valid number ("${qtyText}").`);
      rate = money(`Line ${n} rate`, c.rate, true);
      if (quantityMilli !== null && rate !== null) amount = lineAmountCents(quantityMilli, rate);
    } else if (amountText) {
      amount = money(`Line ${n} amount`, c.amount, false);
      if (qtyText) {
        quantityMilli = parseQuantityMilli(qtyText);
        if (quantityMilli === null) errors.push(`Line ${n} quantity is not a valid number ("${qtyText}").`);
      }
    }
    if (amount !== null) lineAmounts.push(amount);
    items.push({
      ...blankItem,
      kind: "contract_item",
      description,
      detail: detail || null,
      quantity: quantityMilli === null ? null : milliToText(quantityMilli),
      rate_cents: rate,
      amount_cents: amount,
      sort_order: i,
    });
  });
  if (source === "generated" && lineAmounts.length === 0) errors.push("Add at least one line with a description, quantity and rate.");

  const overheadH = percent("Overhead", b.overheadPercent);
  const profitH = percent("Profit", b.profitPercent);

  const depositCents: number[] = [];
  arr(b.deposits).forEach((raw, i) => {
    const d = obj(raw);
    const description = str(d.description);
    const amountText = str(d.amount);
    const dateText = str(d.date);
    if (!description && !amountText && !dateText) return; // blank row
    const amount = money(`Deposit ${i + 1} amount`, d.amount, true);
    const line_date = optDate(`Deposit ${i + 1} date`, d.date);
    if (amount !== null && amount < 0) errors.push(`Deposit ${i + 1} can't be negative.`);
    if (amount !== null) depositCents.push(amount);
    items.push({ ...blankItem, kind: "deposit", description: description || "Deposit", amount_cents: amount, line_date, sort_order: i });
  });

  const changeCents: number[] = [];
  arr(b.changeOrders).forEach((raw, i) => {
    const c = obj(raw);
    const description = str(c.description);
    const amountText = str(c.amount);
    if (!description && !amountText) return;
    if (!description) errors.push(`Change order ${i + 1} needs a description.`);
    const amount = money(`Change order ${i + 1} amount`, c.amount, true);
    if (amount !== null) changeCents.push(amount); // may be negative (credit)
    items.push({ ...blankItem, kind: "change_order", description, amount_cents: amount, sort_order: i });
  });

  // Uploaded invoices keep the printed contract total; generated ones are
  // always subtotal + overhead + profit.
  const printedTotal = source === "uploaded" ? money("Contract total", b.contractTotal, false) : null;
  if (printedTotal !== null && printedTotal < 0) errors.push("Contract total can't be negative.");
  const printedBalance = source === "uploaded" ? money("Balance due", b.balanceDue, false) : null;

  if (errors.length) return { ok: false, errors };

  const cost = computeCostTotals({ lineAmountsCents: lineAmounts, overheadHundredths: overheadH, profitHundredths: profitH });
  const contractTotal = source === "uploaded" && printedTotal !== null ? printedTotal : cost.contractTotalCents;
  const totals = computeTotals({ contractTotalCents: contractTotal, depositCents, changeOrderCents: changeCents });

  let balance = totals.balanceDueCents;
  let reconcileWarning: string | null = null;
  if (source === "uploaded" && printedBalance !== null) {
    balance = printedBalance;
    // Allow a $1 rounding difference.
    if (Math.abs(printedBalance - totals.balanceDueCents) > 100) {
      reconcileWarning = "Totals don't reconcile: contract total + change orders − deposits ≠ balance due.";
    }
  }

  const paymentTerms = str(b.paymentTerms, LIMITS.longText);
  const customer_email = cleanEmail(b.customerEmail, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      customer_name,
      customer_phone: str(b.customerPhone) || null,
      customer_email,
      crm_job_id: cleanCrmJobId(b.crmJobId),
      customer_address: str(b.customerAddress, LIMITS.longText) || null,
      job_address: str(b.jobAddress, LIMITS.longText) || null,
      subtitle: str(b.subtitle) || null,
      tag: str(b.tag, 60) || null,
      payment_terms: paymentTerms || (source === "generated" ? COMPANY.defaultPaymentTerms : null),
      contract_date,
      invoice_date,
      due_date,
      terms: due_date ? termsFor(invoice_date, due_date) : null,
      subtotal_cents: cost.subtotalCents,
      overhead_percent: overheadH ? (overheadH / 100).toFixed(2) : null,
      overhead_cents: cost.overheadCents,
      profit_percent: profitH ? (profitH / 100).toFixed(2) : null,
      profit_cents: cost.profitCents,
      contract_total_cents: totals.contractTotalCents,
      deposits_total_cents: totals.depositsTotalCents,
      change_orders_total_cents: totals.changeOrdersTotalCents,
      balance_due_cents: balance,
      items,
      reconcileWarning,
    },
  };
}

/** Columns for save_invoice() from a validated invoice. */
export function invoiceColumns(v: CleanInvoice) {
  const { items: _items, reconcileWarning: _w, customer_email: _e, crm_job_id: _j, ...cols } = v;
  return cols;
}

/** Year part of a YYYY-MM-DD date. */
export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** "FE-INV-2026-014" → {year: 2026, number: 14}; anything else → null. */
export function parseOurNumber(n: string): { year: number; number: number } | null {
  const m = /^FE-INV-(\d{4})-(\d{3,})$/.exec(n.trim());
  return m ? { year: Number(m[1]), number: Number(m[2]) } : null;
}

/** numeric column value (number or "32.500") → thousandths. */
export function quantityToMilli(q: number | string | null | undefined): number | null {
  if (q === null || q === undefined || q === "") return null;
  return parseQuantityMilli(typeof q === "number" ? q.toFixed(3) : q);
}
