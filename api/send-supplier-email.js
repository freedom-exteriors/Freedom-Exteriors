// Emails a job's material list (and optionally its roof measurements) to the
// supplier rep — e.g. the ABC Supply rep — for a quote or an order. Includes the
// job site/delivery address; leaves out the homeowner's name/contact and every
// price (the catalog prices in the CRM are ours, not the supplier's). Replies go
// to the staff member who sent it.
//
//   POST (staff) { to, cc?, subject?, message?, job: { address, city, state, zip, type },
//                  materials: [{ name, cat?, unit?, qty }], measurements?: {...hover summary} }
import { requireStaff } from "./_lib/supabase.js";

const FROM = process.env.SUPPLIER_EMAIL_FROM || "Freedom Exteriors <nick@freedom-exteriors.com>";
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function parseRecipients(value, { required = false, label = "To" } = {}) {
  const list = (Array.isArray(value) ? value : String(value || "").split(/[,;]/)).map(s => String(s).trim()).filter(Boolean);
  if (required && !list.length) throw new Error(`${label}: enter an email address`);
  if (list.length > 5) throw new Error(`${label}: up to 5 addresses`);
  const bad = list.find(s => !EMAIL_RE.test(s));
  if (bad) throw new Error(`${label}: "${bad}" doesn't look like an email address`);
  return list;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const clip = (v, n = 200) => String(v ?? "").trim().slice(0, n);

// Roof numbers worth sending a supplier, in the order they'd read them.
export function measurementRows(m) {
  if (!m) return [];
  const lf = (v) => (v ? `${Number(v).toLocaleString()} LF` : null);
  const rows = [
    ["Roof area", m.totalRoofArea ? `${Number(m.totalRoofArea).toLocaleString()} SF${m.squares ? ` (${m.squares} squares, no waste)` : ""}` : null],
    ["Predominant pitch", m.predominantPitch || null],
    ["Facets", m.facets || null],
    ["Ridges + hips", lf(m.ridgeHipLength)],
    ["Valleys", lf(m.valleyLength)],
    ["Eaves", lf(m.eavesLength)],
    ["Rakes", lf(m.rakeLength)],
    ["Drip edge (eaves + rakes)", lf(m.dripEdgeLength)],
    ["Step flashing", lf(m.stepFlashingLength)],
    ["Flashing", lf(m.flashingLength)],
    ["Low-slope area (under 4/12)", m.lowSlopeArea ? `${Number(m.lowSlopeArea).toLocaleString()} SF` : null],
  ];
  return rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
}

export function buildMaterialCsv({ siteAddress, materials, measurements }) {
  const lines = [["Job site / delivery", siteAddress], [], ["Item", "Category", "Qty", "Unit"]];
  for (const m of materials) lines.push([m.name, m.cat || "", m.qty, m.unit || ""]);
  const meas = measurementRows(measurements);
  if (meas.length) lines.push([], ["Roof measurements"], ...meas);
  return lines.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const staff = await requireStaff(req, res);
  if (!staff) return;
  if (!process.env.RESEND_API_KEY && !process.env.REACT_APP_RESEND_KEY) return res.status(500).json({ error: "Email isn't set up on the server (RESEND_API_KEY)" });

  const body = req.body || {};
  let to, cc;
  try {
    to = parseRecipients(body.to, { required: true, label: "To" });
    cc = parseRecipients(body.cc, { label: "Cc" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const job = body.job || {};
  const cityLine = [clip(job.city, 80), [clip(job.state, 20), clip(job.zip, 12)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const siteAddress = [clip(job.address), cityLine].filter(Boolean).join(", ");
  if (!clip(job.address)) return res.status(400).json({ error: "This job has no street address — add it on the job first (the supplier needs it for delivery)." });

  const materials = (Array.isArray(body.materials) ? body.materials : [])
    .slice(0, 200)
    .map(m => ({ name: clip(m?.name, 120), cat: clip(m?.cat, 60), unit: clip(m?.unit, 20), qty: Number(m?.qty) || 0 }))
    .filter(m => m.name && m.qty > 0);
  const measurements = body.measurements && typeof body.measurements === "object" ? body.measurements : null;
  if (!materials.length && !measurementRows(measurements).length) return res.status(400).json({ error: "Nothing to send — add materials to the order (or load Hover measurements) first." });

  const jobType = clip(job.type, 60);
  const subject = clip(body.subject) || `Material ${materials.length ? "order" : "quote"} — ${siteAddress}`;
  const meas = measurementRows(measurements);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;color:#1f2933;line-height:1.5">
      ${body.message ? `<p style="white-space:pre-wrap">${esc(clip(body.message, 5000))}</p>` : "<p>Please see the material list below (also attached as a spreadsheet).</p>"}
      <p><strong>Job site / delivery:</strong> ${esc(siteAddress)}${jobType ? `<br><strong>Job:</strong> ${esc(jobType)}` : ""}</p>
      ${materials.length ? `
      <table style="border-collapse:collapse;font-size:14px;margin:12px 0">
        <tr><th align="left" style="padding:4px 12px 4px 0;border-bottom:1px solid #ccc">Item</th><th align="right" style="padding:4px 12px;border-bottom:1px solid #ccc">Qty</th><th align="left" style="padding:4px 0;border-bottom:1px solid #ccc">Unit</th></tr>
        ${materials.map(m => `<tr><td style="padding:3px 12px 3px 0">${esc(m.name)}</td><td align="right" style="padding:3px 12px">${esc(m.qty)}</td><td>${esc(m.unit)}</td></tr>`).join("")}
      </table>` : ""}
      ${meas.length ? `
      <p style="margin-bottom:4px"><strong>Roof measurements</strong></p>
      <table style="border-collapse:collapse;font-size:14px;margin:0 0 12px">
        ${meas.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#667">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
      </table>` : ""}
      <p style="color:#667;font-size:13px">Reply to this email with questions or pricing.<br>${esc(staff.name || "")}${staff.name ? " · " : ""}Freedom Exteriors LLC · (651) 283-1689</p>
    </div>`;
  const csv = buildMaterialCsv({ siteAddress, materials, measurements });
  const filename = `${siteAddress.split(",")[0].replace(/[^a-z0-9]+/gi, " ").trim() || "Job"} - Material List.csv`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY || process.env.REACT_APP_RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM,
      to,
      ...(cc.length ? { cc } : {}),
      reply_to: staff.email,
      subject,
      html,
      attachments: [{ filename, content: Buffer.from(csv).toString("base64") }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(502).json({ error: `Email failed (${response.status}): ${data.message || data.error || "unknown error"}` });

  return res.status(200).json({
    success: true,
    sent: { sentAt: new Date().toISOString(), to, cc, subject, siteAddress, items: materials.length, measurements: meas.length > 0, by: staff.email, id: data.id || null },
  });
}
