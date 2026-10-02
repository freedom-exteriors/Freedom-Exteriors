-- Invoice Project schema.
-- Every table has Row Level Security ON and NO policies, so the anon and
-- authenticated keys can read/write nothing. Only the server (service role,
-- which bypasses RLS) touches this data.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- counters
create table if not exists public.invoice_counters (
  year        integer primary key check (year between 2000 and 2999),
  last_number integer not null check (last_number >= 0)
);

-- ---------------------------------------------------------------- invoices
create table if not exists public.invoices (
  id                        uuid primary key default gen_random_uuid(),
  invoice_number            text not null,
  invoice_number_source     text not null default 'assigned'
                              check (invoice_number_source in ('assigned', 'from_document')),
  -- Exactly as printed on an uploaded document (null for generated invoices).
  document_invoice_number   text,
  duplicate_number_flag     boolean not null default false,
  customer_name             text not null,
  customer_phone            text,
  job_address               text,
  contract_date             date,
  invoice_date              date not null,
  due_date                  date,
  terms                     text,
  contract_total_cents      bigint not null default 0,
  deposits_total_cents      bigint not null default 0,
  change_orders_total_cents bigint not null default 0,
  balance_due_cents         bigint not null default 0,
  status                    text not null default 'outstanding'
                              check (status in ('outstanding', 'paid', 'void')),
  paid_date                 date,
  source                    text not null check (source in ('generated', 'uploaded')),
  original_file_path        text,
  generated_file_path       text,
  extraction_json           jsonb,
  extraction_raw_response   jsonb,
  extraction_warnings       jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint invoices_invoice_number_key unique (invoice_number),
  constraint invoices_paid_date_matches_status
    check ((status = 'paid') = (paid_date is not null))
);

-- ------------------------------------------------------------- line items
create table if not exists public.invoice_line_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  kind         text not null check (kind in ('scope', 'deposit', 'change_order', 'contract_item')),
  description  text not null default '',
  amount_cents bigint,
  line_date    date,
  sort_order   integer not null default 0
);

-- ----------------------------------------------------- login rate limiting
create table if not exists public.login_attempts (
  id           bigint generated always as identity primary key,
  ip           text not null,
  attempted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index if not exists invoices_customer_name_trgm on public.invoices using gin (customer_name gin_trgm_ops);
create index if not exists invoices_job_address_trgm   on public.invoices using gin (job_address gin_trgm_ops);
create index if not exists invoices_number_trgm        on public.invoices using gin (invoice_number gin_trgm_ops);
create index if not exists invoices_invoice_date_idx   on public.invoices (invoice_date desc);
create index if not exists invoices_status_idx         on public.invoices (status);
create index if not exists invoices_customer_lower_idx on public.invoices (lower(customer_name));
create index if not exists invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, kind, sort_order);
create index if not exists login_attempts_ip_time_idx  on public.login_attempts (ip, attempted_at desc);

-- ------------------------------------------------------- updated_at stamp
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- Invoices are never hard-deleted: a deleted row would hide which numbers
-- were used. Use status = 'void' instead.
create or replace function public.block_invoice_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Invoices cannot be deleted. Set status to void instead.';
end $$;

drop trigger if exists invoices_block_delete on public.invoices;
create trigger invoices_block_delete before delete on public.invoices
  for each row execute function public.block_invoice_delete();

-- ------------------------------------------------------ numbering function
-- Atomically takes the next number for a year. INSERT ... ON CONFLICT DO
-- UPDATE locks the counter row, so concurrent callers queue up and each gets
-- a different, consecutive number.
create or replace function public.next_invoice_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.invoice_counters as c (year, last_number)
  values (p_year, 1)
  on conflict (year) do update set last_number = c.last_number + 1
  returning c.last_number into n;

  -- lpad() truncates longer strings, so only pad numbers below 1000.
  return 'FE-INV-' || p_year::text || '-' ||
         case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
end $$;

-- When an uploaded document already carries one of OUR numbers
-- (FE-INV-YYYY-NNN), move the counter past it so the generator never hands
-- the same number out later.
create or replace function public.bump_invoice_counter(p_year integer, p_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_counters as c (year, last_number)
  values (p_year, p_number)
  on conflict (year) do update set last_number = greatest(c.last_number, excluded.last_number);
end $$;

-- Login rate limiting: count recent failed attempts for an IP.
create or replace function public.recent_login_failures(p_ip text, p_minutes integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.login_attempts
  where ip = p_ip and attempted_at > now() - make_interval(mins => p_minutes);
$$;

-- ------------------------------------------------------------------- RLS
alter table public.invoices           enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_counters   enable row level security;
alter table public.login_attempts     enable row level security;

revoke all on public.invoices, public.invoice_line_items, public.invoice_counters, public.login_attempts
  from anon, authenticated;

revoke all on function public.next_invoice_number(integer) from public, anon, authenticated;
revoke all on function public.bump_invoice_counter(integer, integer) from public, anon, authenticated;
revoke all on function public.recent_login_failures(text, integer) from public, anon, authenticated;
grant execute on function public.next_invoice_number(integer) to service_role;
grant execute on function public.bump_invoice_counter(integer, integer) to service_role;
grant execute on function public.recent_login_failures(text, integer) to service_role;

-- ------------------------------------------------- atomic save (one txn)
-- Inserts (p_id null) or updates an invoice and REPLACES its line items in a
-- single transaction, so a half-saved invoice can't exist. Only whitelisted
-- columns are written; invoice_number, source and the file paths are set on
-- insert and never changed by an edit.
create or replace function public.save_invoice(p_id uuid, p_invoice jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.invoices;
  v_id uuid;
begin
  r := jsonb_populate_record(null::public.invoices, p_invoice);

  if p_id is null then
    insert into public.invoices (
      invoice_number, invoice_number_source, document_invoice_number, duplicate_number_flag,
      customer_name, customer_phone, job_address, contract_date, invoice_date, due_date, terms,
      contract_total_cents, deposits_total_cents, change_orders_total_cents, balance_due_cents,
      status, paid_date, source, original_file_path, generated_file_path,
      extraction_json, extraction_raw_response, extraction_warnings)
    values (
      r.invoice_number, coalesce(r.invoice_number_source, 'assigned'), r.document_invoice_number,
      coalesce(r.duplicate_number_flag, false),
      r.customer_name, r.customer_phone, r.job_address, r.contract_date, r.invoice_date, r.due_date, r.terms,
      coalesce(r.contract_total_cents, 0), coalesce(r.deposits_total_cents, 0),
      coalesce(r.change_orders_total_cents, 0), coalesce(r.balance_due_cents, 0),
      coalesce(r.status, 'outstanding'), r.paid_date, r.source, r.original_file_path, r.generated_file_path,
      r.extraction_json, r.extraction_raw_response, r.extraction_warnings)
    returning id into v_id;
  else
    update public.invoices set
      customer_name = r.customer_name,
      customer_phone = r.customer_phone,
      job_address = r.job_address,
      contract_date = r.contract_date,
      invoice_date = r.invoice_date,
      due_date = r.due_date,
      terms = r.terms,
      contract_total_cents = coalesce(r.contract_total_cents, 0),
      deposits_total_cents = coalesce(r.deposits_total_cents, 0),
      change_orders_total_cents = coalesce(r.change_orders_total_cents, 0),
      balance_due_cents = coalesce(r.balance_due_cents, 0)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Invoice % not found', p_id;
    end if;
    delete from public.invoice_line_items where invoice_id = v_id;
  end if;

  insert into public.invoice_line_items (invoice_id, kind, description, amount_cents, line_date, sort_order)
  select v_id, i.kind, coalesce(i.description, ''), i.amount_cents, i.line_date, coalesce(i.sort_order, 0)
  from jsonb_populate_recordset(null::public.invoice_line_items, coalesce(p_items, '[]'::jsonb)) i;

  return v_id;
end $$;

revoke all on function public.save_invoice(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_invoice(uuid, jsonb, jsonb) to service_role;
