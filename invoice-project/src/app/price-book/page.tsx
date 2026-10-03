"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PriceBookItem } from "@/lib/estimate";
import { centsToPlain, formatQuantity, parseQuantityMilli } from "@/lib/money";
import { api } from "@/lib/clientApi";

interface Draft {
  trade: string;
  label: string;
  description: string;
  detail: string;
  unit: string;
  defaultQuantity: string;
  rate: string;
}

const toDraft = (p: PriceBookItem): Draft => ({
  trade: p.trade,
  label: p.label,
  description: p.description,
  detail: p.detail ?? "",
  unit: p.unit,
  defaultQuantity: formatQuantity(parseQuantityMilli(String(Number(p.default_quantity))) ?? 1000).replace(/,/g, ""),
  rate: p.rate_cents === null ? "" : centsToPlain(p.rate_cents),
});

const emptyDraft = (trade = ""): Draft => ({ trade, label: "", description: "", detail: "", unit: "ea", defaultQuantity: "1", rate: "" });

function ItemRow({ item, onSaved }: { item: PriceBookItem; onSaved: (msg: string) => void }) {
  const original = useMemo(() => toDraft(item), [item]);
  const [d, setD] = useState(original);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setD(original), [original]);
  const dirty = JSON.stringify(d) !== JSON.stringify(original);
  const set = (k: keyof Draft, v: string) => setD((x) => ({ ...x, [k]: v }));

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/price-book/${item.id}`, { method: "PATCH", json: body });
      onSaved(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`pb-item${item.active ? "" : " retired"}`}>
      <div className="row">
        <div className="grow">
          <input value={d.label} aria-label="Check-box label" onChange={(e) => set("label", e.target.value)} />
        </div>
        <div className="w-amt">
          <input className={`money${d.rate ? "" : " flagged"}`} value={d.rate} placeholder="no set price" inputMode="decimal" aria-label="Price" onChange={(e) => set("rate", e.target.value)} />
        </div>
        <div className="w-unit">
          <input value={d.unit} aria-label="Unit" onChange={(e) => set("unit", e.target.value)} />
        </div>
        <button type="button" disabled={!dirty || busy} onClick={() => patch(d as unknown as Record<string, unknown>, `Saved "${d.label}".`)}>
          {busy ? "…" : "Save"}
        </button>
        <button type="button" className="link" onClick={() => setOpen((o) => !o)}>{open ? "Less" : "More"}</button>
      </div>
      {error && <div className="alert error small">{error}</div>}
      {open && (
        <div className="grid2" style={{ marginBottom: 8 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Description (printed on the estimate)</label>
            <input value={d.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Detail (small grey line under it)</label>
            <textarea rows={2} value={d.detail} onChange={(e) => set("detail", e.target.value)} />
          </div>
          <div>
            <label>Starting quantity</label>
            <input value={d.defaultQuantity} inputMode="decimal" onChange={(e) => set("defaultQuantity", e.target.value)} />
          </div>
          <div>
            <label>Trade (group)</label>
            <input value={d.trade} onChange={(e) => set("trade", e.target.value)} />
          </div>
          {item.source_note && <p className="muted small" style={{ gridColumn: "1 / -1", margin: 0 }}>Starting price came from: {item.source_note}</p>}
          <div style={{ gridColumn: "1 / -1" }}>
            {item.active ? (
              <button type="button" className="danger" disabled={busy} onClick={() => patch({ active: false }, `Retired "${item.label}". It no longer shows on new estimates.`)}>
                Retire (hide from new estimates)
              </button>
            ) : (
              <button type="button" className="secondary" disabled={busy} onClick={() => patch({ active: true }, `Restored "${item.label}".`)}>
                Restore
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PriceBookPage() {
  const [items, setItems] = useState<PriceBookItem[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ items: PriceBookItem[] }>("/api/price-book?all=1").then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const trades = useMemo(() => {
    const map = new Map<string, PriceBookItem[]>();
    for (const p of items ?? []) if (p.active || showRetired) map.set(p.trade, [...(map.get(p.trade) ?? []), p]);
    return [...map.entries()];
  }, [items, showRetired]);
  const tradeNames = useMemo(() => [...new Set((items ?? []).map((p) => p.trade))], [items]);

  async function add() {
    if (!adding) return;
    setBusy(true);
    setError("");
    try {
      const sortOrder = Math.max(0, ...(items ?? []).filter((p) => p.trade === adding.trade.trim()).map((p) => p.sort_order)) + 10;
      await api("/api/price-book", { method: "POST", json: { ...adding, description: adding.description || adding.label, sortOrder } });
      setNotice(`Added "${adding.label}".`);
      setAdding(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="backbar"><Link className="btn secondary" href="/estimates">← Back to estimates</Link></div>
      <h1>Price book</h1>
      <p className="muted small">
        These are the check boxes on a new estimate. Change a price and click <strong>Save</strong> on that row. Yellow boxes have no set price yet,
        so you type one on each estimate. Changes affect new estimates only; saved estimates keep their prices.
      </p>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}
      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 400, marginBottom: 12 }}>
        <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} style={{ width: "auto" }} /> Show retired items
      </label>
      {!items ? (
        <p className="muted">Loading…</p>
      ) : (
        trades.map(([trade, list]) => (
          <div className="card" key={trade}>
            <h2 style={{ marginTop: 0 }}>{trade}</h2>
            <div className="row muted small pb-head">
              <div className="grow">Check-box label</div>
              <div className="w-amt">Price</div>
              <div className="w-unit">Unit</div>
            </div>
            {list.map((p) => (
              <ItemRow key={p.id} item={p} onSaved={(m) => { setNotice(m); load(); }} />
            ))}
            <button type="button" className="secondary" onClick={() => setAdding(emptyDraft(trade))}>+ Add item to {trade}</button>
          </div>
        ))
      )}
      {adding ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>New item</h2>
          <div className="grid2">
            <div>
              <label>Trade (group) *</label>
              <input list="trades" value={adding.trade} onChange={(e) => setAdding({ ...adding, trade: e.target.value })} />
              <datalist id="trades">{tradeNames.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <label>Check-box label *</label>
              <input value={adding.label} placeholder="e.g. Gutter guards" onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Description printed on the estimate (blank = same as label)</label>
              <input value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Detail (small grey line, optional)</label>
              <textarea rows={2} value={adding.detail} onChange={(e) => setAdding({ ...adding, detail: e.target.value })} />
            </div>
            <div>
              <label>Price (blank = type it on each estimate)</label>
              <input className="money" value={adding.rate} inputMode="decimal" onChange={(e) => setAdding({ ...adding, rate: e.target.value })} />
            </div>
            <div>
              <label>Unit</label>
              <input value={adding.unit} placeholder="ea, sq, lf, hr" onChange={(e) => setAdding({ ...adding, unit: e.target.value })} />
            </div>
          </div>
          <div className="actions">
            <button disabled={busy || !adding.trade.trim() || !adding.label.trim()} onClick={add}>{busy ? "Saving…" : "Add item"}</button>
            <button className="secondary" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="secondary" onClick={() => setAdding(emptyDraft())}>+ Add item in a new trade</button>
      )}
    </>
  );
}
