import { useState, useRef, useCallback } from "react";
import { useCloseGuard } from "./closeGuard";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportRetailContract } from "./pdfExport";

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

function TextBlock({ label, value, onChange, rows }) {
  return (
    <div>
      <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>{label}</label>
      <textarea value={value||""} onChange={e=>onChange(e.target.value)} rows={rows||4}
        style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 12px", fontSize:16, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical" }} />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:18, marginBottom:16 }}>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:14, letterSpacing:1, color:GOLD, marginBottom:14, textTransform:"uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function Notice({ children }) {
  return (
    <div style={{ background:`${GOLD}14`, border:`1px solid ${GOLD}55`, borderRadius:8, padding:14, fontSize:12.5, lineHeight:1.6, color:TEXT, marginTop:10 }}>
      {children}
    </div>
  );
}

function PaymentRow({ num, when, amount, onWhenChange, onAmountChange }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"24px 1fr 140px", gap:10, alignItems:"center", marginBottom:8 }}>
      <span style={{ fontSize:13, color:MUTED, fontWeight:700 }}>{num}.</span>
      <input value={when||""} onChange={e=>onWhenChange(e.target.value)} placeholder="Payment due when…"
        style={{ background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px 12px", fontSize:14, fontFamily:"inherit" }} />
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:MUTED, fontSize:13 }}>$</span>
        <input type="number" min="0" step="0.01" value={amount||""} onChange={e=>onAmountChange(e.target.value)} placeholder="0.00"
          style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px 10px 10px 22px", fontSize:14, fontFamily:"monospace", boxSizing:"border-box" }} />
      </div>
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
  type: "retail-roofing",
  contractNo: `RC-${job.id}`,
  ownerNames: job.name || "",
  ownerAddress: job.address || "",
  ownerCityStateZip: [job.city, job.state].filter(Boolean).join(", "),
  ownerPhone: job.phone || "",
  ownerAltPhone: "",
  ownerEmail: job.email || "",
  description: job.estimate?.scope || "",
  exclusions: "",
  totalSum: job.estimate?.total || "",
  downPayment: job.estimate?.downPayment || "",
  payments: [
    { when: "", amount: "" },
    { when: "", amount: "" },
    { when: "", amount: "" },
    { when: "", amount: "" },
  ],
  startDate: "",
  completionDate: "",
  withdrawDays: "3",
  ownerSignature: null,
  owner2Signature: null,
  contractorSignature: null,
});

export default function RetailContract({ job, onSave, onClose }) {
  const [data, setData] = useState(job.retailContract?.type === "retail-roofing" ? job.retailContract : blank(job));
  const [savedFlash, setSavedFlash] = useState(false);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));
  const setPayment = (i, field) => (v) => setData(d => {
    const payments = [...d.payments];
    payments[i] = { ...payments[i], [field]: v };
    return { ...d, payments };
  });

  const [closeDoc, rememberSaved] = useCloseGuard(data, onSave, onClose);
  const save = () => { onSave(data); rememberSaved(data); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };
  const allSigned = data.ownerSignature && data.contractorSignature;

  return (
    <div style={{ position:"fixed", inset:0, background:DARK, zIndex:300, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
      {/* Header */}
      <div style={{ position:"sticky", top:0, background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:5 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:17, letterSpacing:1 }}>
          <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          <span style={{ color:MUTED, fontWeight:500, fontSize:13, marginLeft:10 }}>Retail Roofing Contract</span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {savedFlash && <span style={{ color:TEAL, fontSize:12, fontWeight:700 }}>✓ Saved</span>}
          {allSigned && <span style={{ color:"#10b981", fontSize:12, fontWeight:700 }}>✓ Fully Signed</span>}
          {allSigned && <button onClick={() => exportRetailContract(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>💾 Save</button>
          <button onClick={closeDoc} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:18 }}>
        {/* Title */}
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:22, letterSpacing:1, color:TEXT }}>RESIDENTIAL ROOFING CONTRACT</div>
          <div style={{ color:MUTED, fontSize:13, marginTop:4 }}>No. {data.contractNo} · Freedom Exteriors LLC · 1145 Summit Ave, Mahtomedi, MN 55115 · (651) 283-1689 · License #BC-810020</div>
        </div>

        {/* Owner Info */}
        <Section title="Owner & Project Information">
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <Field label="Owner Name(s)" value={data.ownerNames} onChange={set("ownerNames")} />
            <Field label="Email" value={data.ownerEmail} onChange={set("ownerEmail")} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <Field label="Address" value={data.ownerAddress} onChange={set("ownerAddress")} />
            <Field label="City, State, Zip" value={data.ownerCityStateZip} onChange={set("ownerCityStateZip")} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Field label="Phone" value={data.ownerPhone} onChange={set("ownerPhone")} />
            <Field label="Alt. Phone" value={data.ownerAltPhone} onChange={set("ownerAltPhone")} />
          </div>
        </Section>

        {/* Authorization */}
        <Section title="Scope of Work">
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.6, marginBottom:14 }}>
            I/WE, the Owner(s) of the premises described above, authorize Freedom Exteriors LLC (hereinafter "Contractor") to furnish all materials and labor necessary to roof and/or improve these premises in a good, workmanlike and substantial manner according to the following terms, specifications and provisions:
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <TextBlock label="a. Description of work and materials to be used" value={data.description} onChange={set("description")} rows={5} />
            <TextBlock label="b. Description of areas that will NOT be worked on" value={data.exclusions} onChange={set("exclusions")} rows={2} />
          </div>
        </Section>

        {/* Payment */}
        <Section title="Payment">
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Total Sum ($)</label>
              <div style={{ position:"relative" }}>
                <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:MUTED, fontSize:14 }}>$</span>
                <input type="number" min="0" step="0.01" value={data.totalSum||""} onChange={e=>set("totalSum")(e.target.value)} placeholder="0.00"
                  style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 12px 12px 22px", fontSize:16, fontFamily:"monospace", boxSizing:"border-box", fontWeight:700 }} />
              </div>
            </div>
            <div>
              <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Down Payment ($)</label>
              <div style={{ position:"relative" }}>
                <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:MUTED, fontSize:14 }}>$</span>
                <input type="number" min="0" step="0.01" value={data.downPayment||""} onChange={e=>set("downPayment")(e.target.value)} placeholder="0.00"
                  style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"12px 12px 12px 22px", fontSize:16, fontFamily:"monospace", boxSizing:"border-box" }} />
              </div>
            </div>
          </div>
          <div style={{ fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>c. Payment Schedule</div>
          {data.payments.map((p, i) => (
            <PaymentRow key={i} num={i+1} when={p.when} amount={p.amount} onWhenChange={setPayment(i,"when")} onAmountChange={setPayment(i,"amount")} />
          ))}
        </Section>

        {/* Dates */}
        <Section title="Schedule">
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Field label="d. Approximate Start Date" value={data.startDate} onChange={set("startDate")} type="date" />
            <Field label="Approximate Completion Date" value={data.completionDate} onChange={set("completionDate")} type="date" />
          </div>
        </Section>

        {/* Provisions */}
        <Section title="Contract Provisions">
          <div style={{ display:"flex", flexDirection:"column", gap:10, fontSize:12.5, color:MUTED, lineHeight:1.7 }}>
            <div><span style={{ color:TEXT, fontWeight:700 }}>1. Plans & Permits.</span> Work shall be done per plans and specifications. All required building permits will be obtained by Contractor and paid for by Owner. All other government charges shall be paid by Owner.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>2. Subcontracting.</span> Contractor has the right to subcontract any part of or all of the work.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>3. Change Orders.</span> Any modifications to this contract must be in writing, signed by both parties, and agreed upon before additional work begins. All change orders become part of this contract.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>4. Owner's Responsibilities.</span> Owner shall provide access to water, electricity, and premises; a storage area for materials and equipment; and must relocate any items blocking work areas. Owner is responsible for maintaining property insurance through completion.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>5. Permissible Delays.</span> Contractor shall not be held liable for delays due to weather, material shortages, labor shortages, acts of Owner, government actions, pandemics, or other events beyond Contractor's reasonable control.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>6. Escalation.</span> Price adjustments due to volatile market conditions or rapid material price increases shall be documented in a written change order.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>7. Surplus Materials.</span> Surplus materials left after completion are the property of Contractor. All salvage resulting from work under this contract is the property of Contractor.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>8. Cleanup.</span> Upon completion, Contractor will leave premises in a neat, broom-clean condition. Contractor is not responsible for dust, dirt, or small debris that settles into attic or open-beam areas. Owner grants Contractor the right to display signage at the job site until 14 days after completion and final payment, and to take and use before/after photos.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>9. Concealed Damage.</span> Contractor will notify Owner of any dry rot or other sub-roof deterioration discovered during work. Any repairs to such concealed conditions will be done only as extra work per a written change order.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>10. Hazardous Substances & Pests.</span> Contractor is not qualified to inspect for or abate hazardous materials or pests. Owner is responsible for any required inspection and abatement.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>11. Right to Stop Work.</span> If any payment is not made as required, Contractor may stop work until all past-due amounts are received. Interest on overdue accounts accrues at 18% per annum or the highest rate allowed by law.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>12. Collection Fees.</span> Owner agrees to pay all collection fees, legal fees, and attorney fees resulting from Owner's default. Prevailing party in any litigation or arbitration is entitled to all legal costs.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>13. Governing Law.</span> This agreement is governed by the laws of the State of Minnesota. If any provision is found invalid or unenforceable, the remaining provisions continue in full force.</div>
            <div><span style={{ color:TEXT, fontWeight:700 }}>14. Arbitration.</span> Any dispute arising out of this contract shall be settled by neutral arbitration under the applicable Construction Industry Arbitration Rules of the American Arbitration Association. A judgment upon the award may be entered in any court of competent jurisdiction. Contractor does not waive any lien rights by agreeing to arbitration.</div>
          </div>
        </Section>

        {/* Notices */}
        <Section title="Required Notices">
          <Notice>
            <strong>Right to Cancel.</strong> You, the Buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. See the attached Notice of Cancellation form for an explanation of this right.
          </Notice>
          <Notice>
            <strong>Minnesota Lien Notice — Minn. Stat. § 514.011.</strong> Any person or company supplying labor or materials for this improvement to your property may file a lien against your property if that person or company is not paid. Under Minnesota law, you have the right to pay persons who supplied labor or materials directly and deduct that amount from our contract price, or withhold the amounts due them from us until 120 days after completion of the improvement, unless we give you a lien waiver signed by persons who supplied any labor or material and who gave you timely notice.
          </Notice>
          <div style={{ marginTop:12, fontSize:12.5, color:MUTED, lineHeight:1.6 }}>
            NOTE: This contract may be withdrawn or renegotiated after{" "}
            <input value={data.withdrawDays||""} onChange={e=>set("withdrawDays")(e.target.value)}
              style={{ width:36, background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:4, color:TEXT, padding:"2px 6px", fontSize:12, fontFamily:"inherit", textAlign:"center" }} />{" "}
            days from signing if not approved and signed by both parties.
          </div>
        </Section>

        {/* Signatures */}
        <Section title="Acceptance & Signatures">
          <div style={{ fontSize:13, color:MUTED, lineHeight:1.6, marginBottom:18 }}>
            This contract is approved and accepted. There are no oral agreements or understandings between the parties beyond what is written here. This document is the entire agreement. Any changes must be in writing, signed by both parties. By signing, Owner and Contractor agree to be bound by all terms above.
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
            <SignatureBox label="Owner Signature" signature={data.ownerSignature}
              onSign={s=>setData(d=>({...d,ownerSignature:s}))} onClear={()=>setData(d=>({...d,ownerSignature:null}))} />
            <SignatureBox label="Second Owner / Co-Signer (if applicable)" signature={data.owner2Signature}
              onSign={s=>setData(d=>({...d,owner2Signature:s}))} onClear={()=>setData(d=>({...d,owner2Signature:null}))} />
            <SignatureBox label="Freedom Exteriors LLC — Contractor Signature" signature={data.contractorSignature}
              onSign={s=>setData(d=>({...d,contractorSignature:s}))} onClear={()=>setData(d=>({...d,contractorSignature:null}))} />
          </div>
        </Section>

        <div style={{ textAlign:"center", paddingBottom:30 }}>
          <button onClick={save} style={{ background:`${TEAL}22`, border:`1px solid ${TEAL}`, color:TEAL, borderRadius:8, padding:"14px 28px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>💾 Save Contract</button>
        </div>
      </div>
    </div>
  );
}