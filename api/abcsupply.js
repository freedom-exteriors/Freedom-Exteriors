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
//   POST ?action=pricing  (staff) { shipToNumber, branchNumber, items: [{ itemNumber, quantity, uom? }] }
//   POST ?action=accounts (staff) { state?, name?, page? }            → { shipTos: [{ number, name, address, branches }] }
//   POST ?action=items    (staff) { query, branchNumber?, page? }     → { items: [{ itemNumber, description, uoms }] }
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
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = req.body || {};

  // Same shared function for every action; it holds the ABC credentials.
  const forward = async (payload) => {
    try {
      const upstream = await fetch(edgeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-api-key": internalKey },
        body: JSON.stringify(payload),
      });
      const data = await upstream.json().catch(() => ({}));
      // A 401 from the function means our shared key doesn't match — a server setup
      // problem, not the user's session, so don't hand the browser a 401.
      if (upstream.status === 401) return res.status(502).json({ error: "ABC Supply proxy rejected this server's key (ABC_SUPPLY_INTERNAL_API_KEY doesn't match the function's INTERNAL_API_KEY)" });
      if (!upstream.ok) return res.status(upstream.status).json(data.error ? data : { error: `ABC Supply error ${upstream.status}` });
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ error: `Couldn't reach ABC Supply: ${e.message}` });
    }
  };

  if (action === "pricing") {
    const { shipToNumber, branchNumber, items } = body;
    if (!shipToNumber || !branchNumber || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Provide shipToNumber, branchNumber, and at least one item" });
    }
    return forward({ shipToNumber: String(shipToNumber), branchNumber: String(branchNumber), items });
  }

  if (action === "accounts") {
    return forward({ action: "accounts", state: body.state, name: body.name, page: body.page });
  }

  if (action === "items") {
    if (!body.query) return res.status(400).json({ error: "Provide a search query (description or item number)" });
    return forward({ action: "items", query: String(body.query), branchNumber: body.branchNumber ? String(body.branchNumber) : undefined, page: body.page });
  }

  return res.status(400).json({ error: "Invalid action" });
}
