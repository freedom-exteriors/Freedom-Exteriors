"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EstimateBuilder } from "@/components/EstimateBuilder";
import { estimateToForm, scopeLines, STATUS_LABEL, type EstimateFormInput, type EstimateRow, type EstimateStatus, type PriceBookItem } from "@/lib/estimate";
import { formatCents, formatPercent, formatQuantity, parsePercentHundredths } from "@/lib/money";
import { addDays, toLongDate, toUsDate } from "@/lib/dates";
import { api, openSigned } from "@/lib/clientApi";
import { EmailPdf } from "@/components/EmailPdf";
import { estimateEmail } from "@/lib/emailText";
import { viewUpload } from "@/lib/uploadClient";

type Loaded = { estimate: EstimateRow; invoiceNumber: string | null };

export default function EstimateDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Loaded | null>(null);
  const [priceBook, setPriceBook] = useState<PriceBookItem[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Loaded>(`/api/estimates/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("created")) {
      setNotice("Estimate saved. Use Email PDF to send it to the customer, or Download .docx for the Word file.");
      window.history.replaceState(null, "", `/estimates/${id}`);
    }
  }, [id]);

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

  async function startEdit() {
    await run(async () => {
      if (!priceBook) setPriceBook((await api<{ items: PriceBookItem[] }>("/api/price-book")).items);
      setEditing(true);
    });
  }

  async function saveEdit(form: EstimateFormInput) {
    await run(async () => {
      const r = await api<{ docxError: string | null }>(`/api/estimates/${id}`, { method: "PATCH", json: form });
      setEditing(false);
      window.scrollTo(0, 0);
      if (r.docxError) throw new Error(`Saved, but rebuilding the .docx failed: ${r.docxError}`);
    }, "Changes saved. The Word file was rebuilt.");
  }

  const setStatus = (status: EstimateStatus) =>
    run(() => api(`/api/estimates/${id}/status`, { method: "POST", json: { status } }), `Marked ${STATUS_LABEL[status]}.`);

  if (error && !data) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { estimate: e, invoiceNumber } = data;
  const locked = e.status === "void" || !!e.invoice_id;

  if (editing && priceBook) {
    return (
      <>
        <div className="backbar">
          <Link className="btn secondary" href="/estimates">← Back to estimates</Link>
          <button className="secondary" onClick={() => setEditing(false)}>Cancel editing</button>
        </div>
        <h1>Edit {e.estimate_number}</h1>
        <p className="muted small">Saving rebuilds the Word file. The estimate number doesn&apos;t change.</p>
        {error && <div className="alert error">{error}</div>}
        <EstimateBuilder initial={estimateToForm(e)} priceBook={priceBook} submitLabel="Save changes" busy={busy} onSubmit={saveEdit} onCancel={() => setEditing(false)} />
        {error && <div className="alert error" style={{ marginTop: 12 }}>{error}</div>}
      </>
    );
  }

  const pct = (v: number | string | null) => (v === null ? "" : ` (${formatPercent(parsePercentHundredths(String(Number(v))) ?? 0)})`);
  const statusButton = (s: EstimateStatus, label: string, cls = "secondary") =>
    e.status !== s && <button className={cls} disabled={busy} onClick={() => setStatus(s)}>{label}</button>;

  return (
    <>
      <div className="backbar"><Link className="btn secondary" href="/estimates">← Back to estimates</Link></div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{e.estimate_number}</h1>
        <span className={`pill est-${e.status}`}>{STATUS_LABEL[e.status]}{e.status === "accepted" && e.accepted_date ? ` ${toUsDate(e.accepted_date)}` : ""}</span>
      </div>
      <p className="muted small">
        {e.customer_name} · {formatCents(e.total_cents)} · valid until {toLongDate(addDays(e.estimate_date, e.valid_days))}
        {e.source === "uploaded" && <> · uploaded from an old estimate{e.document_estimate_number && e.document_estimate_number !== e.estimate_number ? ` (printed number ${e.document_estimate_number})` : ""}; the original is under Photos &amp; files</>}
      </p>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="card">
        <div className="actions" style={{ marginTop: 0 }}>
          {e.status !== "void" && (
            <EmailPdf
              pdfUrl={`/api/estimates/${id}/pdf?v=${encodeURIComponent(e.updated_at)}`}
              fileName={`${e.estimate_number}.pdf`}
              message={estimateEmail(e)}
              to={e.customer_email}
              onShared={() => {
                // Emailed a draft: it's been sent now.
                if (e.status === "draft") setStatus("sent");
              }}
            />
          )}
          <button className="secondary" disabled={busy} onClick={() => run(() => openSigned(`/api/estimates/${id}/download`))}>Download .docx</button>
          {!locked && <button className="secondary" disabled={busy} onClick={startEdit}>Edit</button>}
          {e.invoice_id ? (
            <Link className="btn" href={`/invoices/${e.invoice_id}`}>Open invoice {invoiceNumber ?? ""}</Link>
          ) : (
            e.status !== "void" && e.status !== "declined" && <Link className="btn" href={`/invoices/new?fromEstimate=${id}`}>Make invoice</Link>
          )}
        </div>
        {!e.invoice_id && (
          <div className="actions">
            <span className="muted small" style={{ alignSelf: "center" }}>Status:</span>
            {statusButton("draft", "Draft")}
            {statusButton("sent", "Sent")}
            {statusButton("accepted", "Accepted")}
            {statusButton("declined", "Declined")}
            {e.status !== "void" && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Void ${e.estimate_number}? It stays in the list marked Void and its number is never reused.`)) setStatus("void");
                }}
              >
                Void
              </button>
            )}
          </div>
        )}
        {!e.invoice_id && e.status !== "void" && e.status !== "declined" && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            <strong>Make invoice</strong> opens a new invoice filled in from this estimate. Nothing is saved, and no invoice number is used, until you click Create invoice there. This estimate is then marked Accepted.
          </p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Customer &amp; job</h2>
        <dl className="fields">
          <dt>Customer</dt><dd>{e.customer_name}</dd>
          {e.customer_phone && <><dt>Phone</dt><dd>{e.customer_phone}</dd></>}
          {e.customer_email && <><dt>Email</dt><dd>{e.customer_email}</dd></>}
          {e.customer_address && <><dt>Mailing address</dt><dd>{e.customer_address}</dd></>}
          {e.job_address && <><dt>Job site</dt><dd>{e.job_address}</dd></>}
          {e.subtitle && <><dt>Subtitle</dt><dd>{e.subtitle}</dd></>}
          {e.tag && <><dt>Tag</dt><dd>{e.tag}</dd></>}
          <dt>Estimate date</dt><dd>{toLongDate(e.estimate_date)}</dd>
          <dt>Valid for</dt><dd>{e.valid_days} days</dd>
        </dl>
      </div>

      {scopeLines(e.scope_text).length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Scope of work</h2>
          <ul style={{ margin: 0 }}>{scopeLines(e.scope_text).map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cost estimate</h2>
        <div className="table-wrap">
          <table className="catalog">
            <thead>
              <tr><th>Description</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {e.items.map((i, n) => (
                <tr key={n}>
                  <td className="wrap">
                    {i.description}
                    {i.detail && <div className="muted small">{i.detail}</div>}
                  </td>
                  <td className="num">{formatQuantity(i.quantity_milli)}{i.unit ? ` ${i.unit}` : ""}</td>
                  <td className="num">{formatCents(i.rate_cents)}</td>
                  <td className="num">{formatCents(i.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals" style={{ marginTop: 12 }}>
          <div><span>Subtotal</span><span>{formatCents(e.subtotal_cents)}</span></div>
          {e.overhead_cents !== 0 && <div><span>Overhead{pct(e.overhead_percent)}</span><span>{formatCents(e.overhead_cents)}</span></div>}
          {e.profit_cents !== 0 && <div><span>Profit{pct(e.profit_percent)}</span><span>{formatCents(e.profit_cents)}</span></div>}
          <div className="balance"><span>Total estimate</span><span>{formatCents(e.total_cents)}</span></div>
        </div>
      </div>

      {(e.attachments ?? []).length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Photos &amp; files</h2>
          <p className="muted small" style={{ marginTop: 0 }}>For your reference only. These don&apos;t go to the customer.</p>
          <ul style={{ margin: 0 }}>
            {e.attachments.map((a) => (
              <li key={a.uploadId}>
                <button type="button" className="link" onClick={() => viewUpload(a.uploadId, a.ext).catch((err) => setError(err.message))}>{a.fileName}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {e.payment_terms && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Payment terms</h2>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{e.payment_terms}</p>
        </div>
      )}
    </>
  );
}
