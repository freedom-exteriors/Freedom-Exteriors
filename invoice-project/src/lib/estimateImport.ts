// Old estimates (from before this tool): what Claude reads off the document,
// and how that becomes the review form. The rule that matters: the saved
// total must equal the total printed on the old estimate. When the line
// prices don't add up to it, the lines become scope text and one line
// carries the printed total.

import {
  centsToPlain,
  computeCostTotals,
  formatCents,
  formatQuantity,
  lineAmountCents,
  parseDollarsToCents,
  parsePercentHundredths,
  parseQuantityMilli,
} from "./money";
import { daysBetween, isIsoDate } from "./dates";
import { DEFAULT_VALID_DAYS, estimatePaymentTerms, type EstimateFormInput, type EstimateLineInput, type EstimateStatus } from "./estimate";

export const ESTIMATE_FIELDS = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "customer_address",
  "job_address",
  "subtitle",
  "estimate_number",
  "estimate_date",
  "valid_days",
  "expiration_date",
  "line_items",
  "overhead_percent",
  "overhead_amount",
  "profit_percent",
  "profit_amount",
  "total",
  "scope",
  "payment_terms",
  "signed_by_customer",
] as const;

export interface ExtractedEstimate {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  job_address: string | null;
  subtitle: string | null;
  estimate_number: string | null;
  estimate_date: string | null;
  valid_days: string | null;
  expiration_date: string | null;
  line_items: Array<{ description: string; detail: string | null; quantity: string | null; unit: string | null; rate: string | null; amount: string | null }>;
  overhead_percent: string | null;
  overhead_amount: string | null;
  profit_percent: string | null;
  profit_amount: string | null;
  total: string | null;
  scope: string[];
  payment_terms: string | null;
  signed_by_customer: "yes" | "no";
  low_confidence_fields: string[];
  notes: string | null;
}

/** Claude's tool input → clean fields ("" means "not on the document" → null). */
export function normalizeEstimateFields(input: unknown): ExtractedEstimate {
  const o = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const s = (v: unknown, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const b = o(input);
  return {
    customer_name: s(b.customer_name, 300),
    customer_phone: s(b.customer_phone, 60),
    customer_email: s(b.customer_email, 200),
    customer_address: s(b.customer_address, 500),
    job_address: s(b.job_address, 500),
    subtitle: s(b.subtitle, 300),
    estimate_number: s(b.estimate_number, 100),
    estimate_date: s(b.estimate_date, 30),
    valid_days: s(b.valid_days, 10),
    expiration_date: s(b.expiration_date, 30),
    line_items: (Array.isArray(b.line_items) ? b.line_items : []).slice(0, 100).flatMap((raw) => {
      const l = o(raw);
      const description = s(l.description, 1000);
      return description
        ? [{ description, detail: s(l.detail, 1000), quantity: s(l.quantity, 30), unit: s(l.unit, 20), rate: s(l.rate, 30), amount: s(l.amount, 30) }]
        : [];
    }),
    overhead_percent: s(b.overhead_percent, 10),
    overhead_amount: s(b.overhead_amount, 30),
    profit_percent: s(b.profit_percent, 10),
    profit_amount: s(b.profit_amount, 30),
    total: s(b.total, 30),
    scope: (Array.isArray(b.scope) ? b.scope : []).map((x) => s(x, 300)).filter((x): x is string => !!x).slice(0, 60),
    payment_terms: s(b.payment_terms),
    signed_by_customer: b.signed_by_customer === "yes" ? "yes" : "no",
    low_confidence_fields: (Array.isArray(b.low_confidence_fields) ? b.low_confidence_fields : []).filter((x): x is string => typeof x === "string"),
    notes: s(b.notes),
  };
}

export interface EstimateImportDraft {
  form: EstimateFormInput;
  documentEstimateNumber: string;
  status: Extract<EstimateStatus, "sent" | "accepted">;
  warnings: string[];
}

const plainQty = (milli: number) => formatQuantity(milli).replace(/,/g, "");
const LABELS: Record<string, string> = { customer_name: "customer name", job_address: "job site address", estimate_date: "estimate date", total: "total", line_items: "line items", estimate_number: "estimate number" };

export function draftFromEstimateExtraction(x: ExtractedEstimate): EstimateImportDraft {
  const warnings: string[] = [];
  const total = parseDollarsToCents(x.total);

  // Lines with a usable price, kept exactly; everything else is scope text.
  const priced: Array<{ line: EstimateLineInput; cents: number }> = [];
  const unpriced: string[] = [];
  let unusable = false; // a negative line (discount) or a price we can't read
  for (const l of x.line_items) {
    const text = l.detail ? `${l.description} - ${l.detail}` : l.description;
    const qty = l.quantity ? parseQuantityMilli(l.quantity) : null;
    const rate = l.rate ? parseDollarsToCents(l.rate) : null;
    const amount = l.amount ? parseDollarsToCents(l.amount) : null;
    if ((l.rate && rate === null) || (l.amount && amount === null) || (rate ?? 0) < 0 || (amount ?? 0) < 0) {
      unusable = true;
      unpriced.push(text);
      continue;
    }
    if (rate !== null && (amount === null || lineAmountCents(qty ?? 1000, rate) === amount)) {
      const q = qty ?? 1000;
      priced.push({ line: { priceBookItemId: null, description: l.description, detail: l.detail ?? "", qty: plainQty(q), unit: l.unit ?? "", rate: centsToPlain(rate) }, cents: lineAmountCents(q, rate) });
    } else if (amount !== null) {
      // Amount only (or qty × rate doesn't match it): keep the amount exactly.
      const detail = [l.detail, l.quantity ? `${l.quantity}${l.unit ? ` ${l.unit}` : ""}` : ""].filter(Boolean).join(" · ");
      priced.push({ line: { priceBookItemId: null, description: l.description, detail, qty: "1", unit: "", rate: centsToPlain(amount) }, cents: amount });
    } else {
      unpriced.push(text);
    }
  }

  let lines: EstimateLineInput[] = priced.map((p) => p.line);
  let overheadPercent = "";
  let profitPercent = "";
  const extraScope = [...unpriced];
  const amounts = priced.map((p) => p.cents);
  const ohH = parsePercentHundredths(x.overhead_percent);
  const prH = parsePercentHundredths(x.profit_percent);
  const ohAmt = parseDollarsToCents(x.overhead_amount);
  const prAmt = parseDollarsToCents(x.profit_amount);
  const withPercents = computeCostTotals({ lineAmountsCents: amounts, overheadHundredths: ohH || null, profitHundredths: prH || null }).contractTotalCents;
  const withAmounts = amounts.reduce((a, b) => a + b, 0) + Math.max(ohAmt ?? 0, 0) + Math.max(prAmt ?? 0, 0);

  if (priced.length && !unusable && (total === null || withPercents === total)) {
    if (ohH) overheadPercent = String(ohH / 100);
    if (prH) profitPercent = String(prH / 100);
    if (total === null) warnings.push("No total was found on the document. Check the lines against the original.");
  } else if (priced.length && !unusable && withAmounts === total) {
    if (ohAmt && ohAmt > 0) lines.push({ priceBookItemId: null, description: "Overhead", detail: "", qty: "1", unit: "", rate: centsToPlain(ohAmt) });
    if (prAmt && prAmt > 0) lines.push({ priceBookItemId: null, description: "Profit", detail: "", qty: "1", unit: "", rate: centsToPlain(prAmt) });
  } else if (total !== null && total >= 0) {
    if (priced.length) {
      warnings.push(
        unusable
          ? `The old estimate has a discount or a price that couldn't be read, so it's saved as one ${formatCents(total)} total line. The line text is in the scope.`
          : `The line prices didn't add up to the printed total (${formatCents(withPercents)} vs ${formatCents(total)}), so it's saved as one ${formatCents(total)} total line. The line text is in the scope.`,
      );
    }
    extraScope.unshift(...priced.map((p) => (p.line.detail ? `${p.line.description} - ${p.line.detail}` : p.line.description)));
    lines = [{ priceBookItemId: null, description: "Estimate total", detail: "As quoted on the original estimate", qty: "1", unit: "", rate: centsToPlain(total) }];
  } else {
    warnings.push("No prices or total could be read. Type the prices in from the original.");
  }

  const scope = [...x.scope];
  for (const t of extraScope) if (!scope.includes(t)) scope.push(t);

  const estimateDate = isIsoDate(x.estimate_date) ? x.estimate_date : "";
  if (!estimateDate) warnings.push(x.estimate_date ? `Couldn't read the estimate date ("${x.estimate_date}"). Type it in.` : "No estimate date on the document. Type it in.");
  let validDays = DEFAULT_VALID_DAYS;
  const vd = Number(x.valid_days);
  if (x.valid_days && Number.isInteger(vd) && vd >= 1 && vd <= 365) validDays = vd;
  else if (estimateDate && isIsoDate(x.expiration_date)) {
    const d = daysBetween(estimateDate, x.expiration_date);
    if (d >= 1 && d <= 365) validDays = d;
  } else warnings.push(`The document doesn't say how long it's valid, so it's set to ${DEFAULT_VALID_DAYS} days.`);

  const unsure = x.low_confidence_fields.map((f) => LABELS[f] ?? f.replace(/_/g, " "));
  if (unsure.length) warnings.push(`Claude wasn't sure about: ${unsure.join(", ")}. Check against the original.`);
  if (x.notes) warnings.push(`Note from Claude: ${x.notes}`);

  return {
    documentEstimateNumber: x.estimate_number ?? "",
    status: x.signed_by_customer === "yes" ? "accepted" : "sent",
    warnings,
    form: {
      customerName: x.customer_name ?? "",
      customerPhone: x.customer_phone ?? "",
      customerEmail: x.customer_email ?? "",
      customerAddress: x.customer_address ?? "",
      jobAddress: x.job_address ?? "",
      subtitle: x.subtitle ?? "",
      tag: "",
      estimateDate,
      validDays: String(validDays),
      scope: scope.join("\n"),
      lines,
      overheadPercent,
      profitPercent,
      paymentTerms: x.payment_terms ?? estimatePaymentTerms(validDays),
      attachments: [],
    },
  };
}

/** "FE-EST-2026-004" → { year: 2026, number: 4 }; other numbering → null. */
export function parseOurEstimateNumber(n: string): { year: number; number: number } | null {
  const m = /^FE-EST-(\d{4})-(\d{3,})$/.exec(n.trim());
  return m ? { year: Number(m[1]), number: Number(m[2]) } : null;
}
