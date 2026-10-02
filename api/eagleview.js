// EagleView: import a report PDF, or order a report and receive it.
//
//   POST { jobId, pdfPath } → { measurements }
//     The browser uploads the PDF to the private measurement-reports bucket at
//     <job_id>/<file>.pdf; Claude transcribes it (api/_lib/eagleview.js) into the
//     /api/hover shape. The client saves it on the job as eagleviewMeasurements.
//   POST ?action=quote   { jobId, productId, zip }           → { price, env, address }
//   POST ?action=order   { jobId, productId, zip, confirm }  → { order }
//   POST ?action=refresh { reportId }                        → { order, imported }
//   GET|POST /api/eagleview/callback/<Event> (rewritten to ?action=callback&event=<Event>)
//     EagleView's webhooks. A finished report's measurements (EV Measurement
//     JSON) and PDF are saved onto the job by the server.
import Anthropic from "@anthropic-ai/sdk";
import { requireStaff, supabaseAdmin } from "./_lib/supabase.js";
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, normalizeEagleView, addressMatches } from "./_lib/eagleview.js";
import {
  PRODUCTS, SANDBOX_TEST_ADDRESS, STATUS, SUB_STATUS, evEnv, stateName, orderBody, priceOrder, placeOrder, quotedPrice,
  getReport, getReportFile, measureEvJson, measureGetReport, toJobMeasurements, verifyWebhook,
} from "./_lib/eagleviewApi.js";

const MODEL = "claude-opus-5-5";
const BUCKET = "measurement-reports";

let client = null;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the CRM's Vercel project.");
  if (!client) client = new Anthropic({ timeout: 280_000, maxRetries: 1 });
  return client;
}

async function extract(pdfBase64) {
  const content = [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    { type: "text", text: "Transcribe this EagleView report's measurements." },
  ];
  const base = { model: MODEL, max_tokens: 16000, system: EXTRACT_SYSTEM, messages: [{ role: "user", content }] };
  let response;
  try {
    response = await anthropic().beta.messages.create({
      ...base,
      output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
      // If the model declines, the API reruns the request on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    // An option this account/model doesn't accept: ask plainly for the same JSON instead.
    console.warn("eagleview: structured request rejected, retrying plain:", err.message);
    response = await anthropic().messages.create({
      ...base,
      system: `${EXTRACT_SYSTEM}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose, no code fences):\n${JSON.stringify(EXTRACT_SCHEMA)}`,
    });
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this PDF.");
  if (response.stop_reason === "max_tokens") throw new Error("The report was too long to read in one pass.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
}

// Loads a job the signed-in staff member may work on (same rule as the jobs
// RLS: admins, or the rep it's assigned to). Sends the error and returns null if not.
async function staffJob(req, res, jobId) {
  const staff = await requireStaff(req, res);
  if (!staff) return null;
  const jobKey = String(jobId ?? "");
  if (!/^\d+$/.test(jobKey)) { res.status(400).json({ error: "Missing job." }); return null; }
  const { data: job } = await supabaseAdmin().from("jobs").select("job_id, data").eq("job_id", jobKey).maybeSingle();
  if (!job) { res.status(404).json({ error: "Job not found." }); return null; }
  if (staff.role !== "admin" && job.data?.assigned !== staff.name) { res.status(403).json({ error: "Not your job." }); return null; }
  return { staff, job, jobKey };
}

export default async function handler(req, res) {
  const action = req.query?.action;
  try {
    if (action === "callback") return await webhook(req, res);
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (action === "quote" || action === "order") return await quoteOrOrder(req, res, action);
    if (action === "refresh") return await refresh(req, res);
    if (action) return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    console.error(`eagleview ${action}:`, e.message);
    return res.status(e.status && e.status < 500 ? 502 : 500).json({ error: e.message });
  }
  return importPdf(req, res);
}

async function importPdf(req, res) {
  const { jobId, pdfPath } = req.body || {};
  const ctx = await staffJob(req, res, jobId);
  if (!ctx) return;
  const { job, jobKey } = ctx;
  if (typeof pdfPath !== "string" || !pdfPath.startsWith(jobKey + "/") || pdfPath.includes("..")) {
    return res.status(400).json({ error: "That PDF doesn't belong to this job." });
  }
  const db = supabaseAdmin();

  try {
    const { data: file, error } = await db.storage.from(BUCKET).download(pdfPath);
    if (error || !file) return res.status(404).json({ error: "Could not open the uploaded PDF." });
    const pdfBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const measurements = { ...normalizeEagleView(await extract(pdfBase64)), pdfPath };
    const jobAddress = [job.data?.address, job.data?.city].filter(Boolean).join(", ");
    if (measurements.address && jobAddress && !addressMatches(measurements.address, jobAddress)) {
      measurements.warnings.unshift(`Report address "${measurements.address}" doesn't match this job (${jobAddress}). Make sure this is the right report.`);
    }
    return res.status(200).json({ measurements });
  } catch (e) {
    let message = e.message;
    if (e instanceof Anthropic.AuthenticationError) message = "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.";
    else if (e instanceof SyntaxError) message = "Couldn't read measurements from this PDF. Is it an EagleView report?";
    return res.status(e instanceof Anthropic.APIError ? 502 : 500).json({ error: message });
  }
}

// ---------- Ordering ----------

const OPEN = (o) => !o.imported_at && (o.status_id == null || ![4, 5].includes(o.status_id));

function orderAddress(job, zip) {
  const d = job.data || {};
  const z = String(zip ?? d.zip ?? "").trim();
  if (!d.address?.trim() || !d.city?.trim()) throw Object.assign(new Error("This job needs a street address and city first."), { status: 400 });
  if (!/^\d{5}(-\d{4})?$/.test(z)) throw Object.assign(new Error("Enter the property's ZIP code."), { status: 400 });
  return { Address: d.address.trim(), City: d.city.trim(), State: stateName(d.state), Zip: z };
}

async function quoteOrOrder(req, res, action) {
  const { jobId, productId, zip, confirm, force } = req.body || {};
  const ctx = await staffJob(req, res, jobId);
  if (!ctx) return;
  const { staff, job, jobKey } = ctx;
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ error: "Pick a report type." });

  let jobAddr;
  try { jobAddr = orderAddress(job, zip); } catch (e) { return res.status(400).json({ error: e.message }); }
  const env = evEnv();
  // The sandbox only knows EagleView's test addresses; real ones are rejected there.
  const address = env === "sandbox" ? SANDBOX_TEST_ADDRESS : jobAddr;
  const referenceId = `FE-${jobKey}-${Date.now().toString(36)}`;
  const body = orderBody({ address, productId, referenceId });

  if (action === "quote") {
    const resp = await priceOrder(body);
    // Logged so the price field can be confirmed against a real response (prices/product names only).
    console.log("eagleview PriceOrder response:", JSON.stringify(resp).slice(0, 2000));
    return res.status(200).json({ env, price: quotedPrice(resp), address: Object.values(address).join(", "), product: product.name });
  }

  if (confirm !== true) return res.status(400).json({ error: "Confirm the order first." });
  const db = supabaseAdmin();
  const { data: existing } = await db.from("eagleview_orders").select("*").eq("job_id", jobKey);
  if (!force && (existing || []).some(OPEN)) {
    return res.status(409).json({ error: "This job already has an EagleView order in progress." });
  }
  let quoted = null;
  try { quoted = quotedPrice(await priceOrder(body)); } catch { /* the order itself is what matters */ }

  const placed = await placeOrder(body);
  const first = Array.isArray(placed) ? placed[0] : placed;
  const reportId = first?.ReportIds?.[0];
  if (!first?.OrderId || !reportId) throw new Error(`EagleView didn't return an order number: ${JSON.stringify(placed).slice(0, 200)}`);
  const row = {
    report_id: reportId, order_id: first.OrderId, job_id: Number(jobKey), reference_id: referenceId, env,
    product_id: Number(productId), product_name: product.name, quoted_price: quoted, status: "Ordered",
    placed_by: staff.email,
  };
  const { data: order, error } = await db.from("eagleview_orders").insert(row).select().single();
  if (error) throw new Error(`Order ${first.OrderId} was placed but couldn't be saved: ${error.message}`);
  return res.status(200).json({ order });
}

async function refresh(req, res) {
  const reportId = String(req.body?.reportId ?? "");
  if (!/^\d+$/.test(reportId)) return res.status(400).json({ error: "Missing report." });
  const db = supabaseAdmin();
  const { data: order } = await db.from("eagleview_orders").select("*").eq("report_id", reportId).maybeSingle();
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!(await staffJob(req, res, order.job_id))) return;
  const result = await syncReport(order, { reimport: req.body?.reimport === true });
  return res.status(200).json(result);
}

// A report is ready to import once it's Completed. EagleView's sandbox answers
// every order with a canned sample report that stays "In Process" forever, so
// there it's ready as soon as its measurement file (fileType 107) is listed.
export function reportReady(report, env) {
  if (report?.StatusId === 5) return true;
  return env === "sandbox" && (report?.DeliveryFilesAvailable || []).some((f) => f.DeliveryFileTypeId === 107);
}

// Pulls a report's status from EagleView; once it's Completed, saves its
// measurements (and PDF) onto the job. Safe to call repeatedly.
async function syncReport(order, { evJson = null, reimport = false } = {}) {
  const db = supabaseAdmin();
  const report = await getReport(order.report_id);
  const patch = {
    status_id: report?.StatusId ?? null,
    sub_status_id: report?.SubStatusId ?? null,
    status: report?.DisplayStatus || report?.Status || STATUS[report?.StatusId] || null,
    updated_at: new Date().toISOString(),
  };
  let imported = false;
  if (reportReady(report, order.env) && (!order.imported_at || reimport || evJson)) {
    let totals;
    try {
      const json = evJson || JSON.parse((await getReportFile(order.report_id, 18, 107))?.toString("utf8") || "null");
      totals = json ? measureEvJson(json) : null;
    } catch (e) {
      console.warn("eagleview: measurement JSON unreadable, using GetReport:", e.message);
    }
    if (!totals?.totalRoofArea) totals = measureGetReport(report);
    const measurements = toJobMeasurements(totals, report, { reportId: order.report_id });
    if (order.env === "sandbox") measurements.warnings.unshift("EagleView sandbox test report — not this property.");
    else {
      const { data: job } = await db.from("jobs").select("data").eq("job_id", order.job_id).maybeSingle();
      const where = [job?.data?.address, job?.data?.city].filter(Boolean).join(", ");
      if (measurements.address && where && !addressMatches(measurements.address, where)) {
        measurements.warnings.unshift(`Report address "${measurements.address}" doesn't match this job (${where}).`);
      }
    }
    measurements.orderId = order.order_id;
    const pdfPath = order.pdf_path || (await savePdf(order, report));
    if (pdfPath) { measurements.pdfPath = pdfPath; patch.pdf_path = pdfPath; }
    const { error } = await db.rpc("jobs_set_data_key", { p_job_id: order.job_id, p_key: "eagleviewMeasurements", p_value: measurements });
    if (error) throw new Error(`Couldn't save measurements on the job: ${error.message}`);
    patch.imported_at = new Date().toISOString();
    patch.last_error = null;
    imported = true;
  }
  const { data: saved } = await db.from("eagleview_orders").update(patch).eq("report_id", order.report_id).select().single();
  return { order: saved || { ...order, ...patch }, imported };
}

const PDF_HOSTS = /(^|\.)(cloudfront\.net|eagleview\.com)$/i;

async function savePdf(order, report, bytes = null) {
  try {
    if (!bytes) {
      const link = report?.ReportDownloadLink;
      if (!link) return null;
      const url = new URL(link);
      if (url.protocol !== "https:" || !PDF_HOSTS.test(url.hostname)) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    if (bytes.subarray(0, 4).toString() !== "%PDF") return null;
    const path = `${order.job_id}/eagleview-${order.report_id}.pdf`;
    const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
    return error ? null : path;
  } catch (e) {
    console.warn("eagleview: PDF not saved:", e.message);
    return null;
  }
}

// ---------- Webhooks ----------

const q = (req, key) => {
  const hit = Object.entries(req.query || {}).find(([k]) => k.toLowerCase() === key.toLowerCase());
  const v = hit?.[1];
  return Array.isArray(v) ? v[0] : v;
};

async function webhook(req, res) {
  const { action, event, ...evQuery } = req.query || {}; // action/event are ours (from the rewrite), not EagleView's
  try {
    await verifyWebhook(req.headers.authorization, evQuery);
  } catch (e) {
    console.warn("eagleview webhook rejected:", e.message);
    return res.status(401).json({ error: "Unauthorized" });
  }
  const reportId = String(q(req, "ReportId") || "");
  const db = supabaseAdmin();
  const { data: order } = /^\d+$/.test(reportId)
    ? await db.from("eagleview_orders").select("*").eq("report_id", reportId).maybeSingle()
    : { data: null };
  // Acknowledge reports we didn't order from here (e.g. placed on eagleview.com) so EagleView stops retrying.
  if (!order) return res.status(200).json({ ok: true, ignored: true });

  try {
    if (event === "OrderStatusUpdate" || event === "NeedToId") {
      const statusId = Number(q(req, "StatusId")) || (event === "NeedToId" ? 3 : null);
      const subId = Number(q(req, "SubStatusId")) || (event === "NeedToId" ? 8 : null);
      await db.from("eagleview_orders").update({
        status_id: statusId, sub_status_id: subId,
        status: SUB_STATUS[subId] || STATUS[statusId] || order.status, updated_at: new Date().toISOString(),
      }).eq("report_id", reportId);
      if (statusId === 5 || order.env === "sandbox") await syncReport({ ...order, status_id: statusId });
    } else if (event === "FileDelivery") {
      const format = Number(q(req, "FileFormatId")), type = Number(q(req, "FileTypeId"));
      let body = req.body;
      if (typeof body === "string" || Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString()); } catch { body = null; } }
      const content = body?.["File Content"] ?? body?.FileContent;
      const bytes = typeof content === "string" ? Buffer.from(content, "base64") : null;
      if (bytes && format === 18 && type === 107) {
        await syncReport(order, { evJson: JSON.parse(bytes.toString("utf8")) });
      } else if (bytes && format === 2 && type !== 2 && !order.pdf_path) { // 2/2 is the invoice
        const path = await savePdf(order, null, bytes);
        if (path) await db.from("eagleview_orders").update({ pdf_path: path }).eq("report_id", reportId);
      }
    } else if (event === "FileDeliveryConfirmation") {
      if (!order.imported_at) await syncReport(order);
    }
  } catch (e) {
    console.error(`eagleview webhook ${event} for ${reportId}:`, e.message);
    await db.from("eagleview_orders").update({ last_error: e.message.slice(0, 500) }).eq("report_id", reportId);
    return res.status(500).json({ error: "Couldn't process this update" }); // EagleView will retry
  }
  return res.status(200).json({ ok: true });
}
