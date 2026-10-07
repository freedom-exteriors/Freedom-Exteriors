"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_VALID_DAYS,
  estimatePaymentTerms,
  type EstimateFormInput,
  type EstimateLineInput,
  type PriceBookItem,
} from "@/lib/estimate";
import {
  centsToPlain,
  computeCostTotals,
  formatCents,
  formatQuantity,
  lineAmountCents,
  parseDollarsToCents,
  parsePercentHundredths,
  parseQuantityMilli,
} from "@/lib/money";
import { todayIso } from "@/lib/dates";
import { EstimateFiles } from "./EstimateFiles";

export function emptyEstimate(): EstimateFormInput {
  return {
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    customerAddress: "",
    jobAddress: "",
    subtitle: "",
    tag: "",
    estimateDate: todayIso(),
    validDays: String(DEFAULT_VALID_DAYS),
    scope: "",
    lines: [],
    overheadPercent: "",
    profitPercent: "",
    paymentTerms: estimatePaymentTerms(DEFAULT_VALID_DAYS),
    attachments: [],
  };
}

const blankLine = (): EstimateLineInput => ({ priceBookItemId: null, description: "", detail: "", qty: "1", unit: "", rate: "" });

function lineFromItem(p: PriceBookItem): EstimateLineInput {
  const milli = parseQuantityMilli(String(Number(p.default_quantity))) ?? 1000;
  return {
    priceBookItemId: p.id,
    description: p.description,
    detail: p.detail ?? "",
    qty: formatQuantity(milli).replace(/,/g, ""),
    unit: p.unit,
    rate: p.rate_cents === null ? "" : centsToPlain(p.rate_cents),
  };
}

/** Display-only math; the server recomputes everything on save. */
function lineAmount(l: EstimateLineInput): { cents: number | null; bad: boolean } {
  if (!l.description.trim() && !l.rate.trim()) return { cents: null, bad: false };
  const q = l.qty.trim() ? parseQuantityMilli(l.qty) : 1000;
  const r = l.rate.trim() ? parseDollarsToCents(l.rate) : null;
  if (q === null || (l.rate.trim() && (r === null || r < 0))) return { cents: null, bad: true };
  return { cents: r === null ? null : lineAmountCents(q, r), bad: false };
}

interface Props {
  initial: EstimateFormInput;
  priceBook: PriceBookItem[];
  submitLabel: string;
  busy?: boolean;
  onSubmit: (form: EstimateFormInput) => void;
  onCancel?: () => void;
}

export function EstimateBuilder({ initial, priceBook, submitLabel, busy, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<EstimateFormInput>(initial);
  const [termsTouched, setTermsTouched] = useState(initial.paymentTerms !== estimatePaymentTerms(initial.validDays));
  const set = <K extends keyof EstimateFormInput>(k: K, v: EstimateFormInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const trades = useMemo(() => {
    const map = new Map<string, PriceBookItem[]>();
    for (const p of priceBook) map.set(p.trade, [...(map.get(p.trade) ?? []), p]);
    return [...map.entries()];
  }, [priceBook]);

  const checked = new Set(form.lines.map((l) => l.priceBookItemId).filter(Boolean));

  function toggle(p: PriceBookItem, on: boolean) {
    setForm((f) => ({
      ...f,
      lines: on ? [...f.lines, lineFromItem(p)] : f.lines.filter((l) => l.priceBookItemId !== p.id),
    }));
  }

  function updateLine(i: number, patch: Partial<EstimateLineInput>) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  }

  function setValidDays(v: string) {
    setForm((f) => ({ ...f, validDays: v, paymentTerms: termsTouched ? f.paymentTerms : estimatePaymentTerms(v || DEFAULT_VALID_DAYS) }));
  }

  const totals = useMemo(() => {
    const bad: string[] = [];
    const amounts = form.lines.map((l, i) => {
      const r = lineAmount(l);
      if (r.bad) bad.push(`Line ${i + 1}`);
      return r.cents;
    });
    const pct = (s: string, label: string) => {
      if (!s.trim()) return null;
      const h = parsePercentHundredths(s);
      if (h === null) bad.push(label);
      return h;
    };
    const cost = computeCostTotals({
      lineAmountsCents: amounts.filter((a): a is number => a !== null),
      overheadHundredths: pct(form.overheadPercent, "Overhead %"),
      profitHundredths: pct(form.profitPercent, "Profit %"),
    });
    const missingPrice = form.lines.filter((l) => l.description.trim() && !l.rate.trim()).length;
    return { ...cost, amounts, bad, missingPrice };
  }, [form]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  const input = (label: string, key: keyof EstimateFormInput, o: { placeholder?: string; full?: boolean; required?: boolean; type?: string } = {}) => (
    <div style={o.full ? { gridColumn: "1 / -1" } : undefined}>
      <label>{label}</label>
      <input type={o.type ?? "text"} value={(form[key] as string | undefined) ?? ""} placeholder={o.placeholder} required={o.required} onChange={(e) => set(key, e.target.value as never)} />
    </div>
  );

  return (
    <form onSubmit={submit}>
      <EstimateFiles form={form} priceBook={priceBook} onAttachments={(a) => set("attachments", a)} onMerged={setForm} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Customer &amp; job</h2>
        <div className="grid2">
          {input("Customer name *", "customerName", { required: true })}
          {input("Customer phone", "customerPhone")}
          {input("Customer email (for emailing the PDF)", "customerEmail", { type: "email", placeholder: "name@example.com" })}
          {input("Customer mailing address (leave blank if same as job site)", "customerAddress", { full: true })}
          {input("Job site address", "jobAddress", { full: true, placeholder: "123 Oak St, Stillwater, MN 55082" })}
          {input("Subtitle (job description under the title)", "subtitle", { full: true, placeholder: "Full roof replacement: GAF Timberline HDZ" })}
          {input("Tag (optional, short)", "tag", { placeholder: "e.g. INSURANCE CLAIM" })}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Estimate</h2>
        <div className="grid2">
          {input("Estimate date *", "estimateDate", { type: "date", required: true })}
          <div>
            <label>Valid for (days)</label>
            <input value={form.validDays} inputMode="numeric" onChange={(e) => setValidDays(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Check the items for this job</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each check adds a line below with the price-book price. Change quantities and prices on the lines. Prices are set on the{" "}
          <Link href="/price-book">Price book</Link> page.
        </p>
        {trades.length === 0 && <p className="muted">The price book is empty. Add items on the Price book page, or use &quot;+ Custom line&quot; below.</p>}
        {trades.map(([trade, items]) => (
          <details key={trade} className="trade" open>
            <summary>
              {trade} <span className="muted small">({items.filter((p) => checked.has(p.id)).length} checked)</span>
            </summary>
            <div className="checks">
              {items.map((p) => (
                <label key={p.id} className={`check${checked.has(p.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={checked.has(p.id)} onChange={(e) => toggle(p, e.target.checked)} />
                  <span>
                    {p.label}
                    <span className="muted small">
                      {" "}· {p.rate_cents === null ? "no set price" : `${formatCents(p.rate_cents)} / ${p.unit}`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Lines on the estimate</h2>
        {form.lines.length === 0 && <p className="muted">Nothing yet. Check items above or add a custom line.</p>}
        {form.lines.map((row, i) => {
          const amt = totals.amounts[i];
          const needsPrice = row.description.trim() !== "" && !row.rate.trim();
          return (
            <div key={i} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8 }}>
              <div className="row">
                <div className="grow">
                  {i === 0 && <label>Description</label>}
                  <input value={row.description} placeholder="e.g. Seamless gutters" onChange={(e) => updateLine(i, { description: e.target.value })} />
                </div>
                <div className="w-qty">
                  {i === 0 && <label>Qty</label>}
                  <input className="money" value={row.qty} placeholder="1" inputMode="decimal" onChange={(e) => updateLine(i, { qty: e.target.value })} />
                </div>
                <div className="w-unit">
                  {i === 0 && <label>Unit</label>}
                  <input value={row.unit} placeholder="ea" onChange={(e) => updateLine(i, { unit: e.target.value })} />
                </div>
                <div className="w-amt">
                  {i === 0 && <label>Price each</label>}
                  <input className={`money${needsPrice ? " flagged" : ""}`} value={row.rate} placeholder="0.00" inputMode="decimal" onChange={(e) => updateLine(i, { rate: e.target.value })} />
                </div>
                <div className="w-amt">
                  {i === 0 && <label>Amount</label>}
                  <input className="money" value={amt === null ? "" : formatCents(amt)} readOnly tabIndex={-1} style={{ background: "#f5f7f8" }} />
                </div>
                <button type="button" className="link" aria-label="Remove line" onClick={() => set("lines", form.lines.filter((_, j) => j !== i))}>✕</button>
              </div>
              {row.note && <div className="muted small" style={{ margin: "2px 0 4px" }}>{row.note}</div>}
              {needsPrice && <div className="flag-note">⚠ Type a price for this line (it has no set price in the price book).</div>}
              <input value={row.detail} placeholder="Detail (optional small grey line)" onChange={(e) => updateLine(i, { detail: e.target.value })} style={{ fontSize: 13 }} />
            </div>
          );
        })}
        <button type="button" className="secondary" onClick={() => set("lines", [...form.lines, blankLine()])}>+ Custom line</button>

        <div className="grid2" style={{ marginTop: 16, maxWidth: 420 }}>
          {input("Overhead % (optional)", "overheadPercent", { placeholder: "e.g. 10" })}
          {input("Profit % (optional)", "profitPercent", { placeholder: "e.g. 10" })}
        </div>
        <div className="totals" style={{ marginTop: 12 }}>
          <div><span>Subtotal</span><span>{formatCents(totals.subtotalCents)}</span></div>
          {totals.overheadCents !== 0 && <div><span>Overhead</span><span>{formatCents(totals.overheadCents)}</span></div>}
          {totals.profitCents !== 0 && <div><span>Profit</span><span>{formatCents(totals.profitCents)}</span></div>}
          <div className="balance"><span>Total estimate</span><span>{formatCents(totals.contractTotalCents)}</span></div>
          {totals.bad.length > 0 && <div className="alert error small" style={{ display: "block" }}>Not a valid number: {totals.bad.join(", ")}</div>}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Scope of work</h2>
        <p className="muted small" style={{ marginTop: 0 }}>One item per line. Each line prints as a bullet.</p>
        <textarea rows={6} value={form.scope} onChange={(e) => set("scope", e.target.value)} placeholder="Tear off existing roof down to the deck" />
        <button
          type="button"
          className="link small"
          onClick={() => set("scope", form.lines.map((l) => l.description.trim()).filter(Boolean).join("\n"))}
        >
          Fill in from the lines above
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Payment terms</h2>
        <textarea
          rows={5}
          value={form.paymentTerms}
          onChange={(e) => {
            setTermsTouched(true);
            set("paymentTerms", e.target.value);
          }}
        />
        <button
          type="button"
          className="link small"
          onClick={() => {
            setTermsTouched(false);
            set("paymentTerms", estimatePaymentTerms(form.validDays || DEFAULT_VALID_DAYS));
          }}
        >
          Reset to default wording
        </button>
      </div>

      {totals.missingPrice > 0 && (
        <div className="alert warn">{totals.missingPrice} line{totals.missingPrice === 1 ? " needs" : "s need"} a price before you can save.</div>
      )}
      <div className="actions">
        <button type="submit" disabled={busy || totals.bad.length > 0 || totals.missingPrice > 0}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
