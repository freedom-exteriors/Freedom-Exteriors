import { useState } from "react";
import { apiFetch } from "./apiFetch";
import { roofMeasurements } from "./measurements";

const TEAL = "#1a9e99"; const GOLD = "#e8a820";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099";

// Used until a default is saved company-wide (pricing config → supplierContact).
export const DEFAULT_SUPPLIER_CONTACT = { name: "Mark Little (ABC Supply)", email: "mark.little@abcsupply.com" };

const input = { width: "100%", boxSizing: "border-box", background: PANEL, border: `1px solid ${BORDER}`, color: TEXT, borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", marginBottom: 8 };
const label = { fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, display: "block" };

// Emails a job's material list (+ Hover roof measurements) to the supplier rep,
// with the job site address for delivery. No prices and no homeowner contact info.
export default function EmailSupplier({ job, contact, onSaveContact, onSent }) {
  const saved = contact?.email ? contact : DEFAULT_SUPPLIER_CONTACT;
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(saved.email);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const measured = roofMeasurements(job);
  const [withMeasurements, setWithMeasurements] = useState(Boolean(measured));
  const [remember, setRemember] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);

  const materials = job.materials || [];
  const hasStreet = Boolean(String(job.address || "").trim());
  const address = hasStreet ? [job.address, [job.city, [job.state, job.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";
  const log = [...(job.supplierEmails || [])].reverse();

  const send = async () => {
    setSending(true);
    setStatus(null);
    try {
      const res = await apiFetch("/api/send-supplier-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, cc, subject, message,
          job: { address: job.address, city: job.city, state: job.state, zip: job.zip, type: job.type },
          materials: materials.map(m => ({ name: m.name, cat: m.cat, unit: m.unit, qty: m.qty })),
          measurements: withMeasurements ? measured : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Send failed");
      if (remember && to.trim() !== saved.email) onSaveContact?.({ name: "", email: to.trim() });
      onSent?.(data.sent);
      setStatus({ ok: `Sent to ${data.sent.to.join(", ")}` });
      setOpen(false);
    } catch (e) {
      setStatus({ error: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      {!open ? (
        <button onClick={() => { setOpen(true); setStatus(null); }} style={{ width: "100%", background: "none", border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: "10px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          📧 Email list to supplier rep
        </button>
      ) : (
        <div style={{ background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📧 Email to supplier</div>
          <span style={label}>To{to.trim() === saved.email && saved.name ? ` — ${saved.name}` : ""}</span>
          <input style={input} value={to} onChange={e => setTo(e.target.value)} placeholder="rep@supplier.com" />
          <span style={label}>Cc (optional)</span>
          <input style={input} value={cc} onChange={e => setCc(e.target.value)} />
          <span style={label}>Subject</span>
          <input style={input} value={subject} onChange={e => setSubject(e.target.value)} placeholder={`Material ${materials.length ? "order" : "quote"} — ${address || "job address"}`} />
          <span style={label}>Message</span>
          <textarea style={{ ...input, minHeight: 70, resize: "vertical" }} value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Please deliver Tuesday AM, roof load if possible." />
          <div style={{ fontSize: 12, color: address ? TEXT : "#f87171", marginBottom: 8 }}>
            Delivery: {address || "no street address on this job — add it under Details first"}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>
            {materials.length} item{materials.length === 1 ? "" : "s"} (quantities only, no prices) + spreadsheet attachment
          </div>
          {measured ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={withMeasurements} onChange={e => setWithMeasurements(e.target.checked)} /> Include roof measurements ({measured.source === "eagleview" ? "EagleView" : "Hover"})
            </label>
          ) : null}
          {to.trim() && to.trim() !== saved.email && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Make this the default supplier contact
            </label>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button disabled={sending || !to.trim() || !address} onClick={send} style={{ flex: 1, background: GOLD, color: "#000", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 800, fontSize: 13, cursor: sending ? "wait" : "pointer", fontFamily: "inherit", opacity: sending || !to.trim() || !address ? 0.6 : 1 }}>
              {sending ? "Sending…" : "Send"}
            </button>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 8, padding: "10px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      )}
      {status?.ok && <div style={{ color: TEAL, fontSize: 12, marginTop: 6 }}>✓ {status.ok}</div>}
      {status?.error && <div style={{ color: "#f87171", fontSize: 12, marginTop: 6 }}>{status.error}</div>}
      {log.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Sent to supplier</div>
          {log.map((s, i) => (
            <div key={i} style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>
              {new Date(s.sentAt).toLocaleString()} — {(s.to || []).join(", ")} — {s.items} item{s.items === 1 ? "" : "s"}{s.measurements ? " + measurements" : ""}{s.by ? ` (${s.by})` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
