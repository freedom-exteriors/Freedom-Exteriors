"use client";
import { useState } from "react";
import type { EstimateAttachment, EstimateFormInput, PriceBookItem } from "@/lib/estimate";
import { MAX_ATTACHMENTS } from "@/lib/estimate";
import { api } from "@/lib/clientApi";
import { UPLOAD_ACCEPT, uploadFile, viewUpload } from "@/lib/uploadClient";
import { mergeSuggestion, type EstimateSuggestion, type MergeResult } from "@/lib/estimateSuggest";

interface Props {
  form: EstimateFormInput;
  priceBook: PriceBookItem[];
  onAttachments: (a: EstimateAttachment[]) => void;
  onMerged: (form: EstimateFormInput) => void;
}

// "Start from photos or files": attach insurance scopes, measurement
// reports, photos and notes, then let Claude fill in the estimate.
export function EstimateFiles({ form, priceBook, onAttachments, onMerged }: Props) {
  const files = form.attachments ?? [];
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<(MergeResult & { notes: string | null }) | null>(null);
  const busy = status !== "";

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setError("");
    let current = files;
    const problems: string[] = [];
    for (const f of Array.from(list)) {
      if (current.length >= MAX_ATTACHMENTS) {
        problems.push(`Only ${MAX_ATTACHMENTS} files can be attached to one estimate.`);
        break;
      }
      try {
        const { uploadId, ext, file } = await uploadFile(f, setStatus);
        current = [...current, { uploadId, ext, fileName: file.name }];
        onAttachments(current);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
    }
    setStatus("");
    if (problems.length) setError(problems.join(" "));
  }

  async function read() {
    setError("");
    setResult(null);
    setStatus(`Claude is reading ${files.length} file${files.length === 1 ? "" : "s"}. This can take a minute or two…`);
    try {
      const { suggestion } = await api<{ suggestion: EstimateSuggestion }>("/api/estimates/suggest", { method: "POST", json: { files, note } });
      const merged = mergeSuggestion(form, suggestion, priceBook);
      onMerged(merged.form);
      setResult({ ...merged, notes: suggestion.notes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("");
    }
  }

  async function view(a: EstimateAttachment) {
    setError("");
    try {
      await viewUpload(a.uploadId, a.ext);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Start from photos or files</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Add insurance scopes, Hover/EagleView reports, damage photos, notes or other quotes. Claude reads them and fills in the estimate below. You check
        everything before saving. The files stay attached to this estimate.
      </p>

      {files.length > 0 && (
        <ul style={{ paddingLeft: 18, margin: "8px 0" }}>
          {files.map((a) => (
            <li key={a.uploadId} style={{ marginBottom: 4 }}>
              <button type="button" className="link" onClick={() => view(a)}>{a.fileName}</button>{" "}
              <button type="button" className="link small" disabled={busy} aria-label={`Remove ${a.fileName}`} onClick={() => onAttachments(files.filter((x) => x.uploadId !== a.uploadId))}>✕ remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="actions" style={{ marginTop: 8 }}>
        <label className={`btn secondary${busy ? " disabled" : ""}`} style={{ cursor: busy ? "default" : "pointer" }}>
          {files.length ? "+ Add more files" : "+ Add photos or files"}
          <input type="file" multiple accept={UPLOAD_ACCEPT} disabled={busy} style={{ display: "none" }} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      {files.length > 0 && (
        <>
          <label style={{ marginTop: 12 }}>Notes for Claude (optional)</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer wants Best tier shingles. Gutters on the back only." />
          <div className="actions">
            <button type="button" disabled={busy} onClick={read}>🤖 Read files and fill in the estimate</button>
          </div>
        </>
      )}

      {status && <div className="alert ok">{status}</div>}
      {error && <div className="alert error">{error}</div>}
      {result && (
        <div className="alert warn" style={{ display: "block" }}>
          <strong>Claude added {result.added} line{result.added === 1 ? "" : "s"}.</strong> Check every line. Each one has a 🤖 note saying where it came from.
          {result.filled.length > 0 && <div>Filled in: {result.filled.join(", ")}.</div>}
          {result.alreadyOn.length > 0 && <div>Already on the estimate, left as is: {result.alreadyOn.join("; ")}.</div>}
          {result.needPrice > 0 && <div>{result.needPrice} line{result.needPrice === 1 ? " needs" : "s need"} a price before you can save.</div>}
          {result.notes && <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}><strong>Claude&apos;s notes:</strong> {result.notes}</div>}
        </div>
      )}
    </div>
  );
}
