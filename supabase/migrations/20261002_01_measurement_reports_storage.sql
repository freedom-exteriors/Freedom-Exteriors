-- EagleView (and other measurement) report PDFs, private, at <job_id>/<file>.pdf.
-- Same access rule as job photos: admins, or the rep the job is assigned to.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('measurement-reports', 'measurement-reports', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "measurement-reports: job staff read" on storage.objects;
create policy "measurement-reports: job staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'measurement-reports' and public.can_access_job(public.job_id_from_path(name)));

drop policy if exists "measurement-reports: job staff upload" on storage.objects;
create policy "measurement-reports: job staff upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'measurement-reports' and public.can_access_job(public.job_id_from_path(name)));

drop policy if exists "measurement-reports: job staff delete" on storage.objects;
create policy "measurement-reports: job staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'measurement-reports' and public.can_access_job(public.job_id_from_path(name)));
