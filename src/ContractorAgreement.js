import { useState, useRef, useCallback } from "react";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportContractorAgreement } from "./pdfExport";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

function Field({ label, value, onChange, placeholder, type }) {
  return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>{label}</label>
      <input type={type||"text"} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""}
        style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
    </div>
  );
}

function Notice({ children, color }) {
  const c = color || GOLD;
  return (
    <div style={{ background:c+"14", border:`1px solid ${c}55`, borderRadius:8, padding:14, fontSize:13, lineHeight:1.7, color:TEXT, marginBottom:10 }}>
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

  if (signature?.image) return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{label}</label>
      <div style={{ background:"#fff", borderRadius:8, padding:8 }}><img src={signature.image} alt="sig" style={{ maxWidth:"100%", display:"block" }} /></div>
      <div style={{ fontSize:12, color:MUTED, marginTop:6 }}>Signed by <strong style={{ color:TEXT }}>{signature.name}</strong> · {new Date(signature.signedAt).toLocaleString()}</div>
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
        <input value={typedName} onChange={e=>setTypedName(e.target.value)} placeholder="Type full legal name"
          style={{ flex:"1 1 200px", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px 12px", fontSize:15, fontFamily:"inherit" }} />
        <button onClick={clearCanvas} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"10px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Clear</button>
        <button onClick={confirmSign} disabled={!typedName.trim()||!hasDrawn}
          style={{ background:(!typedName.trim()||!hasDrawn)?"#2a3a4a":`${TEAL}22`, border:`1px solid ${(!typedName.trim()||!hasDrawn)?BORDER:TEAL}`, color:(!typedName.trim()||!hasDrawn)?MUTED:TEAL, borderRadius:7, padding:"10px 16px", fontSize:12, fontWeight:700, cursor:(!typedName.trim()||!hasDrawn)?"default":"pointer", fontFamily:"inherit" }}>✍️ Sign</button>
      </div>
    </div>
  );
}

const blank = (job) => ({
  type: "contractor-agreement",
  propertyAddress: job.address ? `${job.address}, ${job.city||""}, ${job.state||""}`.trim().replace(/,\s*$/,"") : "",
  dateOfLoss: "",
  homeownerSignature: null,
  homeowner2Signature: null,
  repSignature: null,
});

export default function ContractorAgreement({ job, onSave, onClose }) {
  const [data, setData] = useState(job.contractorAgreement?.type === "contractor-agreement" ? job.contractorAgreement : blank(job));
  const [savedFlash, setSavedFlash] = useState(false);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const save = () => { onSave(data); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };
  const allSigned = data.homeownerSignature && data.repSignature;

  return (
    <div style={{ position:"fixed", inset:0, background:DARK, zIndex:300, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
      <div style={{ position:"sticky", top:0, background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:5 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:17, letterSpacing:1 }}>
          <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          <span style={{ color:MUTED, fontWeight:500, fontSize:13, marginLeft:10 }}>Inspection Agreement</span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          {savedFlash && <span style={{ color:TEAL, fontSize:12, fontWeight:700 }}>✓ Saved</span>}
          {allSigned && <span style={{ color:"#10b981", fontSize:12, fontWeight:700 }}>✓ Fully Signed</span>}
          {allSigned && <button onClick={() => exportContractorAgreement(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>💾 Save</button>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:18 }}>
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:22, letterSpacing:1, color:TEXT }}>INSPECTION / CONTINGENCY AGREEMENT</div>
          <div style={{ color:MUTED, fontSize:13, marginTop:4 }}>Freedom Exteriors LLC · 1145 Summit Ave, Mahtomedi, MN 55115 · (651) 283-1689 · License #BC-810020</div>
        </div>

        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Property Information</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Field label="Property Address" value={data.propertyAddress} onChange={set("propertyAddress")} />
            <Field label="Date of Loss" value={data.dateOfLoss} onChange={set("dateOfLoss")} type="date" />
          </div>
        </div>

        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Services Provided</div>
          <Notice color={TEAL}>
            <strong>Homeowner has hired Freedom Exteriors LLC to perform the following:</strong>
            <ul style={{ margin:"8px 0 0 0", paddingLeft:20 }}>
              <li>Inspect the roof for signs of damage and provide an expert opinion on its serviceability</li>
              <li>Assist the homeowner in filing an insurance claim</li>
              <li>Provide a written inspection report of the roof condition</li>
              <li>Photograph all damaged areas and supply the insurance carrier with proper documentation</li>
            </ul>
          </Notice>
          <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.7 }}>
            Homeowner agrees that performance of all tasks may not be necessary, and failure to perform any task does not relieve Homeowner of obligations under this contract.
          </div>
        </div>

        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Insurance Outcomes</div>
          <Notice color="#f87171">
            <strong>If the Insurance Adjuster Denies the Claim:</strong>
            <ul style={{ margin:"8px 0 0 0", paddingLeft:20 }}>
              <li>This contract is immediately null and void.</li>
              <li>Homeowner shall have no further obligation to Contractor.</li>
            </ul>
          </Notice>
          <Notice color="#10b981">
            <strong>If the Insurance Adjuster Approves Replacement:</strong>
            <ul style={{ margin:"8px 0 0 0", paddingLeft:20 }}>
              <li>Homeowner agrees that Freedom Exteriors LLC shall be hired as the sole contractor for the full amount allowed by the insurance summary.</li>
              <li>Freedom Exteriors LLC shall not be subjected to competitive bidding from other contractors.</li>
            </ul>
          </Notice>
        </div>

        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Terms</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10, fontSize:13, lineHeight:1.7, color:MUTED }}>
            <div><span style={{ color:TEXT, fontWeight:700 }}>Deductible.</span> Homeowner is responsible for paying their full insurance deductible.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>Non-Performance.</span> If Contractor obtains insurance approval and Homeowner elects not to hire Freedom Exteriors LLC, Homeowner shall pay Contractor $1,000.00 as consideration for inspection and claims-assistance services, plus all attorney fees and court costs.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>Right to Cancel.</span> Buyer has three (3) business days from the date of this contract to cancel without penalty.</div>
          </div>
        </div>

        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Signatures</div>
          <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
            <SignatureBox label="Homeowner Signature" signature={data.homeownerSignature}
              onSign={s=>setData(d=>({...d,homeownerSignature:s}))} onClear={()=>setData(d=>({...d,homeownerSignature:null}))} />
            <SignatureBox label="Co-Owner / Second Homeowner (if applicable)" signature={data.homeowner2Signature}
              onSign={s=>setData(d=>({...d,homeowner2Signature:s}))} onClear={()=>setData(d=>({...d,homeowner2Signature:null}))} />
            <SignatureBox label="Freedom Exteriors LLC Representative" signature={data.repSignature}
              onSign={s=>setData(d=>({...d,repSignature:s}))} onClear={()=>setData(d=>({...d,repSignature:null}))} />
          </div>
        </div>

        <div style={{ textAlign:"center", paddingBottom:30 }}>
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:8, padding:"14px 28px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>💾 Save Agreement</button>
        </div>
      </div>
    </div>
  );
}