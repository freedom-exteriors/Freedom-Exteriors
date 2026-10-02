import { describe, expect, it } from "vitest";
import { buildCsv, csvCell } from "@/lib/csv";
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
  job_address: "123 Oak St, Stillwater, MN", contract_date: "2026-08-14", invoice_date: "2026-10-02",
  due_date: "2026-11-01", terms: "Net 30", contract_total_cents: 1845000, deposits_total_cents: 615000,
  change_orders_total_cents: 38000, balance_due_cents: 1268000, status: "outstanding", paid_date: null,
  source: "generated", original_file_path: null, generated_file_path: null, extraction_json: null,
  extraction_warnings: null, created_at: "", updated_at: "", ...over,
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

describe("buildCsv", () => {
  it("one row per line item, invoice fields repeated, MM/DD/YYYY", () => {
    const items: LineItemRow[] = [
      { kind: "scope", description: "Tear off", amount_cents: null, line_date: null, sort_order: 0 },
      { kind: "deposit", description: "At signing", amount_cents: 615000, line_date: "2026-08-14", sort_order: 0 },
      { kind: "change_order", description: "Decking", amount_cents: 38000, line_date: null, sort_order: 0 },
    ];
    const csv = buildCsv([{ invoice: inv(), items }]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Customer,Invoice No.,Invoice Date,Due Date,Terms,Item/Description,Amount,Balance,Memo,Status");
    expect(lines).toHaveLength(4); // header + contract + change order + deposit (scope is not billed)
    expect(lines[1]).toBe(`"'=HYPERLINK(""evil"")",FE-INV-2026-001,10/02/2026,11/01/2026,Net 30,Contract total (agreement dated 08/14/2026),18450.00,12680.00,"123 Oak St, Stillwater, MN",Outstanding`);
    expect(lines[2]).toContain("Change order: Decking,380.00");
    expect(lines[3]).toContain("Deposit received 08/14/2026 - At signing,-6150.00");
    // Amounts on an invoice sum to its balance.
    const sum = lines.slice(1).map((l) => Number(parseLine(l)[6])).reduce((a, b) => a + b, 0);
    expect(sum.toFixed(2)).toBe("12680.00");
  });
  it("uploaded invoices export their own line items", () => {
    const items: LineItemRow[] = [
      { kind: "contract_item", description: "Roof", amount_cents: 1000000, line_date: null, sort_order: 0 },
      { kind: "contract_item", description: "Gutters", amount_cents: 200000, line_date: null, sort_order: 1 },
    ];
    const csv = buildCsv([{ invoice: inv({ source: "uploaded", customer_name: "Bob" }), items }]);
    expect(csv).toContain("Bob,FE-INV-2026-001,10/02/2026,11/01/2026,Net 30,Roof,10000.00");
    expect(csv).toContain(",Gutters,2000.00");
  });
});
