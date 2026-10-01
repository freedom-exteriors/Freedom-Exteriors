// Called by the portal after Stripe redirects back, and on every portal visit
// while a checkout is pending (in case the homeowner closed the tab after
// paying). Marks the deposit paid only if Stripe confirms this checkout session
// was paid for this portal link.
import { supabaseAdmin } from "./_lib/supabase.js";
import { confirmSession } from "./_lib/deposits.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { portalToken, sessionId } = req.body || {};
  if (!portalToken) return res.status(400).json({ error: "Missing payment details" });

  let id = sessionId;
  if (!id) {
    const { data } = await supabaseAdmin().rpc("portal_pending_deposit", { p_token: portalToken });
    if (!data) return res.status(200).json({ pending: false });
    id = data;
  }
  try {
    const result = await confirmSession(id, portalToken);
    if (!result.ok) return res.status(sessionId ? 400 : 200).json({ pending: !sessionId, error: "Payment not confirmed" });
    return res.status(200).json({ job: result.job });
  } catch (e) {
    return res.status(500).json({ error: "Could not record payment" });
  }
}
