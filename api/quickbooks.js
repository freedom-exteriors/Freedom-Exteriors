// QuickBooks Online: connect (OAuth) and create an invoice for a job.
// Tokens live server-side in integration_tokens — never in the browser or a URL.
//   POST ?action=start    (admin)  -> { url } to send the browser to Intuit
//   GET  ?action=callback (Intuit) -> stores tokens, back to the app
//   GET  ?action=status   (admin)  -> { connected, company }
//   POST ?action=invoice  (admin)  { jobId } -> { invoiceId, docNumber }
//   POST ?action=disconnect (admin)
// Called by the invoice tool (invoice-project) with the shared
// x-invoice-tool-key header instead of a staff login; see _lib/invoiceTool.js:
//   POST ?action=tool-job     { jobId }  -> the job's customer details
//   POST ?action=tool-invoice { ...invoice } -> creates it in QuickBooks (once)
//   POST ?action=tool-payment { docNumber, date, amountCents, note }
//   POST ?action=tool-status  { docNumber } -> is it still in QuickBooks / voided?
import { requireStaff, supabaseAdmin } from "./_lib/supabase.js";
import { APP_ORIGIN, getIntegration, setIntegration, clearIntegration, createOAuthState, consumeOAuthState } from "./_lib/integrations.js";
import { toolKeyOk, jobForTool, validatePush, qbInvoiceBody, qbPaymentBody, qbInvoiceLink } from "./_lib/invoiceTool.js";
import { PROVIDER, REDIRECT_URI, API_BASE, basicAuth, tokenRequest, toStored, connection, qb, q, findOrCreateCustomer, serviceItem } from "./_lib/quickbooks.js";


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

  if (typeof action === "string" && action.startsWith("tool-")) return invoiceToolAction(action, req, res);

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
    console.error("QuickBooks:", e.message, { status: e.status, code: e.qbCode, intuit_tid: e.intuitTid });
    if (e.status === 401) return res.status(401).json({ error: "QuickBooks connection expired — reconnect it" });
    return res.status(502).json({ error: e.message || "QuickBooks request failed" });
  }

  return res.status(400).json({ error: "Invalid action" });
}

async function findInvoiceByDocNumber(conn, docNumber) {
  const found = await qb(conn, "GET", `query?query=${encodeURIComponent(`select * from Invoice where DocNumber = '${q(docNumber)}'`)}`);
  return found?.QueryResponse?.Invoice?.[0] || null;
}

async function invoiceToolAction(action, req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!toolKeyOk(req)) return res.status(401).json({ error: "Invoice tool key missing or wrong" });
  const body = req.body || {};
  try {
    if (action === "tool-job") {
      const jobId = Number(body.jobId);
      if (!Number.isSafeInteger(jobId) || jobId <= 0) return res.status(400).json({ error: "Missing job" });
      const { data: row } = await supabaseAdmin().from("jobs").select("data").eq("job_id", jobId).maybeSingle();
      if (!row?.data) return res.status(404).json({ error: "CRM job not found" });
      return res.status(200).json({ job: jobForTool(jobId, row.data) });
    }

    if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET) return res.status(500).json({ error: "QuickBooks keys aren't set up on the CRM server" });
    const conn = await connection();
    if (!conn) return res.status(409).json({ error: "QuickBooks isn't connected. In the CRM, click QB (top bar) and sign in to QuickBooks first." });

    if (action === "tool-invoice") {
      const v = validatePush(body);
      if (!v.ok) return res.status(400).json({ error: v.errors.join(". ") });
      const push = v.value;
      // Never create the same invoice twice: an invoice with this number
      // already in QuickBooks is reused (e.g. a retry after a timeout).
      let invoice = await findInvoiceByDocNumber(conn, push.docNumber);
      const created = !invoice;
      if (!invoice) {
        const customerId = await findOrCreateCustomer(conn, push.customer);
        const itemId = await serviceItem(conn);
        invoice = (await qb(conn, "POST", "invoice", qbInvoiceBody(push, customerId, itemId))).Invoice;
      }
      // Deposits become QuickBooks payments, recorded only while the invoice
      // has none yet (Balance still equals the total), so a retry can't double them.
      let paymentsRecorded = 0;
      const untouched = Number(invoice.Balance) === Number(invoice.TotalAmt);
      if (untouched) {
        for (const p of push.payments) {
          await qb(conn, "POST", "payment", qbPaymentBody(invoice, p));
          paymentsRecorded++;
        }
      }
      if (push.crmJobId) {
        const { data: row } = await supabaseAdmin().from("jobs").select("data").eq("job_id", push.crmJobId).maybeSingle();
        if (row?.data && !row.data.qbInvoiceId) {
          await supabaseAdmin().from("jobs").update({
            data: { ...row.data, qbInvoiceId: invoice.Id, qbInvoiceDocNumber: invoice.DocNumber || push.docNumber, qbInvoicedAt: new Date().toISOString() },
          }).eq("job_id", push.crmJobId);
        }
      }
      return res.status(200).json({
        invoiceId: invoice.Id, docNumber: invoice.DocNumber, link: qbInvoiceLink(invoice.Id),
        created, paymentsRecorded, paymentsSkipped: untouched ? 0 : push.payments.length,
      });
    }

    if (action === "tool-status") {
      const docNumber = typeof body.docNumber === "string" ? body.docNumber.trim() : "";
      if (!docNumber) return res.status(400).json({ error: "Missing invoice number" });
      const invoice = await findInvoiceByDocNumber(conn, docNumber);
      if (!invoice) return res.status(200).json({ exists: false, voided: false });
      // QuickBooks voids by zeroing the amounts and noting "Voided".
      const voided = Number(invoice.TotalAmt) === 0 && /void/i.test(invoice.PrivateNote || "");
      return res.status(200).json({
        exists: true, voided,
        totalCents: Math.round(Number(invoice.TotalAmt) * 100), balanceCents: Math.round(Number(invoice.Balance) * 100),
      });
    }

        if (action === "tool-payment") {
      const docNumber = typeof body.docNumber === "string" ? body.docNumber.trim() : "";
      const amountCents = body.amountCents;
      if (!docNumber || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: "Missing invoice number, date or amount" });
      }
      const invoice = await findInvoiceByDocNumber(conn, docNumber);
      if (!invoice) return res.status(404).json({ error: `Invoice ${docNumber} isn't in QuickBooks` });
      const balanceCents = Math.round(Number(invoice.Balance) * 100);
      if (balanceCents <= 0) return res.status(200).json({ recorded: false, alreadyPaid: true });
      const amount = Math.min(amountCents, balanceCents);
      await qb(conn, "POST", "payment", qbPaymentBody(invoice, { date: body.date, amountCents: amount, note: typeof body.note === "string" ? body.note : "" }));
      return res.status(200).json({ recorded: true, amountCents: amount });
    }
  } catch (e) {
    console.error("QuickBooks (invoice tool):", e.message, { status: e.status, code: e.qbCode, intuit_tid: e.intuitTid });
    if (e.status === 401) return res.status(409).json({ error: "The QuickBooks connection expired. In the CRM, click QB and reconnect." });
    return res.status(502).json({ error: e.message || "QuickBooks request failed" });
  }
  return res.status(400).json({ error: "Invalid action" });
}
