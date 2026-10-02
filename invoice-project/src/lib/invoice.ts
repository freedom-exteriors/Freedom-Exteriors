// Shared invoice shapes and the server-side validator. The browser sends
// dollar amounts as TEXT; the server parses them to cents here and computes
// every total itself. Client-calculated totals are never trusted.

import { computeTotals, parseDollarsToCents } from "./money";
import { isIsoDate, termsFor } from "./dates";

export type LineKind = "scope" | "deposit" | "change_order" | "contract_item";
export type InvoiceStatus = "outstanding" | "paid" | "void";
export type InvoiceSource = "generated" | "uploaded";

/** What the forms send. Amounts are dollar strings like "12,500.00". */
export interface InvoiceFormInput {
  customerName: string;
  customerPhone: string;
  jobAddress: string;
  contractDate: string;
  invoiceDate: string;
  dueDate: string;
  scope: string[];
  contractTotal: string;
  deposits: Array<{ date: string; description: string; amount: string }>;
  changeOrders: Array<{ description: string; amount: string }>;
  contractItems: Array<{ description: string; amount: string }>;
  /** Uploaded invoices only: balance as printed on the document. */
  balanceDue?: string;
}

export interface LineItemRow {
  kind: LineKind;
  description: string;
  amount_cents: number | null;
  line_date: string | null;
  sort_order: number;
}

export interface CleanInvoice {
  customer_name: string;
  customer_phone: string | null;
  job_address: string | null;
  contract_date: string | null;
  invoice_date: string;
  due_date: string | null;
  terms: string | null;
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
  job_address: string | null;
  contract_date: string | null;
  invoice_date: string;
  due_date: string | null;
  terms: string | null;
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
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v.slice(0, LIMITS.lines) : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
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
    const text = typeof v === "number" ? String(v) : str(v);
    if (!text) {
      if (required) errors.push(`${label} is required.`);
      return null;
    }
    const cents = parseDollarsToCents(text);
    if (cents === null) errors.push(`${label} is not a valid amount ("${text}").`);
    return cents;
  };

  const contractTotal = money("Contract total", b.contractTotal, source === "generated") ?? 0;
  if (contractTotal < 0) errors.push("Contract total can't be negative.");

  const items: LineItemRow[] = [];

  arr(b.scope).forEach((line, i) => {
    const description = str(line, LIMITS.longText);
    if (description) items.push({ kind: "scope", description, amount_cents: null, line_date: null, sort_order: i });
  });

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
    items.push({ kind: "deposit", description: description || "Deposit", amount_cents: amount, line_date, sort_order: i });
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
    items.push({ kind: "change_order", description, amount_cents: amount, line_date: null, sort_order: i });
  });

  arr(b.contractItems).forEach((raw, i) => {
    const c = obj(raw);
    const description = str(c.description, LIMITS.longText);
    const amountText = str(c.amount);
    if (!description && !amountText) return;
    const amount = amountText ? money(`Line item ${i + 1} amount`, c.amount, false) : null;
    items.push({ kind: "contract_item", description, amount_cents: amount, line_date: null, sort_order: i });
  });

  if (errors.length) return { ok: false, errors };

  const totals = computeTotals({ contractTotalCents: contractTotal, depositCents, changeOrderCents: changeCents });

  let balance = totals.balanceDueCents;
  let reconcileWarning: string | null = null;
  if (source === "uploaded") {
    const entered = money("Balance due", b.balanceDue, false);
    if (errors.length) return { ok: false, errors };
    if (entered !== null) {
      balance = entered;
      // Allow a $1 rounding difference.
      if (Math.abs(entered - totals.balanceDueCents) > 100) {
        reconcileWarning = "Totals don't reconcile: contract total + change orders − deposits ≠ balance due.";
      }
    }
  }

  return {
    ok: true,
    value: {
      customer_name,
      customer_phone: str(b.customerPhone) || null,
      job_address: str(b.jobAddress, LIMITS.longText) || null,
      contract_date,
      invoice_date,
      due_date,
      terms: due_date ? termsFor(invoice_date, due_date) : null,
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
  const { items: _items, reconcileWarning: _w, ...cols } = v;
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
