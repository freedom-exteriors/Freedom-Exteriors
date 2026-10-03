import { describe, expect, it } from "vitest";
import { buildCsv, csvCell, CSV_COLUMNS } from "@/lib/csv";
import type { InvoiceRow, LineItemRow } from "@/lib/invoice";

describe("csvCell", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('He said "hi", then\nleft')).toBe('"He said ""hi"", then\nleft"');
  });
  it.each(["=SUM(A1)", "+1", "-1+1", "@cmd", "\tx", "\rx"])("neutralizes formula %j", (s) => {
    expect(csvCell(s).replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("leaves normal text alone", () => expect(csvCell("Jane Doe")).toBe("Jane Doe"));
});

const inv = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "1", invoice_number: "FE-INV-2026-001", invoice_number_source: "assigned", document_invoice_number: null,
  duplicate_number_flag: false, customer_name: "=HYPERLINK(\"evil\")", customer_phone: null,
  customer_address: null, subtitle: null, tag: null, payment_terms: null,
  job_address: "123 Oak St, Stillwater, MN", contract_date: "2026-08-14", invoice_date: "2026-10-02",
  due_date: "2026-11-01", terms: "Net 30", subtotal_cents: 1845000, overhead_percent: null, overhead_cents: 0,
  profit_percent: null, profit_cents: 0, contract_total_cents: 1845000, deposits_total_cents: 615000,
  change_orders_total_cents: 38000, balance_due_cents: 1268000, status: "outstanding", paid_date: null,
  source: "generated", original_file_path: null, generated_file_path: null, extraction_json: null,
  extraction_warnings: null, created_at: "", updated_at: "", customer_email: null, crm_job_id: null,
  qb_invoice_id: null, qb_doc_number: null, qb_link: null, qb_sent_at: null, ...over,
});

/** Minimal RFC 4180 line parser for checking output. */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const li = (o: Partial<LineItemRow> & Pick<LineItemRow, "kind" | "description">): LineItemRow => ({
  detail: null, quantity: null, rate_cents: null, amount_cents: null, line_date: null, sort_order: 0, ...o,
});

const rowsOf = (csv: string) => csv.replace(/^\uFEFF/, "").trim().split("\r\n").map(parseLine);
const col = (name: string) => (CSV_COLUMNS as readonly string[]).indexOf(name);

describe("buildCsv (QuickBooks Online invoice import)", () => {
  it("uses QuickBooks' sample-file headers", () => {
    expect(rowsOf(buildCsv([]))[0]).toEqual([
      "InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Terms", "Memo",
      "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount",
    ]);
  });

  it("no negative rows: deposits aren't lines (they're payments in QuickBooks)", () => {
    const items: LineItemRow[] = [
      li({ kind: "scope", description: "Tear off" }),
      li({ kind: "deposit", description: "At signing", amount_cents: 615000, line_date: "2026-08-14" }),
      li({ kind: "change_order", description: "Decking", amount_cents: 38000 }),
    ];
    const rows = rowsOf(buildCsv([{ invoice: inv(), items }])).slice(1);
    expect(rows).toHaveLength(2); // contract total + change order
    expect(rows[0]).toEqual([
      "FE-INV-2026-001", "'=HYPERLINK(\"evil\")", "10/02/2026", "11/01/2026", "Net 30", "Job site: 123 Oak St, Stillwater, MN",
      "Exterior Services", "Contract total (agreement dated 08/14/2026)", "1", "18450.00", "18450.00",
    ]);
    expect(rows[1].slice(col("ItemDescription"))).toEqual(["Change order: Decking", "1", "380.00", "380.00"]);
    expect(rows.every((r) => Number(r[col("ItemAmount")]) > 0)).toBe(true);
  });

  it("itemized lines keep qty x rate, then overhead and profit", () => {
    const items: LineItemRow[] = [
      li({ kind: "contract_item", description: "Shingles", detail: "GAF HDZ", quantity: "32.500", rate_cents: 24500, amount_cents: 796250 }),
      li({ kind: "contract_item", description: "=cmd", quantity: "1.000", rate_cents: 100, amount_cents: 100, sort_order: 1 }),
    ];
    const invoice = inv({ customer_name: "Ann", subtotal_cents: 796350, overhead_percent: 10, overhead_cents: 79635, profit_percent: "12.50", profit_cents: 99544, contract_total_cents: 975529 });
    const rows = rowsOf(buildCsv([{ invoice, items }])).slice(1);
    expect(rows.map((r) => r.slice(col("ItemDescription")))).toEqual([
      ["Shingles - GAF HDZ", "32.5", "245.00", "7962.50"],
      ["'=cmd", "1", "1.00", "1.00"],
      ["Overhead (10%)", "1", "796.35", "796.35"],
      ["Profit (12.5%)", "1", "995.44", "995.44"],
    ]);
    const sum = rows.reduce((s, r) => s + Math.round(Number(r[col("ItemAmount")]) * 100), 0);
    expect(sum).toBe(975529);
  });

  it("uploaded invoice with unpriced lines: one priced row carrying the text", () => {
    const items: LineItemRow[] = [
      li({ kind: "contract_item", description: "Garage door wrapped" }),
      li({ kind: "contract_item", description: "Gutter covers replaced", sort_order: 1 }),
    ];
    const invoice = inv({ source: "uploaded", due_date: null, terms: null, contract_total_cents: 1349246, contract_date: null });
    const rows = rowsOf(buildCsv([{ invoice, items }])).slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0][col("DueDate")]).toBe("10/02/2026"); // QuickBooks requires one: falls back to the invoice date
    expect(rows[0][col("ItemDescription")]).toBe("Garage door wrapped; Gutter covers replaced; Contract total");
    expect(rows[0][col("ItemAmount")]).toBe("13492.46");
  });

  it("leaves out void invoices, ones already in QuickBooks, and non-QuickBooks terms", () => {
    const items = [li({ kind: "contract_item", description: "Roof", quantity: "1.000", rate_cents: 1845000, amount_cents: 1845000 })];
    const csv = buildCsv([
      { invoice: inv({ invoice_number: "A", status: "void" }), items },
      { invoice: inv({ invoice_number: "B", qb_invoice_id: "99" }), items },
      { invoice: inv({ invoice_number: "C", terms: "Net 45" }), items },
    ]);
    const rows = rowsOf(csv).slice(1);
    expect(rows.map((r) => r[0])).toEqual(["C"]);
    expect(rows[0][col("Terms")]).toBe("");
  });
});
