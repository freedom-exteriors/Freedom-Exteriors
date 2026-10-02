// Thin client for /api/abcsupply, which proxies to the shared ABC Supply
// Edge Function (also used by bid-estimator): pricing, plus the
// account and item lookups needed to know which ship-to/branch/item to price.
import { apiFetch } from "./apiFetch";

// items: [{ itemNumber, quantity, uom? }]
export async function abcSupplyGetPricing(shipToNumber, branchNumber, items) {
  return post("pricing", { shipToNumber, branchNumber, items });
  // → { prices: [{ itemNumber, unitPrice, uom, statusCode, statusMessage }], fetchedAt, env }
}

// Ship-To accounts (with their branches) the ABC credentials can price against.
export async function abcSupplySearchAccounts({ state, name, page } = {}) {
  return post("accounts", { state, name, page }); // → { shipTos, pagination, env }
}

// Catalog search by description or item number, optionally at one branch.
export async function abcSupplySearchItems(query, { branchNumber, page } = {}) {
  return post("items", { query, branchNumber, page }); // → { items: [{ itemNumber, description, uoms }], pagination, env }
}

async function post(action, body) {
  const res = await apiFetch(`/api/abcsupply?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ABC Supply ${action} request failed (${res.status})`);
  return data;
}
