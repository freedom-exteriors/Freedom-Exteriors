// QuickBooks Online: connect (OAuth) and create an invoice for a job.
// Tokens live server-side in integration_tokens — never in the browser or a URL.
//   POST ?action=start    (admin)  -> { url } to send the browser to Intuit
//   GET  ?action=callback (Intuit) -> stores tokens, back to the app
//   GET  ?action=status   (admin)  -> { connected, company }
//   POST ?action=invoice  (admin)  { jobId } -> { invoiceId, docNumber }
//   POST ?action=disconnect (admin)
import { requireStaff, supabaseAdmin } from "./_lib/supabase.js";
import { APP_ORIGIN, getIntegration, setIntegration, clearIntegration, createOAuthState, consumeOAuthState } from "./_lib/integrations.js";

const PROVIDER = "quickbooks";
const REDIRECT_URI = `${APP_ORIGIN}/quickbooks/callback`;
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
// Intuit "Development" keys only work against the sandbox; set QB_ENVIRONMENT=sandbox to test with them.
const API_BASE = process.env.QB_ENVIRONMENT === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";

function basicAuth() {
  return Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  return res.json().catch(() => ({}));
}

function toStored(tokens, realmId) {
  return {
    realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    refresh_expires_at: Date.now() + (tokens.x_refresh_token_expires_in || 100 * 86400) * 1000,
  };
}

async function connection() {
  const stored = await getIntegration(PROVIDER);
  if (!stored?.refresh_token || !stored.realmId) return null;
  if (Date.now() < stored.expires_at - 60000) return stored;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: stored.refresh_token });
  if (!fresh.access_token) return null; // refresh token expired or revoked: reconnect
  const next = toStored({ ...fresh, refresh_token: fresh.refresh_token || stored.refresh_token }, stored.realmId);
  await setIntegration(PROVIDER, { ...stored, ...next });
  return { ...stored, ...next };
}

async function qb(conn, method, path, body) {
  const res = await fetch(`${API_BASE}/v3/company/${conn.realmId}/${path}${path.includes("?") ? "&" : "?"}minorversion=73`, {
    method,
    headers: { Authorization: `Bearer ${conn.access_token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.Fault?.Error?.[0]?.Detail || data?.Fault?.Error?.[0]?.Message || `QuickBooks error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findOrCreateCustomer(conn, job) {
  const name = String(job.name || "").trim().slice(0, 100);
  if (!name) throw new Error("This job has no customer name");
  const found = await qb(conn, "GET", `query?query=${encodeURIComponent(`select * from Customer where DisplayName = '${q(name)}'`)}`);
  const existing = found?.QueryResponse?.Customer?.[0];
  if (existing) return existing.Id;
  const customer = {
    DisplayName: name,
    ...(job.email ? { PrimaryEmailAddr: { Address: job.email } } : {}),
    ...(job.phone ? { PrimaryPhone: { FreeFormNumber: job.phone } } : {}),
    ...(job.address ? { BillAddr: { Line1: job.address, City: job.city || undefined, CountrySubDivisionCode: job.state || undefined } } : {}),
  };
  const created = await qb(conn, "POST", "customer", customer);
  return created.Customer.Id;
}

async function serviceItem(conn) {
  if (process.env.QB_ITEM_ID) return process.env.QB_ITEM_ID;
  const res = await qb(conn, "GET", `query?query=${encodeURIComponent("select * from Item where Type = 'Service' and Active = true maxresults 50")}`);
  const items = res?.QueryResponse?.Item || [];
  const pick = items.find(i => /roof|exterior|construction/i.test(i.Name)) || items.find(i => i.Name === "Services") || items[0];
  if (!pick) throw new Error("QuickBooks has no service item to bill — add one (e.g. \"Roofing\") in QuickBooks, then try again");
  return pick.Id;
}

export default async function handler(req, res) {
  const action = req.query.action;

  if (action === "callback") {
    const { code, realmId, state, error } = req.query;
    if (error) return res.redirect(`${APP_ORIGIN}/?qb=cancelled`);
    if (!(await consumeOAuthState(PROVIDER, state))) return res.redirect(`${APP_ORIGIN}/?qb=expired`);
    if (!code || !realmId) return res.redirect(`${APP_ORIGIN}/?qb=failed`);
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
    if (!tokens.access_token) return res.redirect(`${APP_ORIGIN}/?qb=failed`);
    await setIntegration(PROVIDER, toStored(tokens, realmId));
    return res.redirect(`${APP_ORIGIN}/?qb=connected`);
  }

  const staff = await requireStaff(req, res, { role: "admin" });
  if (!staff) return;
  if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET) {
    return res.status(500).json({ error: "QuickBooks keys aren't set up on the server" });
  }

  try {
    if (action === "start" && req.method === "POST") {
      const state = await createOAuthState(PROVIDER, staff.email);
      const params = new URLSearchParams({
        client_id: process.env.QB_CLIENT_ID, response_type: "code",
        scope: "com.intuit.quickbooks.accounting", redirect_uri: REDIRECT_URI, state,
      });
      return res.status(200).json({ url: `https://appcenter.intuit.com/connect/oauth2?${params}` });
    }

    if (action === "status") {
      const conn = await connection();
      if (!conn) return res.status(200).json({ connected: false });
      const info = await qb(conn, "GET", `companyinfo/${conn.realmId}`).catch(() => null);
      return res.status(200).json({ connected: true, company: info?.CompanyInfo?.CompanyName || null, sandbox: API_BASE.includes("sandbox") });
    }

    if (action === "disconnect" && req.method === "POST") {
      const stored = await getIntegration(PROVIDER);
      if (stored?.refresh_token) {
        await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
          method: "POST",
          headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ token: stored.refresh_token }),
        }).catch(() => {});
      }
      await clearIntegration(PROVIDER);
      return res.status(200).json({ connected: false });
    }

    if (action === "invoice" && req.method === "POST") {
      const jobId = Number(req.body?.jobId);
      if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: "Missing job" });
      const { data: row } = await supabaseAdmin().from("jobs").select("data").eq("job_id", jobId).maybeSingle();
      const job = row?.data;
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.qbInvoiceId) return res.status(409).json({ error: `Already invoiced in QuickBooks (invoice ${job.qbInvoiceDocNumber || job.qbInvoiceId})` });
      const amount = Math.round(Number(job.estimate?.total || 0) * 100) / 100;
      if (!(amount > 0)) return res.status(400).json({ error: "Set the contract total on the Estimate tab first" });

      const conn = await connection();
      if (!conn) return res.status(401).json({ error: "QuickBooks isn't connected — connect it first" });

      const customerId = await findOrCreateCustomer(conn, job);
      const itemId = await serviceItem(conn);
      const where = [job.address, job.city, job.state].filter(Boolean).join(", ");
      const invoice = await qb(conn, "POST", "invoice", {
        CustomerRef: { value: customerId },
        ...(job.email ? { BillEmail: { Address: job.email } } : {}),
        Line: [{
          Amount: amount,
          DetailType: "SalesItemLineDetail",
          Description: `${job.type || "Exterior"} project${where ? ` — ${where}` : ""}${job.claimNum ? ` (claim ${job.claimNum})` : ""}`.slice(0, 4000),
          SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: amount },
        }],
        ...(job.depositPaid && Number(job.depositAmountPaid) > 0
          ? { CustomerMemo: { value: `Deposit of $${Number(job.depositAmountPaid).toFixed(2)} received ${job.depositPaidAt ? new Date(job.depositPaidAt).toLocaleDateString("en-US") : ""}`.trim() } }
          : {}),
      });
      const inv = invoice.Invoice;
      // Record it on the job so it can't be invoiced twice.
      await supabaseAdmin().from("jobs").update({
        data: { ...job, qbInvoiceId: inv.Id, qbInvoiceDocNumber: inv.DocNumber || null, qbInvoicedAt: new Date().toISOString() },
      }).eq("job_id", jobId);
      return res.status(200).json({ success: true, invoiceId: inv.Id, docNumber: inv.DocNumber || null });
    }
  } catch (e) {
    console.error("QuickBooks:", e.message);
    if (e.status === 401) return res.status(401).json({ error: "QuickBooks connection expired — reconnect it" });
    return res.status(502).json({ error: e.message || "QuickBooks request failed" });
  }

  return res.status(400).json({ error: "Invalid action" });
}
