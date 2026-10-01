import { useState, useEffect, useRef, useCallback } from "react";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { supabase } from "./supabase";
import { compressImage, blobToDataUrl } from "./photos";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

const STAGES = [
  { id: "lead",       label: "New Customer",    icon: "📥" },
  { id: "inspection", label: "Inspection",  icon: "🔍" },
  { id: "claim",      label: "Claim Filed", icon: "📋" },
  { id: "approved",   label: "Approved",    icon: "✅" },
  { id: "deposit",    label: "Initial Deposit Received", icon: "💵" },
  { id: "scheduled",  label: "Scheduled",   icon: "📅" },
  { id: "installed",  label: "Installed",   icon: "🔨" },
  { id: "collected",  label: "Paid in Full",   icon: "💰" },
];

// "2026-10-05" → "Mon, Oct 5, 2026" (dates are stored as plain days, so no time-zone shift).
function formatDay(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  if (!m) return d || "";
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default function Portal({ token }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState("status");
  const [message, setMessage] = useState("");
  const [msgSent, setMsgSent] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [payingDeposit, setPayingDeposit] = useState(false);

  // Signature state
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [sigSaving, setSigSaving] = useState(false);
  const [sigError, setSigError] = useState(null);
  const lastPos = useRef(null);

  useEffect(() => {
    async function load() {
      // Portal access goes through portal_* RPCs (SECURITY DEFINER), which only
      // touch the job matching this token and only return portal-safe fields.
      const { data, error } = await supabase.rpc("portal_get_job", { p_token: token });
      if (error) { setLoadFailed(true); setLoading(false); return; }

      if (!error && data) {
        let jobData = data;

        // Back from Stripe Checkout: the server verifies the session with Stripe
        // before marking the deposit paid.
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get("session_id");
        // Also checked on a normal visit: a homeowner may have paid and closed the
        // tab before Stripe sent them back.
        const returning = params.get("paid") === "true" && sessionId;
        if (!jobData.depositPaid && (returning || jobData.estimate?.downPayment > 0)) {
          try {
            const res = await fetch("/api/confirm-deposit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(returning ? { portalToken: token, sessionId } : { portalToken: token }),
            });
            const out = await res.json();
            if (res.ok && out.job) jobData = out.job;
          } catch (e) {
            console.error("Could not confirm deposit:", e);
          }
        }
        if (params.get("paid")) window.history.replaceState({}, "", window.location.pathname);

        setJob(jobData);
      }
      setLoading(false);
    }
    load();
  }, [token]);

  // Stripe deposit payment
  const handlePayDeposit = async () => {
    if (!job?.estimate?.downPayment) return;
    setPayingDeposit(true);
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portalToken: token }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Payment error: " + data.error);
        setPayingDeposit(false);
      }
    } catch (e) {
      alert("Payment failed. Please try again or call (651) 283-1689.");
      setPayingDeposit(false);
    }
  };

  // Canvas drawing helpers

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

  const stopDraw = useCallback((e) => {
    e?.preventDefault();
    setIsDrawing(false);
    lastPos.current = null;
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const saveSignature = async () => {
    if (!typedName.trim() || !hasDrawn) return;
    setSigSaving(true);
    const canvas = canvasRef.current;
    const signatureImage = canvas.toDataURL("image/png");
    setSigError(null);
    const { data: updated, error } = await supabase.rpc("portal_save_signature", {
      p_token: token, p_name: typedName.trim(), p_image: signatureImage,
    });
    if (!error && updated?.portalSignature) setJob(updated);
    else setSigError("Your signature didn't save. Check your connection and tap Sign again, or call (651) 283-1689.");
    setSigSaving(false);
  };

  const stageIdx = job ? STAGES.findIndex(s => s.id === job.stage) : 0;

  const sendMessage = async () => {
    if (!message.trim()) return;
    const { error } = await supabase.rpc("portal_send_message", { p_token: token, p_message: message.trim() });
    if (error) return;
    setMessage("");
    setMsgSent(true);
  };

  const loadPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal-photos?token=${encodeURIComponent(token)}`);
      const out = await res.json();
      if (res.ok) setPhotos(out.photos || []);
    } catch (e) { /* photos are optional; the rest of the portal still works */ }
  }, [token]);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const uploadPhotos = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, 10);
    if (!files.length) return;
    setPhotoUploading(true);
    setPhotoError(null);
    let failed = 0;
    let lastError = null;
    for (const file of files) {
      try {
        const blob = await compressImage(file);
        const dataUrl = await blobToDataUrl(blob);
        const res = await fetch("/api/portal-photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, name: file.name, dataUrl }),
        });
        if (!res.ok) { failed++; lastError = (await res.json().catch(() => ({}))).error; }
      } catch (e) {
        failed++;
      }
    }
    if (failed) setPhotoError(lastError || `${failed} photo${failed === 1 ? "" : "s"} didn't upload. Please try again, or text them to your rep.`);
    await loadPhotos();
    setPhotoUploading(false);
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", background:DARK, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:10, fontFamily:"'Barlow Condensed',sans-serif" }}>
      <div style={{ fontWeight:800, fontSize:28, letterSpacing:4 }}><span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span></div>
      <div style={{ color:TEAL, fontWeight:700, letterSpacing:3, fontSize:11 }}>LOADING YOUR JOB…</div>
    </div>
  );

  if (!job) return (
    <div style={{ minHeight:"100vh", background:DARK, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:10, fontFamily:"'Barlow Condensed',sans-serif", padding:20 }}>
      <div style={{ fontWeight:800, fontSize:28, letterSpacing:4 }}><span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span></div>
      <div style={{ color:"#f87171", fontWeight:700, fontSize:14, marginTop:10 }}>{loadFailed ? "We couldn't load your project — check your connection." : "Portal link not found or expired."}</div>
      {loadFailed && <button onClick={() => window.location.reload()} style={{ marginTop:8, background:GOLD, color:"#000", border:"none", borderRadius:7, padding:"10px 18px", fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>Try again</button>}
      <div style={{ color:MUTED, fontSize:12 }}>Please contact us at (651) 283-1689</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:DARK, color:TEXT, fontFamily:"'Barlow','Segoe UI',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet"/>
      <header style={{ background:PANEL, borderBottom:`2px solid ${BORDER}`, padding:"0 20px", height:60, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:22, letterSpacing:4 }}>
            <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          </div>
          <div style={{ fontSize:9, letterSpacing:3, color:TEAL, fontWeight:700 }}>HOMEOWNER PORTAL</div>
        </div>
        <a href="tel:6512831689" style={{ color:GOLD, fontWeight:700, fontSize:13, textDecoration:"none" }}>📞 (651) 283-1689</a>
      </header>

      <div style={{ background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"16px 20px" }}>
        <div style={{ fontWeight:800, fontSize:22 }}>{job.name}</div>
        <div style={{ color:MUTED, fontSize:13 }}>{job.address}, {job.city}, {job.state}</div>
        <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap" }}>
          <span style={{ background:TEAL+"22", color:TEAL, borderRadius:5, padding:"3px 10px", fontSize:12, fontWeight:700 }}>{job.type}</span>
          {job.insurer && <span style={{ background:PANEL, color:MUTED, borderRadius:5, padding:"3px 10px", fontSize:12 }}>{job.insurer}</span>}
          {job.claimNum && <span style={{ background:GOLD+"22", color:GOLD, borderRadius:5, padding:"3px 10px", fontSize:12, fontFamily:"monospace" }}>{job.claimNum}</span>}
        </div>
      </div>

      <div style={{ padding:"16px 20px", background:PANEL, borderBottom:`1px solid ${BORDER}` }}>
        <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Job Progress</div>
        <div style={{ display:"flex", alignItems:"center" }}>
          {STAGES.map((s, i) => (
            <div key={s.id} style={{ display:"flex", alignItems:"center", flex:1 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:i<=stageIdx?TEAL:BORDER, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, border:`2px solid ${i===stageIdx?GOLD:i<stageIdx?TEAL:BORDER}` }}>
                  {i < stageIdx ? "✓" : s.icon}
                </div>
                <div style={{ fontSize:8, color:i<=stageIdx?TEAL:MUTED, marginTop:3, textAlign:"center", fontWeight:i===stageIdx?800:400, lineHeight:1.15, maxWidth:56, minHeight:18 }}>{s.label}</div>
              </div>
              {i < STAGES.length-1 && <div style={{ height:2, flex:1, background:i<stageIdx?TEAL:BORDER, marginBottom:14 }}/>}
            </div>
          ))}
        </div>
        <div style={{ marginTop:12, background:PANEL2, borderRadius:8, padding:"10px 14px", border:`1px solid ${GOLD}44` }}>
          <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1 }}>Current Stage</div>
          <div style={{ fontSize:18, fontWeight:800, color:GOLD, marginTop:2 }}>{STAGES[stageIdx]?.icon} {STAGES[stageIdx]?.label}</div>
        </div>
      </div>

      <div style={{ background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"0 20px", display:"flex", gap:2 }}>
        {[{id:"status",label:"📋 Status"},{id:"contracts",label:"✍️ Sign"},{id:"photos",label:"📷 Photos"},{id:"message",label:"💬 Message"}].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background:"none", border:"none", color:tab===t.id?GOLD:MUTED, borderBottom:tab===t.id?`2px solid ${GOLD}`:"2px solid transparent", padding:"12px 14px", cursor:"pointer", fontSize:12, fontWeight:tab===t.id?700:500, fontFamily:"inherit" }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding:"16px 20px", maxWidth:600, margin:"0 auto" }}>

        {tab==="status" && (
          <div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>Your Job Details</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
              {[["Job Type",job.type],["Assigned Rep",job.assigned],["Insurance",job.insurer],["Claim #",job.claimNum||"Not filed"],["Date Added",job.added],["Install Date",formatDay(job.installDate)||"TBD"]].map(([l,v]) => (
                <div key={l} style={{ background:PANEL, borderRadius:7, padding:"9px 12px", border:`1px solid ${BORDER}` }}>
                  <div style={{ color:MUTED, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>{l}</div>
                  <div style={{ fontWeight:600, fontSize:13 }}>{v||"—"}</div>
                </div>
              ))}
            </div>
            {job.scopeReviewSummary?.text && (
              <div style={{ background:PANEL, borderRadius:8, padding:14, border:`1px solid ${BORDER}`, borderLeft:"3px solid #10b981", marginBottom:14 }}>
                <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>What we found in your insurance estimate</div>
                <div style={{ fontSize:14, lineHeight:1.6, whiteSpace:"pre-wrap" }}>{job.scopeReviewSummary.text}</div>
              </div>
            )}
            {job.estimate?.total > 0 && (
              <div style={{ background:PANEL, borderRadius:8, padding:14, border:`1px solid ${BORDER}`, marginBottom:14 }}>
                <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Estimate Summary</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, textAlign:"center" }}>
                  {[["Contract Value",`$${(job.estimate.total||0).toLocaleString()}`,"#10b981"],["Down Payment",`$${(job.estimate.downPayment||0).toLocaleString()}`,GOLD],["Deductible",`$${(job.estimate.deductible||0).toLocaleString()}`,"#f87171"]].map(([l,v,c]) => (
                    <div key={l}><div style={{ fontSize:9, color:MUTED }}>{l}</div><div style={{ fontSize:18, fontWeight:800, color:c }}>{v}</div></div>
                  ))}
                </div>
              </div>
            )}
            {job.estimate?.downPayment > 0 && (
              <div style={{ marginBottom:14 }}>
                {job.depositPaid ? (
                  <div style={{ background:"#10b98122", border:"1px solid #10b981", borderRadius:10, padding:16, textAlign:"center" }}>
                    <div style={{ fontSize:24 }}>✅</div>
                    <div style={{ fontWeight:800, color:"#10b981", fontSize:15, marginTop:6 }}>Deposit Paid</div>
                    <div style={{ color:MUTED, fontSize:12, marginTop:4 }}>
                      ${job.estimate.downPayment.toLocaleString()} received
                      {job.depositPaidAt && ` · ${new Date(job.depositPaidAt).toLocaleDateString()}`}
                    </div>
                  </div>
                ) : (
                  <div style={{ background:GOLD+"11", border:`1px solid ${GOLD}44`, borderRadius:10, padding:16 }}>
                    <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>Deposit Due</div>
                    <div style={{ fontSize:28, fontWeight:800, color:GOLD, marginBottom:12 }}>${job.estimate.downPayment.toLocaleString()}</div>
                    <button onClick={handlePayDeposit} disabled={payingDeposit}
                      style={{ width:"100%", background:GOLD, color:"#000", border:"none", borderRadius:8, padding:"13px", fontWeight:800, fontSize:15, cursor:payingDeposit?"default":"pointer", fontFamily:"inherit", opacity:payingDeposit?0.7:1 }}>
                      {payingDeposit ? "Redirecting to payment…" : "💳 Pay Deposit Now"}
                    </button>
                    <div style={{ color:MUTED, fontSize:10, textAlign:"center", marginTop:8 }}>Secure payment powered by Stripe</div>
                  </div>
                )}
              </div>
            )}
            {job.homeownerNote && (
              <div style={{ background:PANEL, borderRadius:7, padding:"10px 12px", border:`1px solid ${BORDER}` }}>
                <div style={{ color:MUTED, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Notes from your rep</div>
                <div style={{ fontSize:13, lineHeight:1.6 }}>{job.homeownerNote}</div>
              </div>
            )}
          </div>
        )}

        {tab==="contracts" && (
          <div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>✍️ Sign Your Contract</div>
            <div style={{ color:MUTED, fontSize:12, marginBottom:16 }}>Draw your signature below and type your full legal name to sign electronically.</div>
            {job.portalSignature ? (
              <div style={{ background:TEAL+"22", border:`1px solid ${TEAL}`, borderRadius:10, padding:20, textAlign:"center" }}>
                <div style={{ fontSize:28 }}>✅</div>
                <div style={{ fontWeight:800, color:TEAL, fontSize:16, marginTop:8 }}>Contract Signed</div>
                <div style={{ color:MUTED, fontSize:12, marginTop:6 }}>Signed by: <strong style={{ color:TEXT }}>{job.portalSignature}</strong></div>
                <div style={{ color:MUTED, fontSize:11, marginTop:2 }}>{new Date(job.portalSignedAt).toLocaleString()}</div>
                {job.portalSignatureImage && (
                  <div style={{ marginTop:14 }}>
                    <div style={{ fontSize:10, color:MUTED, marginBottom:6, textTransform:"uppercase", letterSpacing:1 }}>Signature on file</div>
                    <img src={job.portalSignatureImage} alt="Signature" style={{ maxWidth:"100%", border:`1px solid ${BORDER}`, borderRadius:6, background:"#fff", padding:4 }}/>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {job.estimate?.scope && (
                  <div style={{ background:PANEL, borderRadius:8, padding:12, border:`1px solid ${BORDER}`, marginBottom:16, fontSize:12, lineHeight:1.7, color:MUTED }}>
                    <div style={{ color:TEXT, fontWeight:700, marginBottom:6 }}>Scope of Work:</div>
                    {job.estimate.scope}
                  </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <label style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1 }}>Draw your signature</label>
                    <button onClick={clearCanvas} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:5, padding:"3px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Clear</button>
                  </div>
                  <canvas ref={canvasRef} width={560} height={160}
                    onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                    onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
                    style={{ width:"100%", height:160, background:"#fff", border:`2px solid ${hasDrawn?TEAL:BORDER}`, borderRadius:8, cursor:"crosshair", display:"block", touchAction:"none" }}/>
                  {!hasDrawn && <div style={{ textAlign:"center", color:BORDER, fontSize:12, marginTop:6 }}>Sign here with your finger or mouse</div>}
                </div>
                <div style={{ marginBottom:12 }}>
                  <label style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:6 }}>Type your full legal name</label>
                  <input value={typedName} onChange={e => setTypedName(e.target.value)} placeholder="Your full legal name"
                    style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 14px", fontSize:16, fontFamily:"Georgia, serif", boxSizing:"border-box" }}/>
                </div>
                <div style={{ color:MUTED, fontSize:11, marginBottom:14, lineHeight:1.6 }}>
                  By drawing your signature and typing your name above, you agree to the scope of work and terms outlined by Freedom Exteriors LLC. This constitutes a legally binding electronic signature.
                </div>
                <button onClick={saveSignature} disabled={!typedName.trim()||!hasDrawn||sigSaving}
                  style={{ width:"100%", background:typedName.trim()&&hasDrawn?GOLD:"#333", color:typedName.trim()&&hasDrawn?"#000":MUTED, border:"none", borderRadius:8, padding:"13px", fontWeight:800, fontSize:14, cursor:typedName.trim()&&hasDrawn?"pointer":"default", fontFamily:"inherit" }}>
                  {sigSaving ? "Saving…" : "✍️ Sign Contract"}
                </button>
                {sigError && <div style={{ color:"#f87171", fontSize:12, marginTop:10 }}>{sigError}</div>}
              </div>
            )}
          </div>
        )}

        {tab==="photos" && (
          <div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📷 Upload Photos</div>
            <div style={{ color:MUTED, fontSize:12, marginBottom:14 }}>Upload photos of damage, your roof, or anything relevant to your claim.</div>
            <label style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, cursor:"pointer", background:PANEL2, border:`2px dashed ${BORDER}`, borderRadius:9, padding:"20px", marginBottom:14 }}>
              <input type="file" accept="image/*" multiple style={{ display:"none" }} disabled={photoUploading} onChange={e => { uploadPhotos(e.target.files); e.target.value = ""; }}/>
              <span style={{ fontSize:28 }}>📷</span>
              <div><div style={{ fontWeight:700, fontSize:14 }}>{photoUploading?"Uploading…":"Tap to Upload Photos"}</div><div style={{ color:MUTED, fontSize:11 }}>JPG, PNG — up to 10 at a time</div></div>
            </label>
            {photoError && <div style={{ color:"#f87171", fontSize:12, marginBottom:12 }}>{photoError}</div>}
            {photos.length > 0 && (
              <div>
                <div style={{ fontSize:11, color:GOLD, fontWeight:700, marginBottom:8 }}>Your Uploads</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  {photos.filter(ph => ph.url).map(ph => (
                    <img key={ph.id} src={ph.url} alt={ph.name} style={{ width:"100%", height:90, objectFit:"cover", borderRadius:7, border:`1px solid ${BORDER}` }}/>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab==="message" && (
          <div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>💬 Message Your Rep</div>
            <div style={{ color:MUTED, fontSize:12, marginBottom:14 }}>Send a message directly to your Freedom Exteriors representative.</div>
            {msgSent ? (
              <div style={{ background:TEAL+"22", border:`1px solid ${TEAL}`, borderRadius:8, padding:20, textAlign:"center" }}>
                <div style={{ fontSize:24 }}>✅</div>
                <div style={{ fontWeight:700, color:TEAL, marginTop:6 }}>Message Sent!</div>
                <div style={{ color:MUTED, fontSize:12, marginTop:4 }}>Your rep will follow up with you shortly.</div>
                <button onClick={() => { setMsgSent(false); setMessage(""); }} style={{ marginTop:12, background:"none", border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"7px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>Send Another</button>
              </div>
            ) : (
              <div>
                <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Type your message here..." rows={5}
                  style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px 12px", fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical", marginBottom:10 }}/>
                <button onClick={sendMessage} disabled={!message.trim()} style={{ width:"100%", background:message.trim()?TEAL:"#333", color:message.trim()?TEXT:MUTED, border:"none", borderRadius:8, padding:"12px", fontWeight:800, fontSize:14, cursor:message.trim()?"pointer":"default", fontFamily:"inherit" }}>
                  Send Message →
                </button>
              </div>
            )}
            <div style={{ marginTop:20, background:PANEL, borderRadius:8, padding:14, border:`1px solid ${BORDER}` }}>
              <div style={{ fontSize:11, color:MUTED, marginBottom:6 }}>Or reach us directly:</div>
              <a href="tel:6512831689" style={{ color:GOLD, fontWeight:700, fontSize:14, textDecoration:"none", display:"block" }}>📞 (651) 283-1689</a>
              <a href="mailto:nick@freedom-exteriors.com" style={{ color:TEAL, fontSize:12, textDecoration:"none", display:"block", marginTop:4 }}>✉️ nick@freedom-exteriors.com</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}