import { useState, useRef, useCallback } from "react";
import { useCloseGuard } from "./closeGuard";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportDocsAcknowledgement } from "./pdfExport";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

const REQUIRED_DOCS = [
  "MN Statute 325E.66 — Insurance Deductible Notice",
  "Good Faith Estimate",
  "MN Statute 325F.18 — Urea Formaldehyde Notice",
  "MN Statute 326B.809 — Written Contract and Performance Guidelines",
  "MN Statute 326B.811 — Right to Cancel for Denied Claim",
  "MN Statute 327A — Warranty",
  "General Contractor License #BC-810020",
  "General Liability and Workers Compensation Insurance",
  "Mold Notice",
  "Cancellation Form",
  "Denied Claim Cancellation Form",
];

function SignatureBox({ label, signature, onSign, onClear }) {
  const canvasRef = useRef(null);
  const lastPos = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [typedDate, setTypedDate] = useState("");

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
  const clearCanvas = () => { const canvas = canvasRef.current; if (canvas) canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height); setHasDrawn(false); setTypedName(""); setTypedDate(""); onClear && onClear(); };
  const confirmSign = () => { if (!typedName.trim() || !hasDrawn) return; onSign({ name: typedName.trim(), date: typedDate, image: canvasRef.current.toDataURL("image/png"), signedAt: new Date().toISOString() }); };

  if (signature?.image) return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{label}</label>
      <div style={{ background:"#fff", borderRadius:8, padding:8 }}><img src={signature.image} alt="sig" style={{ maxWidth:"100%", display:"block" }} /></div>
      <div style={{ fontSize:12, color:MUTED, marginTop:6 }}>
        Signed by <strong style={{ color:TEXT }}>{signature.name}</strong>
        {signature.date && <> · <strong style={{ color:TEXT }}>{signature.date}</strong></>}
        {" · "}{new Date(signature.signedAt).toLocaleString()}
      </div>
      <button onClick={clearCanvas} style={{ marginTop:8, background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"6px 12px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>↻ Re-sign</button>
    </div>
  );

  return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{label}</label>
      <canvas ref={canvasRef} width={520} height={150}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
        style={{ width:"100%", maxWidth:520, height:150, background:"#fff", borderRadius:8, touchAction:"none", display:"block" }} />
      <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
        <input value={typedName} onChange={e=>setTypedName(e.target.value)} placeholder="Full legal name"
          style={{ flex:"2 1 180px", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px 12px", fontSize:14, fontFamily:"inherit" }} />
        <input value={typedDate} onChange={e=>setTypedDate(e.target.value)} placeholder="Date" type="date"
          style={{ flex:"1 1 130px", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px 12px", fontSize:14, fontFamily:"inherit" }} />
        <button onClick={clearCanvas} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"10px 12px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Clear</button>
        <button onClick={confirmSign} disabled={!typedName.trim()||!hasDrawn}
          style={{ background:(!typedName.trim()||!hasDrawn)?"#2a3a4a":`${TEAL}22`, border:`1px solid ${(!typedName.trim()||!hasDrawn)?BORDER:TEAL}`, color:(!typedName.trim()||!hasDrawn)?MUTED:TEAL, borderRadius:7, padding:"10px 14px", fontSize:12, fontWeight:700, cursor:(!typedName.trim()||!hasDrawn)?"default":"pointer", fontFamily:"inherit" }}>✍️ Sign</button>
      </div>
    </div>
  );
}

const blank = (job) => ({
  type: "docs-acknowledgement",
  homeownerName: job.name || "",
  address: job.address ? `${job.address}, ${job.city||""}, ${job.state||""}`.trim().replace(/,\s*$/,"") : "",
  homeownerSignature: null,
  homeowner2Signature: null,
  repSignature: null,
  repPrintedName: "",
});

export default function DocsAcknowledgement({ job, onSave, onClose }) {
  const [data, setData] = useState(job.docsAcknowledgement?.type === "docs-acknowledgement" ? job.docsAcknowledgement : blank(job));
  const [savedFlash, setSavedFlash] = useState(false);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const [closeDoc, rememberSaved] = useCloseGuard(data, onSave, onClose);
  const save = () => { onSave(data); rememberSaved(data); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };
  const allSigned = data.homeownerSignature && data.repSignature;

  return (
    <div style={{ position:"fixed", inset:0, background:DARK, zIndex:300, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
      <div style={{ position:"sticky", top:0, background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:5 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:17, letterSpacing:1 }}>
          <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          <span style={{ color:MUTED, fontWeight:500, fontSize:13, marginLeft:10 }}>Documents Acknowledgement</span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {savedFlash && <span style={{ color:TEAL, fontSize:12, fontWeight:700 }}>✓ Saved</span>}
          {allSigned && <span style={{ color:"#10b981", fontSize:12, fontWeight:700 }}>✓ Signed</span>}
          {allSigned && <button onClick={() => exportDocsAcknowledgement(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>💾 Save</button>
          <button onClick={closeDoc} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:18 }}>
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:20, letterSpacing:1, color:TEXT }}>CONTRACTOR DOCUMENTS ACKNOWLEDGEMENT</div>
          <div style={{ color:MUTED, fontSize:13, marginTop:4 }}>Freedom Exteriors LLC · 1145 Summit Ave, Mahtomedi, MN 55115 · (651) 283-1689 · License #BC-810020</div>
        </div>

        {/* Homeowner info */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Homeowner Information</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Name(s)</label>
              <input value={data.homeownerName||""} onChange={e=>set("homeownerName")(e.target.value)}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Property Address</label>
              <input value={data.address||""} onChange={e=>set("address")(e.target.value)}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
          </div>
        </div>

        {/* Document list */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Documents Received</div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.7, marginBottom:16 }}>
            I, <strong style={{ color:TEXT }}>{data.homeownerName || "___________________________"}</strong>, acknowledge and certify that I have received all documentation listed below from Freedom Exteriors LLC:
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {REQUIRED_DOCS.map((doc, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:PANEL2, borderRadius:7, border:`1px solid ${BORDER}` }}>
                <span style={{ color:TEAL, fontSize:14 }}>✓</span>
                <span style={{ fontSize:13, color:TEXT }}>{doc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Signatures */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Signatures</div>
          <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
            <SignatureBox label="Homeowner Signature" signature={data.homeownerSignature}
              onSign={s=>setData(d=>({...d,homeownerSignature:s}))} onClear={()=>setData(d=>({...d,homeownerSignature:null}))} />
            <SignatureBox label="Second Homeowner / Co-Owner (if applicable)" signature={data.homeowner2Signature}
              onSign={s=>setData(d=>({...d,homeowner2Signature:s}))} onClear={()=>setData(d=>({...d,homeowner2Signature:null}))} />
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Rep Printed Name</label>
              <input value={data.repPrintedName||""} onChange={e=>set("repPrintedName")(e.target.value)} placeholder="Freedom Exteriors LLC Representative"
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box", marginBottom:14 }} />
              <SignatureBox label="Freedom Exteriors LLC Representative Signature" signature={data.repSignature}
                onSign={s=>setData(d=>({...d,repSignature:s}))} onClear={()=>setData(d=>({...d,repSignature:null}))} />
            </div>
          </div>
        </div>

        <div style={{ textAlign:"center", paddingBottom:30 }}>
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:8, padding:"14px 28px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>💾 Save Acknowledgement</button>
        </div>
      </div>
    </div>
  );
}