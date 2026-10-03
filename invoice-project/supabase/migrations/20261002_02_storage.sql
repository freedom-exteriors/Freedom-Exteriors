-- One PRIVATE bucket for generated .docx files, uploaded originals, and the
-- raw Claude extraction responses kept for auditing.
-- No storage policies are created, so only the service role can read or
-- write. Files are handed out through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoice-files',
  'invoice-files',
  false,
  20971520, -- 20 MB
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/json' -- extraction audit records
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
