"use client";
import { useState } from "react";
import Link from "next/link";
import { emptyForm, InvoiceForm } from "@/components/InvoiceForm";
import type { InvoiceFormInput } from "@/lib/invoice";
import { api, openSigned } from "@/lib/clientApi";

export default function NewInvoicePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; invoiceNumber: string; docxError: string | null } | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function save(form: InvoiceFormInput) {
    setBusy(true);
    setError("");
    try {
      setCreated(await api("/api/invoices", { method: "POST", json: form }));
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="card">
        <h1>Invoice {created.invoiceNumber} created</h1>
        {created.docxError ? (
          <div className="alert warn">The invoice was saved, but building the Word file failed: {created.docxError}. Open the invoice and click &quot;Rebuild .docx&quot;.</div>
        ) : (
          <div className="alert ok">Saved, and the Word file is stored.</div>
        )}
        <div className="actions">
          {!created.docxError && <button onClick={() => openSigned(`/api/invoices/${created.id}/download`)}>Download .docx</button>}
          <Link className="btn secondary" href={`/invoices/${created.id}`}>Open invoice</Link>
          <button className="secondary" onClick={() => { setCreated(null); setFormKey((k) => k + 1); }}>Start another</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="backbar"><Link className="btn secondary" href="/">← Back to catalog</Link></div>
      <h1>New invoice</h1>
      <p className="muted small">The invoice number is assigned when you save (FE-INV-YYYY-###).</p>
      {error && <div className="alert error">{error}</div>}
      <InvoiceForm key={formKey} mode="generated" initial={emptyForm()} submitLabel="Create invoice" busy={busy} onSubmit={save} />
    </>
  );
}
