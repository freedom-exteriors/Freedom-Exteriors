// The invoice tool (invoice-project, its own Vercel app) calls the CRM
// server-to-server to read a job and to put invoices into QuickBooks through
// the CRM's single QuickBooks connection. QuickBooks rotates its login tokens,
// so two apps holding their own connection would log each other out; that's
// why the invoice tool never talks to QuickBooks directly.
//
// Auth: a shared secret in the x-invoice-tool-key header, equal to the
// INVOICE_TOOL_KEY env var set on both Vercel projects.
import crypto from "crypto";

export const TOOL_KEY_HEADER = "x-invoice-tool-key";

export function toolKeyOk(req, expected = process.env.INVOICE_TOOL_KEY) {
  const got = req.headers?.[TOOL_KEY_HEADER];
  if (!expected || expected.length < 32 || typeof got !== "string") return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** Whole cents → dollars with 2 decimals, as QuickBooks wants. */
const dollars = (cents) => Math.round(cents) / 100;

/** The job fields the invoice tool fills its forms with. */
export function jobForTool(jobId, job) {
  return {
    jobId,
    name: job.name || "",
    email: job.email || "",
    phone: job.phone || "",
    address: [job.address, [job.city, [job.state, job.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", "),
    type: job.type || "",
    claimNum: job.claimNum || "",
    insurer: job.insurer || "",
    qbInvoiceDocNumber: job.qbInvoiceDocNumber || null,
  };
}

/**
 * Validates the invoice tool's "send to QuickBooks" request. All money is in
 * integer cents (the tool's own format), converted to dollars only here.
 * Lines: {description, qtyMilli?, rateCents?, amountCents?}; a line with no
 * amount is a description-only line (scope text with no price).
 */
export function validatePush(body) {
  const b = body && typeof body === "object" ? body : {};
  const errors = [];
  const docNumber = str(b.docNumber, 40);
  // QuickBooks invoice numbers are at most 21 characters.
  if (!docNumber || docNumber.length > 21) errors.push("Invoice number is missing or longer than 21 characters");
  if (!isDate(b.txnDate)) errors.push("Invoice date is missing");
  if (b.dueDate != null && !isDate(b.dueDate)) errors.push("Due date is not a date");
  const c = b.customer && typeof b.customer === "object" ? b.customer : {};
  const customer = { name: str(c.name, 100), email: str(c.email, 100), phone: str(c.phone, 30), address: str(c.address, 300) };
  if (!customer.name) errors.push("Customer name is missing");
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) errors.push("Customer email isn't a valid address");

  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200).map((l) => ({
    description: str(l?.description, 4000),
    qtyMilli: Number.isSafeInteger(l?.qtyMilli) && l.qtyMilli > 0 ? l.qtyMilli : null,
    rateCents: Number.isSafeInteger(l?.rateCents) ? l.rateCents : null,
    amountCents: Number.isSafeInteger(l?.amountCents) ? l.amountCents : null,
  }));
  if (!lines.some((l) => l.amountCents !== null)) errors.push("The invoice has no amounts");
  if (lines.some((l) => !l.description && l.amountCents === null)) errors.push("A line has no description");
  const totalCents = lines.reduce((s, l) => s + (l.amountCents ?? 0), 0);
  if (totalCents <= 0) errors.push("The invoice total must be more than $0");

  const payments = (Array.isArray(b.payments) ? b.payments : []).slice(0, 50).map((p) => ({
    date: p?.date, amountCents: p?.amountCents, note: str(p?.note, 200),
  }));
  for (const p of payments) {
    if (!isDate(p.date) || !Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) {
      errors.push("A deposit or payment is missing its date or amount");
      break;
    }
  }
  if (payments.reduce((s, p) => s + (p.amountCents || 0), 0) > totalCents) errors.push("Payments are more than the invoice total");

  const crmJobId = Number.isSafeInteger(b.crmJobId) && b.crmJobId > 0 ? b.crmJobId : null;
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { docNumber, txnDate: b.txnDate, dueDate: b.dueDate || b.txnDate, customer, lines, totalCents, payments, memo: str(b.memo, 1000), crmJobId },
  };
}

/** One invoice line in QuickBooks' format. */
export function qbLine(l, itemId) {
  if (l.amountCents === null) return { DetailType: "DescriptionOnly", Description: l.description, DescriptionLineDetail: {} };
  const amount = dollars(l.amountCents);
  // QuickBooks rejects a line whose Amount isn't Qty x UnitPrice, so qty and
  // rate are only sent when they multiply out exactly; otherwise 1 x amount.
  const exact = l.qtyMilli !== null && l.rateCents !== null && Math.abs(l.qtyMilli * l.rateCents - l.amountCents * 1000) < 1;
  return {
    DetailType: "SalesItemLineDetail",
    Amount: amount,
    Description: l.description,
    SalesItemLineDetail: exact
      ? { ItemRef: { value: itemId }, Qty: l.qtyMilli / 1000, UnitPrice: dollars(l.rateCents) }
      : { ItemRef: { value: itemId }, Qty: 1, UnitPrice: amount },
  };
}

export function qbInvoiceBody(push, customerId, itemId) {
  return {
    DocNumber: push.docNumber,
    TxnDate: push.txnDate,
    DueDate: push.dueDate,
    CustomerRef: { value: customerId },
    ...(push.customer.email ? { BillEmail: { Address: push.customer.email } } : {}),
    Line: push.lines.map((l) => qbLine(l, itemId)),
    ...(push.memo ? { PrivateNote: push.memo } : {}),
  };
}

export function qbPaymentBody(invoice, payment) {
  return {
    CustomerRef: { value: invoice.CustomerRef.value },
    TotalAmt: dollars(payment.amountCents),
    TxnDate: payment.date,
    ...(payment.note ? { PrivateNote: payment.note.slice(0, 4000) } : {}),
    Line: [{ Amount: dollars(payment.amountCents), LinkedTxn: [{ TxnId: invoice.Id, TxnType: "Invoice" }] }],
  };
}

/** Link that opens the invoice in QuickBooks Online. */
export const qbInvoiceLink = (id) => `https://app.qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(id)}`;
