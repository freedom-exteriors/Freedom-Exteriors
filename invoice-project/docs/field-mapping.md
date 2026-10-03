# Field mapping: database → QuickBooks invoice import

The CSV export (`Export CSV` on the catalog) produces one row per line item, with the invoice-level
fields repeated on every row, which is the layout QuickBooks Online's invoice import expects.
Dates are `MM/DD/YYYY`. Amounts are plain numbers (`1234.56`).

## `invoices` table

| Database column | QuickBooks column | Notes |
| --- | --- | --- |
| `customer_name` | **Customer** | Must match (or will create) a QuickBooks customer. |
| `invoice_number` | **Invoice No.** | `FE-INV-YYYY-###`, or the number printed on an uploaded document. |
| `invoice_date` | **Invoice Date** | |
| `due_date` | **Due Date** | |
| `terms` | **Terms** | Worked out from the dates: `Net 30`, `Net 15`, `Due on receipt`. |
| `balance_due_cents` | **Balance** | Cents ÷ 100. Repeated on every row of the invoice. |
| `job_address` | **Memo** | |
| `status` | **Status** | `Outstanding` / `Paid` / `Void`. Not a standard QuickBooks import column; delete it before importing if QuickBooks complains. |
| `customer_phone`, `customer_address` | (not exported) | Map to the QuickBooks customer record (phone, billing address) if needed. |
| `subtitle`, `tag`, `payment_terms` | (not exported) | Printed on the invoice only. QuickBooks has a "Message on invoice" field if you want `payment_terms` there later. |
| `contract_date` | (in the description) | Shown as "Contract total (agreement dated MM/DD/YYYY)" when there are no cost lines. |
| `subtotal_cents` | (sum of cost-line rows) | |
| `overhead_percent`, `overhead_cents` | an `Overhead (10%)` row, Amount = `overhead_cents` | Only when overhead is used. |
| `profit_percent`, `profit_cents` | a `Profit (10%)` row, Amount = `profit_cents` | Only when profit is used. |
| `contract_total_cents` | (sum of the rows above) | Subtotal + overhead + profit. If an invoice has no cost lines (some uploads), one "Contract total" row carries it instead. |
| `deposits_total_cents`, `change_orders_total_cents` | (sum of rows) | Exported as their individual rows below. |
| `paid_date` | (not exported) | Record the payment in QuickBooks with this date. |
| `id`, `invoice_number_source`, `document_invoice_number`, `duplicate_number_flag`, `source`, `original_file_path`, `generated_file_path`, `extraction_json`, `extraction_raw_response`, `extraction_warnings`, `created_at`, `updated_at` | (not exported) | Internal bookkeeping and audit trail. |

## `invoice_line_items` table → Item/Description + Amount

| `kind` | Exported as | Amount |
| --- | --- | --- |
| `scope` | not exported (scope bullets have no price) | - |
| `contract_item` (cost line) | its own row. Item/Description = `description` + " - " + `detail`; **Qty** = `quantity`; **Rate** = `rate_cents` ÷ 100 | `amount_cents` ÷ 100 (= qty × rate, calculated by the server in integer cents, rounded half-up) |
| `change_order` | `Change order: <description>` | `amount_cents` ÷ 100 |
| `deposit` | `Deposit received MM/DD/YYYY - <description>` | **negative** `amount_cents` ÷ 100 |

Because deposits are negative rows, the Amount column of an invoice's rows adds up to its balance due.
Qty and Rate are blank on overhead, profit, change-order and deposit rows, and on uploaded lines whose
document showed only an amount.

**Decision for later:** if you'd rather record deposits in QuickBooks as *payments* (the more
standard way), filter out the `Deposit received` rows before importing. Then the QuickBooks invoice
total equals contract total + change orders, and each deposit gets entered as a payment against it.

CSV column order: Customer, Invoice No., Invoice Date, Due Date, Terms, Item/Description, Qty, Rate, Amount, Balance, Memo, Status.

`line_date` is used only in the deposit description. `sort_order` keeps rows in the order you entered them.

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
