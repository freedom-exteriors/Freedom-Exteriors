-- CRM hardening (applied 2026-09-30). End state of these migrations on the
-- live project: protect_portal_owned_job_fields, portal_privacy_and_photo_limits,
-- job_photos_storage, integration_tokens, protect_quickbooks_invoice_fields,
-- portal_photos_via_storage.

-- 1. Saves from a stale browser copy can't erase what the homeowner or the
--    server did. For app users (role "authenticated") this keeps:
--    * signature, deposit and QuickBooks-invoice fields once set
--    * every photo already on the job (a stale copy just adds its photos)
--    * the portal token
create or replace function public.jobs_preserve_portal_fields()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  k text;
  old_photos jsonb;
  new_photos jsonb;
begin
  if current_user <> 'authenticated' or new.job_id <= 0 or old.data is null then
    return new;
  end if;
  if new.data is null then new.data := '{}'::jsonb; end if;

  foreach k in array array['depositPaid','depositPaidAt','depositStripeSession','depositAmountPaid',
                           'portalSignature','portalSignatureImage','portalSignedAt',
                           'qbInvoiceId','qbInvoiceDocNumber','qbInvoicedAt'] loop
    if old.data ? k and old.data->k is not null and old.data->k not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb) then
      new.data := jsonb_set(new.data, array[k], old.data->k, true);
    end if;
  end loop;

  old_photos := case when jsonb_typeof(old.data->'photos') = 'array' then old.data->'photos' else '[]'::jsonb end;
  new_photos := case when jsonb_typeof(new.data->'photos') = 'array' then new.data->'photos' else '[]'::jsonb end;
  if jsonb_array_length(old_photos) > 0 then
    new.data := jsonb_set(new.data, '{photos}', new_photos || coalesce((
      select jsonb_agg(o order by ord)
        from jsonb_array_elements(old_photos) with ordinality as t(o, ord)
       where not exists (
         select 1 from jsonb_array_elements(new_photos) n
          where n->'id' = o->'id' or (o ? 'path' and n->'path' = o->'path'))
    ), '[]'::jsonb), true);
  end if;

  if new.portal_token is null and old.portal_token is not null then
    new.portal_token := old.portal_token;
  end if;
  if coalesce(new.data->>'portal_token', '') = '' and old.data->>'portal_token' is not null then
    new.data := jsonb_set(new.data, '{portal_token}', old.data->'portal_token', true);
  end if;
  return new;
end $$;

drop trigger if exists jobs_preserve_portal_fields on public.jobs;
create trigger jobs_preserve_portal_fields
  before update on public.jobs
  for each row execute function public.jobs_preserve_portal_fields();
revoke execute on function public.jobs_preserve_portal_fields() from public, anon, authenticated;

-- 2. A signed contract stays signed.
create or replace function public.portal_save_signature(p_token text, p_name text, p_image text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if coalesce(trim(p_name), '') = '' or p_image not like 'data:image/png;base64,%' or length(p_image) > 500000 then
    raise exception 'invalid signature';
  end if;
  update public.jobs
     set data = data || jsonb_build_object(
       'portalSignature', left(trim(p_name), 200),
       'portalSignatureImage', p_image,
       'portalSignedAt', to_jsonb(now()))
   where coalesce(p_token, '') <> '' and portal_token = p_token and job_id > 0
     and coalesce(data->>'portalSignature', '') = '';
  return public.portal_get_job(p_token);
end $function$;

-- 3. The portal only gets what the homeowner should see: no internal notes
--    (reps write `homeownerNote` for that), only the four estimate figures it
--    shows, and no photos (homeowner photos come from /api/portal-photos).
create or replace function public.portal_get_job(p_token text)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', j.data->'id', 'name', j.data->'name', 'address', j.data->'address', 'city', j.data->'city',
    'state', j.data->'state', 'type', j.data->'type', 'stage', j.data->'stage', 'assigned', j.data->'assigned',
    'insurer', j.data->'insurer', 'claimNum', j.data->'claimNum',
    'estimate', case when jsonb_typeof(j.data->'estimate') = 'object' then jsonb_build_object(
        'total', j.data->'estimate'->'total', 'downPayment', j.data->'estimate'->'downPayment',
        'deductible', j.data->'estimate'->'deductible', 'scope', j.data->'estimate'->'scope') end,
    'homeownerNote', nullif(j.data->>'homeownerNote', ''),
    'installDate', j.data->'installDate', 'added', j.data->'added',
    'depositPaid', j.data->'depositPaid', 'depositPaidAt', j.data->'depositPaidAt',
    'portalSignature', j.data->'portalSignature', 'portalSignatureImage', j.data->'portalSignatureImage',
    'portalSignedAt', j.data->'portalSignedAt',
    'scopeReviewSummary', (
      select jsonb_build_object('text', r->'homeownerSummary', 'date', r->'createdAt')
        from jsonb_array_elements(
               case when jsonb_typeof(j.data->'scopeReviews') = 'array' then j.data->'scopeReviews' else '[]'::jsonb end
             ) r
       where r->>'shareSummaryWithHomeowner' = 'true'
         and coalesce(r->>'homeownerSummary', '') <> ''
       order by r->>'createdAt' desc
       limit 1)
  ))
  from public.jobs j
  where coalesce(p_token, '') <> '' and j.portal_token = p_token and j.job_id > 0
  limit 1
$function$;

-- The old base64 upload path is closed; uploads go through /api/portal-photos.
revoke execute on function public.portal_add_photos(text, jsonb) from public, anon, authenticated;

-- 4. Job photos: private bucket at <job_id>/<file>; job rows hold {id, path, name, cat, added}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_job(p_job_id bigint)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select p_job_id > 0 and (
    public.is_admin()
    or (public.staff_role() = 'rep' and exists (
          select 1 from public.jobs j where j.job_id = p_job_id and j.data->>'assigned' = public.staff_name())))
$$;
revoke execute on function public.can_access_job(bigint) from public, anon;
grant execute on function public.can_access_job(bigint) to authenticated;

create or replace function public.job_id_from_path(p_name text)
returns bigint
language sql
immutable
set search_path to ''
as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9]{1,18}$' then split_part(p_name, '/', 1)::bigint end
$$;

drop policy if exists "job-photos: staff read" on storage.objects;
drop policy if exists "job-photos: staff upload" on storage.objects;
drop policy if exists "job-photos: admin delete" on storage.objects;
create policy "job-photos: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and public.can_access_job(public.job_id_from_path(name)));
create policy "job-photos: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.can_access_job(public.job_id_from_path(name)));
create policy "job-photos: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and public.is_admin());

create or replace function public.portal_record_photo(p_token text, p_photo jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_count int;
begin
  if coalesce(p_photo->>'path', '') = '' then raise exception 'missing path'; end if;
  select count(*) into v_count
    from public.jobs j, jsonb_array_elements(case when jsonb_typeof(j.data->'photos') = 'array' then j.data->'photos' else '[]'::jsonb end) ph
   where coalesce(p_token, '') <> '' and j.portal_token = p_token and j.job_id > 0 and ph->>'cat' = 'Homeowner Upload';
  if v_count >= 60 then raise exception 'Photo limit reached for this project'; end if;
  update public.jobs
     set data = jsonb_set(data, '{photos}', coalesce(data->'photos', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
       'id', coalesce(p_photo->>'id', gen_random_uuid()::text),
       'path', p_photo->>'path',
       'name', left(coalesce(p_photo->>'name', 'photo'), 200),
       'cat', 'Homeowner Upload',
       'added', left(coalesce(p_photo->>'added', ''), 40))))
   where coalesce(p_token, '') <> '' and portal_token = p_token and job_id > 0;
  return public.portal_get_job(p_token);
end $$;
revoke execute on function public.portal_record_photo(text, jsonb) from public, anon, authenticated;
grant execute on function public.portal_record_photo(text, jsonb) to service_role;

create or replace function public.portal_job_id(p_token text)
returns bigint
language sql
stable security definer
set search_path to ''
as $$
  select job_id from public.jobs where coalesce(p_token, '') <> '' and portal_token = p_token and job_id > 0 limit 1
$$;
revoke execute on function public.portal_job_id(text) from public, anon, authenticated;
grant execute on function public.portal_job_id(text) to service_role;

-- Homeowner photos in the portal are read with the job's own id, so the server
-- route needs the photo list; this returns only the homeowner's uploads.
create or replace function public.portal_homeowner_photos(p_token text)
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(ph), '[]'::jsonb)
    from public.jobs j,
         jsonb_array_elements(case when jsonb_typeof(j.data->'photos') = 'array' then j.data->'photos' else '[]'::jsonb end) ph
   where coalesce(p_token, '') <> '' and j.portal_token = p_token and j.job_id > 0
     and ph->>'cat' = 'Homeowner Upload'
$$;
revoke execute on function public.portal_homeowner_photos(text) from public, anon, authenticated;
grant execute on function public.portal_homeowner_photos(text) to service_role;

-- 5. QuickBooks / Hover tokens and OAuth state: server only (RLS on, no policies).
create table if not exists public.integration_tokens (
  provider text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from anon, authenticated;

insert into public.integration_tokens (provider, data)
select 'hover', data from public.jobs where user_email = 'hover_token' and data ? 'access_token'
limit 1
on conflict (provider) do nothing;
delete from public.jobs where user_email = 'hover_token';
