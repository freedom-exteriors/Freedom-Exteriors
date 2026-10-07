"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATUS_LABEL, type EstimateRow } from "@/lib/estimate";
import { formatCents } from "@/lib/money";
import { toUsDate } from "@/lib/dates";
import { api } from "@/lib/clientApi";

export default function EstimatesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<EstimateRow[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (status) sp.set("status", status);
      api<{ estimates: EstimateRow[] }>(`/api/estimates?${sp}`)
        .then((r) => !cancelled && (setRows(r.estimates), setError("")))
        .catch((e) => !cancelled && setError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, status]);

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ margin: 0, marginRight: "auto" }}>Estimates</h1>
        <Link className="btn" href="/estimates/new">+ New estimate</Link>
        <Link className="btn secondary" href="/estimates/upload">Upload old estimate</Link>
      </div>
      <div className="filters est">
        <div>
          <label>Search (customer, address, estimate #)</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Pearson" />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All except void</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined</option>
            <option value="void">Void</option>
            <option value="all">Everything</option>
          </select>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!rows ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No estimates yet. Click <strong>+ New estimate</strong> to build one.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="catalog">
            <thead>
              <tr>
                <th>Estimate #</th>
                <th>Customer</th>
                <th>Job address</th>
                <th>Date</th>
                <th className="num">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => router.push(`/estimates/${r.id}`)}>
                  <td><Link href={`/estimates/${r.id}`}>{r.estimate_number}</Link></td>
                  <td className="wrap">{r.customer_name}</td>
                  <td className="wrap">{r.job_address}</td>
                  <td>{toUsDate(r.estimate_date)}</td>
                  <td className="num">{formatCents(r.total_cents)}</td>
                  <td>
                    <span className={`pill est-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    {r.invoice_id && <span className="pill src" style={{ marginLeft: 6 }}>Invoiced</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
