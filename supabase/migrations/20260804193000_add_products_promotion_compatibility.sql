-- Bring the clean local migration history in line with the canonical product
-- fields consumed by the selected-products promotion RPC. Existing production
-- databases may already have these fields; this migration preserves them.

alter table public.products
  add column if not exists item_name text,
  add column if not exists department text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.products
set item_name = nullif(btrim(name), '')
where item_name is null
  and name is not null;

notify pgrst, 'reload schema';
