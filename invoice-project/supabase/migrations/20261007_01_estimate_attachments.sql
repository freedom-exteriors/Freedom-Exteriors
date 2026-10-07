-- Photos and files attached to an estimate (insurance scopes, measurement
-- reports, damage photos, notes). Each entry is
--   { "uploadId": uuid, "ext": "pdf"|"png"|"jpg"|"docx", "fileName": text }
-- and the file itself is in the private bucket at originals/<uploadId>/original.<ext>,
-- the same place invoice uploads go.
alter table public.estimates
  add column if not exists attachments jsonb not null default '[]'::jsonb;
