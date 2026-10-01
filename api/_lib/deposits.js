// Records a Stripe deposit on a job, but only after Stripe confirms the checkout
// session was paid for that portal link. Shared by the portal return and the webhook.
import { supabaseAdmin } from "./supabase.js";
import { stripeRequest } from "./stripe.js";

export async function recordPaidSession(session, portalToken) {
  if (!session || session.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  const token = portalToken || session.metadata?.portalToken;
  if (!token || session.metadata?.portalToken !== token) return { ok: false, reason: "wrong_job" };
  const { data: job, error } = await supabaseAdmin().rpc("mark_deposit_paid", {
    p_token: token,
    p_session_id: session.id,
    p_amount: (session.amount_total || 0) / 100,
  });
  if (error) throw new Error("Could not record payment");
  return { ok: true, job };
}

export async function confirmSession(sessionId, portalToken) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ""))) return { ok: false, reason: "bad_session" };
  let session;
  try {
    session = await stripeRequest("GET", `checkout/sessions/${sessionId}`);
  } catch (e) {
    return { ok: false, reason: "not_found" };
  }
  return recordPaidSession(session, portalToken);
}
