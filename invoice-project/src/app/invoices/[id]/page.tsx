"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InvoiceForm } from "@/components/InvoiceForm";
import type { InvoiceFormInput, InvoiceRow, LineItemRow } from "@/lib/invoice";
import { formFromInvoice } from "@/lib/formMapping";
import { formatCents, formatQuantity } from "@/lib/money";
import { quantityToMilli } from "@/lib/invoice";
import { toLongDate, toUsDate, todayIso } from "@/lib/dates";
import { api, openSigned } from "@/lib/clientApi";

type Loaded = { invoice: InvoiceRow; items: LineItemRow[] };

export default function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paidDate, setPaidDate] = useState(todayIso());

  const load = useCallback(() => {
    api<Loaded>(`/api/invoices/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(form: InvoiceFormInput) {
    await run(async () => {
      const r = await api<{ docxError: string | null }>(`/api/invoices/${id}`, { method: "PATCH", json: form });
      setEditing(false);
      if (r.docxError) throw new Error(`Saved, but rebuilding the .docx failed: ${r.docxError}`);
    }, "Changes saved.");
  }

  const setStatus = (status: InvoiceRow["status"], extra: Record<string, string> = {}) =>
    run(() => api(`/api/invoices/${id}/status`, { method: "POST", json: { status, ...extra } }), "Status updated.");

  if (error && !data) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { invoice: inv, items } = data;
  const kind = (k: LineItemRow["kind"]) => items.filter((i) => i.kind === k).sort((a, b) => a.sort_order - b.sort_order);
  const warnings = Array.isArray(inv.extraction_warnings) ? (inv.extraction_warnings as string[]) : [];
  const hasFile = inv.source === "generated" ? !!inv.generated_file_path : !!inv.original_file_path;

  if (editing) {
    return (
      <>
        <div className="backbar">
          <Link className="btn secondary" href="/">← Back to catalog</Link>
          <button className="secondary" onClick={() => setEditing(false)}>Cancel editing</button>
        </div>
        <h1>Edit {inv.invoice_number}</h1>
        {inv.source === "generated" && <p className="muted small">Saving rebuilds the Word file with the new details. The invoice number doesn&apos;t change.</p>}
        {error && <div className="alert error">{error}</div>}
        <InvoiceForm mode={inv.source} initial={formFromInvoice(inv, items)} submitLabel="Save changes" busy={busy} onSubmit={saveEdit} onCancel={() => setEditing(false)} />
      </>
    );
  }

  return (
    <>
      <div className="backbar"><Link className="btn secondary" href="/">← Back to catalog</Link></div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{inv.invoice_number}</h1>
        <span className={`pill ${inv.status}`}>{inv.status === "paid" ? `Paid ${toUsDate(inv.paid_date)}` : inv.status.toUpperCase()}</span>
        <span className="pill src">{inv.source === "generated" ? "Generated" : "Uploaded"}</span>
      </div>
      <p className="muted small">
        Number {inv.invoice_number_source === "from_document" ? `taken from the document${inv.document_invoice_number && inv.document_invoice_number !== inv.invoice_number ? ` (printed as "${inv.document_invoice_number}")` : ""}` : "assigned by this app"}.
      </p>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}
      {inv.duplicate_number_flag && <div className="alert warn">This document&apos;s invoice number was already used by another invoice, so a suffix was added.</div>}
      {warnings.map((w, i) => <div key={i} className="alert warn">{w}</div>)}

      <div className="card">
        <div className="actions" style={{ marginTop: 0 }}>
          {hasFile && <button onClick={() => run(() => openSigned(`/api/invoices/${id}/download`))}>{inv.source === "generated" ? "Download .docx" : "Download original"}</button>}
          {inv.source === "generated" && <button className="secondary" disabled={busy} onClick={() => run(() => api(`/api/invoices/${id}/rebuild`, { method: "POST" }), "Word file rebuilt.")}>Rebuild .docx</button>}
          {inv.status !== "void" && <button className="secondary" onClick={() => setEditing(true)}>Edit</button>}
          {inv.status === "outstanding" && (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} style={{ width: 160 }} aria-label="Paid date" />
              <button disabled={busy} onClick={() => setStatus("paid", { paidDate })}>Mark paid</button>
            </span>
          )}
          {inv.status === "paid" && <button className="secondary" disabled={busy} onClick={() => setStatus("outstanding")}>Mark unpaid</button>}
          {inv.status !== "void" ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (confirm(`Void ${inv.invoice_number}? It stays in the catalog marked VOID and its number is never reused.`)) setStatus("void");
              }}
            >
              Void
            </button>
          ) : (
            <button className="secondary" disabled={busy} onClick={() => setStatus("outstanding")}>Restore (un-void)</button>
          )}
        </div>
      </div>

      <div className="card">
        <dl className="fields">
          <dt>Customer</dt><dd>{inv.customer_name}</dd>
          <dt>Phone</dt><dd>{inv.customer_phone || "-"}</dd>
          <dt>Mailing address</dt><dd>{inv.customer_address || "Same as job site"}</dd>
          <dt>Job site</dt><dd>{inv.job_address || "-"}</dd>
          <dt>Subtitle</dt><dd>{inv.subtitle || "-"} {inv.tag && <strong style={{ color: "#b88700" }}>· {inv.tag}</strong>}</dd>
          <dt>Contract date</dt><dd>{toLongDate(inv.contract_date) || "-"}</dd>
          <dt>Invoice date</dt><dd>{toLongDate(inv.invoice_date)}</dd>
          <dt>Due date</dt><dd>{toLongDate(inv.due_date) || "-"} {inv.terms && <span className="muted">({inv.terms})</span>}</dd>
          <dt>Paid date</dt><dd>{toLongDate(inv.paid_date) || "-"}</dd>
        </dl>
      </div>

      {inv.payment_terms && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Payment terms</h2>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{inv.payment_terms}</p>
        </div>
      )}

      {kind("scope").length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Scope of work</h2>
          <ul>{kind("scope").map((s, i) => <li key={i}>{s.description}</li>)}</ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Account summary</h2>
        <div className="table-wrap">
          <table className="catalog">
            <tbody>
              {kind("contract_item").map((c, i) => {
                const q = quantityToMilli(c.quantity);
                return (
                  <tr key={`ci${i}`}>
                    <td className="wrap">
                      <strong>{c.description}</strong>
                      {c.detail && <div className="muted small">{c.detail}</div>}
                      {q !== null && c.rate_cents !== null && <div className="muted small">{formatQuantity(q)} × {formatCents(c.rate_cents)}</div>}
                    </td>
                    <td className="num">{c.amount_cents === null ? "" : formatCents(c.amount_cents)}</td>
                  </tr>
                );
              })}
              {inv.overhead_cents !== 0 && <tr><td>Overhead ({Number(inv.overhead_percent)}%)</td><td className="num">{formatCents(inv.overhead_cents)}</td></tr>}
              {inv.profit_cents !== 0 && <tr><td>Profit ({Number(inv.profit_percent)}%)</td><td className="num">{formatCents(inv.profit_cents)}</td></tr>}
              <tr><td><strong>Contract total</strong></td><td className="num"><strong>{formatCents(inv.contract_total_cents)}</strong></td></tr>
              {kind("deposit").map((d, i) => (
                <tr key={`d${i}`}><td className="wrap">Deposit received {toUsDate(d.line_date)} {d.description && `· ${d.description}`}</td><td className="num">({formatCents(d.amount_cents)})</td></tr>
              ))}
              {kind("change_order").map((c, i) => (
                <tr key={`co${i}`}><td className="wrap">Change order: {c.description}</td><td className="num">{formatCents(c.amount_cents)}</td></tr>
              ))}
              <tr><td><strong>BALANCE DUE</strong></td><td className="num"><strong>{formatCents(inv.balance_due_cents)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="muted small">Created {new Date(inv.created_at).toLocaleString()} · Last changed {new Date(inv.updated_at).toLocaleString()}</p>
    </>
  );
}
