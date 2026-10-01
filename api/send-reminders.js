// Daily Vercel cron (see vercel.json): texts homeowners whose install is
// tomorrow. Vercel sends "Authorization: Bearer $CRON_SECRET" automatically.
import { supabaseAdmin } from "./_lib/supabase.js";
import { toE164, sendSms } from "./_lib/twilio.js";

// Tomorrow's date (YYYY-MM-DD) in Minnesota time, matching how installDate is entered.
function tomorrowCentral() {
  return new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const tomorrow = tomorrowCentral();
  const { data: rows, error } = await supabaseAdmin()
    .from("jobs").select("data").eq("user_email", "all").gt("job_id", 0);
  if (error) return res.status(500).json({ error: error.message });

  const toRemind = (rows || []).map(r => r.data)
    .filter(job => job && job.installDate === tomorrow && job.phone && job.stage === "scheduled");

  const results = [];
  for (const job of toRemind) {
    const to = toE164(job.phone);
    if (!to) { results.push({ job: job.id, status: "skipped", error: "bad phone number" }); continue; }
    try {
      const sid = await sendSms(to,
        `Hi ${job.name}! Reminder from Freedom Exteriors — your ${job.type} installation is scheduled for TOMORROW. We'll be there bright and early! Questions? Call (651) 283-1689.`);
      results.push({ job: job.id, sid, status: "sent" });
    } catch (e) {
      results.push({ job: job.id, status: "failed", error: e.message });
    }
  }
  return res.status(200).json({ date: tomorrow, reminded: results.length, results });
}
