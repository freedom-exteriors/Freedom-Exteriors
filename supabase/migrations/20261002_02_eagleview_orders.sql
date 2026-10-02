-- EagleView orders placed from the CRM (applied 2026-10-02).
--
-- Orders live in their own table, not in jobs.data, so a stale browser copy of
-- a job can't wipe one out. Only the server (service role) writes here; staff
-- can read orders for jobs they can see.
create table if not exists public.eagleview_orders (
  report_id     bigint primary key,
  order_id      bigint not null,
  job_id        bigint not null,
  reference_id  text not null,
  env           text not null default 'sandbox',
  product_id    int not null,
  product_name  text,
  quoted_price  numeric,
  status_id     int,
  sub_status_id int,
  status        text,
  placed_by     text,
  placed_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  imported_at   timestamptz,
  pdf_path      text,
  last_error    text
);
create index if not exists eagleview_orders_job_idx on public.eagleview_orders (job_id);
create index if not exists eagleview_orders_ref_idx on public.eagleview_orders (reference_id);

alter table public.eagleview_orders enable row level security;
drop policy if exists "eagleview_orders: staff select" on public.eagleview_orders;
create policy "eagleview_orders: staff select" on public.eagleview_orders
  for select to authenticated using (public.can_access_job(job_id));
revoke all on public.eagleview_orders from anon;
revoke insert, update, delete, truncate, references, trigger on public.eagleview_orders from authenticated;

-- Sets one top-level key of a job's data without touching the rest, so the
-- server can save measurements without overwriting edits made meanwhile.
create or replace function public.jobs_set_data_key(p_job_id bigint, p_key text, p_value jsonb)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.jobs
     set data = jsonb_set(coalesce(data, '{}'::jsonb), array[p_key], p_value, true)
   where job_id = p_job_id and p_job_id > 0;
$$;
revoke execute on function public.jobs_set_data_key(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.jobs_set_data_key(bigint, text, jsonb) to service_role;
