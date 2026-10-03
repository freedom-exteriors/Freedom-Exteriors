# Field mapping: database → QuickBooks

There are two ways into QuickBooks Online, and both use the same lines (`src/lib/qbLines.ts`):

1. **Send to QuickBooks** on an invoice (recommended): goes through the CRM's QuickBooks connection.
2. **Export CSV (QuickBooks import)** on the catalog: a file for QuickBooks' *Import data → Invoices*.

## Lines

| Invoice | QuickBooks line | Amount |
| --- | --- | --- |
| Cost lines, when they (plus overhead and profit) add up to the contract total | one line each: description (+ " - " + detail), Qty, Rate | `amount_cents` ÷ 100 |
| Overhead / profit | `Overhead (10%)`, `Profit (12.5%)` | `overhead_cents`, `profit_cents` |
| Cost lines that **don't** add up (e.g. an uploaded invoice whose lines have no prices) | text-only lines, then one `Contract total (agreement dated …)` line | contract total |
| Change orders | `Change order: <description>` | `amount_cents` |
| Scope bullets | not sent (printed on the PDF/.docx only) | - |
| **Deposits** | **not lines**: each becomes a QuickBooks **payment** (Send) or must be entered as a payment by hand (CSV) | - |

So the QuickBooks invoice total is contract total + change orders, and after the deposits are
applied its balance equals our balance due. QuickBooks' import rejects negative lines, which is why
deposits are payments rather than negative lines.

Qty × Rate is only sent when it equals the amount to the cent (QuickBooks rejects a mismatch);
otherwise the line is Qty 1 × the amount. Every line is filed under the service item
**Exterior Services**.

## Send to QuickBooks

| Invoice field | QuickBooks |
| --- | --- |
| `invoice_number` | Invoice no. (`DocNumber`, max 21 characters) |
| `customer_name`, `customer_email`, `customer_phone`, `customer_address` (or `job_address`) | Customer (found by exact name, else created); email also goes on the invoice |
| `invoice_date` / `due_date` | Invoice date / due date (due date falls back to the invoice date) |
| `job_address` | Private note: "From the invoice tool… Job site: …" |
| deposits (`line_date`, `amount_cents`, `description`) | Payments applied to the invoice (no date: the invoice date) |
| status Paid | also a final payment for `balance_due_cents` on `paid_date` |
| result | saved as `qb_invoice_id`, `qb_doc_number`, `qb_link`, `qb_sent_at`; the CRM job gets `qbInvoiceId` |

## CSV columns (QuickBooks' sample-file names)

`InvoiceNo, Customer, InvoiceDate, DueDate, Terms, Memo, Item(Product/Service), ItemDescription,
ItemQuantity, ItemRate, ItemAmount`. Dates `MM/DD/YYYY`; amounts plain (`1234.56`); every row has
an amount (text-only lines are folded into the next priced line's description). `Terms` only when
it's one of QuickBooks' own (Due on receipt, Net 15, Net 30, Net 60). Left out: void invoices,
invoices already in QuickBooks, and invoices with no total. QuickBooks imports at most 100 invoices
per file, and imports every invoice as **unpaid**: record deposits and payments in QuickBooks
afterwards, or use Send to QuickBooks instead.

## `invoice_counters` table

Not exported. `(year, last_number)` holds the last FE-INV number handed out for each calendar year.

## Estimates (`estimates` table)

| Screen field | Column | Notes |
| --- | --- | --- |
| Estimate # | `estimate_number` | FE-EST-YYYY-###, from `next_estimate_number(year)` |
| Customer, phone, mailing address, job site, subtitle, tag | same names as invoices | |
| Estimate date | `estimate_date` | |
| Valid for (days) | `valid_days` | 1–365, default 30; printed as "Valid For" |
| Scope of work | `scope_text` | one bullet per line |
| Lines | `items` (jsonb) | `{description, detail, quantity_milli, unit, rate_cents, amount_cents, price_book_item_id}`; amount computed by the server |
| Overhead % / Profit % | `overhead_percent`, `profit_percent` | amounts in `overhead_cents`, `profit_cents` |
| Total estimate | `total_cents` | subtotal + overhead + profit |
| Status | `status` | draft / sent / accepted / declined / void |
| Made into invoice | `invoice_id`, `accepted_date` | set by "Make invoice" → Create |

Estimates are not part of the QuickBooks CSV export; only invoices are.
