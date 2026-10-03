"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { InvoiceRow } from "@/lib/invoice";
import { formatCents } from "@/lib/money";
import { toUsDate } from "@/lib/dates";
import { api } from "@/lib/clientApi";

const COLUMNS: Array<{ key: keyof InvoiceRow; label: string; num?: boolean }> = [
  { key: "invoice_number", label: "Invoice #" },
  { key: "customer_name", label: "Customer" },
  { key: "job_address", label: "Job address" },
  { key: "invoice_date", label: "Invoice date" },
  { key: "contract_total_cents", label: "Total", num: true },
  { key: "balance_due_cents", label: "Balance due", num: true },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
];

const FILTER_KEYS = ["q", "customer", "from", "to", "status", "sort", "dir"] as const;

function Catalog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters live in the URL so the CSV export uses exactly what's on screen.
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>, [params]);
  const [q, setQ] = useState(filters.q);
  const [customer, setCustomer] = useState(filters.customer);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    for (const k of FILTER_KEYS) if (filters[k]) sp.set(k, filters[k]);
    return sp.toString();
  }, [filters]);

  const setFilter = useCallback(
    (patch: Partial<typeof filters>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`);
    },
    [params, pathname, router],
  );

  // Debounce the text boxes.
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== filters.q || customer !== filters.customer) setFilter({ q, customer });
    }, 300);
    return () => clearTimeout(t);
  }, [q, customer, filters.q, filters.customer, setFilter]);

  useEffect(() => {
    let cancelled = false;
    api<{ invoices: InvoiceRow[] }>(`/api/invoices?${query}`)
      .then((r) => !cancelled && (setRows(r.invoices), setError("")))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [query]);

  function sortBy(key: string) {
    const dir = filters.sort === key && filters.dir !== "asc" ? "asc" : "desc";
    setFilter({ sort: key, dir });
  }

  async function togglePaid(row: InvoiceRow, e: React.MouseEvent) {
    e.stopPropagation();
    setBusyId(row.id);
    try {
      const next = row.status === "paid" ? "outstanding" : "paid";
      const updated = await api<{ status: InvoiceRow["status"]; paid_date: string | null }>(`/api/invoices/${row.id}/status`, { method: "POST", json: { status: next } });
      setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, ...updated } : r)) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const totals = useMemo(() => {
    const live = (rows ?? []).filter((r) => r.status !== "void");
    return { count: rows?.length ?? 0, balance: live.filter((r) => r.status === "outstanding").reduce((a, r) => a + r.balance_due_cents, 0) };
  }, [rows]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ marginRight: "auto" }}>Invoice catalog</h1>
        <a className="btn secondary" href={`/api/export?${query}`} title="QuickBooks Online import file. Easier: open an invoice and use Send to QuickBooks.">Export CSV (QuickBooks import)</a>
      </div>

      <div className="card filters">
        <div>
          <label>Search customer, address or invoice #</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
        </div>
        <div>
          <label>Customer</label>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </div>
        <div>
          <label>From</label>
          <input type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
        </div>
        <div>
          <label>To</label>
          <input type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
        </div>
        <div>
          <label>Status</label>
          <select value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
            <option value="">Outstanding + Paid</option>
            <option value="outstanding">Outstanding</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
            <option value="all">All (incl. void)</option>
          </select>
        </div>
        <div>
          <button className="secondary" onClick={() => { setQ(""); setCustomer(""); router.replace(pathname); }}>Clear</button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      <p className="muted small">
        {totals.count} invoice{totals.count === 1 ? "" : "s"} · outstanding balance {formatCents(totals.balance)}
      </p>

      <div className="table-wrap">
        <table className="catalog">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={c.num ? "num" : undefined}>
                  <button onClick={() => sortBy(c.key)}>
                    {c.label}
                    {(filters.sort || "invoice_date") === c.key ? ((filters.dir || "desc") === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
              <th>Paid?</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={9} className="muted">Loading…</td></tr>
            )}
            {rows?.length === 0 && (
              <tr><td colSpan={9} className="muted">No invoices match.</td></tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => router.push(`/invoices/${r.id}`)}>
                <td>
                  <strong>{r.invoice_number}</strong>
                  {r.duplicate_number_flag && <span title="Duplicate number on the document" style={{ color: "#8a5a00" }}> ⚠</span>}
                </td>
                <td className="wrap">{r.customer_name}</td>
                <td className="wrap">{r.job_address}</td>
                <td>{toUsDate(r.invoice_date)}</td>
                <td className="num">{formatCents(r.contract_total_cents + r.change_orders_total_cents)}</td>
                <td className="num">{formatCents(r.balance_due_cents)}</td>
                <td>
                  <span className={`pill ${r.status}`}>{r.status === "paid" ? `Paid ${toUsDate(r.paid_date)}` : r.status[0].toUpperCase() + r.status.slice(1)}</span>
                  {r.qb_doc_number && <span className="pill qb" style={{ marginLeft: 6 }} title="In QuickBooks">QB</span>}
                </td>
                <td><span className="pill src">{r.source === "generated" ? "Generated" : "Uploaded"}</span></td>
                <td>
                  {r.status !== "void" && (
                    <button className="secondary" style={{ padding: "3px 10px" }} disabled={busyId === r.id} onClick={(e) => togglePaid(r, e)}>
                      {r.status === "paid" ? "Mark unpaid" : "Mark paid"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function CatalogPage() {
  return (
    <Suspense>
      <Catalog />
    </Suspense>
  );
}
