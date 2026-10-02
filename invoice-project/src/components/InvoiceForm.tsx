"use client";
import { useMemo, useState } from "react";
import type { InvoiceFormInput } from "@/lib/invoice";
import { computeTotals, formatCents, parseDollarsToCents } from "@/lib/money";
import { addDays, todayIso } from "@/lib/dates";

export function emptyForm(): InvoiceFormInput {
  const today = todayIso();
  return {
    customerName: "",
    customerPhone: "",
    jobAddress: "",
    contractDate: "",
    invoiceDate: today,
    dueDate: addDays(today, 30),
    scope: [""],
    contractTotal: "",
    deposits: [],
    changeOrders: [],
    contractItems: [],
  };
}

type Mode = "generated" | "uploaded";

interface Props {
  mode: Mode;
  initial: InvoiceFormInput;
  /** field name → reason (review screen highlights these) */
  flags?: Record<string, string>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (form: InvoiceFormInput) => void;
  onCancel?: () => void;
  /** Rendered just above the buttons (e.g. invoice-number choice). */
  extra?: React.ReactNode;
}

/** Live totals. Display only: the server recomputes everything on save. */
export function liveTotals(form: InvoiceFormInput) {
  const bad: string[] = [];
  const cents = (s: string, label: string) => {
    if (!s.trim()) return 0;
    const c = parseDollarsToCents(s);
    if (c === null) bad.push(label);
    return c ?? 0;
  };
  const t = computeTotals({
    contractTotalCents: cents(form.contractTotal, "Contract total"),
    depositCents: form.deposits.map((d, i) => cents(d.amount, `Deposit ${i + 1}`)),
    changeOrderCents: form.changeOrders.map((c, i) => cents(c.amount, `Change order ${i + 1}`)),
  });
  const entered = form.balanceDue !== undefined && form.balanceDue.trim() ? parseDollarsToCents(form.balanceDue) : null;
  return { ...t, bad, enteredBalanceCents: entered };
}

export function InvoiceForm({ mode, initial, flags = {}, submitLabel, busy, onSubmit, onCancel, extra }: Props) {
  const [form, setForm] = useState<InvoiceFormInput>(initial);
  const [dueTouched, setDueTouched] = useState(mode === "uploaded" || initial.dueDate !== addDays(initial.invoiceDate, 30));
  const [preview, setPreview] = useState(false);
  const totals = useMemo(() => liveTotals(form), [form]);

  const set = <K extends keyof InvoiceFormInput>(k: K, v: InvoiceFormInput[K]) => {
    setPreview(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const flagCls = (field: string) => (flags[field] ? "flagged" : undefined);
  const flagNote = (field: string) => (flags[field] ? <div className="flag-note">⚠ {flags[field]}</div> : null);

  function setInvoiceDate(v: string) {
    setPreview(false);
    setForm((f) => ({ ...f, invoiceDate: v, dueDate: !dueTouched && v ? addDays(v, 30) : f.dueDate }));
  }

  function updateList<K extends "deposits" | "changeOrders" | "contractItems">(key: K, i: number, patch: Partial<InvoiceFormInput[K][number]>) {
    set(key, form[key].map((row, j) => (j === i ? { ...row, ...patch } : row)) as InvoiceFormInput[K]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) {
      setPreview(true);
      return;
    }
    onSubmit(form);
  }

  const balanceShown = mode === "uploaded" && totals.enteredBalanceCents !== null ? totals.enteredBalanceCents : totals.balanceDueCents;
  const reconciles = mode !== "uploaded" || totals.enteredBalanceCents === null || Math.abs(totals.enteredBalanceCents - totals.balanceDueCents) <= 100;

  return (
    <form onSubmit={submit}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Customer &amp; dates</h2>
        <div className="grid2">
          <div>
            <label>Customer name *</label>
            <input className={flagCls("customer_name")} value={form.customerName} onChange={(e) => set("customerName", e.target.value)} required />
            {flagNote("customer_name")}
          </div>
          <div>
            <label>Customer phone</label>
            <input className={flagCls("customer_phone")} value={form.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} />
            {flagNote("customer_phone")}
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Job address</label>
            <input className={flagCls("job_address")} value={form.jobAddress} onChange={(e) => set("jobAddress", e.target.value)} placeholder="123 Oak St, Stillwater, MN 55082" />
            {flagNote("job_address")}
          </div>
          <div>
            <label>Contract date</label>
            <input type="date" className={flagCls("contract_date")} value={form.contractDate} onChange={(e) => set("contractDate", e.target.value)} />
            {flagNote("contract_date")}
          </div>
          <div>
            <label>Invoice date *</label>
            <input type="date" className={flagCls("invoice_date")} value={form.invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
            {flagNote("invoice_date")}
          </div>
          <div>
            <label>Due date {mode === "generated" && <span className="muted">(Net 30 unless changed)</span>}</label>
            <input
              type="date"
              className={flagCls("due_date")}
              value={form.dueDate}
              onChange={(e) => {
                setDueTouched(true);
                set("dueDate", e.target.value);
              }}
            />
            {flagNote("due_date")}
          </div>
        </div>
      </div>

      {mode === "generated" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Scope of work</h2>
          {form.scope.map((line, i) => (
            <div className="row" key={i}>
              <div className="grow">
                <input value={line} placeholder={i === 0 ? "e.g. Tear off and replace roof with GAF Timberline HDZ" : ""} onChange={(e) => set("scope", form.scope.map((s, j) => (j === i ? e.target.value : s)))} />
              </div>
              <button type="button" className="link" aria-label="Remove line" onClick={() => set("scope", form.scope.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => set("scope", [...form.scope, ""])}>+ Add scope line</button>
        </div>
      )}

      {mode === "uploaded" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Line items on the document</h2>
          {flagNote("line_items")}
          {form.contractItems.map((row, i) => (
            <div className="row" key={i}>
              <div className="grow">
                <input value={row.description} placeholder="Description" onChange={(e) => updateList("contractItems", i, { description: e.target.value })} />
              </div>
              <div className="w-amt">
                <input className="money" value={row.amount} placeholder="0.00" inputMode="decimal" onChange={(e) => updateList("contractItems", i, { amount: e.target.value })} />
              </div>
              <button type="button" className="link" aria-label="Remove" onClick={() => set("contractItems", form.contractItems.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => set("contractItems", [...form.contractItems, { description: "", amount: "" }])}>+ Add line item</button>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Money</h2>
        <div className="row">
          <div className="grow">
            <label>Contract total {mode === "generated" && "*"}</label>
            {flagNote("contract_total")}
          </div>
          <div className="w-amt">
            <input className={`money ${flagCls("contract_total") ?? ""}`} value={form.contractTotal} placeholder="0.00" inputMode="decimal" onChange={(e) => set("contractTotal", e.target.value)} required={mode === "generated"} />
          </div>
          <span style={{ width: 28 }} />
        </div>

        <h2>Deposits received</h2>
        {flagNote("deposits")}
        {form.deposits.map((row, i) => (
          <div className="row" key={i}>
            <div className="w-date">
              {i === 0 && <label>Date</label>}
              <input type="date" value={row.date} onChange={(e) => updateList("deposits", i, { date: e.target.value })} />
            </div>
            <div className="grow">
              {i === 0 && <label>Description</label>}
              <input value={row.description} placeholder="e.g. Deposit at signing" onChange={(e) => updateList("deposits", i, { description: e.target.value })} />
            </div>
            <div className="w-amt">
              {i === 0 && <label>Amount</label>}
              <input className="money" value={row.amount} placeholder="0.00" inputMode="decimal" onChange={(e) => updateList("deposits", i, { amount: e.target.value })} />
            </div>
            <button type="button" className="link" aria-label="Remove deposit" onClick={() => set("deposits", form.deposits.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => set("deposits", [...form.deposits, { date: "", description: "", amount: "" }])}>+ Add deposit</button>

        <h2>Change orders / add-ons</h2>
        {flagNote("change_orders")}
        {form.changeOrders.map((row, i) => (
          <div className="row" key={i}>
            <div className="grow">
              {i === 0 && <label>Description</label>}
              <input value={row.description} placeholder="e.g. Replace 4 sheets of rotted decking" onChange={(e) => updateList("changeOrders", i, { description: e.target.value })} />
            </div>
            <div className="w-amt">
              {i === 0 && <label>Amount</label>}
              <input className="money" value={row.amount} placeholder="0.00" inputMode="decimal" onChange={(e) => updateList("changeOrders", i, { amount: e.target.value })} />
            </div>
            <button type="button" className="link" aria-label="Remove change order" onClick={() => set("changeOrders", form.changeOrders.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => set("changeOrders", [...form.changeOrders, { description: "", amount: "" }])}>+ Add change order</button>

        {mode === "uploaded" && (
          <div className="row" style={{ marginTop: 16 }}>
            <div className="grow">
              <label>Balance due (as printed on the document)</label>
              {flagNote("balance_due")}
            </div>
            <div className="w-amt">
              <input className={`money ${flagCls("balance_due") ?? ""}`} value={form.balanceDue ?? ""} placeholder="0.00" inputMode="decimal" onChange={(e) => set("balanceDue", e.target.value)} />
            </div>
            <span style={{ width: 28 }} />
          </div>
        )}

        <div className="totals" style={{ marginTop: 20 }}>
          <div><span>Contract total</span><span>{formatCents(totals.contractTotalCents)}</span></div>
          <div><span>+ Change orders</span><span>{formatCents(totals.changeOrdersTotalCents)}</span></div>
          <div><span>− Deposits</span><span>{formatCents(totals.depositsTotalCents)}</span></div>
          <div className="balance"><span>Balance due</span><span>{formatCents(balanceShown)}</span></div>
          {!reconciles && (
            <div className="alert warn small" style={{ display: "block" }}>
              The numbers above add up to {formatCents(totals.balanceDueCents)}, but the balance entered is {formatCents(totals.enteredBalanceCents)}. Check the document. You can still save.
            </div>
          )}
          {totals.bad.length > 0 && <div className="alert error small" style={{ display: "block" }}>Not a valid amount: {totals.bad.join(", ")}</div>}
        </div>
      </div>

      {extra}

      {preview && (
        <div className="alert ok">
          <strong>Check the totals:</strong> contract {formatCents(totals.contractTotalCents)} + change orders {formatCents(totals.changeOrdersTotalCents)} − deposits {formatCents(totals.depositsTotalCents)} ={" "}
          <strong>balance due {formatCents(balanceShown)}</strong>. If that&apos;s right, click <strong>{submitLabel}</strong>.
        </div>
      )}
      <div className="actions">
        <button type="submit" disabled={busy || totals.bad.length > 0}>
          {busy ? "Saving…" : preview ? submitLabel : "Preview totals"}
        </button>
        {preview && <button type="button" className="secondary" onClick={() => setPreview(false)}>Keep editing</button>}
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
