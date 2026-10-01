// Starts a Stripe Checkout for a homeowner's deposit. The amount comes from the
// job record (estimate.downPayment), never from the browser.
import { supabaseAdmin } from "./_lib/supabase.js";
import { stripeRequest } from "./_lib/stripe.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { portalToken } = req.body || {};
  if (!portalToken) return res.status(400).json({ error: "Missing portal link" });

  const { data: job, error } = await supabaseAdmin().rpc("portal_get_job", { p_token: portalToken });
  if (error || !job) return res.status(404).json({ error: "Portal link not found" });
  if (job.depositPaid) return res.status(400).json({ error: "Deposit already paid" });
  const amount = Number(job.estimate?.downPayment);
  if (!(amount > 0)) return res.status(400).json({ error: "No deposit amount set for this project" });

  const origin = (process.env.APP_ORIGIN || "https://freedom-exteriors.vercel.app").replace(/\/$/, "");
  const portalUrl = `${origin}/portal/${encodeURIComponent(portalToken)}`;
  try {
    const session = await stripeRequest("POST", "checkout/sessions", {
      mode: "payment",
      "payment_method_types": { 0: "card" },
      line_items: { 0: {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: `Freedom Exteriors — ${job.type || "Project"} Deposit`,
            description: `Down payment deposit for ${job.name || "your project"}`,
          },
        },
      } },
      success_url: `${portalUrl}?paid=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: portalUrl,
      metadata: { portalToken, customerName: job.name || "" },
    });
    // Remembered so the payment is recorded even if the homeowner never comes back to the portal.
    await supabaseAdmin().rpc("portal_set_pending_deposit", { p_token: portalToken, p_session_id: session.id });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Stripe error:", e.message);
    return res.status(500).json({ error: "Could not start payment" });
  }
}
