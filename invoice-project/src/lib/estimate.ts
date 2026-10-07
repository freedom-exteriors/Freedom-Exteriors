// Shared estimate shapes, the server-side validator, and the estimate →
// invoice pre-fill. Same rule as invoices: the browser sends text, the
// server parses it to integers and computes every total itself.

import {
  centsToPlain,
  computeCostTotals,
  formatQuantity,
  lineAmountCents,
  parseDollarsToCents,
  parsePercentHundredths,
  parseQuantityMilli,
} from "./money";
import { addDays, isIsoDate, todayIso } from "./dates";
import { COMPANY } from "./company";
import { cleanCrmJobId, cleanEmail, type InvoiceFormInput } from "./invoice";

export type EstimateStatus = "draft" | "sent" | "accepted" | "declined" | "void";
export const ESTIMATE_STATUSES: EstimateStatus[] = ["draft", "sent", "accepted", "declined", "void"];
export const STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  void: "Void",
};

export interface PriceBookItem {
  id: string;
  trade: string;
  label: string;
  description: string;
  detail: string | null;
  unit: string;
  default_quantity: number | string;
  rate_cents: number | null;
  sort_order: number;
  active: boolean;
  source_note: string | null;
}

export interface EstimateLineInput {
  /** Set when the line came from a price-book check box. */
  priceBookItemId: string | null;
  description: string;
  detail: string;
  qty: string;
  unit: string;
  rate: string;
  /** Browser only: where Claude got this line from. Never saved or printed. */
  note?: string;
}

/** A photo or file attached to the estimate (stored like invoice uploads). */
export const ATTACHMENT_EXTS = ["pdf", "png", "jpg", "docx"] as const;
export type AttachmentExt = (typeof ATTACHMENT_EXTS)[number];
export interface EstimateAttachment {
  uploadId: string;
  ext: AttachmentExt;
  fileName: string;
}
export const MAX_ATTACHMENTS = 20;

export interface EstimateFormInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  crmJobId?: number | null;
  customerAddress: string;
  jobAddress: string;
  subtitle: string;
  tag: string;
  estimateDate: string;
  validDays: string;
  scope: string;
  lines: EstimateLineInput[];
  overheadPercent: string;
  profitPercent: string;
  paymentTerms: string;
  attachments?: EstimateAttachment[];
}

/** One stored line (estimates.items jsonb). */
export interface EstimateItem {
  description: string;
  detail: string | null;
  /** Thousandths. */
  quantity_milli: number;
  unit: string | null;
  rate_cents: number;
  amount_cents: number;
  price_book_item_id: string | null;
}

export interface CleanEstimate {
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  crm_job_id: number | null;
  customer_address: string | null;
  job_address: string | null;
  subtitle: string | null;
  tag: string | null;
  estimate_date: string;
  valid_days: number;
  scope_text: string | null;
  payment_terms: string;
  items: EstimateItem[];
  subtotal_cents: number;
  overhead_percent: string | null;
  overhead_cents: number;
  profit_percent: string | null;
  profit_cents: number;
  total_cents: number;
  attachments: EstimateAttachment[];
}

export interface EstimateRow extends Omit<CleanEstimate, "overhead_percent" | "profit_percent"> {
  id: string;
  estimate_number: string;
  status: EstimateStatus;
  overhead_percent: number | string | null;
  profit_percent: number | string | null;
  invoice_id: string | null;
  accepted_date: string | null;
  generated_file_path: string | null;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_VALID_DAYS = 30;

export function estimatePaymentTerms(days: number | string): string {
  return COMPANY.defaultEstimatePaymentTerms.replace("{days}", String(days));
}

const LIMITS = { text: 300, longText: 4000, lines: 100 };

function str(v: unknown, max = LIMITS.text): string {
  return typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "";
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
const isUuidLike = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Keeps only well-formed attachment entries (the browser sends these back as-is). */
export function cleanAttachments(v: unknown): EstimateAttachment[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: EstimateAttachment[] = [];
  for (const raw of v) {
    const a = obj(raw);
    const uploadId = str(a.uploadId);
    const ext = str(a.ext);
    if (!isUuidLike(uploadId) || !(ATTACHMENT_EXTS as readonly string[]).includes(ext) || seen.has(uploadId)) continue;
    seen.add(uploadId);
    out.push({ uploadId: uploadId.toLowerCase(), ext: ext as AttachmentExt, fileName: str(a.fileName, 200) || `file.${ext}` });
    if (out.length === MAX_ATTACHMENTS) break;
  }
  return out;
}

export function validateEstimateInput(body: unknown): { ok: true; value: CleanEstimate } | { ok: false; errors: string[] } {
  const b = obj(body);
  const errors: string[] = [];

  const customer_name = str(b.customerName);
  if (!customer_name) errors.push("Customer name is required.");
  const estimate_date = str(b.estimateDate);
  if (!isIsoDate(estimate_date)) errors.push("Estimate date is required.");

  const daysText = str(b.validDays);
  const valid_days = daysText === "" ? DEFAULT_VALID_DAYS : Number(daysText);
  if (!Number.isInteger(valid_days) || valid_days < 1 || valid_days > 365) errors.push("Valid for must be a whole number of days from 1 to 365.");

  const items: EstimateItem[] = [];
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, LIMITS.lines) : [];
  lines.forEach((raw, i) => {
    const l = obj(raw);
    const description = str(l.description, LIMITS.longText);
    const detail = str(l.detail, LIMITS.longText);
    const qtyText = str(l.qty);
    const rateText = str(l.rate);
    if (!description && !detail && !qtyText && !rateText) return; // blank row
    const n = i + 1;
    if (!description) errors.push(`Line ${n} needs a description.`);
    const quantity_milli = qtyText ? parseQuantityMilli(qtyText) : 1000; // blank qty = 1
    if (quantity_milli === null) errors.push(`Line ${n} quantity is not a valid number ("${qtyText}").`);
    let rate_cents: number | null = null;
    if (!rateText) errors.push(`Line ${n} (${description || "no description"}) needs a price.`);
    else {
      rate_cents = parseDollarsToCents(rateText);
      if (rate_cents === null) errors.push(`Line ${n} price is not a valid amount ("${rateText}").`);
      else if (rate_cents < 0) errors.push(`Line ${n} price can't be negative.`);
    }
    if (quantity_milli === null || rate_cents === null) return;
    const id = str(l.priceBookItemId);
    items.push({
      description,
      detail: detail || null,
      quantity_milli,
      unit: str(l.unit, 20) || null,
      rate_cents,
      amount_cents: lineAmountCents(quantity_milli, rate_cents),
      price_book_item_id: id && isUuidLike(id) ? id : null,
    });
  });
  if (!errors.length && items.length === 0) errors.push("Check at least one item (or add a custom line) with a price.");

  const percent = (label: string, v: unknown): number | null => {
    const text = str(v);
    if (!text) return null;
    const h = parsePercentHundredths(text);
    if (h === null) errors.push(`${label} must be a percent between 0 and 100 ("${text}").`);
    return h || null;
  };
  const customer_email = cleanEmail(b.customerEmail, errors);
  const overheadH = percent("Overhead", b.overheadPercent);
  const profitH = percent("Profit", b.profitPercent);

  if (errors.length) return { ok: false, errors };

  const cost = computeCostTotals({ lineAmountsCents: items.map((i) => i.amount_cents), overheadHundredths: overheadH, profitHundredths: profitH });
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
      estimate_date,
      valid_days,
      scope_text: str(b.scope, LIMITS.longText) || null,
      payment_terms: str(b.paymentTerms, LIMITS.longText) || estimatePaymentTerms(valid_days),
      items,
      subtotal_cents: cost.subtotalCents,
      overhead_percent: overheadH ? (overheadH / 100).toFixed(2) : null,
      overhead_cents: cost.overheadCents,
      profit_percent: profitH ? (profitH / 100).toFixed(2) : null,
      profit_cents: cost.profitCents,
      total_cents: cost.contractTotalCents,
      attachments: cleanAttachments(b.attachments),
    },
  };
}

/** Scope text (one item per line) → list, without bullets or blanks. */
export function scopeLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean);
}

const pctText = (v: number | string | null) => (v === null || v === undefined ? "" : String(Number(v)));

/** Saved estimate → editable form. */
export function estimateToForm(e: EstimateRow): EstimateFormInput {
  return {
    customerName: e.customer_name,
    customerPhone: e.customer_phone ?? "",
    customerEmail: e.customer_email ?? "",
    crmJobId: e.crm_job_id ?? null,
    customerAddress: e.customer_address ?? "",
    jobAddress: e.job_address ?? "",
    subtitle: e.subtitle ?? "",
    tag: e.tag ?? "",
    estimateDate: e.estimate_date,
    validDays: String(e.valid_days),
    scope: e.scope_text ?? "",
    lines: e.items.map((i) => ({
      priceBookItemId: i.price_book_item_id,
      description: i.description,
      detail: i.detail ?? "",
      qty: formatQuantity(i.quantity_milli).replace(/,/g, ""),
      unit: i.unit ?? "",
      rate: centsToPlain(i.rate_cents),
    })),
    overheadPercent: pctText(e.overhead_percent),
    profitPercent: pctText(e.profit_percent),
    paymentTerms: e.payment_terms ?? "",
    attachments: e.attachments ?? [],
  };
}

/**
 * Accepted estimate → a pre-filled NEW invoice form. Nothing is saved and
 * no invoice number is used until Nick clicks Create on the invoice page.
 */
export function estimateToInvoiceForm(e: EstimateRow, today = todayIso()): InvoiceFormInput {
  return {
    customerName: e.customer_name,
    customerPhone: e.customer_phone ?? "",
    customerEmail: e.customer_email ?? "",
    crmJobId: e.crm_job_id ?? null,
    customerAddress: e.customer_address ?? "",
    jobAddress: e.job_address ?? "",
    subtitle: e.subtitle ?? "",
    tag: "",
    contractDate: e.accepted_date ?? today,
    invoiceDate: today,
    dueDate: addDays(today, COMPANY.defaultTermsDays),
    scope: scopeLines(e.scope_text).length ? scopeLines(e.scope_text) : [""],
    costLines: e.items.map((i) => ({
      description: i.description,
      detail: i.detail ?? "",
      qty: formatQuantity(i.quantity_milli).replace(/,/g, ""),
      rate: centsToPlain(i.rate_cents),
      amount: "",
    })),
    overheadPercent: pctText(e.overhead_percent),
    profitPercent: pctText(e.profit_percent),
    contractTotal: "",
    deposits: [],
    changeOrders: [],
    paymentTerms: COMPANY.defaultPaymentTerms,
  };
}
