// Daily Vercel cron (see vercel.json): sends the lead follow-up series.
// Add ?dry=1 to see what WOULD be sent without sending anything.
import { supabaseAdmin } from "./_lib/supabase.js";
import { toE164, sendSms } from "./_lib/twilio.js";
import { STEPS, nextStep, messageFor } from "./_lib/followUp.js";

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function sendEmail(to, subject, text) {
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222">${esc(text).replace(/\n/g, "<br>")}<p style="color:#888;font-size:12px;margin-top:24px">Freedom Exteriors LLC · Veteran Owned &amp; Operated · (651) 283-1689</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY || process.env.REACT_APP_RESEND_KEY}` },
    body: JSON.stringify({ from: "Freedom Exteriors <nick@freedom-exteriors.com>", reply_to: "nick@freedom-exteriors.com", to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}`);
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const dry = req.query?.dry === "1";
  const db = supabaseAdmin();
  const { data: rows, error } = await db.from("jobs").select("job_id, data").eq("user_email", "all").gt("job_id", 0);
  if (error) return res.status(500).json({ error: error.message });

  const now = Date.now();
  const results = [];
  for (const row of rows || []) {
    const job = row.data;
    if (!job) continue;
    const due = nextStep(job, now);
    if (due.skip) continue;

    const step = STEPS[due.stepIndex];
    const msg = messageFor(due.stepIndex, job);
    const to = step.channel === "sms" ? toE164(job.phone) : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(job.email || "").trim()) ? job.email.trim() : null);
    const entry = { at: new Date(now).toISOString(), step: due.stepIndex + 1, channel: step.channel };

    if (!to) {
      entry.status = "skipped";
      entry.error = step.channel === "sms" ? "no valid phone" : "no valid email";
    } else if (dry) {
      results.push({ job: job.id, name: job.name, wouldSend: step.channel, step: entry.step });
      continue;
    } else {
      try {
        if (step.channel === "sms") await sendSms(to, msg.text);
        else await sendEmail(to, msg.subject, msg.text);
        entry.status = "sent";
      } catch (e) {
        // Count it as handled so a broken number never gets retried daily.
        entry.status = "failed";
        entry.error = String(e.message || e).slice(0, 200);
      }
    }
    results.push({ job: job.id, name: job.name, ...entry });
    if (dry) continue;

    // Re-read the freshest copy and change only our own field.
    const { data: fresh } = await db.from("jobs").select("data").eq("job_id", row.job_id).eq("user_email", "all").single();
    if (!fresh?.data) continue;
    const entered = due.state.stageEntered;
    const next = { ...fresh.data, autoFollowUp: { stageEntered: entered, sent: [...due.state.sent, entry] } };
    await db.from("jobs").update({ data: next }).eq("job_id", row.job_id).eq("user_email", "all");
  }
  return res.status(200).json({ dry, handled: results.length, results });
}
