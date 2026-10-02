// Thin client for /api/abcsupply, which proxies to the shared ABC Supply
// pricing Edge Function (also used by bid-estimator). Only pricing is
// exposed here — item/account/branch lookups aren't part of the shared
// function yet, so they'd need to be added there first if the CRM needs them.
import { apiFetch } from "./apiFetch";

// items: [{ itemNumber, quantity, uom? }]
export async function abcSupplyGetPricing(shipToNumber, branchNumber, items) {
  const res = await apiFetch("/api/abcsupply?action=pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipToNumber, branchNumber, items }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ABC Supply pricing request failed (${res.status})`);
  return data; // { prices: [{ itemNumber, unitPrice, uom, statusCode, statusMessage }], fetchedAt }
}
