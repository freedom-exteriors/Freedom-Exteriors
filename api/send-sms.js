import { requireStaff } from "./_lib/supabase.js";
import { toE164, sendSms } from "./_lib/twilio.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireStaff(req, res))) return;
  const { to, message } = req.body || {};
  const number = toE164(to);
  if (!number) return res.status(400).json({ error: "That phone number doesn't look right" });
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Message is empty" });
  if (message.length > 1600) return res.status(400).json({ error: "Message is too long" });
  try {
    const sid = await sendSms(number, message.trim());
    return res.status(200).json({ success: true, sid });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
