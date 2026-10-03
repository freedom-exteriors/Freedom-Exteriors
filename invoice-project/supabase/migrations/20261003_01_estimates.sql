-- Estimates and the price book.
-- Same rules as invoices: RLS on with NO policies (server-only access),
-- numbers from an atomic counter, and estimates are voided, never deleted.

-- ------------------------------------------------------------- counters
create table if not exists public.estimate_counters (
  year        integer primary key check (year between 2000 and 2999),
  last_number integer not null check (last_number >= 0)
);

create or replace function public.next_estimate_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.estimate_counters as c (year, last_number)
  values (p_year, 1)
  on conflict (year) do update set last_number = c.last_number + 1
  returning c.last_number into n;

  -- lpad() truncates longer strings, so only pad numbers below 1000.
  return 'FE-EST-' || p_year::text || '-' ||
         case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
end $$;

-- ------------------------------------------------------------ estimates
create table if not exists public.estimates (
  id                 uuid primary key default gen_random_uuid(),
  estimate_number    text not null,
  status             text not null default 'draft'
                       check (status in ('draft', 'sent', 'accepted', 'declined', 'void')),
  customer_name      text not null,
  customer_phone     text,
  customer_address   text,
  job_address        text,
  subtitle           text,
  tag                text,
  estimate_date      date not null,
  valid_days         integer not null default 30 check (valid_days between 1 and 365),
  scope_text         text,
  payment_terms      text,
  -- Priced lines: [{description, detail, quantity, rate_cents, amount_cents,
  -- price_book_item_id}]. Amounts are computed by the server (qty x rate).
  items              jsonb not null default '[]'::jsonb,
  subtotal_cents     bigint not null default 0,
  overhead_percent   numeric(5,2),
  overhead_cents     bigint not null default 0,
  profit_percent     numeric(5,2),
  profit_cents       bigint not null default 0,
  total_cents        bigint not null default 0,
  invoice_id         uuid references public.invoices(id),
  accepted_date      date,
  generated_file_path text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint estimates_estimate_number_key unique (estimate_number)
);

create index if not exists estimates_customer_name_trgm on public.estimates using gin (customer_name extensions.gin_trgm_ops);
create index if not exists estimates_job_address_trgm   on public.estimates using gin (job_address extensions.gin_trgm_ops);
create index if not exists estimates_number_trgm        on public.estimates using gin (estimate_number extensions.gin_trgm_ops);
create index if not exists estimates_date_idx           on public.estimates (estimate_date desc);
create index if not exists estimates_status_idx         on public.estimates (status);

create or replace trigger estimates_set_updated_at before update on public.estimates
  for each row execute function public.set_updated_at();

create or replace function public.block_estimate_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Estimates cannot be deleted. Set status to void instead.';
end $$;

create or replace trigger estimates_block_delete before delete on public.estimates
  for each row execute function public.block_estimate_delete();

-- ----------------------------------------------------------- price book
-- One row per check box in the estimate builder. rate_cents null = no
-- standard price yet (typed per estimate). Retire items with active = false.
create table if not exists public.price_book_items (
  id               uuid primary key default gen_random_uuid(),
  trade            text not null,
  label            text not null,
  description      text not null,
  detail           text,
  unit             text not null default 'ea',
  default_quantity numeric(12,3) not null default 1,
  rate_cents       bigint check (rate_cents is null or rate_cents >= 0),
  sort_order       integer not null default 0,
  active           boolean not null default true,
  source_note      text,
  updated_at       timestamptz not null default now()
);

create index if not exists price_book_items_trade_idx on public.price_book_items (trade, sort_order);

create or replace trigger price_book_items_set_updated_at before update on public.price_book_items
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ RLS
alter table public.estimate_counters enable row level security;
alter table public.estimates         enable row level security;
alter table public.price_book_items  enable row level security;

revoke all on public.estimate_counters, public.estimates, public.price_book_items from anon, authenticated;
revoke all on function public.next_estimate_number(integer) from public, anon, authenticated;
grant execute on function public.next_estimate_number(integer) to service_role;

-- ----------------------------------------------------------- seed items
-- Prices ONLY where Nick's own documents give one:
--   'Pearson estimate'   = reference/Freedom_Exteriors_Estimate_Pearson.docx
--   'CRM Good/Better/Best' = the CRM's default $/square tiers
-- Everything else starts blank (null) for Nick to fill in on the Price book page.
insert into public.price_book_items (trade, sort_order, label, description, detail, unit, default_quantity, rate_cents, source_note)
select * from (values
  -- Roofing
  ('Roofing', 10, 'Roof replacement — Good tier', 'Roof Replacement — Architectural Shingles (Good)', 'Tear off existing roof, install ice & water shield, synthetic underlayment, drip edge and new shingles; magnetic sweep and cleanup.', 'sq', 1.000, 65000::bigint, 'CRM Good/Better/Best (standard pitch, 1 story)'),
  ('Roofing', 20, 'Roof replacement — Better tier', 'Roof Replacement — Architectural Shingles (Better)', 'Tear off existing roof, install ice & water shield, synthetic underlayment, drip edge and new shingles; magnetic sweep and cleanup.', 'sq', 1.000, 75000, 'CRM Good/Better/Best (standard pitch, 1 story)'),
  ('Roofing', 30, 'Roof replacement — Best tier', 'Roof Replacement — Premium Shingles (Best)', 'Tear off existing roof, install ice & water shield, premium synthetic underlayment, drip edge and new shingles; magnetic sweep and cleanup.', 'sq', 1.000, 85000, 'CRM Good/Better/Best (standard pitch, 1 story)'),
  ('Roofing', 40, 'Additional layer tear-off', 'Additional Layer Tear-Off', 'Remove and dispose of each additional existing shingle layer.', 'sq', 1.000, null, null),
  ('Roofing', 50, 'Ridge vent', 'Ridge Vent', 'Cut in and install ridge vent.', 'lf', 1.000, null, null),
  ('Roofing', 60, 'Box vents', 'Box Vents', 'Replace box vents.', 'ea', 1.000, null, null),
  ('Roofing', 70, 'Pipe boots', 'Pipe Boots / Pipe Jacks', 'Replace pipe boots.', 'ea', 1.000, null, null),
  ('Roofing', 80, 'Chimney flashing', 'Chimney Flashing', 'Remove and replace chimney flashing; seal.', 'ea', 1.000, null, null),
  ('Roofing', 90, 'Skylight removal & deck-over', 'Skylight Removal & Deck-Over', 'Remove skylight, frame and sheath opening, shingle to match.', 'ea', 1.000, null, null),
  -- Siding, soffit, fascia & gutters
  ('Siding, Soffit, Fascia & Gutters', 10, 'Remove & reinstall board & batten siding', 'Remove & Reinstall Board & Batten Siding', 'Remove siding to expose wall/header for inspection; re-install existing product if reusable, replace if damaged.', 'sq', 1.000, 95000, 'Pearson estimate'),
  ('Siding, Soffit, Fascia & Gutters', 20, 'New siding', 'New Siding Installation', 'Remove existing siding, install house wrap and new siding with trim.', 'sq', 1.000, null, null),
  ('Siding, Soffit, Fascia & Gutters', 30, 'Soffit', 'Soffit', 'Install new vented soffit.', 'lf', 1.000, null, null),
  ('Siding, Soffit, Fascia & Gutters', 40, 'Fascia', 'Fascia Wrap', 'Wrap fascia with pre-finished aluminum.', 'lf', 1.000, null, null),
  ('Siding, Soffit, Fascia & Gutters', 50, 'Seamless gutters', 'Seamless Gutters', 'Remove existing; install new seamless aluminum gutters.', 'lf', 1.000, null, null),
  ('Siding, Soffit, Fascia & Gutters', 60, 'Downspouts', 'Downspouts', 'Install downspouts with extensions.', 'ea', 1.000, null, null),
  ('Siding, Soffit, Fascia & Gutters', 70, 'Gutter covers', 'Gutter Covers', 'Remove and replace gutter covers.', 'lf', 1.000, null, null),
  ('Siding, Soffit, Fascia & Gutters', 80, 'Garage door wrap', 'Garage Door Trim Wrap', 'Remove and replace garage door wrap, like kind and quality.', 'ea', 1.000, null, null),
  -- Windows & doors
  ('Windows & Doors', 10, 'Sliding patio door', 'Sliding Patio Door — White on White', 'Remove & dispose of existing unit; furnish & install new insulated vinyl slider, flash and seal per manufacturer spec.', 'ea', 1.000, 350000, 'Pearson estimate'),
  ('Windows & Doors', 20, 'Slider window', 'Slider Window — White on White', 'Remove & dispose of existing unit; furnish & install new insulated vinyl slider window, flash and seal.', 'ea', 1.000, 180000, 'Pearson estimate'),
  ('Windows & Doors', 30, 'Double-hung window', 'Double-Hung Window', 'Remove & dispose of existing unit; furnish & install new insulated vinyl double-hung window, flash and seal.', 'ea', 1.000, null, null),
  ('Windows & Doors', 40, 'Entry door', 'Entry Door', 'Remove & dispose of existing door; furnish & install new prehung entry door, flash and seal.', 'ea', 1.000, null, null),
  ('Windows & Doors', 50, 'Storm door', 'Storm Door', 'Furnish & install new storm door.', 'ea', 1.000, null, null),
  ('Windows & Doors', 60, 'Garage service door', 'Garage Service Door', 'Remove & dispose of existing door; furnish & install new service door.', 'ea', 1.000, null, null),
  -- Deck
  ('Deck', 10, 'Deck removal & haul-away', 'Deck Removal & Haul-Away', 'Disconnect from ledger, demo deck surface, framing, stairs & railings; haul debris off-site and dispose.', 'ea', 1.000, 250000, 'Pearson estimate (10'' x 16'' elevated deck w/ stairs)'),
  ('Deck', 20, 'New deck framing (pressure-treated)', 'New Deck Framing — Pressure-Treated', 'Ledger, posts, beams, joists and decking, PT lumber, fasteners & hardware; framed and installed to current code.', 'ea', 1.000, 450000, 'Pearson estimate (10'' x 16'' deck, stairs separate)'),
  ('Deck', 30, 'Stairs with railings', 'Stairs with Railings', 'PT stringers, treads, and code-compliant railings/balusters.', 'ea', 1.000, 258700, 'Pearson estimate (6–7 steps)'),
  ('Deck', 40, 'Deck refinish', 'Deck Refinish', 'Clean, prep and stain/seal deck surface and railings.', 'sq ft', 1.000, null, null),
  -- Interior & general
  ('Interior & General', 10, 'Interior repairs (drywall / ceiling)', 'Interior Repairs — Drywall & Ceiling', 'Cut out and replace damaged drywall, re-texture to match existing, prime and paint affected areas.', 'ea', 1.000, 90000, 'Pearson estimate (rate per unit; Pearson used qty 6)'),
  ('Interior & General', 20, 'Rotted / unforeseen substrate allowance', 'Rotted / Unforeseen Substrate — Allowance', 'T&M if additional rot is found once wall/deck is opened up: labor $125/man-hr; std. dimensional lumber $8/ft; OSB/CDX sheet goods $175/sheet. Anything larger than 2x6 is non-standard and priced separately. Client notified & approves before proceeding.', 'ea', 1.000, 0, 'Pearson estimate'),
  ('Interior & General', 30, 'Labor (time & materials)', 'Additional Labor (T&M)', 'Labor billed per man-hour.', 'hr', 1.000, 12500, 'Pearson estimate T&M rate'),
  ('Interior & General', 40, 'OSB / CDX sheet goods', 'OSB / CDX Sheet Goods', 'Replace rotted or damaged sheathing.', 'sheet', 1.000, 17500, 'Pearson estimate T&M rate'),
  ('Interior & General', 50, 'Dimensional lumber', 'Standard Dimensional Lumber', 'Up to 2x6; larger is non-standard and priced separately.', 'lf', 1.000, 800, 'Pearson estimate T&M rate'),
  ('Interior & General', 60, 'Dumpster', 'Dumpster & Debris Disposal', 'Dumpster rental, haul-away and disposal.', 'ea', 1.000, null, null),
  ('Interior & General', 70, 'Permit', 'Permit', 'Obtain building permit (fee as charged by the city).', 'ea', 1.000, null, null)
) as v(trade, sort_order, label, description, detail, unit, default_quantity, rate_cents, source_note)
where not exists (select 1 from public.price_book_items);
