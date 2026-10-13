-- "manager" role: sees and edits ALL jobs (like an admin) but none of the
-- owner-only items: QuickBooks, profitability/commission, pricing settings and
-- deleting jobs. Used for Victor.

alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('admin', 'manager', 'rep'));

create or replace function public.sees_all_jobs()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select role in ('admin', 'manager') from public.staff where email = lower(auth.email())), false)
$$;

drop policy if exists "jobs: staff select" on public.jobs;
create policy "jobs: staff select" on public.jobs for select using (
  is_admin()
  or staff_role() = 'manager'
  or (staff_role() = 'rep' and (job_id = any (array[-1, -2]::bigint[]) or (data ->> 'assigned') = staff_name()))
);

drop policy if exists "jobs: staff insert" on public.jobs;
create policy "jobs: staff insert" on public.jobs for insert with check (
  is_admin()
  or (staff_role() = 'manager' and job_id > 0)
  or (staff_role() = 'rep' and job_id > 0 and (data ->> 'assigned') = staff_name())
);

drop policy if exists "jobs: staff update" on public.jobs;
create policy "jobs: staff update" on public.jobs for update
using (
  (job_id > 0 and (is_admin() or staff_role() = 'manager' or (staff_role() = 'rep' and (data ->> 'assigned') = staff_name())))
  or (job_id = any (array[-1, -2]::bigint[]) and is_owner())
  or (job_id = -3 and (is_admin() or staff_role() = 'manager'))
)
with check (
  (job_id > 0 and (is_admin() or staff_role() = 'manager' or (staff_role() = 'rep' and (data ->> 'assigned') = staff_name())))
  or (job_id = any (array[-1, -2]::bigint[]) and is_owner())
  or (job_id = -3 and (is_admin() or staff_role() = 'manager'))
);

-- Managers can read the staff roster (for the "Assigned To" list).
drop policy if exists "staff: read own row, admins read all" on public.staff;
create policy "staff: read own row, admins read all" on public.staff for select using (
  email = lower(auth.email()) or sees_all_jobs()
);

update public.staff set role = 'manager' where lower(name) = 'victor';

-- Scope Review documents + homeowner messages: managers too.
drop policy if exists "scope-documents: admin read" on storage.objects;
create policy "scope-documents: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'scope-documents' and sees_all_jobs());
drop policy if exists "scope-documents: admin upload" on storage.objects;
create policy "scope-documents: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'scope-documents' and sees_all_jobs());
drop policy if exists "messages: admin all" on public.messages;
create policy "messages: admin all" on public.messages for all using (sees_all_jobs()) with check (sees_all_jobs());
