"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { EstimateBuilder } from "@/components/EstimateBuilder";
import { STATUS_LABEL, type EstimateFormInput, type EstimateStatus, type PriceBookItem } from "@/lib/estimate";
import type { EstimateImportDraft } from "@/lib/estimateImport";
import { api } from "@/lib/clientApi";
import { UPLOAD_ACCEPT, uploadFile, type UploadExt } from "@/lib/uploadClient";

type Stage =
  | { name: "pick" }
  | { name: "working"; message: string }
  | { name: "review"; uploadId: string; ext: UploadExt; fileName: string; viewUrl: string; draft: EstimateImportDraft; previewText: string | null }
  | { name: "saved"; id: string; estimateNumber: string; duplicate: boolean };

type SaveStatus = Exclude<EstimateStatus, "void">;

// Upload an estimate made before this tool, so the ones still out with
// customers are tracked here. Same flow as uploading an old invoice:
// upload → Claude reads it → check it next to the original → save.
export default function UploadEstimatePage() {
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [docNumber, setDocNumber] = useState("");
  const [status, setStatus] = useState<SaveStatus>("sent");
  const [showOriginal, setShowOriginal] = useState(true);
  const [priceBook, setPriceBook] = useState<PriceBookItem[]>([]);

  useEffect(() => {
    api<{ items: PriceBookItem[] }>("/api/price-book").then((r) => setPriceBook(r.items)).catch(() => setPriceBook([]));
  }, []);

  async function handleFile(original: File | undefined) {
    if (!original) return;
    setError("");
    try {
      const { uploadId, ext, file } = await uploadFile(original, (message) => setStage({ name: "working", message }));
      setStage({ name: "working", message: "Claude is reading the estimate. This can take up to a minute for long PDFs…" });
      const { draft, previewText } = await api<{ draft: EstimateImportDraft; previewText: string | null }>(`/api/estimates/import/${uploadId}/extract`, {
        method: "POST",
        json: { ext, fileName: file.name },
      });
      const { url } = await api<{ url: string }>(`/api/uploads/${uploadId}/view?ext=${ext}`);
      setDocNumber(draft.documentEstimateNumber);
      setStatus(draft.status);
      setStage({
        name: "review",
        uploadId,
        ext,
        fileName: file.name,
        viewUrl: url,
        previewText,
        draft: { ...draft, form: { ...draft.form, attachments: [{ uploadId, ext, fileName: file.name }] } },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage({ name: "pick" });
    }
  }

  async function save(form: EstimateFormInput) {
    if (stage.name !== "review") return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string; estimateNumber: string; duplicate: boolean }>(`/api/estimates/import/${stage.uploadId}/save`, {
        method: "POST",
        json: { ext: stage.ext, form, documentEstimateNumber: docNumber, status },
      });
      setStage({ name: "saved", ...r });
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      window.scrollTo(0, 0);
    } finally {
      setBusy(false);
    }
  }

  if (stage.name === "saved") {
    return (
      <div className="card">
        <h1>Saved as {stage.estimateNumber}</h1>
        {stage.duplicate && <div className="alert warn">That estimate number was already in the list, so a suffix was added. Check whether this is a duplicate upload.</div>}
        <div className="actions">
          <Link className="btn" href={`/estimates/${stage.id}`}>Open it</Link>
          <button className="secondary" onClick={() => setStage({ name: "pick" })}>Upload another</button>
        </div>
      </div>
    );
  }

  if (stage.name === "review") {
    const { draft } = stage;
    return (
      <>
        <div className="backbar">
          <Link className="btn secondary" href="/estimates">← Back to estimates (don&apos;t save)</Link>
          <button className="secondary" onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? "Hide original" : "Show original"}</button>
        </div>
        <h1>Review: {stage.fileName}</h1>
        <p className="muted small">Nothing is saved until you click Save. Check every field against the original on the left. The total must match the original.</p>
        {error && <div className="alert error">{error}</div>}
        {draft.warnings.map((w, i) => <div key={i} className="alert warn">{w}</div>)}
        <div className={`review${showOriginal ? "" : " hide-original"}`}>
          {showOriginal && <div className="viewer">
            {stage.ext === "pdf" ? (
              <iframe src={stage.viewUrl} title="Original document" />
            ) : stage.ext === "docx" ? (
              <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
                <p className="muted small" style={{ marginTop: 0 }}>
                  Text of the Word file (what Claude read). <a href={stage.viewUrl}>Download the original .docx</a>
                </p>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: 0 }}>{stage.previewText}</pre>
              </div>
            ) : (
              <img src={stage.viewUrl} alt="Original document" />
            )}
          </div>}
          <div>
            <EstimateBuilder
              initial={draft.form}
              priceBook={priceBook}
              submitLabel="Save estimate"
              busy={busy}
              onSubmit={save}
              onCancel={() => setStage({ name: "pick" })}
              hideFiles
              extra={
                <div className="card">
                  <h2 style={{ marginTop: 0 }}>Estimate number &amp; status</h2>
                  <div className="grid2">
                    <div>
                      <label>Number printed on the document</label>
                      <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="None printed" />
                    </div>
                    <div>
                      <label>Status</label>
                      <select value={status} onChange={(e) => setStatus(e.target.value as SaveStatus)}>
                        {(["sent", "accepted", "declined", "draft"] as const).map((st) => (
                          <option key={st} value={st}>{STATUS_LABEL[st]}{st === "sent" ? " (still out with the customer)" : ""}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="muted small">
                    {docNumber.trim()
                      ? "This number will be kept. If another estimate already has it, a -DUP suffix is added and you'll be warned."
                      : "No number on the document: the next FE-EST number for the estimate's year will be assigned when you save."}
                    {draft.status === "accepted" && " Claude saw a customer signature, so this is set to Accepted."}
                  </p>
                </div>
              }
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="backbar"><Link className="btn secondary" href="/estimates">← Back to estimates</Link></div>
      <h1>Upload an old estimate</h1>
      <p className="muted small">For estimates made before this tool, so the ones still out with customers are tracked here. Claude reads it and you check it before it&apos;s saved. The original stays attached.</p>
      {error && <div className="alert error">{error}</div>}
      {stage.name === "working" ? (
        <div className="card"><p>⏳ {stage.message}</p></div>
      ) : (
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files[0]);
          }}
        >
          <p style={{ fontSize: 17, fontWeight: 700, color: "var(--teal)" }}>Drop a PDF or photo here, or click to choose</p>
          <p className="muted small">PDF, Word (.docx), PNG, JPG or iPhone HEIC · up to 20 MB · multi-page PDFs are fine</p>
          <input type="file" accept={UPLOAD_ACCEPT} style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
      )}
    </>
  );
}
