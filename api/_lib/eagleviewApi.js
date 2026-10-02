// EagleView Measurement Orders API (server only): OAuth client-credentials
// token, order/report calls, webhook token checks, and turning a finished
// report into the same measurement shape /api/hover returns.
//
// Env (Vercel): EAGLEVIEW_CLIENT_ID, EAGLEVIEW_CLIENT_SECRET,
// EAGLEVIEW_ENV = "sandbox" (default) | "production".
import crypto from "crypto";

const TOKEN_URL = "https://apicenter.eagleview.com/oauth2/v1/token"; // same for sandbox and production
const API_BASE = { sandbox: "https://sandbox.apicenter.eagleview.com", production: "https://apicenter.eagleview.com" };
const JWKS_URL = "https://evkeys.eagleview.com/auth/jwks.json";
const WEBHOOK_ISSUER = "https://auth.eagleview.com";

export function evEnv() {
  const env = (process.env.EAGLEVIEW_ENV || "sandbox").toLowerCase();
  if (!API_BASE[env]) throw new Error(`EAGLEVIEW_ENV must be "sandbox" or "production", got "${env}"`);
  return env;
}

// Products we offer from the job screen. Bid Perfect only ships with its own
// delivery option (45); the rest use Regular (8). IDs from GetAvailableProducts.
export const PRODUCTS = {
  106: { name: "Roof (full measurements)", delivery: 8 },
  110: { name: "Bid Perfect (area + pitch only)", delivery: 45 },
  108: { name: "Walls", delivery: 8 },
  107: { name: "Walls, Windows & Doors", delivery: 8 },
  111: { name: "Full House (roof + walls)", delivery: 8 },
};

// The sandbox only accepts EagleView's fixed test addresses.
export const SANDBOX_TEST_ADDRESS = { Address: "4800 Floral Park Rd", City: "Brandywine", State: "Maryland", Zip: "20613" };

export const STATUS = { 1: "Created", 2: "In process", 3: "Pending", 4: "Closed", 5: "Completed" };
export const SUB_STATUS = {
  5: "Images under review", 6: "Measuring started", 8: "Needs structure ID — EagleView emailed you", 9: "Closed: duplicate order",
  10: "Canceled", 11: "Closed: poor images", 12: "Closed: property never identified", 14: "Closed: report type change declined",
  15: "Closed: no images for this property", 16: "Closed", 18: "Card rejected", 19: "Files sent", 20: "Files sent",
  21: "Awaiting your response", 24: "Closed: wrong house", 27: "Payment failed", 31: "Processing", 32: "Being measured",
  38: "Closed: unsupported structure", 43: "Capturing payment",
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
export const stateName = (s) => STATE_NAMES[String(s || "").trim().toUpperCase()] || String(s || "").trim();

let cachedToken = null;
async function token() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const id = process.env.EAGLEVIEW_CLIENT_ID, secret = process.env.EAGLEVIEW_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET aren't set on the CRM's Vercel project.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`EagleView sign-in failed (${res.status}) — check the client ID/secret.`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

/** Authenticated EagleView call. Returns the raw Response; callers decide how to read it. */
export async function evFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE[evEnv()]}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) cachedToken = null;
  return res;
}

async function evJson(path, opts) {
  const res = await evFetch(path, opts);
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`EagleView ${path.split("?")[0]} error ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
  return text ? JSON.parse(text) : null;
}

/** The PlaceOrder/PriceOrder body for one address. */
export function orderBody({ address, productId, referenceId }) {
  const product = PRODUCTS[productId];
  if (!product) throw new Error("Unknown EagleView product.");
  return {
    OrderReports: [{
      ReportAddresses: [{ ...address, Country: "US", AddressType: 1 }],
      PrimaryProductId: Number(productId),
      DeliveryProductId: product.delivery,
      MeasurementInstructionType: 3,
      ChangesInLast4Years: false,
      ReferenceID: referenceId,
    }],
    PromoCode: null,
    PlaceOrderUser: null,
    CreditCardData: null,
  };
}

export const priceOrder = (body) => evJson("/v2/Order/PriceOrder", { method: "POST", body });
export const placeOrder = (body) => evJson("/v2/Order/PlaceOrder", { method: "POST", body });
export const getReport = (reportId) => evJson(`/v3/Report/GetReport?reportId=${encodeURIComponent(reportId)}`);

/** GetReportFile → Buffer, or null when the file isn't there (204) or not ready yet (500). */
export async function getReportFile(reportId, fileFormat, fileType) {
  const res = await evFetch(`/v1/File/GetReportFile?reportId=${encodeURIComponent(reportId)}&fileFormat=${fileFormat}&fileType=${fileType}`);
  if (res.status === 204 || res.status === 404 || res.status === 500) return null;
  if (!res.ok) throw new Error(`EagleView GetReportFile error ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// PriceOrder's response shape isn't documented. Prefer an explicit total;
// otherwise the first price-like number anywhere in the response.
export function quotedPrice(resp) {
  const hits = [];
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 6) return;
    for (const [k, v] of Object.entries(o)) {
      const n = typeof v === "number" ? v : typeof v === "string" && /^\$?\d+(\.\d+)?$/.test(v.trim()) ? parseFloat(v.replace("$", "")) : null;
      if (n !== null && Number.isFinite(n) && /(price|cost|total|amount|charge|fee)/i.test(k) && !/(id|count|qty|quantity)$/i.test(k)) {
        hits.push({ n, total: /total|ordertotal|grand/i.test(k), depth });
      } else if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(resp);
  const pick = hits.find((h) => h.total) || hits.sort((a, b) => a.depth - b.depth)[0];
  return pick ? pick.n : null;
}

// ---------- Measurements ----------

const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? x : null; };

const LINE_KEYS = { RIDGE: "ridges", HIP: "hips", VALLEY: "valleys", EAVE: "eaves", RAKE: "rakes", FLASHING: "flashing", STEPFLASH: "stepFlashing", PARAPET: "parapets" };

/**
 * EV Measurement JSON (fileFormat 18 / fileType 107) → totals. Uses the
 * report's OVERALL_SUMMARY when present (Roof/Premium), otherwise adds up
 * the roof geometry itself (Bid Perfect ships geometry without a summary) —
 * the two agree to the tenth of a foot on EagleView's samples.
 */
export function measureEvJson(json) {
  const root = json?.EAGLEVIEW_EXPORT;
  if (!root) throw new Error("Not an EagleView measurement file.");
  const lengths = Object.fromEntries(Object.values(LINE_KEYS).map((k) => [k, 0]));
  const seen = new Set();
  const pitchArea = new Map();
  let area = 0, facets = 0, roofs = 0;
  for (const s of arr(root.STRUCTURES)) {
    for (const roof of arr(s?.ROOF)) {
      roofs++;
      const pts = new Map(arr(roof.POINTS?.POINT).map((p) => [p["@id"], String(p["@data"]).split(",").map(Number)]));
      for (const ln of arr(roof.LINES?.LINE)) {
        const key = LINE_KEYS[ln["@type"]];
        if (!key) continue;
        seen.add(key);
        const [a, b] = String(ln["@path"]).split(",").map((id) => pts.get(id));
        if (a && b) lengths[key] += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      }
      for (const f of arr(roof.FACES?.FACE)) {
        if (f["@type"] !== "ROOF") continue;
        const size = num(f.POLYGON?.["@unroundedsize"]) ?? num(f.POLYGON?.["@size"]) ?? 0;
        const pitch = `${num(f.POLYGON?.["@pitch"]) ?? 0}/12`;
        area += size; facets++;
        pitchArea.set(pitch, (pitchArea.get(pitch) || 0) + size);
      }
    }
  }

  // The report's own summary, when it has one, is the number printed on the PDF.
  const summary = Object.fromEntries(arr(root.OVERALL_SUMMARY?.ATTRIBUTE).map((a) => [a["@name"], a["@value"]]));
  const S = (k) => num(summary[k]);
  if (Object.keys(summary).length) {
    for (const [k, attr] of [["ridges", "TotalRidgesLength"], ["hips", "TotalHipsLength"], ["valleys", "TotalValleysLength"], ["rakes", "TotalRakesLength"],
      ["eaves", "TotalEavesLength"], ["flashing", "TotalFlashingLength"], ["stepFlashing", "TotalStepFlashingLength"], ["parapets", "TotalParapetsLength"]]) {
      if (S(attr) !== null) { lengths[k] = S(attr); seen.add(k); }
    }
    const perPitch = Object.entries(summary).filter(([k]) => k.startsWith("RoofAreaPerPitch:"));
    if (perPitch.length) { pitchArea.clear(); for (const [k, v] of perPitch) pitchArea.set(k.split(":")[1], num(v) || 0); }
  }
  const totalRoofArea = S("TotalRoofArea") ?? (area ? area : null);
  const loc = root.LOCATION || {};
  return {
    totalRoofArea: r1(totalRoofArea),
    facets: S("TotalRoofFacets") ?? (facets || null),
    pitches: [...pitchArea].map(([pitch, a]) => ({ pitch, area: r1(a), percentage: totalRoofArea ? r1((a / totalRoofArea) * 100) : null }))
      .sort((a, b) => (b.area || 0) - (a.area || 0)),
    lengths: Object.fromEntries(Object.entries(lengths).map(([k, v]) => [k, seen.has(k) ? r1(v) : null])),
    roofCount: roofs,
    penetrations: S("TotalPenetrationsCount"),
    stories: summary.NumberOfStories || null,
    complexity: summary.StructureComplexity || null,
    address: [loc["@address"], loc["@city"], [loc["@state"], loc["@postal"]].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
  };
}

// GetReport prints lengths as "46 ft" or `79' 0"`.
export function parseFeet(v) {
  const s = String(v ?? "");
  const m = s.match(/(-?[\d.,]+)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?/);
  if (m) return r2(num(m[1]) + (m[2] ? Number(m[2]) / 12 : 0));
  return num(s);
}

/** GetReport alone → totals (fallback when the measurement JSON isn't available). */
export function measureGetReport(report) {
  const t = report?.TotalMeasurements || report || {};
  const area = num(t.Area ?? report?.Area);
  const pitches = arr(t.PitchTable ?? report?.PitchTable).map((p) => ({ pitch: p.Pitch, area: num(p.RoofArea), percentage: num(p.PercentageRoofArea) }))
    .sort((a, b) => (b.area || 0) - (a.area || 0));
  const L = (k) => parseFeet(t[k] ?? report?.[k]);
  return {
    totalRoofArea: area,
    facets: num(t.TotalRoofFacets ?? report?.TotalRoofFacets),
    pitches,
    lengths: { ridges: L("LengthRidge"), hips: L("LengthHip"), valleys: L("LengthValley"), eaves: L("LengthEave"), rakes: L("LengthRake"), flashing: null, stepFlashing: null, parapets: null },
  };
}

/** Totals (+ GetReport details) → the job.hoverMeasurements shape the rest of the CRM reads. */
export function toJobMeasurements(totals, report, { reportId, now = new Date() } = {}) {
  const { lengths = {} } = totals;
  const area = totals.totalRoofArea;
  const rise = (p) => Number(String(p || "").split("/")[0]);
  const ridges = lengths.ridges, hips = lengths.hips, eaves = lengths.eaves, rakes = lengths.rakes;
  const hasLengths = [ridges, hips, lengths.valleys, eaves, rakes].some((v) => v !== null && v !== undefined);
  const walls = report?.TotalMeasurements?.WallMeasurement || null;
  const warnings = [];
  if (!area) warnings.push("No roof area in this report.");
  if (!hasLengths) warnings.push("This report has no ridge/hip/valley/eave/rake lengths. Area and pitch are fine for pricing; order a Roof report for a full material takeoff.");
  const plus = (pct) => (area ? Math.round(area * (1 + pct / 100)) : null);
  return {
    source: "eagleview",
    via: "order",
    reportType: report?.ProductPrimary || report?.PrimaryProductDisplayName || null,
    reportNumber: String(reportId ?? report?.ReportId ?? "") || null,
    reportDate: report?.DateCompleted || null,
    address: totals.address || [report?.Street, report?.City, [report?.State, report?.Zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    totalRoofArea: area,
    squares: area ? r2(area / 100) : null,
    areaWithWaste: { plus5: plus(5), plus10: plus(10), plus15: plus(15), plus20: plus(20) },
    suggestedWastePct: null,
    facets: totals.facets ?? null,
    predominantPitch: totals.pitches?.[0]?.pitch ?? null,
    pitches: totals.pitches || [],
    lowSlopeArea: totals.pitches?.length ? r1(totals.pitches.filter((p) => rise(p.pitch) < 4).reduce((s, p) => s + (p.area || 0), 0)) : null,
    hasLengths,
    ridgeHipLength: ridges != null || hips != null ? r1((ridges || 0) + (hips || 0)) : null,
    ridgeLength: ridges ?? null,
    hipLength: hips ?? null,
    valleyLength: lengths.valleys ?? null,
    eavesLength: eaves ?? null,
    rakeLength: rakes ?? null,
    dripEdgeLength: eaves != null && rakes != null ? r1(eaves + rakes) : null,
    flashingLength: lengths.flashing ?? null,
    stepFlashingLength: lengths.stepFlashing ?? null,
    parapetLength: lengths.parapets ?? null,
    stories: totals.stories || null, // EagleView prints "1" or ">1"
    walls: walls ? { wallsArea: num(walls.WallsArea), sidingArea: num(walls.WallsSidingArea), masonryArea: num(walls.WallsMasonryArea), openingsArea: num(walls.PenetrationArea) } : null,
    warnings,
    fetchedAt: now.toISOString(),
  };
}

// ---------- Webhook token ----------

let jwks = null;
async function webhookKey(kid) {
  if (!jwks || !jwks.keys.some((k) => k.kid === kid)) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`Couldn't load EagleView signing keys (${res.status})`);
    jwks = await res.json();
  }
  const jwk = jwks.keys.find((k) => k.kid === kid) || (jwks.keys.length === 1 ? jwks.keys[0] : null);
  if (!jwk) throw new Error("Unknown EagleView signing key");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

const b64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * Checks the Bearer token EagleView puts on every webhook call: RS256
 * signature against EagleView's published keys, issuer, expiry, that it's
 * for our client ID, and that the query string it signed is the one we got.
 * Returns the claims, or throws.
 */
export async function verifyWebhook(authHeader, query, { now = Date.now(), clientId = process.env.EAGLEVIEW_CLIENT_ID, getKey = webhookKey } = {}) {
  const jwt = String(authHeader || "").replace(/^Bearer\s+/i, "");
  const [h, p, sig] = jwt.split(".");
  if (!h || !p || !sig) throw new Error("missing token");
  const header = JSON.parse(b64url(h).toString("utf8"));
  if (header.alg !== "RS256") throw new Error("unexpected token algorithm");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), await getKey(header.kid), b64url(sig));
  if (!ok) throw new Error("bad signature");
  const claims = JSON.parse(b64url(p).toString("utf8"));
  if (claims.iss !== WEBHOOK_ISSUER) throw new Error("wrong issuer");
  if (!(Number(claims.exp) * 1000 > now - 30_000)) throw new Error("token expired");
  if (!clientId || claims.x_target_client !== clientId) throw new Error("token is for a different client");
  if (claims.x_query_parameter) {
    const signed = new URLSearchParams(Buffer.from(claims.x_query_parameter, "base64").toString("utf8"));
    for (const [k, v] of signed) {
      const got = Object.entries(query || {}).find(([qk]) => qk.toLowerCase() === k.toLowerCase())?.[1];
      if (String(Array.isArray(got) ? got[0] : got ?? "") !== v) throw new Error(`query parameter ${k} doesn't match the token`);
    }
  }
  return claims;
}
