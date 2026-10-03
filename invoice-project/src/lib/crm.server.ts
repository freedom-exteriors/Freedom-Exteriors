import "server-only";

// Calls to the CRM (freedom-exteriors.vercel.app), server to server. The CRM
// owns the one QuickBooks connection; this app asks it to read a job and to
// create invoices/payments in QuickBooks. Authenticated by INVOICE_TOOL_KEY,
// the same secret set on both Vercel projects. Never sent to the browser.

export class CrmError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface CrmJob {
  jobId: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  type: string;
  claimNum: string;
  insurer: string;
  qbInvoiceDocNumber: string | null;
}

const CRM_URL = (process.env.CRM_URL || "https://freedom-exteriors.vercel.app").replace(/\/$/, "");

export async function crmCall<T>(action: "tool-job" | "tool-invoice" | "tool-payment", body: unknown): Promise<T> {
  const key = process.env.INVOICE_TOOL_KEY;
  if (!key || key.length < 32) throw new CrmError("The link to the CRM isn't set up (INVOICE_TOOL_KEY is missing).", 500);
  let res: Response;
  try {
    res = await fetch(`${CRM_URL}/api/quickbooks?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-invoice-tool-key": key },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new CrmError("Couldn't reach the CRM. Try again in a minute.", 502);
  }
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new CrmError(out.error || `CRM error ${res.status}`, res.status);
  return out as T;
}
