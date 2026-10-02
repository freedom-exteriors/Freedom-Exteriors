// Shared ABC Supply proxy.
//
// Deployed ONCE here (in the CRM's Supabase project) and called server-side
// by both Freedom-Exteriors and the bid-estimator, which live in two
// SEPARATE Supabase projects. Since an Edge Function is just an HTTPS
// endpoint, hosting it in one project and having the other app's server-side
// code call it works fine without requiring a shared project.
//
// verify_jwt is deliberately OFF: Supabase's default JWT check would
// reject the bid-estimator's calls outright, since its anon key belongs to
// a different project and can never produce a JWT valid here. Auth is a
// shared internal secret instead (INTERNAL_API_KEY) -- still server-to-
// server only, since both callers are the apps' own serverless functions,
// never a browser.
//
// Required Supabase Edge Function secrets (set via the Dashboard or
// `supabase secrets set`, never via this codebase):
//   ABC_SUPPLY_CLIENT_ID, ABC_SUPPLY_CLIENT_SECRET  -- from the ABC Supply
//     Developer Portal app's "Manage" screen
//   ABC_SUPPLY_ENV        -- "sandbox" (default) or "production"
//   INTERNAL_API_KEY      -- a random shared secret; put the same value in
//     both Vercel projects as ABC_SUPPLY_INTERNAL_API_KEY
//
// POST body (header x-internal-api-key):
//   { shipToNumber, branchNumber, items: [{ itemNumber, quantity?, uom? }] }  -- pricing (default action)
//   { action: "accounts", state?, name?, page? }   -- your Ship-To accounts + their branches
//   { action: "items", query, branchNumber?, page? } -- catalog search by description or item number

const ENDPOINTS: Record<string, { tokenUrl: string; apiBase: string }> = {
  sandbox: {
    tokenUrl: "https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token",
    apiBase: "https://partners-sb.abcsupply.com/api",
  },
  production: {
    tokenUrl: "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token",
    apiBase: "https://partners.abcsupply.com/api",
  },
};

function getEnv() {
  const env = (Deno.env.get("ABC_SUPPLY_ENV") || "sandbox").toLowerCase();
  const endpoints = ENDPOINTS[env];
  if (!endpoints) throw new Error(`ABC_SUPPLY_ENV must be "sandbox" or "production", got "${env}"`);
  return { env, ...endpoints };
}

// Best-effort warm-instance cache -- a fresh token is fetched whenever the
// isolate is cold anyway, this just avoids a redundant token call on a
// warm one. Access tokens last 30 minutes per ABC's docs.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAbcSupplyToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.accessToken;

  const { tokenUrl } = getEnv();
  const clientId = Deno.env.get("ABC_SUPPLY_CLIENT_ID");
  const clientSecret = Deno.env.get("ABC_SUPPLY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("ABC_SUPPLY_CLIENT_ID and ABC_SUPPLY_CLIENT_SECRET must be set");

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
    // Only the 4 scopes this app was actually granted at signup.
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "location.read product.read account.read pricing.read" }),
  });
  if (!res.ok) throw new Error(`ABC Supply auth failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000 };
  return cachedToken.accessToken;
}

async function abcPost(path: string, body: unknown) {
  const { apiBase } = getEnv();
  const token = await getAbcSupplyToken();
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ABC Supply ${path} error ${res.status}: ${await res.text()}`);
  return res.json();
}

const MAX_LINES_PER_REQUEST = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface PriceLine {
  itemNumber: string;
  quantity?: number;
  uom?: string;
}

// HTTP 200 doesn't mean every line priced -- ABC's docs are explicit that
// each line's status.code must be checked individually, and that a $0.00
// unitPrice with status.code "OK" means the branch hasn't entered pricing
// for that item yet, not a real free rate. Both handled explicitly below
// rather than trusting the top-level response.
async function priceAbcItems(items: PriceLine[], shipToNumber: string, branchNumber: string) {
  const results = [];

  for (const batch of chunk(items, MAX_LINES_PER_REQUEST)) {
    const data = await abcPost("/pricing/v2/prices", {
      requestId: `abc-supply-pricing-${Date.now()}`,
      shipToNumber,
      branchNumber,
      purpose: "estimating", // pulling numbers into a bid tool, not placing an order
      lines: batch.map((it, i) => ({ id: String(i + 1), itemNumber: it.itemNumber, quantity: it.quantity || 1, uom: it.uom })),
    });

    for (let i = 0; i < batch.length; i++) {
      const line = (data.lines || [])[i];
      const zeroButOk = line && line.status?.code === "OK" && line.unitPrice === 0;
      const priced = line && line.status?.code === "OK" && line.unitPrice > 0;
      let statusMessage = line?.status?.message || (line ? undefined : "No line returned for this item");
      if (zeroButOk) statusMessage = "Branch hasn't entered pricing for this item yet ($0.00, not a real rate)";
      results.push({
        itemNumber: batch[i].itemNumber,
        unitPrice: priced ? line.unitPrice : null,
        uom: line?.uom || batch[i].uom,
        statusCode: line?.status?.code || "MISSING",
        statusMessage,
      });
    }
  }

  return results;
}

const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const pageOf = (v: unknown) => Math.min(Math.max(Number(v) || 1, 1), 100);

// Ship-To accounts this app can price against, each with its branches. Per
// ABC's docs, Ship-Tos with no branches are retired ERP accounts -- dropped.
async function searchAccounts(body: Record<string, unknown>) {
  const filters: Record<string, unknown>[] = [{ key: "accountType", condition: "equals", values: ["Ship-To"] }];
  const state = str(body.state, 2).toUpperCase();
  const name = str(body.name);
  if (state) filters.push({ key: "address.state", condition: "equals", values: [state] });
  else if (name) filters.push({ key: "name", condition: "contains", values: [name] });
  if (filters.length > 1) filters[0].joinCondition = "and";

  const data = await abcPost("/account/v1/search/accounts", { filters, pagination: { itemsPerPage: 50, pageNumber: pageOf(body.page) } });
  const shipTos = (data.shipTos || [])
    .filter((s: any) => Array.isArray(s.branches) && s.branches.length)
    .map((s: any) => ({
      number: s.number,
      name: s.name,
      status: s.status,
      address: s.address,
      branches: s.branches.map((b: any) => ({ number: b.number, name: b.name, homeBranch: !!b.homeBranch, status: b.status })),
    }));
  return { shipTos, pagination: data.pagination || null };
}

// Catalog search by description or item number, optionally limited to one branch.
async function searchItems(body: Record<string, unknown>) {
  const query = str(body.query);
  if (!query) throw new HttpError(400, "query is required");
  const key = /^[A-Z0-9]{6,}$/i.test(query) && !/\s/.test(query) ? "itemNumber" : "itemDescription";
  const filters: Record<string, unknown>[] = [{ key, condition: "contains", values: [query] }];
  const branchNumber = str(body.branchNumber, 20);
  if (branchNumber) {
    filters[0].joinCondition = "and";
    filters.push({ key: "branchNumber", condition: "equals", values: [branchNumber] });
  }
  const data = await abcPost("/product/v1/search/items", { filters, pagination: { itemsPerPage: 25, pageNumber: pageOf(body.page) } });
  const items = (data.items || []).map((it: any) => ({
    itemNumber: it.itemNumber,
    description: it.itemDescription,
    familyName: it.familyName,
    status: it.status,
    uoms: (it.uoms || []).map((u: any) => ({ code: u.code, name: u.name })),
  }));
  return { items, pagination: data.pagination || null };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const internalKey = req.headers.get("x-internal-api-key");
  const expectedKey = Deno.env.get("INTERNAL_API_KEY");
  if (!expectedKey || !internalKey || internalKey !== expectedKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const action = body.action || "pricing";
    const { env } = getEnv();

    if (action === "accounts") return json({ ...(await searchAccounts(body)), env });
    if (action === "items") return json({ ...(await searchItems(body)), env });
    if (action !== "pricing") return json({ error: `Unknown action "${action}"` }, 400);

    const { items, shipToNumber, branchNumber } = body;
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "items (non-empty array of {itemNumber, uom}) is required" }, 400);
    }
    if (!shipToNumber) return json({ error: "shipToNumber is required" }, 400);
    if (!branchNumber) return json({ error: "branchNumber is required" }, 400);

    const prices = await priceAbcItems(items, shipToNumber, branchNumber);
    return json({ prices, fetchedAt: new Date().toISOString(), env });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
