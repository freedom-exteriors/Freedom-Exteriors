-- Links to the CRM and QuickBooks.
--   crm_job_id     the CRM job (jobs.job_id in the CRM's database) this came from
--   customer_email used for the QuickBooks customer and the Email PDF message
--   qb_*           set once an invoice is in QuickBooks; it's then locked here
alter table public.invoices
  add column if not exists crm_job_id bigint,
  add column if not exists customer_email text,
  add column if not exists qb_invoice_id text,
  add column if not exists qb_doc_number text,
  add column if not exists qb_link text,
  add column if not exists qb_sent_at timestamptz;

alter table public.estimates
  add column if not exists crm_job_id bigint,
  add column if not exists customer_email text;

create index if not exists invoices_crm_job_idx on public.invoices (crm_job_id) where crm_job_id is not null;
create index if not exists estimates_crm_job_idx on public.estimates (crm_job_id) where crm_job_id is not null;
