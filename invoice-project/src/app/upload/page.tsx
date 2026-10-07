"use client";
import { useState } from "react";
import Link from "next/link";
import { InvoiceForm } from "@/components/InvoiceForm";
import type { InvoiceFormInput } from "@/lib/invoice";
import type { ReviewDraft } from "@/lib/review";
import { api } from "@/lib/clientApi";
import { UPLOAD_ACCEPT, uploadFile, type UploadExt } from "@/lib/uploadClient";

type Ext = UploadExt;

type Stage =
  | { name: "pick" }
  | { name: "working"; message: string }
  | { name: "review"; uploadId: string; ext: Ext; fileName: string; viewUrl: string; draft: ReviewDraft; previewText: string | null }
  | { name: "saved"; id: string; invoiceNumber: string; duplicate: boolean };

export default function UploadPage() {
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [docNumber, setDocNumber] = useState("");
  const [showOriginal, setShowOriginal] = useState(true);

  async function handleFile(original: File | undefined) {
    if (!original) return;
    setError("");
    try {
      const { uploadId, ext, file } = await uploadFile(original, (message) => setStage({ name: "working", message }));

      setStage({ name: "working", message: "Claude is reading the invoice. This can take up to a minute for long PDFs…" });
      const { draft, previewText } = await api<{ draft: ReviewDraft; previewText: string | null }>(`/api/uploads/${uploadId}/extract`, {
        method: "POST",
        json: { ext, fileName: file.name },
      });
      const { url } = await api<{ url: string }>(`/api/uploads/${uploadId}/view?ext=${ext}`);
      setDocNumber(draft.documentInvoiceNumber);
      setStage({ name: "review", uploadId, ext, fileName: file.name, viewUrl: url, draft, previewText });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage({ name: "pick" });
    }
  }

  async function save(form: InvoiceFormInput) {
    if (stage.name !== "review") return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string; invoiceNumber: string; duplicate: boolean }>(`/api/uploads/${stage.uploadId}/save`, {
        method: "POST",
        json: { ext: stage.ext, form, documentInvoiceNumber: docNumber, warnings: stage.draft.warnings },
      });
      setStage({ name: "saved", ...r });
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (stage.name === "saved") {
    return (
      <div className="card">
        <h1>Saved as {stage.invoiceNumber}</h1>
        {stage.duplicate && <div className="alert warn">That invoice number was already in the catalog, so a suffix was added. Check whether this is a duplicate upload.</div>}
        <div className="actions">
          <Link className="btn" href={`/invoices/${stage.id}`}>Open it</Link>
          <button className="secondary" onClick={() => setStage({ name: "pick" })}>Upload another</button>
        </div>
      </div>
    );
  }

  if (stage.name === "review") {
    const { draft } = stage;
    const flagCount = Object.keys(draft.flags).length;
    return (
      <>
        <div className="backbar">
          <Link className="btn secondary" href="/">← Back to catalog (don&apos;t save)</Link>
          <button className="secondary" onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? "Hide original" : "Show original"}</button>
        </div>
        <h1>Review: {stage.fileName}</h1>
        <p className="muted small">Nothing is saved until you click Save. Check every field against the original on the left.</p>
        {error && <div className="alert error">{error}</div>}
        {flagCount > 0 && <div className="alert warn">{flagCount} field{flagCount === 1 ? "" : "s"} highlighted in yellow need a look (missing or uncertain).</div>}
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
            <InvoiceForm
              mode="uploaded"
              initial={draft.form}
              flags={draft.flags}
              submitLabel="Save to catalog"
              busy={busy}
              onSubmit={save}
              onCancel={() => setStage({ name: "pick" })}
              extra={
                <div className="card">
                  <h2 style={{ marginTop: 0 }}>Invoice number</h2>
                  <label>Number printed on the document (kept exactly as printed)</label>
                  <input className={draft.flags.invoice_number ? "flagged" : undefined} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="None printed" />
                  {draft.flags.invoice_number && <div className="flag-note">⚠ {draft.flags.invoice_number}</div>}
                  <p className="muted small">
                    {docNumber.trim()
                      ? "This number will be kept. If another invoice already has it, a -DUP suffix is added and you'll be warned."
                      : "No number on the document: the next FE-INV number for the invoice's year will be assigned when you save."}
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
      <h1>Upload an old invoice</h1>
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
