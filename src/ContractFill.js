import { useState, useRef, useCallback } from "react";
import { useCloseGuard } from "./closeGuard";
import { canvasPoint, SIGNATURE_INK } from "./signature";
import { exportInsuranceContract } from "./pdfExport";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

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

function TextBlock({ label, value, onChange, rows }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{label}</label>
      <textarea
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        rows={rows || 4}
        style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "12px 12px", fontSize: 16, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
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

const blankContract = (job) => ({
  type: "residential-roofing-insurance",
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
  startDate: "",
  completionDate: "",
  ownerSignature: null,
  contractorSignature: null,
});

export default function ContractFill({ job, onSave, onClose }) {
  const [data, setData] = useState(job.contract?.type === "residential-roofing-insurance" ? job.contract : blankContract(job));
  const [savedFlash, setSavedFlash] = useState(false);
  const set = (k) => (v) => setData(d => ({ ...d, [k]: v }));

  const [closeDoc, rememberSaved] = useCloseGuard(data, onSave, onClose);
  const save = () => {
    onSave(data); rememberSaved(data);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: DARK, zIndex: 200, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, background: PANEL2, borderBottom: `1px solid ${BORDER}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: 1 }}>
          <span style={{ color: TEAL }}>FREEDOM </span><span style={{ color: GOLD }}>EXTERIORS</span>
          <span style={{ color: MUTED, fontWeight: 500, fontSize: 13, marginLeft: 10 }}>Residential Roofing Contract</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedFlash && <span style={{ color: TEAL, fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
          {data.ownerSignature && data.contractorSignature && <button onClick={() => exportInsuranceContract(data, job)} style={{ background:"#fff2", border:"1px solid #fff4", color:TEXT, borderRadius:7, padding:"9px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📥 PDF</button>}
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>💾 Save Contract</button>
          <button onClick={closeDoc} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 18 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: 1, color: TEXT }}>RESIDENTIAL ROOFING CONTRACT</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>No. {data.contractNo} · Freedom Exteriors LLC · 1145 Summit Ave, Mahtomedi, MN 55115 · (651) 283-1689 · License #BC-810020</div>
        </div>

        <Section title="Owner & Project Information">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Owner Name(s)" value={data.ownerNames} onChange={set("ownerNames")} />
            <Field label="Email" value={data.ownerEmail} onChange={set("ownerEmail")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Address" value={data.ownerAddress} onChange={set("ownerAddress")} />
            <Field label="City, State, Zip" value={data.ownerCityStateZip} onChange={set("ownerCityStateZip")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Phone" value={data.ownerPhone} onChange={set("ownerPhone")} />
            <Field label="Alt. Phone" value={data.ownerAltPhone} onChange={set("ownerAltPhone")} />
          </div>
        </Section>

        <Section title="Scope of Work">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <TextBlock label="Description of work and materials to be used" value={data.description} onChange={set("description")} rows={5} />
            <TextBlock label="Areas that will NOT be worked on" value={data.exclusions} onChange={set("exclusions")} rows={2} />
          </div>
          <Notice>
            The only cost to the property owner is the insurance deductible, plus any upgrades chosen or any non-covered items needed to complete the repairs. The remaining contract balance is paid by the owner's insurance company per the final loss invoice. This agreement is null and void, and does not obligate either party, if the insurance company denies coverage for this claim or if the coverage offered is insufficient for Contractor to properly complete the work. Owner acknowledges Contractor is a general contractor and, as such, is entitled to standard overhead and profit as recognized under insurance industry practice.
          </Notice>
        </Section>

        <Section title="Payment">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Total Sum ($)" value={data.totalSum} onChange={set("totalSum")} type="number" />
            <Field label="Down Payment ($)" value={data.downPayment} onChange={set("downPayment")} type="number" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Approximate Start Date" value={data.startDate} onChange={set("startDate")} type="date" />
            <Field label="Approximate Completion Date" value={data.completionDate} onChange={set("completionDate")} type="date" />
          </div>
        </Section>

        <Section title="Required Notices">
          <Notice>
            <strong>Right to Cancel.</strong> You, the Buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. In addition, if your insurer denies your claim, you may cancel this contract within 72 hours after being notified of that denial. See the attached Notice of Cancellation form for instructions on exercising this right.
          </Notice>
          <Notice>
            <strong>Insurance Deductible — Minn. Stat. § 325E.66.</strong> A residential contractor providing home repair or improvement services to be paid by an insured from the proceeds of a property or casualty insurance policy shall not, as an inducement to the sale or provision of goods or services, advertise or promise to pay, directly or indirectly, all or part of any applicable insurance deductible, or offer to compensate an insured for providing any service to the insured.
          </Notice>
        </Section>

        <Section title="Acceptance">
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: MUTED }}>
            This contract is approved and accepted by both parties. There are no oral agreements or understandings between the parties beyond what is written here; this document, together with any plans or specifications referenced, is the entire agreement. Any changes must be made in writing and signed by both parties before additional charges apply or work scope changes. By signing below, Owner and Contractor agree to be bound by these terms.
          </div>
        </Section>

        <Section title="Signatures">
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <SignatureBox label="Owner Signature" signature={data.ownerSignature} onSign={s => setData(d => ({ ...d, ownerSignature: s }))} onClear={() => setData(d => ({ ...d, ownerSignature: null }))} />
            <SignatureBox label="Contractor Signature" signature={data.contractorSignature} onSign={s => setData(d => ({ ...d, contractorSignature: s }))} onClear={() => setData(d => ({ ...d, contractorSignature: null }))} />
          </div>
        </Section>

        <div style={{ textAlign: "center", paddingBottom: 30 }}>
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: "14px 28px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>💾 Save Contract</button>
        </div>
      </div>
    </div>
  );
}