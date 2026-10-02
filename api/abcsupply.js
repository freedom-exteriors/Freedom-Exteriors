// ABC Supply API (Individual Business / Client Credentials). Token is kept
// server-side in integration_tokens (service role only) — there's no OAuth
// redirect here since Client Credentials is app-to-app, not per-user like
// Hover/QuickBooks.
//   GET  ?action=status               (staff)  -> { connected, environment }
//   GET  ?action=branches&state=MN    (staff)  -> ABC branches in a state
//   GET  ?action=branches&lat=&long=&distance= (staff) -> nearest branches
//   GET  ?action=accounts&q=searchterm (staff) -> matching Ship-To accounts
//   GET  ?action=item&itemNumber=02GASTZ3WW (staff) -> item detail
//   POST ?action=availability         (staff)  { itemNumbers: [...] } -> branch availability
//   POST ?action=pricing              (staff)  { shipToNumber, branchNumber, purpose, lines } -> real-time pricing
import { requireStaff } from "./_lib/supabase.js";
import { getIntegration, setIntegration } from "./_lib/integrations.js";

const PROVIDER = "abcsupply";

// Set ABC_ENVIRONMENT=production once ABC Supply approves the Production
// Request (currently PENDING) and the Production Client ID/Secret are in
// place. Until then this defaults to Sandbox.
const IS_PRODUCTION = process.env.ABC_ENVIRONMENT === "production";

const TOKEN_URL = IS_PRODUCTION
  ? "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token"
  : "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token";

const API_BASE = IS_PRODUCTION
  ? "https://partners.abcsupply.com/api"
  : "https://partners-sb.abcsupply.com/api";

// Individual Business integrations get every scope; we only request what we
// currently use. Add order.write / invoice.read here when those features are built.
const SCOPES = "location.read product.read account.read pricing.read";

function basicAuth() {
  return Buffer.from(`${process.env.ABC_CLIENT_ID}:${process.env.ABC_CLIENT_SECRET}`).toString("base64");
}

async function requestToken() {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`ABC Supply auth failed: ${detail}`);
  }
  return data;
}

// Client Credentials tokens last ~30 min and there's no refresh token —
// just request a new one once the cached one is close to expiring.
async function getValidToken() {
  const stored = await getIntegration(PROVIDER);
  if (stored?.access_token && stored.environment === (IS_PRODUCTION ? "production" : "sandbox") && Date.now() <= stored.expires_at - 60000) {
    return stored.access_token;
  }
  const data = await requestToken();
  const next = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 1800) * 1000,
    environment: IS_PRODUCTION ? "production" : "sandbox",
  };
  await setIntegration(PROVIDER, next);
  return next.access_token;
}

async function abc(path, { method = "GET", body } = {}) {
  const token = await getValidToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `ABC Supply API error ${res.status}`);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

export default async function handler(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) return;

  if (!process.env.ABC_CLIENT_ID || !process.env.ABC_CLIENT_SECRET) {
    return res.status(500).json({ error: "ABC Supply keys aren't set up on the server yet (ABC_CLIENT_ID / ABC_CLIENT_SECRET)" });
  }

  const action = req.query.action;

  try {
    if (action === "status") {
      try {
        await getValidToken();
        return res.status(200).json({ connected: true, environment: IS_PRODUCTION ? "production" : "sandbox" });
      } catch (e) {
        return res.status(200).json({ connected: false, environment: IS_PRODUCTION ? "production" : "sandbox", error: e.message });
      }
    }

    if (action === "branches" && req.method === "GET") {
      const { state, lat, long, distance } = req.query;
      const params = new URLSearchParams();
      if (state) params.set("state", state);
      if (lat && long) {
        params.set("lat", lat);
        params.set("long", long);
        if (distance) params.set("distance", distance);
      }
      if (!params.toString()) return res.status(400).json({ error: "Provide state, or lat/long (optionally with distance)" });
      const data = await abc(`/location/v1/branches?${params}`);
      return res.status(200).json({ branches: data });
    }

    if (action === "accounts" && req.method === "GET") {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "Provide ?q= a name or number to search for" });
      const data = await abc("/account/v1/search/accounts", {
        method: "POST",
        body: {
          filters: [
            { key: "accountType", condition: "equals", values: ["Ship-to"], joinCondition: "and" },
            { key: "name", condition: "contains", values: [q] },
          ],
          pagination: { itemsPerPage: 20, pageNumber: 1 },
        },
      });
      // Retired accounts carry no branches — filter them out per ABC's own guidance.
      const shipTos = (data.shipTos || []).filter(s => (s.branches || []).length > 0);
      return res.status(200).json({ shipTos, pagination: data.pagination });
    }

    if (action === "item" && req.method === "GET") {
      const itemNumber = String(req.query.itemNumber || "").trim();
      if (!itemNumber) return res.status(400).json({ error: "Provide ?itemNumber=" });
      const data = await abc(`/product/v1/items/${encodeURIComponent(itemNumber)}?embed=branches,variations`);
      return res.status(200).json({ item: data });
    }

    if (action === "availability" && req.method === "POST") {
      const itemNumbers = Array.isArray(req.body?.itemNumbers) ? req.body.itemNumbers.filter(Boolean) : [];
      if (!itemNumbers.length) return res.status(400).json({ error: "Provide itemNumbers: [\"...\"]" });
      const data = await abc("/product/v1/search/availability/items", {
        method: "POST",
        body: {
          filters: [{ key: "itemNumber", condition: "equals", values: itemNumbers }],
          pagination: { itemsPerPage: 50, pageNumber: 1 },
        },
      });
      return res.status(200).json(data);
    }

    if (action === "pricing" && req.method === "POST") {
      const { shipToNumber, branchNumber, purpose, lines } = req.body || {};
      if (!shipToNumber || !branchNumber || !Array.isArray(lines) || !lines.length) {
        return res.status(400).json({ error: "Provide shipToNumber, branchNumber, and at least one line item" });
      }
      if (lines.length > 50) return res.status(400).json({ error: "ABC Supply allows at most 50 line items per pricing request" });
      const data = await abc("/pricing/v2/prices", {
        method: "POST",
        body: {
          shipToNumber: String(shipToNumber),
          branchNumber: String(branchNumber),
          purpose: purpose || "estimating",
          lines: lines.map((l, i) => ({
            id: String(l.id ?? i + 1),
            itemNumber: l.itemNumber,
            quantity: Number(l.quantity),
            ...(l.uom ? { uom: l.uom } : {}),
            ...(l.length ? { length: l.length } : {}),
          })),
        },
      });
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message, detail: e.detail });
  }
}
