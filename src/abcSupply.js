// Thin client for /api/abcsupply — mirrors the pattern other integrations
// (QuickBooks, Hover) don't have a dedicated frontend module for, but this
// one's used from more than one place (QuickQuote, future estimating tools),
// so it's worth centralizing here instead of repeating apiFetch calls.
import { apiFetch } from "./apiFetch";

async function call(url, options) {
  const res = await apiFetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ABC Supply request failed (${res.status})`);
  return data;
}

export const abcSupplyStatus = () => call("/api/abcsupply?action=status");

export const abcSupplySearchAccounts = (q) =>
  call(`/api/abcsupply?action=accounts&q=${encodeURIComponent(q)}`);

export const abcSupplyBranchesByState = (state) =>
  call(`/api/abcsupply?action=branches&state=${encodeURIComponent(state)}`);

export const abcSupplyGetItem = (itemNumber) =>
  call(`/api/abcsupply?action=item&itemNumber=${encodeURIComponent(itemNumber)}`);

export const abcSupplyCheckAvailability = (itemNumbers) =>
  call("/api/abcsupply?action=availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemNumbers }),
  });

// lines: [{ itemNumber, quantity, uom?, length? }]
export const abcSupplyGetPricing = (shipToNumber, branchNumber, lines, purpose = "estimating") =>
  call("/api/abcsupply?action=pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipToNumber, branchNumber, purpose, lines }),
  });
