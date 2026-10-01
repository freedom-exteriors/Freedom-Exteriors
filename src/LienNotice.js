import { useState, useRef, useCallback } from "react";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportLienNotice } from "./pdfExport";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>{label}</label>
      <input value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""}
        style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
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
  type: "lien-notice",
  ownerName: job.name || "",
  projectDescription: job.type || "",
  projectAddress: job.address ? `${job.address}, ${job.city||""}, ${job.state||""}`.trim().replace(/,\s*$/,"") : "",
  contractDate: new Date().toISOString().slice(0,10),
  ownerSignature: null,
});

export default function LienNotice({ job, onSave, onClose }) {
  const [data, setData] = useState(job.lienNotice?.type === "lien-notice" ? job.lienNotice : blank(job));
  const [savedFlash, setSavedFlash] = useState(false);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const save = () => { onSave(data); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };

  return (
    <div style={{ position:"fixed", inset:0, background:DARK, zIndex:300, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
      <div style={{ position:"sticky", top:0, background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:5 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:17, letterSpacing:1 }}>
          <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          <span style={{ color:MUTED, fontWeight:500, fontSize:13, marginLeft:10 }}>MN Mandatory Lien Notice</span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {savedFlash && <span style={{ color:TEAL, fontSize:12, fontWeight:700 }}>✓ Saved</span>}
          {data.ownerSignature && <span style={{ color:"#10b981", fontSize:12, fontWeight:700 }}>✓ Signed</span>}
          {data.ownerSignature && <button onClick={() => exportLienNotice(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>💾 Save</button>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:18 }}>
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:20, letterSpacing:1, color:TEXT }}>MINNESOTA MANDATORY NOTICE</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:15, color:GOLD, marginTop:2 }}>Per § 514.011 and Housing Statutory Warranty Per § 327A</div>
          <div style={{ color:MUTED, fontSize:13, marginTop:4 }}>Freedom Exteriors LLC · 1145 Summit Ave, Mahtomedi, MN 55115 · (651) 283-1689</div>
        </div>

        {/* Project info */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Project Information</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <Field label="Project Owner's Name" value={data.ownerName} onChange={set("ownerName")} />
            <Field label="Brief Description of Project" value={data.projectDescription} onChange={set("projectDescription")} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Field label="Project Street Address, City, State, Zip" value={data.projectAddress} onChange={set("projectAddress")} />
            <Field label="Contract Date" value={data.contractDate} onChange={set("contractDate")} />
          </div>
          <div style={{ marginTop:12, fontSize:12.5, color:MUTED, lineHeight:1.7 }}>
            This is a continuation of that certain CONTRACT briefly described above between Freedom Exteriors LLC and the project owner named above. This is a mandatory notice given according to Minnesota Law (§ 514.011). This notice must be included in any contract with the owner for the improvement of real property.
          </div>
        </div>

        {/* Lien Notice - exact statutory text */}
        <div style={{ background:PANEL, border:`1px solid ${GOLD}44`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Mandatory Lien Notice</div>
          <div style={{ fontSize:13, fontWeight:700, color:TEXT, lineHeight:1.8 }}>
            <p style={{ margin:"0 0 12px 0" }}>(A) ANY PERSON OR COMPANY SUPPLYING LABOR OR MATERIALS FOR THIS IMPROVEMENT TO YOUR PROPERTY MAY FILE A LIEN AGAINST YOUR PROPERTY IF THAT PERSON OR COMPANY IS NOT PAID FOR THE CONTRIBUTIONS.</p>
            <p style={{ margin:0 }}>(B) UNDER MINNESOTA LAW, YOU HAVE THE RIGHT TO PAY PERSONS WHO SUPPLIED LABOR OR MATERIALS FOR THIS IMPROVEMENT DIRECTLY AND DEDUCT THIS AMOUNT FROM OUR CONTRACT PRICE, OR WITHHOLD THE AMOUNTS DUE THEM FROM US UNTIL 120 DAYS AFTER COMPLETION OF THE IMPROVEMENT UNLESS WE GIVE YOU A LIEN WAIVER SIGNED BY PERSONS WHO SUPPLIED ANY LABOR OR MATERIAL FOR THE IMPROVEMENT AND WHO GAVE YOU TIMELY NOTICE.</p>
          </div>
        </div>

        {/* Housing Statutory Warranty */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Housing Statutory Warranty (§ 327A.01 to § 327A.08)</div>
          <div style={{ fontSize:13, fontWeight:700, color:TEXT, lineHeight:1.8 }}>
            <p style={{ margin:"0 0 10px 0" }}>In compliance with the MN HOUSING STATUTORY WARRANTIES ACT, Contractor Warrants to Owner that for Home improvement warranties:</p>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10, fontSize:12.5, color:MUTED, lineHeight:1.7 }}>
            <div><span style={{ color:TEXT, fontWeight:700 }}>(a)</span> In a sale or contract for the sale of home improvement work involving major structural changes or additions to a residential building, the home improvement contractor shall warrant to the owner that: (1) during the one-year period from and after the warranty date the home improvement shall be free from defects caused by faulty workmanship and defective materials due to noncompliance with building standards; and (2) during the ten-year period from and after the warranty date the home improvement shall be free from major construction defects due to noncompliance with building standards.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>(b)</span> In a sale or contract for the sale of home improvement work involving the installation of plumbing, electrical, heating, or cooling systems, the contractor shall warrant that during the two-year period from and after the warranty date the home improvement shall be free from defects caused by faulty installation due to noncompliance with building standards.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>(c)</span> In a sale or contract for the sale of any home improvement work not covered by (a) or (b), the contractor shall warrant that during the one-year period from and after the warranty date the home improvement shall be free from defects caused by faulty workmanship or defective materials due to noncompliance with building standards.</div>
          </div>
        </div>

        {/* Signature */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Acknowledgement</div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.7, marginBottom:18 }}>
            I acknowledge receipt of this Notice and Warranty by my signature below:
          </div>
          <SignatureBox label="Owner Signature" signature={data.ownerSignature}
            onSign={s=>setData(d=>({...d,ownerSignature:s}))} onClear={()=>setData(d=>({...d,ownerSignature:null}))} />
        </div>

        <div style={{ textAlign:"center", paddingBottom:30 }}>
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:8, padding:"14px 28px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>💾 Save Notice</button>
        </div>
      </div>
    </div>
  );
}