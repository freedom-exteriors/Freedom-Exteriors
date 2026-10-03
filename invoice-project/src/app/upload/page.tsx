"use client";
import { useState } from "react";
import Link from "next/link";
import { InvoiceForm } from "@/components/InvoiceForm";
import type { InvoiceFormInput } from "@/lib/invoice";
import type { ReviewDraft } from "@/lib/review";
import { api } from "@/lib/clientApi";

const MAX_BYTES = 20 * 1024 * 1024;
type Ext = "pdf" | "png" | "jpg" | "docx";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Stage =
  | { name: "pick" }
  | { name: "working"; message: string }
  | { name: "review"; uploadId: string; ext: Ext; fileName: string; viewUrl: string; draft: ReviewDraft; previewText: string | null }
  | { name: "saved"; id: string; invoiceNumber: string; duplicate: boolean };

function extOf(file: File): Ext | "heic" | "doc" | null {
  const name = file.name.toLowerCase();
  if (file.type === DOCX_MIME || name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "image/png" || name.endsWith(".png")) return "png";
  if (file.type === "image/jpeg" || /\.jpe?g$/.test(name)) return "jpg";
  if (/image\/hei[cf]/.test(file.type) || /\.hei[cf]$/.test(name)) return "heic";
  return null;
}

/** iPhone photos (HEIC) are converted to JPG in the browser before upload. */
async function heicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
}

export default function UploadPage() {
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [docNumber, setDocNumber] = useState("");

  async function handleFile(original: File | undefined) {
    if (!original) return;
    setError("");
    let ext = extOf(original);
    let file = original;
    if (ext === null) {
      setError(`"${original.name}" isn't a PDF, Word (.docx), PNG, JPG or HEIC file. Save or export it as a PDF and try again.`);
      return;
    }
    if (ext === "doc") {
      setError(`"${original.name}" is an old-style Word file (.doc). Open it in Word, choose File → Save As → Word Document (.docx) or PDF, and upload that.`);
      return;
    }
    try {
      if (ext === "heic") {
        setStage({ name: "working", message: "Converting iPhone photo (HEIC) to JPG…" });
        try {
          file = await heicToJpeg(original);
          ext = "jpg";
        } catch {
          throw new Error("This HEIC photo couldn't be converted. On your iPhone, open it and use Share → Save as JPEG (or take a screenshot), then upload that.");
        }
      }
      if (file.size > MAX_BYTES) throw new Error(`This file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 20 MB.`);
      if (file.size === 0) throw new Error("This file is empty.");

      setStage({ name: "working", message: "Uploading…" });
      const { uploadId, signedUrl } = await api<{ uploadId: string; signedUrl: string }>("/api/uploads", {
        method: "POST",
        json: { ext, size: file.size, fileName: file.name },
      });
      const put = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", docx: DOCX_MIME }[ext as Ext],
          "x-upsert": "false",
        },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status}). Try again.`);

      setStage({ name: "working", message: "Claude is reading the invoice. This can take up to a minute for long PDFs…" });
      const { draft, previewText } = await api<{ draft: ReviewDraft; previewText: string | null }>(`/api/uploads/${uploadId}/extract`, {
        method: "POST",
        json: { ext, fileName: file.name },
      });
      const { url } = await api<{ url: string }>(`/api/uploads/${uploadId}/view?ext=${ext}`);
      setDocNumber(draft.documentInvoiceNumber);
      setStage({ name: "review", uploadId, ext: ext as Ext, fileName: file.name, viewUrl: url, draft, previewText });
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
        <h1>Review: {stage.fileName}</h1>
        <p className="muted small">Nothing is saved until you click Save. Check every field against the original on the left.</p>
        {error && <div className="alert error">{error}</div>}
        {flagCount > 0 && <div className="alert warn">{flagCount} field{flagCount === 1 ? "" : "s"} highlighted in yellow need a look (missing or uncertain).</div>}
        {draft.warnings.map((w, i) => <div key={i} className="alert warn">{w}</div>)}
        <div className="review">
          <div className="viewer">
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
          </div>
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
          <input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.heic,.heif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/heic,image/heif" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
      )}
    </>
  );
}
