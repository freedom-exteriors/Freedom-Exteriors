"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { emptyForm, InvoiceForm } from "@/components/InvoiceForm";
import type { InvoiceFormInput } from "@/lib/invoice";
import { estimateToInvoiceForm, type EstimateRow } from "@/lib/estimate";
import { api, openSigned } from "@/lib/clientApi";

export default function NewInvoicePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; invoiceNumber: string; docxError: string | null } | null>(null);
  const [formKey, setFormKey] = useState(0);
  // "Make invoice" on an estimate opens /invoices/new?fromEstimate=<id>.
  // The form is only pre-filled here; nothing is saved until Create.
  const [fromEstimate, setFromEstimate] = useState<{ id: string; number: string; alreadyInvoiced: boolean } | null>(null);
  const [initial, setInitial] = useState<InvoiceFormInput | null>(null);

  useEffect(() => {
    const estId = new URLSearchParams(window.location.search).get("fromEstimate");
    if (!estId) {
      setInitial(emptyForm());
      return;
    }
    api<{ estimate: EstimateRow }>(`/api/estimates/${encodeURIComponent(estId)}`)
      .then(({ estimate }) => {
        setFromEstimate({ id: estimate.id, number: estimate.estimate_number, alreadyInvoiced: !!estimate.invoice_id });
        setInitial(estimateToInvoiceForm(estimate));
      })
      .catch((e) => {
        setError(`Couldn't load the estimate (${e.message}). Starting a blank invoice.`);
        setInitial(emptyForm());
      });
  }, []);

  async function save(form: InvoiceFormInput) {
    setBusy(true);
    setError("");
    try {
      setCreated(await api("/api/invoices", { method: "POST", json: { ...form, fromEstimateId: fromEstimate?.id } }));
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
          {fromEstimate && <Link className="btn secondary" href={`/estimates/${fromEstimate.id}`}>Back to estimate {fromEstimate.number}</Link>}
          <button className="secondary" onClick={() => { setCreated(null); setFromEstimate(null); setInitial(emptyForm()); setFormKey((k) => k + 1); window.history.replaceState(null, "", "/invoices/new"); }}>Start another</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="backbar">
        {fromEstimate ? (
          <Link className="btn secondary" href={`/estimates/${fromEstimate.id}`}>← Back to estimate (don&apos;t create)</Link>
        ) : (
          <Link className="btn secondary" href="/">← Back to catalog</Link>
        )}
      </div>
      <h1>New invoice{fromEstimate ? ` from ${fromEstimate.number}` : ""}</h1>
      <p className="muted small">The invoice number is assigned when you save (FE-INV-YYYY-###).</p>
      {fromEstimate && !fromEstimate.alreadyInvoiced && (
        <div className="alert ok">Filled in from estimate {fromEstimate.number}. Check it, add any deposits received, then click Preview totals and Create invoice. The estimate will be marked Accepted.</div>
      )}
      {fromEstimate?.alreadyInvoiced && (
        <div className="alert warn">An invoice was already made from {fromEstimate.number}. Creating another one makes a second invoice for the same job.</div>
      )}
      {error && <div className="alert error">{error}</div>}
      {initial ? (
        <InvoiceForm key={formKey} mode="generated" initial={initial} submitLabel="Create invoice" busy={busy} onSubmit={save} />
      ) : (
        <p className="muted">Loading the estimate…</p>
      )}
    </>
  );
}
