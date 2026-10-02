// ABC Supply pricing — thin, staff-gated proxy to the SHARED abc-supply-pricing
// Supabase Edge Function (deployed in this project's Supabase project,
// klfrqwplazjryeppamtk). That function is the one place that actually talks
// to ABC Supply with the Client Credentials grant; both this CRM and the
// separate bid-estimator app call it rather than each holding their own ABC
// Supply credentials. See its source for the full rationale.
//
// Required Vercel env vars (same values as bid-estimator's):
//   ABC_SUPPLY_EDGE_FUNCTION_URL — already set, e.g.
//     https://klfrqwplazjryeppamtk.supabase.co/functions/v1/abc-supply-pricing
//   ABC_SUPPLY_INTERNAL_API_KEY  — shared secret sent as x-internal-api-key;
//     must match the Edge Function's INTERNAL_API_KEY secret (set via the
//     Supabase dashboard or `supabase secrets set`, not in any codebase)
//
//   POST ?action=pricing (staff) { shipToNumber, branchNumber, items: [{ itemNumber, quantity, uom? }] }
import { requireStaff } from "./_lib/supabase.js";

export default async function handler(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) return;

  const edgeUrl = process.env.ABC_SUPPLY_EDGE_FUNCTION_URL;
  const internalKey = process.env.ABC_SUPPLY_INTERNAL_API_KEY;
  if (!edgeUrl || !internalKey) {
    return res.status(500).json({ error: "ABC Supply pricing isn't set up on the server yet (ABC_SUPPLY_EDGE_FUNCTION_URL / ABC_SUPPLY_INTERNAL_API_KEY)" });
  }

  const action = req.query.action;

  if (action === "pricing" && req.method === "POST") {
    const { shipToNumber, branchNumber, items } = req.body || {};
    if (!shipToNumber || !branchNumber || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Provide shipToNumber, branchNumber, and at least one item" });
    }
    try {
      const upstream = await fetch(edgeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-api-key": internalKey },
        body: JSON.stringify({ shipToNumber: String(shipToNumber), branchNumber: String(branchNumber), items }),
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return res.status(upstream.status).json(data.error ? data : { error: `ABC Supply pricing error ${upstream.status}` });
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ error: `Couldn't reach ABC Supply pricing: ${e.message}` });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
}
