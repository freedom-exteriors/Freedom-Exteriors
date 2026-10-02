import { useRef, useState } from "react";
import { apiFetch } from "./apiFetch";
import { supabase } from "./supabase";

const PANEL2 = "#162030"; const BORDER = "#1e3048"; const TEXT = "#e2eaf4"; const MUTED = "#6b8099";
const EV = "#3b82f6"; const WARN = "#fbbf24";
const BUCKET = "measurement-reports";

const lf = (v) => (v || v === 0 ? `${Number(v).toLocaleString()} LF` : "—");

// Upload an EagleView report PDF for this job; the server reads it into
// measurements (same shape as Hover's) that get saved as eagleviewMeasurements.
export default function EagleViewImport({ job, onImported }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const m = job.eagleviewMeasurements;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { setError("Pick the EagleView report PDF."); return; }
    setBusy(true);
    setError(null);
    const pdfPath = `${job.id}/eagleview-${Date.now()}.pdf`;
    try {
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(pdfPath, file, { contentType: "application/pdf" });
      if (upErr) throw new Error("Upload failed: " + upErr.message);
      const res = await apiFetch("/api/eagleview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, pdfPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      onImported({ ...data.measurements, fileName: file.name });
    } catch (err) {
      setError(err.message);
      supabase.storage.from(BUCKET).remove([pdfPath]).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async () => {
    const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(m.pdfPath, 120);
    if (signErr) { setError("Couldn't open the PDF: " + signErr.message); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const cells = m ? [
    ["Roof area", m.totalRoofArea ? `${m.totalRoofArea.toLocaleString()} sq ft (${m.squares} SQ)` : "—"],
    ["Pitch", (m.pitches || []).map((p) => `${p.pitch} ${Math.round(p.percentage)}%`).join(", ") || "—"],
    ["Facets", m.facets ?? "—"],
    ["Suggested waste", m.suggestedWastePct != null ? `${m.suggestedWastePct}%` : "—"],
    ...(m.hasLengths ? [
      ["Ridges + hips", lf(m.ridgeHipLength)], ["Valleys", lf(m.valleyLength)],
      ["Eaves / rakes", `${lf(m.eavesLength)} / ${lf(m.rakeLength)}`], ["Drip edge", lf(m.dripEdgeLength)],
      ["Step flashing", lf(m.stepFlashingLength)],
    ] : []),
  ] : [];

  return (
    <div style={{ marginTop: 12 }}>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={onFile} />
      <button disabled={busy} onClick={() => fileRef.current?.click()} style={{ background: EV + "22", border: `1px solid ${EV}`, color: EV, borderRadius: 7, padding: "10px 14px", cursor: busy ? "wait" : "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 }}>
        {busy ? "Reading EagleView report…" : m ? "🦅 Replace EagleView report" : "🦅 Import EagleView report"}
      </button>
      {error && <div style={{ color: "#f87171", fontSize: 12, marginTop: 6 }}>{error}</div>}
      {m && (
        <div style={{ background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>🦅 EagleView {m.reportType || "report"}{m.reportNumber ? ` #${m.reportNumber}` : ""}</div>
            <div style={{ fontSize: 11, color: MUTED }}>
              {m.address || ""}{m.pdfPath && <> · <button onClick={openPdf} style={{ background: "none", border: "none", color: EV, cursor: "pointer", padding: 0, fontSize: 11, fontFamily: "inherit" }}>open PDF</button></>}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
            {cells.map(([k, v]) => (
              <div key={k} style={{ background: "#0f1923", borderRadius: 6, padding: "6px 9px" }}>
                <div style={{ color: MUTED, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: TEXT }}>{v}</div>
              </div>
            ))}
          </div>
          {(m.warnings || []).map((w, i) => <div key={i} style={{ color: WARN, fontSize: 11, marginTop: 6 }}>⚠ {w}</div>)}
          {job.hoverMeasurements?.totalRoofArea ? <div style={{ color: MUTED, fontSize: 11, marginTop: 6 }}>This job also has Hover measurements — those are used first.</div> : null}
        </div>
      )}
    </div>
  );
}
