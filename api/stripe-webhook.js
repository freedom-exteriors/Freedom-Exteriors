// Stripe webhook: records a deposit the moment Stripe reports the checkout paid.
// Setup: Stripe Dashboard → Developers → Webhooks → endpoint
//   https://freedom-exteriors.vercel.app/api/stripe-webhook
// events: checkout.session.completed, checkout.session.async_payment_succeeded.
// Put its signing secret in Vercel as STRIPE_WEBHOOK_SECRET.
import crypto from "crypto";
import { recordPaidSession } from "./_lib/deposits.js";

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.payload">[,v1=...]
export function verifyStripeSignature(payload, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = {};
  const sigs = [];
  for (const piece of String(header).split(",")) {
    const [k, v] = piece.split("=");
    if (k === "t") parts.t = v;
    if (k === "v1" && v) sigs.push(v);
  }
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload.toString("utf8")}`).digest("hex");
  const exp = Buffer.from(expected);
  return sigs.some(s => {
    const got = Buffer.from(s);
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Webhook not configured" });

  const payload = await rawBody(req);
  if (!verifyStripeSignature(payload, req.headers["stripe-signature"], secret)) {
    return res.status(400).json({ error: "Bad signature" });
  }
  let event;
  try { event = JSON.parse(payload.toString("utf8")); } catch { return res.status(400).json({ error: "Bad payload" }); }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    try {
      await recordPaidSession(event.data?.object);
    } catch (e) {
      return res.status(500).json({ error: e.message }); // Stripe retries
    }
  }
  return res.status(200).json({ received: true });
}
