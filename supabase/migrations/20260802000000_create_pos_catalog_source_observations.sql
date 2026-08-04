-- Durable, source-scoped catalog observations. These rows are staging only;
-- they do not create, update, or promote public.products.

create table public.pos_catalog_source_observations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_product_key text not null,
  source_upc text not null,
  source_modifier text not null,
  source_description text not null,
  source_price numeric(12,2) not null,
  source_department text not null,
  observation_status text not null default 'observed',
  last_snapshot_hash text not null,
  observed_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_observations_store_source_key
    unique (store_id, source_system, source_product_key),
  constraint pos_catalog_source_observations_source_system_length_check
    check (char_length(source_system) between 1 and 64),
  constraint pos_catalog_source_observations_source_product_key_length_check
    check (char_length(source_product_key) between 3 and 256),
  constraint pos_catalog_source_observations_source_upc_check
    check (source_upc ~ '^[0-9]{1,32}$'),
  constraint pos_catalog_source_observations_source_modifier_check
    check (source_modifier ~ '^[0-9]{1,64}$'),
  constraint pos_catalog_source_observations_source_key_match_check
    check (source_product_key = source_upc || '/' || source_modifier),
  constraint pos_catalog_source_observations_description_length_check
    check (char_length(source_description) between 1 and 512),
  constraint pos_catalog_source_observations_price_check
    check (source_price >= 0 and source_price <= 9999999999.99),
  constraint pos_catalog_source_observations_department_length_check
    check (char_length(source_department) between 1 and 64),
  constraint pos_catalog_source_observations_status_check
    check (observation_status in ('observed', 'reviewed', 'imported', 'rejected')),
  constraint pos_catalog_source_observations_snapshot_hash_check
    check (last_snapshot_hash ~ '^[0-9a-f]{64}$')
);

create index pos_catalog_source_observations_store_status_idx
  on public.pos_catalog_source_observations (
    store_id,
    observation_status,
    observed_at desc
  );

create trigger pos_catalog_source_observations_set_updated_at
before update on public.pos_catalog_source_observations
for each row execute function public.set_pos_catalog_updated_at();

alter table public.pos_catalog_source_observations enable row level security;

drop policy if exists "owners_read_pos_catalog_source_observations"
  on public.pos_catalog_source_observations;
create policy "owners_read_pos_catalog_source_observations"
on public.pos_catalog_source_observations
for select
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = pos_catalog_source_observations.store_id
      and s.owner_id = (select auth.uid())
  )
);

revoke all on table public.pos_catalog_source_observations
  from anon, authenticated;
grant select on table public.pos_catalog_source_observations
  to authenticated;
grant all on table public.pos_catalog_source_observations
  to service_role;

comment on table public.pos_catalog_source_observations is
  'Source-scoped catalog observations for review. No automatic product promotion or POS publishing.';

notify pgrst, 'reload schema';
