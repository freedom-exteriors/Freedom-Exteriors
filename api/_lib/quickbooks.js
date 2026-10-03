// QuickBooks Online helpers shared by api/quickbooks.js: OAuth token
// handling (tokens stay server-side in integration_tokens), API calls,
// customers and the service item invoices are billed under.
import { APP_ORIGIN, getIntegration, setIntegration } from "./integrations.js";

export const PROVIDER = "quickbooks";
export const REDIRECT_URI = `${APP_ORIGIN}/quickbooks/callback`;
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
// Intuit "Development" keys only work against the sandbox; set QB_ENVIRONMENT=sandbox to test with them.
export const API_BASE = process.env.QB_ENVIRONMENT === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";

export function basicAuth() {
  return Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
}

export async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  return res.json().catch(() => ({}));
}

export function toStored(tokens, realmId) {
  return {
    realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    refresh_expires_at: Date.now() + (tokens.x_refresh_token_expires_in || 100 * 86400) * 1000,
  };
}

export async function connection() {
  const stored = await getIntegration(PROVIDER);
  if (!stored?.refresh_token || !stored.realmId) return null;
  if (Date.now() < stored.expires_at - 60000) return stored;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: stored.refresh_token });
  if (!fresh.access_token) return null; // refresh token expired or revoked: reconnect
  const next = toStored({ ...fresh, refresh_token: fresh.refresh_token || stored.refresh_token }, stored.realmId);
  await setIntegration(PROVIDER, { ...stored, ...next });
  return { ...stored, ...next };
}

export async function qb(conn, method, path, body) {
  const res = await fetch(`${API_BASE}/v3/company/${conn.realmId}/${path}${path.includes("?") ? "&" : "?"}minorversion=73`, {
    method,
    headers: { Authorization: `Bearer ${conn.access_token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.Fault?.Error?.[0]?.Detail || data?.Fault?.Error?.[0]?.Message || `QuickBooks error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function findOrCreateCustomer(conn, job) {
  const name = String(job.name || "").trim().slice(0, 100);
  if (!name) throw new Error("This job has no customer name");
  const found = await qb(conn, "GET", `query?query=${encodeURIComponent(`select * from Customer where DisplayName = '${q(name)}'`)}`);
  const existing = found?.QueryResponse?.Customer?.[0];
  if (existing) return existing.Id;
  const customer = {
    DisplayName: name,
    ...(job.email ? { PrimaryEmailAddr: { Address: job.email } } : {}),
    ...(job.phone ? { PrimaryPhone: { FreeFormNumber: job.phone } } : {}),
    ...(job.address ? { BillAddr: { Line1: job.address, City: job.city || undefined, CountrySubDivisionCode: job.state || undefined } } : {}),
  };
  const created = await qb(conn, "POST", "customer", customer);
  return created.Customer.Id;
}

export async function serviceItem(conn) {
  if (process.env.QB_ITEM_ID) return process.env.QB_ITEM_ID;
  const res = await qb(conn, "GET", `query?query=${encodeURIComponent("select * from Item where Type = 'Service' and Active = true maxresults 50")}`);
  const items = res?.QueryResponse?.Item || [];
  const pick = items.find(i => /roof|exterior|construction/i.test(i.Name)) || items.find(i => i.Name === "Services") || items[0];
  if (!pick) throw new Error("QuickBooks has no service item to bill — add one (e.g. \"Roofing\") in QuickBooks, then try again");
  return pick.Id;
}
