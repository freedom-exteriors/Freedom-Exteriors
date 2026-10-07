-- Old estimates (from before this tool) uploaded and read by Claude, so the
-- ones still out with customers can be tracked here.
--   source                    'built' here, or 'uploaded' from an old document
--   document_estimate_number  the number printed on the old document, if any
--   original_file_path        the uploaded original in the private bucket
--   extraction_json           what Claude read (for auditing)
alter table public.estimates
  add column if not exists source text not null default 'built' check (source in ('built', 'uploaded')),
  add column if not exists document_estimate_number text,
  add column if not exists original_file_path text,
  add column if not exists extraction_json jsonb;

create unique index if not exists estimates_original_file_path_key
  on public.estimates (original_file_path) where original_file_path is not null;

-- If an old document carries one of OUR numbers (FE-EST-YYYY-###), move the
-- counter past it so a new estimate can never reuse it.
create or replace function public.bump_estimate_counter(p_year integer, p_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.estimate_counters as c (year, last_number)
  values (p_year, p_number)
  on conflict (year) do update set last_number = greatest(c.last_number, excluded.last_number);
end $$;

revoke all on function public.bump_estimate_counter(integer, integer) from public, anon, authenticated;
grant execute on function public.bump_estimate_counter(integer, integer) to service_role;
