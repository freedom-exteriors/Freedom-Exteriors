"use client";
import { useMemo, useState } from "react";
import type { CostLineInput, InvoiceFormInput } from "@/lib/invoice";
import {
  computeCostTotals,
  computeTotals,
  formatCents,
  lineAmountCents,
  parseDollarsToCents,
  parsePercentHundredths,
  parseQuantityMilli,
} from "@/lib/money";
import { addDays, todayIso } from "@/lib/dates";
import { COMPANY } from "@/lib/company";

const blankLine = (): CostLineInput => ({ description: "", detail: "", qty: "", rate: "", amount: "" });

export function emptyForm(): InvoiceFormInput {
  const today = todayIso();
  return {
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    customerAddress: "",
    jobAddress: "",
    subtitle: "",
    tag: "",
    contractDate: "",
    invoiceDate: today,
    dueDate: addDays(today, COMPANY.defaultTermsDays),
    scope: [""],
    costLines: [blankLine()],
    overheadPercent: "",
    profitPercent: "",
    contractTotal: "",
    deposits: [],
    changeOrders: [],
    paymentTerms: COMPANY.defaultPaymentTerms,
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

/** One cost line's amount for display: qty × rate, else the typed amount. */
function lineAmount(l: CostLineInput, mode: Mode): { cents: number | null; bad: boolean } {
  const blank = !l.description.trim() && !l.qty.trim() && !l.rate.trim() && !l.amount.trim();
  if (blank) return { cents: null, bad: false };
  if (l.rate.trim() || mode === "generated") {
    const q = l.qty.trim() ? parseQuantityMilli(l.qty) : 1000;
    const r = l.rate.trim() ? parseDollarsToCents(l.rate) : null;
    if (q === null || (l.rate.trim() && r === null)) return { cents: null, bad: true };
    return { cents: r === null ? null : lineAmountCents(q, r), bad: false };
  }
  const a = parseDollarsToCents(l.amount);
  return { cents: a, bad: l.amount.trim() !== "" && a === null };
}

/** Live totals. Display only: the server recomputes everything on save. */
export function liveTotals(form: InvoiceFormInput, mode: Mode) {
  const bad: string[] = [];
  const cents = (s: string, label: string) => {
    if (!s.trim()) return 0;
    const c = parseDollarsToCents(s);
    if (c === null) bad.push(label);
    return c ?? 0;
  };
  const pct = (s: string, label: string) => {
    if (!s.trim()) return null;
    const h = parsePercentHundredths(s);
    if (h === null) bad.push(label);
    return h;
  };
  const amounts = form.costLines.map((l, i) => {
    const r = lineAmount(l, mode);
    if (r.bad) bad.push(`Line ${i + 1}`);
    return r.cents;
  });
  const cost = computeCostTotals({
    lineAmountsCents: amounts.filter((a): a is number => a !== null),
    overheadHundredths: pct(form.overheadPercent, "Overhead %"),
    profitHundredths: pct(form.profitPercent, "Profit %"),
  });
  const printed = mode === "uploaded" && form.contractTotal.trim() ? cents(form.contractTotal, "Contract total") : null;
  const t = computeTotals({
    contractTotalCents: printed ?? cost.contractTotalCents,
    depositCents: form.deposits.map((d, i) => cents(d.amount, `Deposit ${i + 1}`)),
    changeOrderCents: form.changeOrders.map((c, i) => cents(c.amount, `Change order ${i + 1}`)),
  });
  const entered = form.balanceDue !== undefined && form.balanceDue.trim() ? parseDollarsToCents(form.balanceDue) : null;
  return { ...cost, ...t, amounts, bad, enteredBalanceCents: entered };
}

export function InvoiceForm({ mode, initial, flags = {}, submitLabel, busy, onSubmit, onCancel, extra }: Props) {
  const [form, setForm] = useState<InvoiceFormInput>(initial);
  const [dueTouched, setDueTouched] = useState(mode === "uploaded" || initial.dueDate !== addDays(initial.invoiceDate, COMPANY.defaultTermsDays));
  const [preview, setPreview] = useState(false);
  const totals = useMemo(() => liveTotals(form, mode), [form, mode]);

  const set = <K extends keyof InvoiceFormInput>(k: K, v: InvoiceFormInput[K]) => {
    setPreview(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const flagCls = (field: string) => (flags[field] ? "flagged" : undefined);
  const flagNote = (field: string) => (flags[field] ? <div className="flag-note">⚠ {flags[field]}</div> : null);

  function setInvoiceDate(v: string) {
    setPreview(false);
    setForm((f) => ({ ...f, invoiceDate: v, dueDate: !dueTouched && v ? addDays(v, COMPANY.defaultTermsDays) : f.dueDate }));
  }

  function updateList<K extends "deposits" | "changeOrders" | "costLines">(key: K, i: number, patch: Partial<InvoiceFormInput[K][number]>) {
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
  const field = (label: string, key: keyof InvoiceFormInput, flag: string, o: { type?: string; placeholder?: string; full?: boolean; required?: boolean } = {}) => (
    <div style={o.full ? { gridColumn: "1 / -1" } : undefined}>
      <label>{label}</label>
      <input
        type={o.type ?? "text"}
        className={flagCls(flag)}
        value={(form[key] as string | undefined) ?? ""}
        placeholder={o.placeholder}
        required={o.required}
        onChange={(e) => set(key, e.target.value as never)}
      />
      {flagNote(flag)}
    </div>
  );

  return (
    <form onSubmit={submit}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Customer &amp; job</h2>
        <div className="grid2">
          {field("Customer name *", "customerName", "customer_name", { required: true })}
          {field("Customer phone", "customerPhone", "customer_phone")}
          {field("Customer email (for QuickBooks and emailing the PDF)", "customerEmail", "customer_email", { type: "email", placeholder: "name@example.com" })}
          {field("Customer mailing address (leave blank if same as job site)", "customerAddress", "customer_address", { full: true, placeholder: "PO Box 12, Stillwater, MN 55082" })}
          {field("Job site address", "jobAddress", "job_address", { full: true, placeholder: "123 Oak St, Stillwater, MN 55082" })}
          {field("Subtitle (job description under INVOICE)", "subtitle", "subtitle", { full: true, placeholder: "Full roof replacement: GAF Timberline HDZ" })}
          {field("Tag (optional, short)", "tag", "tag", { placeholder: "e.g. FINAL INVOICE" })}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Dates</h2>
        <div className="grid2">
          {field("Contract date", "contractDate", "contract_date", { type: "date" })}
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
                <input value={line} placeholder={i === 0 ? "e.g. Tear off existing roof down to the deck" : ""} onChange={(e) => set("scope", form.scope.map((s, j) => (j === i ? e.target.value : s)))} />
              </div>
              <button type="button" className="link" aria-label="Remove line" onClick={() => set("scope", form.scope.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => set("scope", [...form.scope, ""])}>+ Add scope line</button>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Line items</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Amount = Qty × Rate (blank Qty means 1).{mode === "uploaded" && " If the document shows only an amount, leave Qty and Rate blank and type the amount."}
        </p>
        {flagNote("line_items")}
        {form.costLines.map((row, i) => {
          const amt = totals.amounts[i];
          const manual = mode === "uploaded" && !row.rate.trim();
          return (
            <div key={i} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8 }}>
              <div className="row">
                <div className="grow">
                  {i === 0 && <label>Description</label>}
                  <input value={row.description} placeholder="e.g. Architectural shingles" onChange={(e) => updateList("costLines", i, { description: e.target.value })} />
                </div>
                <div className="w-qty">
                  {i === 0 && <label>Qty</label>}
                  <input className="money" value={row.qty} placeholder="1" inputMode="decimal" onChange={(e) => updateList("costLines", i, { qty: e.target.value })} />
                </div>
                <div className="w-amt">
                  {i === 0 && <label>Rate</label>}
                  <input className="money" value={row.rate} placeholder="0.00" inputMode="decimal" onChange={(e) => updateList("costLines", i, { rate: e.target.value })} />
                </div>
                <div className="w-amt">
                  {i === 0 && <label>Amount</label>}
                  {manual ? (
                    <input className="money" value={row.amount} placeholder="0.00" inputMode="decimal" onChange={(e) => updateList("costLines", i, { amount: e.target.value })} />
                  ) : (
                    <input className="money" value={amt === null ? "" : formatCents(amt)} readOnly tabIndex={-1} style={{ background: "#f5f7f8" }} />
                  )}
                </div>
                <button type="button" className="link" aria-label="Remove line" onClick={() => set("costLines", form.costLines.filter((_, j) => j !== i))}>✕</button>
              </div>
              <input value={row.detail} placeholder="Detail (optional small grey line, e.g. GAF Timberline HDZ, Charcoal, 32 squares)" onChange={(e) => updateList("costLines", i, { detail: e.target.value })} style={{ fontSize: 13 }} />
            </div>
          );
        })}
        <button type="button" className="secondary" onClick={() => set("costLines", [...form.costLines, blankLine()])}>+ Add line</button>

        <div className="grid2" style={{ marginTop: 16, maxWidth: 420 }}>
          {field("Overhead % (optional)", "overheadPercent", "overhead_percent", { placeholder: "e.g. 10" })}
          {field("Profit % (optional)", "profitPercent", "profit_percent", { placeholder: "e.g. 10" })}
        </div>

        <div className="totals" style={{ marginTop: 12 }}>
          <div><span>Subtotal</span><span>{formatCents(totals.subtotalCents)}</span></div>
          {totals.overheadCents !== 0 && <div><span>Overhead</span><span>{formatCents(totals.overheadCents)}</span></div>}
          {totals.profitCents !== 0 && <div><span>Profit</span><span>{formatCents(totals.profitCents)}</span></div>}
          <div style={{ fontWeight: 700 }}><span>Total</span><span>{formatCents(totals.subtotalCents + totals.overheadCents + totals.profitCents)}</span></div>
        </div>

        {mode === "uploaded" && (
          <div className="row" style={{ marginTop: 16 }}>
            <div className="grow">
              <label>Contract total as printed on the document (if different from the lines above)</label>
              {flagNote("contract_total")}
            </div>
            <div className="w-amt">
              <input className={`money ${flagCls("contract_total") ?? ""}`} value={form.contractTotal} placeholder="0.00" inputMode="decimal" onChange={(e) => set("contractTotal", e.target.value)} />
            </div>
            <span style={{ width: 28 }} />
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Deposits received</h2>
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
          <div><span>− Deposits</span><span>{formatCents(totals.depositsTotalCents)}</span></div>
          <div><span>+ Change orders</span><span>{formatCents(totals.changeOrdersTotalCents)}</span></div>
          <div className="balance"><span>Balance due</span><span>{formatCents(balanceShown)}</span></div>
          {!reconciles && (
            <div className="alert warn small" style={{ display: "block" }}>
              The numbers above add up to {formatCents(totals.balanceDueCents)}, but the balance entered is {formatCents(totals.enteredBalanceCents)}. Check the document. You can still save.
            </div>
          )}
          {totals.bad.length > 0 && <div className="alert error small" style={{ display: "block" }}>Not a valid number: {totals.bad.join(", ")}</div>}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Payment terms</h2>
        <textarea rows={3} value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
        {mode === "generated" && (
          <button type="button" className="link small" onClick={() => set("paymentTerms", COMPANY.defaultPaymentTerms)}>Reset to default wording</button>
        )}
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
