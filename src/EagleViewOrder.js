import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./apiFetch";
import { supabase } from "./supabase";

const PANEL2 = "#162030"; const BORDER = "#1e3048"; const TEXT = "#e2eaf4"; const MUTED = "#6b8099";
const EV = "#3b82f6"; const OK = "#10b981"; const BAD = "#f87171";

// Same IDs as PRODUCTS in api/_lib/eagleviewApi.js.
export const EV_PRODUCTS = [
  { id: 106, name: "Roof (full measurements)" },
  { id: 110, name: "Bid Perfect (area + pitch only)" },
  { id: 108, name: "Walls" },
  { id: 107, name: "Walls, Windows & Doors" },
  { id: 111, name: "Full House (roof + walls)" },
];

const money = (v) => (typeof v === "number" ? `$${v.toFixed(2)}` : null);
const when = (s) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const isOpen = (o) => o.status_id == null || ![4, 5].includes(o.status_id);

async function post(action, body) {
  const res = await apiFetch(`/api/eagleview?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `EagleView request failed (${res.status})`);
  return data;
}

// Order an EagleView report for this job. When EagleView finishes it, the
// server saves the measurements onto the job (webhook), or "Check status" pulls them.
export default function EagleViewOrder({ job, onPatch }) {
  const [orders, setOrders] = useState([]);
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(106);
  const [zip, setZip] = useState(job.zip || "");
  const [quote, setQuote] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("eagleview_orders").select("*").eq("job_id", job.id).order("placed_at", { ascending: false });
    setOrders(data || []);
  }, [job.id]);
  useEffect(() => { load(); }, [load]);

  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const getQuote = () => run("quote", async () => {
    setConfirming(false);
    setQuote(await post("quote", { jobId: job.id, productId, zip }));
  });

  // Second click of a two-step confirm (an on-page step, not a browser pop-up).
  const placeOrder = () => run("order", async () => {
    const { order } = await post("order", { jobId: job.id, productId, zip, confirm: true });
    setOrders((prev) => [order, ...prev]);
    if (zip.trim() && zip.trim() !== (job.zip || "")) onPatch({ zip: zip.trim() });
    setQuote(null);
    setConfirming(false);
    setOpen(false);
  });

  const refresh = (reportId, reimport = false) => run(`refresh-${reportId}`, async () => {
    const { order, imported } = await post("refresh", { reportId, reimport });
    setOrders((prev) => prev.map((o) => (o.report_id === order.report_id ? order : o)));
    if (imported) {
      // The server saved it on the job; pull it so this screen (and its next save) has it.
      const { data } = await supabase.from("jobs").select("data").eq("job_id", job.id).maybeSingle();
      if (data?.data?.eagleviewMeasurements) onPatch({ eagleviewMeasurements: data.data.eagleviewMeasurements });
    }
  });

  const hasOpenOrder = orders.some(isOpen);
  const btn = (color, disabled) => ({ background: color + "22", border: `1px solid ${color}`, color, borderRadius: 7, padding: "8px 12px", cursor: disabled ? "default" : "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, opacity: disabled ? 0.5 : 1 });
  const input = { background: "#0f1923", border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

  return (
    <div style={{ marginTop: 10 }}>
      {!open && (
        <button onClick={() => setOpen(true)} disabled={hasOpenOrder} title={hasOpenOrder ? "An order for this job is still in progress" : ""} style={btn(EV, hasOpenOrder)}>
          🛒 Order EagleView report
        </button>
      )}
      {open && (
        <div style={{ background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: TEXT, marginBottom: 8 }}>Order EagleView report</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select aria-label="Report type" value={productId} onChange={(e) => { setProductId(Number(e.target.value)); setQuote(null); }} style={input}>
              {EV_PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input aria-label="ZIP code" placeholder="ZIP" value={zip} onChange={(e) => { setZip(e.target.value); setQuote(null); }} style={{ ...input, width: 90 }} />
            <button onClick={getQuote} disabled={!!busy} style={btn(EV, !!busy)}>{busy === "quote" ? "Pricing…" : "Get price"}</button>
            <button onClick={() => { setOpen(false); setQuote(null); setConfirming(false); setError(null); }} style={{ ...btn(MUTED, false), border: "none", background: "none" }}>Cancel</button>
          </div>
          <div style={{ color: MUTED, fontSize: 11, marginTop: 6 }}>{[job.address, job.city, job.state].filter(Boolean).join(", ") || "This job has no address yet."}</div>
          {quote && (
            <div style={{ marginTop: 10, fontSize: 12, color: TEXT }}>
              {quote.env === "sandbox" && <div style={{ color: "#fbbf24", marginBottom: 4 }}>Sandbox: orders go to EagleView's test address ({quote.address}) and return a sample report.</div>}
              <div>{quote.product} — <b>{money(quote.price) || "price not returned (billed at your EagleView rate)"}</b></div>
              {!confirming ? (
                <button onClick={() => setConfirming(true)} disabled={!!busy} style={{ ...btn(OK, !!busy), marginTop: 8 }}>{`Place order${money(quote.price) ? ` · ${money(quote.price)}` : ""}`}</button>
              ) : (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 7, border: `1px solid ${quote.env === "sandbox" ? "#fbbf24" : BAD}`, background: "#0f1923" }}>
                  <div style={{ fontWeight: 700, color: quote.env === "sandbox" ? "#fbbf24" : BAD }}>
                    {quote.env === "sandbox" ? "Sandbox test order (no charge)" : `Place a real EagleView order${money(quote.price) ? ` for ${money(quote.price)}` : " at your EagleView rate"}?`}
                  </div>
                  <div style={{ color: MUTED, fontSize: 11, margin: "4px 0 8px" }}>{quote.product} · {quote.address}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={placeOrder} disabled={!!busy} style={btn(OK, !!busy)}>{busy === "order" ? "Placing order…" : "Confirm order"}</button>
                    <button onClick={() => setConfirming(false)} disabled={!!busy} style={btn(MUTED, !!busy)}>Back</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {error && <div style={{ color: BAD, fontSize: 12, marginTop: 6 }}>{error}</div>}
      {orders.map((o) => (
        <div key={o.report_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 12, color: TEXT }}>
          <div>
            <b>{o.product_name}</b> · report #{o.report_id}{o.env === "sandbox" ? " (sandbox)" : ""}
            <div style={{ color: MUTED, fontSize: 11 }}>
              {o.imported_at ? <span style={{ color: OK }}>Measurements imported {when(o.imported_at)}</span> : (o.status || "Ordered")}
              {" · ordered "}{when(o.placed_at)}{o.quoted_price != null ? ` · ${money(Number(o.quoted_price))}` : ""}
              {o.last_error ? <span style={{ color: BAD }}> · {o.last_error}</span> : null}
            </div>
          </div>
          <button onClick={() => refresh(o.report_id, !!o.imported_at)} disabled={!!busy} style={btn(EV, !!busy)}>
            {busy === `refresh-${o.report_id}` ? "Checking…" : o.imported_at ? "Re-import" : "Check status"}
          </button>
        </div>
      ))}
    </div>
  );
}
