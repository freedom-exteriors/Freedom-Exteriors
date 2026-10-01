import { useState, useRef, useCallback } from "react";
import { useCloseGuard } from "./closeGuard";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportPurchaseAgreement } from "./pdfExport";
import { TRADES, defaultTradeForJobType } from "./purchaseAgreementSchema";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

// ─── Shared field/section widgets (mirrors ContractFill.js styling) ────────

function Field({ label, value, onChange, placeholder, type }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{label}</label>
      <input
        type={type || "text"}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ""}
        style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "12px 12px", fontSize: 16, fontFamily: "inherit", boxSizing: "border-box" }}
      />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, marginBottom: 16 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 1, color: GOLD, marginBottom: 14, textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function Notice({ children }) {
  return (
    <div style={{ background: "#e8a82014", border: `1px solid ${GOLD}55`, borderRadius: 8, padding: 14, fontSize: 12.5, lineHeight: 1.6, color: TEXT, marginTop: 10 }}>
      {children}
    </div>
  );
}

function SignatureBox({ label, signature, onSign, onClear }) {
  const canvasRef = useRef(null);
  const lastPos = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [typedName, setTypedName] = useState("");


  const startDraw = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    lastPos.current = canvasPoint(e, canvas);
  }, []);

  const draw = useCallback((e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pos = canvasPoint(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = SIGNATURE_INK;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
    setHasDrawn(true);
  }, [isDrawing]);

  const stopDraw = useCallback((e) => { e?.preventDefault(); setIsDrawing(false); lastPos.current = null; }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    setTypedName("");
    onClear && onClear();
  };

  const confirmSign = () => {
    if (!typedName.trim() || !hasDrawn) return;
    const canvas = canvasRef.current;
    onSign({ name: typedName.trim(), image: canvas.toDataURL("image/png"), signedAt: new Date().toISOString() });
  };

  if (signature?.image) {
    return (
      <div>
        <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</label>
        <div style={{ background: "#fff", borderRadius: 8, padding: 8 }}>
          <img src={signature.image} alt={`${label} signature`} style={{ maxWidth: "100%", display: "block" }} />
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
          Signed by <strong style={{ color: TEXT }}>{signature.name}</strong> · {new Date(signature.signedAt).toLocaleString()}
        </div>
        <button onClick={clearCanvas} style={{ marginTop: 8, background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>↻ Re-sign</button>
      </div>
    );
  }

  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</label>
      <canvas
        ref={canvasRef} width={520} height={150}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
        style={{ width: "100%", maxWidth: 520, height: 150, background: "#fff", borderRadius: 8, touchAction: "none", display: "block" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <input
          value={typedName} onChange={e => setTypedName(e.target.value)} placeholder="Type full legal name"
          style={{ flex: "1 1 200px", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "10px 12px", fontSize: 15, fontFamily: "inherit" }}
        />
        <button onClick={() => { setHasDrawn(false); clearCanvas(); }} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "10px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Clear</button>
        <button onClick={confirmSign} disabled={!typedName.trim() || !hasDrawn} style={{ background: (!typedName.trim() || !hasDrawn) ? "#2a3a4a" : `${TEAL}22`, border: `1px solid ${(!typedName.trim() || !hasDrawn) ? BORDER : TEAL}`, color: (!typedName.trim() || !hasDrawn) ? MUTED : TEAL, borderRadius: 7, padding: "10px 16px", fontSize: 12, fontWeight: 700, cursor: (!typedName.trim() || !hasDrawn) ? "default" : "pointer", fontFamily: "inherit" }}>✍️ Sign</button>
      </div>
    </div>
  );
}

// A single spec row: a label, a set of toggle-able options (multi-select chips),
// and (unless suppressed) a free-text "details" box for the blanks the paper
// form has next to each checkbox group (colors, measurements, costs, "other").
function ChipRow({ row, value, onChange }) {
  const selected = value?.selected || [];
  const details = value?.details || "";
  const toggle = (opt) => {
    const next = selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt];
    onChange({ ...value, selected: next });
  };
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 8 }}>{row.label}</div>
      {row.options && row.options.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: row.details === false ? 0 : 8 }}>
          {row.options.map(opt => {
            const on = selected.includes(opt);
            return (
              <button key={opt} type="button" onClick={() => toggle(opt)}
                style={{ display: "flex", alignItems: "center", gap: 10, background: on ? `${TEAL}14` : "none", border: "none", borderRadius: 7, padding: "9px 6px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}>
                <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: `2px solid ${on ? TEAL : MUTED}`, background: on ? TEAL : "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: DARK }}>
                  {on ? "✕" : ""}
                </span>
                <span style={{ fontSize: 13.5, color: on ? TEXT : MUTED, fontWeight: on ? 700 : 500 }}>{opt}</span>
              </button>
            );
          })}
        </div>
      )}
      {row.details !== false && (
        <input
          value={details} onChange={e => onChange({ ...value, details: e.target.value })}
          placeholder={row.detailsPlaceholder || "Details — color, size, cost, notes…"}
          style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box" }}
        />
      )}
    </div>
  );
}

function money(n) {
  const v = parseFloat(n);
  return Number.isFinite(v) ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

// Reference card showing the job's Estimate / Good-Better-Best pricing with
// one-click buttons to pull a number straight onto the agreement's Total Price.
function PricingRef({ job, onUse }) {
  const estTotal = parseFloat(job.estimate?.total) || 0;
  const gbb = job.gbb?.result;
  const tiers = gbb ? [
    { key: "good", label: "Good", total: gbb.good?.total },
    { key: "better", label: "Better", total: gbb.better?.total },
    { key: "best", label: "Best", total: gbb.best?.total },
  ].filter(t => t.total > 0) : [];

  if (!estTotal && !tiers.length) return (
    <div style={{ background: PANEL2, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: MUTED, marginBottom: 14 }}>
      No Estimate or Good/Better/Best pricing on file for this job yet.
    </div>
  );

  return (
    <div style={{ background: `${TEAL}11`, border: `1px solid ${TEAL}44`, borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Pricing on File — Pull onto this Agreement</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {estTotal > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12.5, color: TEXT }}>Current Estimate: <strong style={{ fontFamily: "monospace" }}>{money(estTotal)}</strong></span>
            <button type="button" onClick={() => onUse(estTotal)} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Use →</button>
          </div>
        )}
        {tiers.map(t => (
          <div key={t.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12.5, color: TEXT }}>Good/Better/Best — {t.label}: <strong style={{ fontFamily: "monospace" }}>{money(t.total)}</strong></span>
            <button type="button" onClick={() => onUse(Math.round(t.total * 100) / 100)} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Use →</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TextRow({ row, value, onChange }) {
  if (row.type === "text2") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
        <Field label={row.label} value={value?.a} onChange={v => onChange({ ...value, a: v })} />
        <Field label={row.label2} value={value?.b} onChange={v => onChange({ ...value, b: v })} />
      </div>
    );
  }
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
      <Field label={row.label} value={value} onChange={onChange} />
    </div>
  );
}

function SpecSection({ title, rows, values, setRowValue }) {
  return (
    <Section title={title}>
      <div>
        {rows.map(row => row.type === "text" || row.type === "text2"
          ? <TextRow key={row.key} row={row} value={values[row.key]} onChange={v => setRowValue(row.key, v)} />
          : <ChipRow key={row.key} row={row} value={values[row.key]} onChange={v => setRowValue(row.key, v)} />
        )}
      </div>
    </Section>
  );
}

const blankAgreement = (job, trade) => ({
  trade,
  contractNo: `PA-${job.id}`,
  ownerNames: job.name || "",
  ownerHomePhone: job.phone || "",
  ownerCellPhone: "",
  ownerEmail: job.email || "",
  ownerAddress: job.address || "",
  ownerCityStateZip: [job.city, job.state].filter(Boolean).join(", "),
  date: new Date().toISOString().slice(0, 10),
  rows: {},
  additionalDetails: "",
  paymentTermsPct: "",
  totalPrice: job.estimate?.total || "",
  downPayment: job.estimate?.downPayment || "",
  downPaymentDate: "",
  ownerSignature: null,
  coOwnerSignature: null,
  contractorSignature: null,
});

export default function PurchaseAgreement({ job, onSave, onClose }) {
  const initial = job.purchaseAgreement && TRADES[job.purchaseAgreement.trade] ? job.purchaseAgreement : blankAgreement(job, defaultTradeForJobType(job.type));
  const [data, setData] = useState(initial);
  const [savedFlash, setSavedFlash] = useState(false);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const setRowValue = (key, v) => setData(d => ({ ...d, rows: { ...d.rows, [key]: v } }));

  const trade = TRADES[data.trade] || TRADES.roofing;

  const changeTrade = (key) => {
    if (data.trade === key) return;
    if ((Object.keys(data.rows || {}).length > 0 || data.ownerSignature) && !window.confirm("Switching trade type clears the specs you've filled in below. Continue?")) return;
    setData(blankAgreement(job, key));
  };

  const [closeDoc, rememberSaved] = useCloseGuard(data, onSave, onClose);
  const save = () => {
    onSave(data); rememberSaved(data);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: DARK, zIndex: 200, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, background: PANEL2, borderBottom: `1px solid ${BORDER}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: 1 }}>
          <span style={{ color: TEAL }}>FREEDOM </span><span style={{ color: GOLD }}>EXTERIORS</span>
          <span style={{ color: MUTED, fontWeight: 500, fontSize: 13, marginLeft: 10 }}>Purchase Agreement</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {savedFlash && <span style={{ color: TEAL, fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
          {data.ownerSignature && data.contractorSignature && <button onClick={() => exportPurchaseAgreement(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>💾 Save</button>
          <button onClick={closeDoc} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: 18 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: 1, color: TEXT }}>PURCHASE AGREEMENT — {trade.subtitle}</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>No. {data.contractNo} · Freedom Exteriors LLC · 1145 Summit Ave, Mahtomedi, MN 55115 · (651) 283-1689 · MN License #BC-810020 · WI Dwelling Contractor License #4811-DCFR</div>
        </div>

        <Section title="Trade Type">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(TRADES).map(([key, t]) => (
              <button key={key} type="button" onClick={() => changeTrade(key)}
                style={{ background: data.trade === key ? `${TEAL}22` : "none", border: `1px solid ${data.trade === key ? TEAL : BORDER}`, color: data.trade === key ? TEAL : MUTED, borderRadius: 20, padding: "8px 14px", fontSize: 12.5, fontWeight: data.trade === key ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Contract Submitted To">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Customer Name(s)" value={data.ownerNames} onChange={set("ownerNames")} />
            <Field label="Email" value={data.ownerEmail} onChange={set("ownerEmail")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Home Phone" value={data.ownerHomePhone} onChange={set("ownerHomePhone")} />
            <Field label="Cell Phone" value={data.ownerCellPhone} onChange={set("ownerCellPhone")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Street" value={data.ownerAddress} onChange={set("ownerAddress")} />
            <Field label="City, State & Zip" value={data.ownerCityStateZip} onChange={set("ownerCityStateZip")} />
          </div>
          <Field label="Date" value={data.date} onChange={set("date")} type="date" />
        </Section>

        {trade.sections.map(sec => (
          <SpecSection key={sec.title} title={sec.title} rows={sec.rows} values={data.rows} setRowValue={setRowValue} />
        ))}

        <Section title="Additional Details">
          <textarea
            value={data.additionalDetails || ""} onChange={e => set("additionalDetails")(e.target.value)}
            rows={3} placeholder="Anything else specific to this job…"
            style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "12px 12px", fontSize: 15, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
          />
        </Section>

        <Section title="Payment">
          <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
            We hereby propose to furnish the labor and material in accordance with the above specifications, for the sum below. Payment Terms: the stated % is paid down on start date, with the remaining balance due upon substantial completion. Checks payable to Freedom Exteriors LLC. All sales tax included in Total Price.
          </div>
          <PricingRef job={job} onUse={(total) => set("totalPrice")(total)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Payment Terms (% Down)" value={data.paymentTermsPct} onChange={set("paymentTermsPct")} type="number" />
            <Field label="Total Price ($)" value={data.totalPrice} onChange={set("totalPrice")} type="number" />
            <Field label="Down Payment ($)" value={data.downPayment} onChange={set("downPayment")} type="number" />
          </div>
          <Field label="Down Payment Date" value={data.downPaymentDate} onChange={set("downPaymentDate")} type="date" />
        </Section>

        <Section title="Acceptance & Required Notices">
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: MUTED, marginBottom: 10 }}>
            <strong style={{ color: TEXT }}>Acceptance of Contract:</strong> By my signature below, the proposal prices, specifications and conditions are hereby accepted. You are authorized to perform the work specified. Payments will be made as outlined above. Terms on page 2 and on additional pages also form a part of this Agreement and are hereby accepted. Verbal agreements will not be honored, no exceptions.
          </div>
          <Notice>
            <strong>Right to Cancel.</strong> In the event of a home solicitation sale, you, the buyer, may cancel this purchase at any time prior to midnight of the third business day after the date of this purchase. See the attached Notice of Cancellation form for an explanation of this right. In all other circumstances, this Agreement is binding when signed by you and us.
          </Notice>
          <Notice>
            <strong>Insurance Claim Denial.</strong> You may cancel this contract at any time within 72 hours after you have been notified that your insurer has denied your claim to pay for the goods and services to be provided under this contract. See the attached Notice of Cancellation per Minn. Stat. § 326B.811.
          </Notice>
        </Section>

        <Section title="Signatures">
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <SignatureBox label="Owner Signature" signature={data.ownerSignature} onSign={s => setData(d => ({ ...d, ownerSignature: s }))} onClear={() => setData(d => ({ ...d, ownerSignature: null }))} />
            <SignatureBox label="Co-Owner Signature (optional)" signature={data.coOwnerSignature} onSign={s => setData(d => ({ ...d, coOwnerSignature: s }))} onClear={() => setData(d => ({ ...d, coOwnerSignature: null }))} />
            <SignatureBox label="Company Representative Signature" signature={data.contractorSignature} onSign={s => setData(d => ({ ...d, contractorSignature: s }))} onClear={() => setData(d => ({ ...d, contractorSignature: null }))} />
          </div>
        </Section>

        <div style={{ textAlign: "center", paddingBottom: 30 }}>
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: "14px 28px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>💾 Save</button>
        </div>
      </div>
    </div>
  );
}
