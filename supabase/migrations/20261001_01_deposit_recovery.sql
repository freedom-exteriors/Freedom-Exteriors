-- Deposits (applied 2026-10-01 as deposit_pending_session).
-- The checkout a homeowner starts is remembered so the payment is recorded even
-- if they close the tab before Stripe sends them back. Server routes only.
create or replace function public.portal_set_pending_deposit(p_token text, p_session_id text)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.jobs
     set data = data || jsonb_build_object('depositPendingSession', p_session_id, 'depositPendingAt', to_jsonb(now()))
   where coalesce(p_token, '') <> '' and portal_token = p_token and job_id > 0
     and coalesce((data->>'depositPaid')::boolean, false) = false
$$;
revoke execute on function public.portal_set_pending_deposit(text, text) from public, anon, authenticated;
grant execute on function public.portal_set_pending_deposit(text, text) to service_role;

create or replace function public.portal_pending_deposit(p_token text)
returns text
language sql
stable security definer
set search_path to ''
as $$
  select data->>'depositPendingSession' from public.jobs
   where coalesce(p_token, '') <> '' and portal_token = p_token and job_id > 0
     and coalesce((data->>'depositPaid')::boolean, false) = false
   limit 1
$$;
revoke execute on function public.portal_pending_deposit(text) from public, anon, authenticated;
grant execute on function public.portal_pending_deposit(text) to service_role;

-- Only the server (after checking with Stripe) may mark a deposit paid.
revoke execute on function public.mark_deposit_paid(text, text, numeric) from public, anon, authenticated;
grant execute on function public.mark_deposit_paid(text, text, numeric) to service_role;

-- jobs_preserve_portal_fields() now also keeps depositPendingSession and
-- depositPendingAt (see 20260930_01_crm_hardening.sql for the function body;
-- the key list there is extended with those two keys).
