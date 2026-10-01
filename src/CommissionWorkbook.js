import { useState } from "react";
import { exportCommissionWorkbook } from "./pdfExport";
import { TRADES } from "./purchaseAgreementSchema";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099"; const GREEN = "#10b981";

const OP_ALLOC_PCT = 0.15;

const TIERS = [
  { value: 30, label: "30%", desc: "Paid Lead / Entry Rep" },
  { value: 40, label: "40%", desc: "Start-to-Finish, Own Lead" },
  { value: 50, label: "50%", desc: "Team Leader / $1M Sold" },
];

const COST_LINES = [
  { key: "xactimate",      label: "A. Xactimate" },
  { key: "permits",        label: "B. Permits" },
  { key: "roofMaterials",  label: "C. Roofing Materials" },
  { key: "roofLabor",      label: "D. Roofing Labor" },
  { key: "sidingMaterials",label: "E. Siding / Wrap Materials" },
  { key: "sidingLabor",    label: "F. Siding / Wrap Labor" },
  { key: "gutterMat",      label: "G. Gutter Materials" },
  { key: "gutterLabor",    label: "H. Gutter Labor" },
  { key: "windows",        label: "I. Windows" },
  { key: "electrical",     label: "J. Electrical" },
  { key: "dumpster",       label: "K. Dumpster Fees" },
  { key: "hoverCost",      label: "L. Hover Cost" },
  { key: "chargeback",     label: "M. Chargeback" },
  { key: "insNegFee",      label: "N. Insurance Negotiation Fee" },
  { key: "supplementFee",  label: "O. Supplement Negotiation Fee" },
  { key: "materialReturn", label: "P. Material Return Credit (−)" },
  { key: "supplyRun",      label: "Q. Supply Run (Menards/Home Depot/etc.)" },
  { key: "cleanUp",        label: "R. Clean Up" },
  { key: "other",          label: "S. Other" },
];

// Shared with the job board's commission overview so both always agree.
export function calcCommission(c, isParLead) {
  const gross = parseFloat(c?.grossRevenue) || 0;
  const opAlloc = gross * OP_ALLOC_PCT;
  const netRev = gross - opAlloc;
  const costs = COST_LINES.reduce((sum, { key }) => {
    const v = parseFloat(c?.[key]) || 0;
    return key === "materialReturn" ? sum - v : sum + v;
  }, 0);
  const commNet = netRev - costs;
  const tier = parseFloat(c?.tier) || 30;
  const commission = commNet * (tier / 100);
  const parFee = isParLead ? commNet * 0.105 : 0;
  const repNet = commission - parFee;
  return { gross, opAlloc, netRev, costs, commNet, tier, commission, parFee, repNet, isParLead };
}

function fmt(n) {
  if (isNaN(n) || n === 0) return "$0.00";
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Row({ label, value, isCredit, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${BORDER}33` }}>
      <span style={{ fontSize: 13, color: bold ? TEXT : MUTED, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 800 : 600, color: isCredit ? "#f87171" : bold ? GOLD : TEXT, fontFamily: "monospace", minWidth: 90, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function CostInput({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: `1px solid ${BORDER}33` }}>
      <label style={{ flex: 1, fontSize: 13, color: MUTED }}>{label}</label>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 14 }}>$</span>
        <input
          type="number" min="0" step="0.01"
          value={value || ""}
          onChange={e => onChange(e.target.value)}
          placeholder="0.00"
          style={{ width: 110, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px 9px 22px", fontSize: 14, fontFamily: "monospace", boxSizing: "border-box" }}
        />
      </div>
    </div>
  );
}

function PurchaseAgreementRef({ job, onUse }) {
  const pa = job.purchaseAgreement;
  if (!pa) return (
    <div style={{ background: PANEL2, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: MUTED, marginBottom: 14 }}>
      No Purchase Agreement on file for this job yet.
    </div>
  );
  const trade = TRADES[pa.trade] || TRADES.roofing;
  const signed = pa.ownerSignature && pa.contractorSignature;
  const total = parseFloat(pa.totalPrice) || 0;
  return (
    <div style={{ background: `${TEAL}11`, border: `1px solid ${TEAL}44`, borderRadius: 8, padding: "12px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: 0.5 }}>Purchase Agreement — {trade.label}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
          Total Price: <span style={{ color: TEXT, fontWeight: 700, fontFamily: "monospace" }}>{fmt(total)}</span>
          {pa.downPayment ? <> · Down Payment: <span style={{ color: TEXT, fontFamily: "monospace" }}>{fmt(parseFloat(pa.downPayment) || 0)}</span></> : ""}
          <span style={{ marginLeft: 8, color: signed ? "#10b981" : "#f87171" }}>{signed ? "✓ Signed" : "Not yet signed"}</span>
        </div>
      </div>
      {total > 0 && (
        <button onClick={() => onUse(total)} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            Use as Gross Revenue →
          </button>
      )}
    </div>
  );
}

export default function CommissionWorkbook({ job, isAdmin, onSave, onClose }) {
  const c = job.commission || {};
  const [local, setLocal] = useState({ ...c, tier: c.tier || 30 });
  const [savedFlash, setSavedFlash] = useState(false);
  const [parActive, setParActive] = useState(!!job.parLead);
  const [repSplitActive, setRepSplitActive] = useState(!!c.repSplitActive);
  const [repSplits, setRepSplits] = useState(c.repSplits && c.repSplits.length ? c.repSplits : [{ id: Date.now(), name: "", pct: "" }]);

  const set = (key) => (val) => setLocal(prev => ({ ...prev, [key]: val }));

  const addRepRow = () => setRepSplits(rows => [...rows, { id: Date.now() + Math.random(), name: "", pct: "" }]);
  const removeRepRow = (id) => setRepSplits(rows => rows.filter(r => r.id !== id));
  const updateRepRow = (id, key, val) => setRepSplits(rows => rows.map(r => r.id === id ? { ...r, [key]: val } : r));

  const save = () => {
    onSave({ commission: { ...local, repSplitActive, repSplits } });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const r = calcCommission(local, parActive);
  const finalCommission = r.isParLead ? r.repNet : r.commission;
  const repSplitPctTotal = repSplits.reduce((sum, row) => sum + (parseFloat(row.pct) || 0), 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: DARK, zIndex: 300, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      {/* Header */}
      <div style={{ background: PANEL2, borderBottom: `1px solid ${BORDER}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: 1 }}>
            <span style={{ color: TEAL }}>FREEDOM </span><span style={{ color: GOLD }}>EXTERIORS</span>
          </div>
          <div style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>Commission Workbook — {job.name} · {job.address}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedFlash && <span style={{ color: TEAL, fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
          <button onClick={() => exportCommissionWorkbook({ ...local, repSplitActive, repSplits }, job, parActive)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>💾 Save</button>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Step 1: Revenue */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Step 1 — Job Revenue</div>
          <PurchaseAgreementRef job={job} onUse={(total) => set("grossRevenue")(total)} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <label style={{ flex: 1, fontSize: 13, color: MUTED }}>A. Gross Job Revenue</label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 14 }}>$</span>
              <input
                type="number" min="0" step="0.01"
                value={local.grossRevenue || ""}
                onChange={e => set("grossRevenue")(e.target.value)}
                placeholder="0.00"
                style={{ width: 140, background: PANEL2, border: `1px solid ${TEAL}`, borderRadius: 7, color: TEXT, padding: "11px 10px 11px 22px", fontSize: 16, fontFamily: "monospace", boxSizing: "border-box", fontWeight: 700 }}
              />
            </div>
          </div>
          <Row label={`B. Operating Allocation (${(OP_ALLOC_PCT * 100).toFixed(0)}% of Gross)`} value={fmt(r.opAlloc)} isCredit />
          <Row label="C. Net Revenue (A − B)" value={fmt(r.netRev)} bold />
        </div>

        {/* Step 2: Costs */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Step 2 — Cost of Revenue</div>
          {COST_LINES.map(({ key, label }) => (
            <CostInput key={key} label={label} value={local[key]} onChange={set(key)} />
          ))}
          <div style={{ marginTop: 12 }}>
            <Row label="T. Total Cost of Revenue" value={fmt(r.costs)} bold />
          </div>
        </div>

        {/* Step 3: Commission */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Step 3 — Commission Calculation</div>
          <Row label="U. Commissionable Net (C − T)" value={fmt(r.commNet)} bold />

          {/* Tier selector — admin only */}
          <div style={{ marginTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              V. Commission Tier {!isAdmin && <span style={{ color: "#f87171", marginLeft: 6 }}>🔒 Set by admin</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {TIERS.map(({ value, label, desc }) => {
                const active = (parseFloat(local.tier) || 30) === value;
                return (
                  <button
                    key={value}
                    onClick={() => isAdmin && set("tier")(value)}
                    style={{
                      flex: 1, padding: "10px 6px", borderRadius: 8, fontFamily: "inherit", cursor: isAdmin ? "pointer" : "default",
                      background: active ? `${GOLD}22` : PANEL2,
                      border: `1px solid ${active ? GOLD : BORDER}`,
                      color: active ? GOLD : MUTED,
                      opacity: !isAdmin && !active ? 0.5 : 1,
                    }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{label}</div>
                    <div style={{ fontSize: 10, marginTop: 3, lineHeight: 1.3 }}>{desc}</div>
                  </button>
                );
              })}
            </div>

            {/* PAR toggle button */}
            <button
              onClick={() => setParActive(p => !p)}
              style={{
                width: "100%", marginTop: 10, padding: "12px 14px", borderRadius: 8,
                fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: parActive ? "#22d3ee22" : PANEL2,
                border: `1.5px solid ${parActive ? "#22d3ee" : BORDER}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>📞</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: parActive ? "#22d3ee" : MUTED }}>PAR Lead — ProAct Resources</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>Deducts 10.5% of commissionable net (35% of 30%)</div>
                </div>
              </div>
              <div style={{
                width: 42, height: 24, borderRadius: 12, padding: "2px", display: "flex", alignItems: "center",
                background: parActive ? "#22d3ee" : BORDER, justifyContent: parActive ? "flex-end" : "flex-start", transition: "all 0.2s"
              }}>
                <div style={{ width: 20, height: 20, borderRadius: 10, background: "#fff" }} />
              </div>
            </button>
          </div>

          {/* Final commission */}
          <div style={{ background: `${GOLD}11`, border: `1px solid ${GOLD}44`, borderRadius: 10, padding: 18, textAlign: "center", marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>W. Rep Gross Commission (U × V)</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: r.commission >= 0 ? GOLD : "#f87171", fontFamily: "monospace" }}>{fmt(r.commission)}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{r.tier}% of {fmt(r.commNet)} commissionable net</div>
            {r.isParLead && (
              <div style={{ marginTop: 14, borderTop: `1px solid ${GOLD}44`, paddingTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "#f87171" }}>− PAR Fee (10.5% of net — 35% of 30%)</span>
                  <span style={{ fontSize: 13, fontFamily: "monospace", color: "#f87171", fontWeight: 700 }}>− {fmt(r.parFee)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: `${TEAL}11`, border: `1px solid ${TEAL}44`, borderRadius: 7, padding: "10px 14px", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>Rep Net Commission</span>
                  <span style={{ fontSize: 20, fontFamily: "monospace", color: TEAL, fontWeight: 800 }}>{fmt(r.repNet)}</span>
                </div>
                <div style={{ background: "#22d3ee11", border: "1px solid #22d3ee44", borderRadius: 7, padding: "10px 14px", textAlign: "left" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#22d3ee", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>⚠️ PAR Fee Due to ProAct Resources</div>
                  <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.6 }}>Per the ProAct Resources agreement (signed 09/01/2026), <strong style={{ color: TEXT }}>{fmt(r.parFee)}</strong> is owed to PAR within <strong style={{ color: TEXT }}>15 days of deposit</strong> or receipt of payment.</div>
                </div>
              </div>
            )}
          </div>

          {/* Transparent breakdown */}
          <div style={{ marginTop: 16, padding: "12px 14px", background: PANEL2, borderRadius: 8, fontSize: 12, color: MUTED, lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: TEXT, marginBottom: 6 }}>Full Breakdown</div>
            <div>Gross Revenue: <span style={{ color: TEXT, fontFamily: "monospace" }}>{fmt(r.gross)}</span></div>
            <div>− Operating Allocation (15%): <span style={{ color: "#f87171", fontFamily: "monospace" }}>{fmt(r.opAlloc)}</span></div>
            <div>= Net Revenue: <span style={{ color: TEXT, fontFamily: "monospace" }}>{fmt(r.netRev)}</span></div>
            <div>− Total Costs: <span style={{ color: "#f87171", fontFamily: "monospace" }}>{fmt(r.costs)}</span></div>
            <div>= Commissionable Net: <span style={{ color: GREEN, fontFamily: "monospace" }}>{fmt(r.commNet)}</span></div>
            <div>× Commission Tier ({r.tier}%): <span style={{ color: GOLD, fontFamily: "monospace", fontWeight: 700 }}>{fmt(r.commission)}</span></div>
            {r.isParLead && <>
              <div>− PAR Fee (10.5% of net): <span style={{ color: "#f87171", fontFamily: "monospace" }}>− {fmt(r.parFee)}</span></div>
              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4, paddingTop: 4 }}>= Rep Net: <span style={{ color: TEAL, fontFamily: "monospace", fontWeight: 700 }}>{fmt(r.repNet)}</span></div>
            </>}
            {repSplitActive && repSplits.some(row => row.name || row.pct) && (
              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 8, paddingTop: 8 }}>
                <div style={{ fontWeight: 700, color: TEXT, marginBottom: 4 }}>Sales Rep Split ({fmt(finalCommission)})</div>
                {repSplits.filter(row => row.name || row.pct).map(row => (
                  <div key={row.id}>{row.name || "(unnamed)"} ({parseFloat(row.pct) || 0}%): <span style={{ color: GOLD, fontFamily: "monospace", fontWeight: 700 }}>{fmt(finalCommission * ((parseFloat(row.pct) || 0) / 100))}</span></div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Step 4: Sales Rep Split */}
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: repSplitActive ? 14 : 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>Step 4 — Sales Rep Split</div>
            <button
              onClick={() => setRepSplitActive(a => !a)}
              style={{
                width: 42, height: 24, borderRadius: 12, padding: "2px", display: "flex", alignItems: "center", border: "none", cursor: "pointer",
                background: repSplitActive ? "#22d3ee" : BORDER, justifyContent: repSplitActive ? "flex-end" : "flex-start", transition: "all 0.2s"
              }}>
              <div style={{ width: 20, height: 20, borderRadius: 10, background: "#fff" }} />
            </button>
          </div>

          {repSplitActive && (
            <>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>
                Splits <strong style={{ color: TEXT }}>{fmt(finalCommission)}</strong> — the {r.isParLead ? "Rep Net Commission (after PAR fee)" : "Gross Commission"} — between whoever agreed to split this deal.
              </div>

              {repSplits.map((row, i) => {
                const pct = parseFloat(row.pct) || 0;
                const amount = finalCommission * (pct / 100);
                return (
                  <div key={row.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input
                      type="text" placeholder={`Rep ${i + 1} name`} value={row.name}
                      onChange={e => updateRepRow(row.id, "name", e.target.value)}
                      style={{ flex: 2, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
                    />
                    <div style={{ position: "relative", flex: 1 }}>
                      <input
                        type="number" min="0" max="100" step="0.1" placeholder="0"
                        value={row.pct}
                        onChange={e => updateRepRow(row.id, "pct", e.target.value)}
                        style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 20px 9px 10px", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}
                      />
                      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 12 }}>%</span>
                    </div>
                    <div style={{ flex: 1, textAlign: "right", fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: GOLD }}>{fmt(amount)}</div>
                    <button onClick={() => removeRepRow(row.id)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</button>
                  </div>
                );
              })}

              <button onClick={addRepRow} style={{ background: "none", border: `1px dashed ${BORDER}`, color: MUTED, borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}>+ Add Rep</button>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                <span style={{ fontSize: 12, color: repSplitPctTotal === 100 ? MUTED : "#f87171", fontWeight: 700 }}>
                  Total: {repSplitPctTotal.toFixed(1)}% {repSplitPctTotal !== 100 && "⚠️ doesn't add up to 100%"}
                </span>
              </div>
            </>
          )}
        </div>

        <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: "14px 28px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", marginBottom: 20 }}>💾 Save Workbook</button>
      </div>
    </div>
  );
}