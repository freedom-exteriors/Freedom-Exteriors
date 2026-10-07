// Hover OAuth + measurements. The Hover token is kept server-side in
// integration_tokens (service role only).
import { requireStaff } from "./_lib/supabase.js";
import { APP_ORIGIN, getIntegration, setIntegration, createOAuthState, consumeOAuthState } from "./_lib/integrations.js";

const HOVER_TOKEN_URL = "https://hover.to/oauth/token";
const HOVER_API_BASE = "https://hover.to/api/v3";
// Must exactly match the redirect URI registered on the Hover integration
// (Hover > Settings > Developer > Freedom Exteriors CRM). vercel.json rewrites
// it to /api/hover?action=callback.
const REDIRECT_URI = `${APP_ORIGIN}/api/hover/callback`;

const getStoredToken = () => getIntegration("hover");
const storeToken = (tokenData) => setIntegration("hover", tokenData);

async function requestToken(params) {
  const res = await fetch(HOVER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: process.env.HOVER_CLIENT_ID, client_secret: process.env.HOVER_CLIENT_SECRET }),
  });
  return res.json();
}

async function getValidToken() {
  const stored = await getStoredToken();
  if (!stored?.access_token) return null;
  if (Date.now() <= stored.expires_at - 60000) return stored.access_token;
  const data = await requestToken({ grant_type: "refresh_token", refresh_token: stored.refresh_token });
  if (!data.access_token) return null;
  await storeToken({
    access_token: data.access_token,
    refresh_token: data.refresh_token || stored.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return data.access_token;
}

export default async function handler(req, res) {
  const action = req.query.action;

  // A signed-in staff member starts the Hover login; the one-time state proves the
  // callback belongs to that login (so nobody can attach their own Hover account).
  if (action === "start" && req.method === "POST") {
    const staff = await requireStaff(req, res);
    if (!staff) return;
    const state = await createOAuthState("hover", staff.email);
    const params = new URLSearchParams({ client_id: process.env.HOVER_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", state });
    return res.status(200).json({ url: `https://hover.to/oauth/authorize?${params}` });
  }

  if (action === "callback") {
    const { code, state } = req.query;
    if (!(await consumeOAuthState("hover", state))) return res.redirect(`${APP_ORIGIN}/?hover=expired`);
    if (!code) return res.redirect(`${APP_ORIGIN}/?hover=failed`);
    const tokenData = await requestToken({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
    if (!tokenData.access_token) return res.redirect(`${APP_ORIGIN}/?hover=failed`);
    await storeToken({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
    });
    return res.redirect(`${APP_ORIGIN}/?hover=connected`);
  }

  if (action === "measurements" && req.method === "GET") {
    // Server-to-server callers (the separate bid-estimator app) authenticate
    // with a shared secret instead of a staff cookie -- it has no CRM staff
    // session to send, and shouldn't get one just to read a measurement. This
    // never does Hover's own OAuth login/callback: only reads the connection
    // the CRM's staff already made, so the token stays owned in one place.
    const internalKey = req.headers["x-internal-api-key"];
    const isInternal = !!internalKey && !!process.env.HOVER_INTERNAL_API_KEY && internalKey === process.env.HOVER_INTERNAL_API_KEY;
    if (!isInternal && !(await requireStaff(req, res))) return;
    const { hoverId } = req.query;
    if (!hoverId || !/^\d+$/.test(String(hoverId))) return res.status(400).json({ error: "Valid hoverId required" });

    try {
      const token = await getValidToken();
      // 401 tells the app to send the user through Hover's login (action=start).
      if (!token) return res.status(401).json({ error: "Hover isn't connected yet" });

      const jobRes = await fetch(`${HOVER_API_BASE}/jobs/${hoverId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (jobRes.status === 401) return res.status(401).json({ error: "Hover session expired" });
      if (!jobRes.ok) return res.status(jobRes.status).json({ error: `Hover API error ${jobRes.status}` });

      const jobData = await jobRes.json();
      const job = jobData.job || jobData;

      // Roof numbers live on the measurements endpoint, not the job record.
      // Keep Hover's raw summary alongside our fields so the mapping can be
      // checked against real data.
      const measRes = await fetch(`https://hover.to/api/v2/jobs/${hoverId}/measurements.json?version=summarized_json`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let summary = null;
      let measurementsStatus = measRes.status;
      if (measRes.ok) {
        summary = await measRes.json().catch(() => null);
      }

      // Mapping for Hover's summarized_json (confirmed against a real job): each
      // roof line item has { total: count, length: feet }; facets carry area.
      const roof = summary?.roof || {};
      const n = (v) => (v === null || v === undefined || isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
      const len = (key) => n(roof[key]?.length);
      const pitches = Array.isArray(roof.pitch)
        ? roof.pitch.map(p => ({ pitch: p.roof_pitch, area: n(p.area), percentage: n(p.percentage) })).sort((a, b) => (b.area || 0) - (a.area || 0))
        : [];
      const rise = (p) => Number(String(p || "").split("/")[0]);
      const totalRoofArea = n(roof.roof_facets?.area);
      const eavesLength = len("gutters_eaves");
      const rakeLength = len("rakes");
      const waste = roof.waste_factor?.area || {};
      const measurements = {
        totalRoofArea, // sq ft, no waste
        squares: totalRoofArea !== null ? n(totalRoofArea / 100) : null,
        areaWithWaste: { plus5: n(waste.plus_5_percent), plus10: n(waste.plus_10_percent), plus15: n(waste.plus_15_percent), plus20: n(waste.plus_20_percent) },
        facets: n(roof.roof_facets?.total),
        predominantPitch: pitches[0]?.pitch ?? null,
        pitches,
        lowSlopeArea: pitches.length ? n(pitches.filter(p => rise(p.pitch) < 4).reduce((sum, p) => sum + (p.area || 0), 0)) : null, // under 4/12
        ridgeHipLength: len("ridges_hips"), // Hover reports ridges and hips combined
        valleyLength: len("valleys"),
        eavesLength,
        rakeLength,
        dripEdgeLength: eavesLength !== null && rakeLength !== null ? n(eavesLength + rakeLength) : null, // eaves + rakes perimeter
        flashingLength: len("flashing"),
        stepFlashingLength: len("step_flashing"),
        address: job.address || null,
        measurementsStatus,
        rawSummary: summary,
        fetchedAt: new Date().toISOString(),
      };
      return res.status(200).json({ success: true, measurements });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
}
