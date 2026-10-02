// EagleView report import (staff). The browser uploads the PDF to the private
// measurement-reports bucket at <job_id>/<file>.pdf; this reads it back, has
// Claude transcribe it (api/_lib/eagleview.js), and returns measurements in the
// same shape as /api/hover. The client saves them on the job as
// eagleviewMeasurements.
//
//   POST { jobId, pdfPath } → { measurements }
import Anthropic from "@anthropic-ai/sdk";
import { requireStaff, supabaseAdmin } from "./_lib/supabase.js";
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, normalizeEagleView, addressMatches } from "./_lib/eagleview.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const staff = await requireStaff(req, res);
  if (!staff) return;

  const { jobId, pdfPath } = req.body || {};
  const jobKey = String(jobId ?? "");
  if (!/^\d+$/.test(jobKey)) return res.status(400).json({ error: "Missing job." });
  if (typeof pdfPath !== "string" || !pdfPath.startsWith(jobKey + "/") || pdfPath.includes("..")) {
    return res.status(400).json({ error: "That PDF doesn't belong to this job." });
  }

  const db = supabaseAdmin();
  const { data: job } = await db.from("jobs").select("job_id, data").eq("job_id", jobKey).maybeSingle();
  if (!job) return res.status(404).json({ error: "Job not found." });
  // Same rule as the job's RLS: admins, or the rep the job is assigned to.
  if (staff.role !== "admin" && job.data?.assigned !== staff.name) return res.status(403).json({ error: "Not your job." });

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
