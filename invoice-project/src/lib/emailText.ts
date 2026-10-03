// Subject and body for the "Email PDF" button. Nick edits the message in
// his own mail app before sending; this is just a good starting point.
import { COMPANY } from "./company";
import { formatCents } from "./money";
import { toLongDate } from "./dates";

export interface EmailText {
  subject: string;
  body: string;
}

/** "Ilene Pearson" → "Ilene"; companies and blanks get a generic greeting. */
export function greetingName(customerName: string): string {
  const name = customerName.trim();
  if (!name || /\b(llc|inc|corp|company|co\.|association|hoa|properties|management)\b/i.test(name)) return name ? name : "there";
  return name.split(/[\s,&]+/)[0];
}

const signOff = `Thank you,\n${COMPANY.shortName}\n${COMPANY.phone}`;

export function invoiceEmail(inv: {
  invoice_number: string;
  customer_name: string;
  job_address: string | null;
  balance_due_cents: number;
  due_date: string | null;
  status: string;
}): EmailText {
  const where = inv.job_address ? ` for ${inv.job_address}` : "";
  const amount =
    inv.status === "paid" || inv.balance_due_cents <= 0
      ? "This invoice is paid in full. Thank you!"
      : `Balance due: ${formatCents(inv.balance_due_cents)}${inv.due_date ? `, due ${toLongDate(inv.due_date)}` : ""}.`;
  return {
    subject: `Invoice ${inv.invoice_number} from ${COMPANY.shortName}`,
    body: `Hi ${greetingName(inv.customer_name)},\n\nAttached is invoice ${inv.invoice_number}${where}.\n${amount}\n\nCall or text ${COMPANY.phone} with any questions.\n\n${signOff}`,
  };
}

export function estimateEmail(est: {
  estimate_number: string;
  customer_name: string;
  job_address: string | null;
  subtitle: string | null;
  total_cents: number;
  valid_days: number;
}): EmailText {
  const what = est.subtitle ? ` for ${est.subtitle}` : est.job_address ? ` for ${est.job_address}` : "";
  return {
    subject: `Estimate ${est.estimate_number} from ${COMPANY.shortName}`,
    body:
      `Hi ${greetingName(est.customer_name)},\n\nAttached is estimate ${est.estimate_number}${what}. ` +
      `Total: ${formatCents(est.total_cents)}. It's good for ${est.valid_days} days.\n\n` +
      `To go ahead, sign the Acceptance section and send it back, or just reply to this email. ` +
      `Call or text ${COMPANY.phone} with any questions.\n\n${signOff}`,
  };
}
