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
| `customer_phone` | (not exported) | Map to the QuickBooks customer record if needed. |
| `contract_date` | (in the description) | Shown as "Contract total (agreement dated MM/DD/YYYY)". |
| `contract_total_cents` | Amount on the "Contract total" row | Generated invoices only (uploaded ones export their own line items). |
| `deposits_total_cents`, `change_orders_total_cents` | (sum of rows) | Exported as their individual rows below. |
| `paid_date` | (not exported) | Record the payment in QuickBooks with this date. |
| `id`, `invoice_number_source`, `document_invoice_number`, `duplicate_number_flag`, `source`, `original_file_path`, `generated_file_path`, `extraction_json`, `extraction_raw_response`, `extraction_warnings`, `created_at`, `updated_at` | (not exported) | Internal bookkeeping and audit trail. |

## `invoice_line_items` table → Item/Description + Amount

| `kind` | Exported as | Amount |
| --- | --- | --- |
| `scope` | not exported (scope bullets have no price) | - |
| `contract_item` | its own row (uploaded invoices), description as read | `amount_cents` ÷ 100 |
| `change_order` | `Change order: <description>` | `amount_cents` ÷ 100 |
| `deposit` | `Deposit received MM/DD/YYYY - <description>` | **negative** `amount_cents` ÷ 100 |

Because deposits are negative rows, the Amount column of an invoice's rows adds up to its balance due.

**Decision for later:** if you'd rather record deposits in QuickBooks as *payments* (the more
standard way), filter out the `Deposit received` rows before importing. Then the QuickBooks invoice
total equals contract total + change orders, and each deposit gets entered as a payment against it.

`line_date` is used only in the deposit description. `sort_order` keeps rows in the order you entered them.

## `invoice_counters` table

Not exported. `(year, last_number)` holds the last FE-INV number handed out for each calendar year.
