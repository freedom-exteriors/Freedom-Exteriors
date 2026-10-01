import { useState, useRef, useCallback } from "react";
import { useCloseGuard } from "./closeGuard";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportPreBuildLetter } from "./pdfExport";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

const PRECAUTIONS = [
  {
    id: "p1",
    title: "Clear the Work Area",
    body: "Move anything not permanently attached away from the work zone — this includes lawn furniture, hanging or potted plants, grills, hoses, and decorations.",
  },
  {
    id: "p2",
    title: "Nails and Cleanup",
    body: "Construction can produce thousands of nails. We use magnetic rollers to collect them, but some may be missed. Mow your lawn before construction to help us locate nails. After the dumpster and trailer are removed, check your driveway for leftover nails. Freedom Exteriors LLC is not liable for accidents or damage caused by missed nails.",
  },
  {
    id: "p3",
    title: "Protect Valuables Inside the Home",
    body: "Remove or secure fragile items, wall art, and light fixture covers. Vibrations from construction can cause items to loosen or fall.",
  },
  {
    id: "p4",
    title: "Secure Gates and Fences",
    body: "Check that all gates and fences are closed at the end of each workday.",
  },
  {
    id: "p5",
    title: "Satellite Dishes",
    body: "Freedom Exteriors LLC does not reinstall satellite dishes. Please contact your satellite provider to schedule reinstallation after your project.",
  },
  {
    id: "p6",
    title: "Attic and Garage Items",
    body: "Dust and debris may fall through small gaps in decking. Cover or remove stored items, and park vehicles outside the garage. Freedom Exteriors LLC is not liable for any damage caused by dust or falling debris.",
  },
  {
    id: "p7",
    title: "Electricity and Power Use",
    body: "Crews may need access to exterior outlets. Vibrations may trip breakers or GFI outlets. Check and reset outlets or breakers as needed. Freedom Exteriors LLC will not reimburse for electricity used during construction and is not responsible for losses caused by power interruptions (freezers, hot tubs, appliances). Please unplug anything connected to exterior outlets before work begins.",
  },
  {
    id: "p8",
    title: "Landscaping and Exterior Features",
    body: "While we take great care, construction areas can impact landscaping, lights, and retaining walls. Our crews need full access around the perimeter to complete your project safely and efficiently.",
  },
];

function InitialBox({ value, onChange }) {
  const canvasRef = useRef(null);
  const lastPos = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const startDraw = useCallback((e) => { e.preventDefault(); const canvas = canvasRef.current; if (!canvas) return; setIsDrawing(true); lastPos.current = canvasPoint(e, canvas); }, []);
  const draw = useCallback((e) => {
    e.preventDefault(); if (!isDrawing) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); const pos = canvasPoint(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = SIGNATURE_INK; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
    lastPos.current = pos; setHasDrawn(true);
  }, [isDrawing]);
  const stopDraw = useCallback((e) => {
    e?.preventDefault(); setIsDrawing(false); lastPos.current = null;
    if (hasDrawn && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  }, [hasDrawn, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onChange(null);
  };

  if (value) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ background: "#fff", borderRadius: 6, padding: 2, width: 64, height: 40 }}>
        <img src={value} alt="initials" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
      <button onClick={clear} style={{ fontSize: 9, color: MUTED, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>re-initial</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <canvas ref={canvasRef} width={128} height={80}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
        style={{ width: 64, height: 40, background: "#fff", borderRadius: 6, touchAction: "none", display: "block", border: `1px solid ${BORDER}` }} />
      <span style={{ fontSize: 9, color: MUTED }}>initial here</span>
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
  type: "pre-build-letter",
  homeownerNames: job.name || "",
  address: job.address ? `${job.address}, ${job.city || ""}, ${job.state || ""}`.trim().replace(/,\s*$/, "") : "",
  initials: {},
  homeownerSignature: null,
  homeowner2Signature: null,
  repSignature: null,
  repPrintedName: "",
});

export default function PreBuildLetter({ job, onSave, onClose }) {
  const [data, setData] = useState(job.preBuildLetter?.type === "pre-build-letter" ? job.preBuildLetter : blank(job));
  const [savedFlash, setSavedFlash] = useState(false);

  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const setInitial = (id) => (img) => setData(d => ({ ...d, initials: { ...d.initials, [id]: img } }));

  const [closeDoc, rememberSaved] = useCloseGuard(data, onSave, onClose);
  const save = () => { onSave(data); rememberSaved(data); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };

  const allInitialed = PRECAUTIONS.every(p => data.initials[p.id]);
  const allSigned = data.homeownerSignature && data.repSignature;
  const complete = allInitialed && allSigned;

  return (
    <div style={{ position:"fixed", inset:0, background:DARK, zIndex:300, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
      {/* Header */}
      <div style={{ position:"sticky", top:0, background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:5 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:17, letterSpacing:1 }}>
          <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          <span style={{ color:MUTED, fontWeight:500, fontSize:13, marginLeft:10 }}>Pre-Build Precaution Letter</span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {savedFlash && <span style={{ color:TEAL, fontSize:12, fontWeight:700 }}>✓ Saved</span>}
          {complete && <span style={{ color:"#10b981", fontSize:12, fontWeight:700 }}>✓ Complete</span>}
          {complete && <button onClick={() => exportPreBuildLetter(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>💾 Save</button>
          <button onClick={closeDoc} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:18 }}>
        {/* Title */}
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:22, letterSpacing:1, color:TEXT }}>PRE-BUILD PRECAUTION LETTER</div>
          <div style={{ color:MUTED, fontSize:13, marginTop:4 }}>Freedom Exteriors LLC · 1145 Summit Ave, Mahtomedi, MN 55115 · (651) 283-1689</div>
        </div>

        {/* Homeowner info */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Homeowner Information</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Name(s)</label>
              <input value={data.homeownerNames||""} onChange={e=>set("homeownerNames")(e.target.value)}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Property Address</label>
              <input value={data.address||""} onChange={e=>set("address")(e.target.value)}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
          </div>
        </div>

        {/* Intro */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.7 }}>
            Thank you for choosing Freedom Exteriors LLC! We're excited to complete your project and want to ensure a smooth, safe, and damage-free experience. Before work begins, please review the following precautions. These guidelines help protect your property and clarify responsibilities during construction.
          </div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.7, marginTop:10 }}>
            You'll also receive a Welcome Letter from our Production Department before scheduling your build — please read it thoroughly.
          </div>
        </div>

        {/* 8 precaution items with initials */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>
            Precautions — Homeowner Initials Required
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {PRECAUTIONS.map((p, i) => (
              <div key={p.id} style={{ display:"flex", gap:14, alignItems:"flex-start", padding:"12px 0", borderBottom: i < PRECAUTIONS.length - 1 ? `1px solid ${BORDER}33` : "none" }}>
                <div style={{ flexShrink:0 }}>
                  <InitialBox value={data.initials[p.id]} onChange={setInitial(p.id)} />
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:13, color: data.initials[p.id] ? TEXT : MUTED, marginBottom:4 }}>{i+1}. {p.title}</div>
                  <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.6 }}>{p.body}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:14, padding:"10px 12px", background:PANEL2, borderRadius:8, fontSize:12, color:MUTED }}>
            {allInitialed
              ? <span style={{ color:TEAL, fontWeight:700 }}>✓ All 8 items initialed</span>
              : <span>{PRECAUTIONS.filter(p => data.initials[p.id]).length} of 8 items initialed</span>
            }
          </div>
        </div>

        {/* Acknowledgement */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, color:GOLD, marginBottom:14, textTransform:"uppercase", letterSpacing:1 }}>Acknowledgement & Signatures</div>
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.7, marginBottom:18 }}>
            By signing below, you acknowledge that you have read and understand these precautions. <strong style={{ color:TEXT }}>Freedom Exteriors LLC is not responsible for damages resulting from the situations or items listed above.</strong>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
            <SignatureBox label="Homeowner Signature" signature={data.homeownerSignature}
              onSign={s=>setData(d=>({...d,homeownerSignature:s}))} onClear={()=>setData(d=>({...d,homeownerSignature:null}))} />
            <SignatureBox label="Second Homeowner / Co-Owner (if applicable)" signature={data.homeowner2Signature}
              onSign={s=>setData(d=>({...d,homeowner2Signature:s}))} onClear={()=>setData(d=>({...d,homeowner2Signature:null}))} />
            <SignatureBox label="Freedom Exteriors LLC Representative" signature={data.repSignature}
              onSign={s=>setData(d=>({...d,repSignature:s}))} onClear={()=>setData(d=>({...d,repSignature:null}))} />
          </div>
        </div>

        <div style={{ textAlign:"center", paddingBottom:30 }}>
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:8, padding:"14px 28px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>💾 Save Letter</button>
        </div>
      </div>
    </div>
  );
}