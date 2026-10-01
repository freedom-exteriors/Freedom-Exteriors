import { useState, useRef, useCallback } from "react";
import { useCloseGuard } from "./closeGuard";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportCancellationNotice } from "./pdfExport";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

function SignatureBox({ label, signature, onSign, onClear, compact }) {
  const canvasRef = useRef(null);
  const lastPos = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [typedName, setTypedName] = useState("");

  const startDraw = useCallback((e) => { e.preventDefault(); const canvas = canvasRef.current; if (!canvas) return; setIsDrawing(true); lastPos.current = canvasPoint(e, canvas); }, []);
  const draw = useCallback((e) => {
    e.preventDefault(); if (!isDrawing) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); const pos = canvasPoint(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = SIGNATURE_INK; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
    lastPos.current = pos; setHasDrawn(true);
  }, [isDrawing]);
  const stopDraw = useCallback((e) => { e?.preventDefault(); setIsDrawing(false); lastPos.current = null; }, []);
  const clearCanvas = () => { const canvas = canvasRef.current; if (canvas) canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height); setHasDrawn(false); setTypedName(""); onClear && onClear(); };
  const confirmSign = () => { if (!typedName.trim() || !hasDrawn) return; onSign({ name: typedName.trim(), image: canvasRef.current.toDataURL("image/png"), signedAt: new Date().toISOString() }); };
  const h = compact ? 100 : 150;

  if (signature?.image) return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{label}</label>
      <div style={{ background:"#fff", borderRadius:8, padding:8 }}><img src={signature.image} alt="sig" style={{ maxWidth:"100%", maxHeight:h, display:"block" }} /></div>
      <div style={{ fontSize:12, color:MUTED, marginTop:6 }}>Signed by <strong style={{ color:TEXT }}>{signature.name}</strong> · {new Date(signature.signedAt).toLocaleString()}</div>
      <button onClick={clearCanvas} style={{ marginTop:8, background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"6px 12px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>↻ Re-sign</button>
    </div>
  );

  return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{label}</label>
      <canvas ref={canvasRef} width={520} height={h*2}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
        style={{ width:"100%", maxWidth:520, height:h, background:"#fff", borderRadius:8, touchAction:"none", display:"block" }} />
      <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
        <input value={typedName} onChange={e=>setTypedName(e.target.value)} placeholder="Type full legal name"
          style={{ flex:"1 1 180px", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"9px 12px", fontSize:14, fontFamily:"inherit" }} />
        <button onClick={clearCanvas} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 12px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Clear</button>
        <button onClick={confirmSign} disabled={!typedName.trim()||!hasDrawn}
          style={{ background:(!typedName.trim()||!hasDrawn)?"#2a3a4a":`${TEAL}22`, border:`1px solid ${(!typedName.trim()||!hasDrawn)?BORDER:TEAL}`, color:(!typedName.trim()||!hasDrawn)?MUTED:TEAL, borderRadius:7, padding:"9px 14px", fontSize:12, fontWeight:700, cursor:(!typedName.trim()||!hasDrawn)?"default":"pointer", fontFamily:"inherit" }}>✍️ Sign</button>
      </div>
    </div>
  );
}

const NOTICE_TEXT = (address) => `If your insurer denies your claim to pay for goods and services to be provided under this contract, you may cancel the contract by mailing or delivering a signed and dated copy of this cancellation notice or any other written notice to:

Freedom Exteriors LLC
1145 Summit Ave
Mahtomedi, MN 55115

at any time within 72 hours after you have been notified that your claim has been denied. If you cancel, any payments made by you under the contract will be returned within ten business days following receipt by the contractor of your cancellation notice.`;

const blank = (job) => ({
  type: "cancellation-notice",
  insuredName: job.name || "",
  propertyAddress: job.address ? `${job.address}, ${job.city||""}, ${job.state||""}`.trim().replace(/,\s*$/,"") : "",
  copy1Signature: null,
  copy2Signature: null,
  companySignature: null,
});

export default function CancellationNotice({ job, onSave, onClose }) {
  const [data, setData] = useState(job.cancellationNotice?.type === "cancellation-notice" ? job.cancellationNotice : blank(job));
  const [savedFlash, setSavedFlash] = useState(false);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const [closeDoc, rememberSaved] = useCloseGuard(data, onSave, onClose);
  const save = () => { onSave(data); rememberSaved(data); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };
  const allSigned = data.copy1Signature && data.copy2Signature && data.companySignature;

  const CopySection = ({ title, subtitle, sigKey, compact }) => (
    <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:4, textTransform:"uppercase", letterSpacing:1 }}>{title}</div>
      <div style={{ fontSize:11, color:MUTED, marginBottom:14 }}>{subtitle}</div>
      <div style={{ background:PANEL2, borderRadius:8, padding:14, marginBottom:16 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:13, color:TEXT, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>NOTICE OF CANCELLATION PER MN STATUTES SECTION 326B.811</div>
        <div style={{ fontWeight:700, fontSize:13, color:TEXT, marginBottom:10 }}>NOTICE OF CANCELLATION</div>
        <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.7, whiteSpace:"pre-line", marginBottom:14 }}>{NOTICE_TEXT()}</div>
        <div style={{ fontSize:13, color:TEXT, fontWeight:600, marginBottom:4 }}>I hereby cancel this transaction.</div>
      </div>
      <SignatureBox
        label={`${title} — Insured's Signature`}
        signature={data[sigKey]}
        onSign={s=>setData(d=>({...d,[sigKey]:s}))}
        onClear={()=>setData(d=>({...d,[sigKey]:null}))}
        compact={compact}
      />
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:DARK, zIndex:300, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
      <div style={{ position:"sticky", top:0, background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:5 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:17, letterSpacing:1 }}>
          <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          <span style={{ color:MUTED, fontWeight:500, fontSize:13, marginLeft:10 }}>Cancellation Notice</span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {savedFlash && <span style={{ color:TEAL, fontSize:12, fontWeight:700 }}>✓ Saved</span>}
          {allSigned && <span style={{ color:"#10b981", fontSize:12, fontWeight:700 }}>✓ All 3 Copies Signed</span>}
          {allSigned && <button onClick={() => exportCancellationNotice(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>💾 Save</button>
          <button onClick={closeDoc} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:18 }}>
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:20, letterSpacing:1, color:TEXT }}>NOTICE OF CANCELLATION</div>
          <div style={{ color:GOLD, fontWeight:700, fontSize:14, marginTop:2 }}>Per MN Statutes Section 326B.811</div>
          <div style={{ color:MUTED, fontSize:13, marginTop:4 }}>Three copies required — two given to homeowner, one kept by company</div>
        </div>

        {/* Insured info */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Insured Information</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Insured Name</label>
              <input value={data.insuredName||""} onChange={e=>set("insuredName")(e.target.value)}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Property Address</label>
              <input value={data.propertyAddress||""} onChange={e=>set("propertyAddress")(e.target.value)}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
          </div>
        </div>

        <CopySection title="Copy 1 — Homeowner's Copy" subtitle="Give this signed copy to the homeowner to keep" sigKey="copy1Signature" />
        <CopySection title="Copy 2 — Homeowner's Copy" subtitle="Give this signed copy to the homeowner to keep" sigKey="copy2Signature" />
        <CopySection title="Copy 3 — Company Records" subtitle="Have owner sign below — keep this copy for your records" sigKey="companySignature" compact />

        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.7 }}>
            <strong style={{ color:TEXT }}>Buyer:</strong> Should you wish to exercise your right to cancel, date and sign the above Cancellation Notice not later than midnight of the date shown above and mail it to the contractor at the above address. Keep the bottom copy for your records.
          </div>
          <div style={{ fontSize:12, color:MUTED, lineHeight:1.7, marginTop:8 }}>
            <strong style={{ color:TEXT }}>Acknowledgement:</strong> I acknowledge receipt of two copies of this Notice by my signature above.
          </div>
        </div>

        <div style={{ textAlign:"center", paddingBottom:30 }}>
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:8, padding:"14px 28px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>💾 Save Notice</button>
        </div>
      </div>
    </div>
  );
}