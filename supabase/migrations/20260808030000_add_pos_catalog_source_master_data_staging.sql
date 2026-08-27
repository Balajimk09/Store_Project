-- StorePulse Commander source master-data staging.
-- Additive only: this migration does not alter public.products, publish jobs,
-- live catalog product observations, or the existing product snapshot import RPC.
-- All source rows are normalized Commander facts; no raw XML or credentials are stored.

create table public.pos_catalog_source_master_data_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_site text not null,
  master_data_payload_sha256 text not null,
  pos_config_normalized_sha256 text not null,
  tax_rate_normalized_sha256 text not null,
  restrictions_normalized_sha256 text not null,
  age_validation_normalized_sha256 text not null,
  age_service_normalized_sha256 text not null,
  collected_at timestamptz not null,
  department_count integer not null,
  category_count integer not null,
  product_code_count integer not null,
  tax_definition_count integer not null,
  age_validation_count integer not null,
  department_tax_link_count integer not null,
  department_age_validation_link_count integer not null,
  restrictions_summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_master_data_runs_id_store_key unique (id, store_id),
  constraint pos_catalog_source_master_data_runs_retry_key
    unique (store_id, source_system, master_data_payload_sha256, collected_at),
  constraint pos_catalog_source_master_data_runs_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_master_data_runs_site_length_check
    check (char_length(source_site) between 1 and 64),
  constraint pos_catalog_source_master_data_runs_payload_hash_check
    check (master_data_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_master_data_runs_pos_hash_check
    check (pos_config_normalized_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_master_data_runs_tax_hash_check
    check (tax_rate_normalized_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_master_data_runs_restrictions_hash_check
    check (restrictions_normalized_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_master_data_runs_age_hash_check
    check (age_validation_normalized_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_master_data_runs_age_service_hash_check
    check (age_service_normalized_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_master_data_runs_counts_check
    check (
      department_count >= 0 and category_count >= 0 and product_code_count >= 0
      and tax_definition_count >= 0 and age_validation_count >= 0
      and department_tax_link_count >= 0 and department_age_validation_link_count >= 0
    ),
  constraint pos_catalog_source_master_data_runs_restrictions_object_check
    check (jsonb_typeof(restrictions_summary) = 'object')
);

create table public.pos_catalog_source_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_category_key text not null,
  source_name text not null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_master_data_run_id uuid not null,
  last_master_data_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_categories_store_source_key
    unique (store_id, source_system, source_category_key),
  constraint pos_catalog_source_categories_first_run_store_fkey
    foreign key (first_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_categories_last_run_store_fkey
    foreign key (last_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_categories_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_categories_key_length_check
    check (char_length(source_category_key) between 1 and 64),
  constraint pos_catalog_source_categories_name_length_check
    check (char_length(source_name) between 1 and 512),
  constraint pos_catalog_source_categories_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_categories_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create table public.pos_catalog_source_product_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_product_code_key text not null,
  source_name text not null,
  is_not_sold boolean not null,
  is_fuel boolean not null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_master_data_run_id uuid not null,
  last_master_data_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_product_codes_store_source_key
    unique (store_id, source_system, source_product_code_key),
  constraint pos_catalog_source_product_codes_first_run_store_fkey
    foreign key (first_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_product_codes_last_run_store_fkey
    foreign key (last_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_product_codes_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_product_codes_key_length_check
    check (char_length(source_product_code_key) between 1 and 64),
  constraint pos_catalog_source_product_codes_name_length_check
    check (char_length(source_name) between 1 and 512),
  constraint pos_catalog_source_product_codes_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_product_codes_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create table public.pos_catalog_source_tax_definitions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_tax_key text not null,
  source_name text not null,
  source_indicator text null,
  source_price_includes_tax boolean not null,
  source_prompt_exemption boolean not null,
  source_rate numeric(26,8) not null,
  source_percent_start_amount numeric(26,8) not null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_master_data_run_id uuid not null,
  last_master_data_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_tax_definitions_store_source_key
    unique (store_id, source_system, source_tax_key),
  constraint pos_catalog_source_tax_definitions_first_run_store_fkey
    foreign key (first_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_tax_definitions_last_run_store_fkey
    foreign key (last_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_tax_definitions_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_tax_definitions_key_length_check
    check (char_length(source_tax_key) between 1 and 64),
  constraint pos_catalog_source_tax_definitions_name_length_check
    check (char_length(source_name) between 1 and 512),
  constraint pos_catalog_source_tax_definitions_indicator_length_check
    check (source_indicator is null or char_length(source_indicator) between 1 and 64),
  constraint pos_catalog_source_tax_definitions_amounts_check
    check (source_rate >= 0 and source_percent_start_amount >= 0),
  constraint pos_catalog_source_tax_definitions_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_tax_definitions_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create table public.pos_catalog_source_age_validations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_age_validation_key text not null,
  source_name text not null,
  source_min_age integer null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_master_data_run_id uuid not null,
  last_master_data_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_age_validations_store_source_key
    unique (store_id, source_system, source_age_validation_key),
  constraint pos_catalog_source_age_validations_first_run_store_fkey
    foreign key (first_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_age_validations_last_run_store_fkey
    foreign key (last_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_age_validations_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_age_validations_key_length_check
    check (char_length(source_age_validation_key) between 1 and 64),
  constraint pos_catalog_source_age_validations_name_length_check
    check (char_length(source_name) between 1 and 512),
  constraint pos_catalog_source_age_validations_min_age_check
    check (source_min_age is null or source_min_age between 0 and 999999999),
  constraint pos_catalog_source_age_validations_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_age_validations_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create table public.pos_catalog_source_department_definitions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_department_key text not null,
  source_name text not null,
  source_category_key text not null,
  source_product_code_key text not null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_master_data_run_id uuid not null,
  last_master_data_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_department_definitions_store_source_key
    unique (store_id, source_system, source_department_key),
  constraint pos_catalog_source_department_definitions_first_run_store_fkey
    foreign key (first_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_department_definitions_last_run_store_fkey
    foreign key (last_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_department_definitions_category_fkey
    foreign key (store_id, source_system, source_category_key)
    references public.pos_catalog_source_categories(store_id, source_system, source_category_key),
  constraint pos_catalog_source_department_definitions_product_code_fkey
    foreign key (store_id, source_system, source_product_code_key)
    references public.pos_catalog_source_product_codes(store_id, source_system, source_product_code_key),
  constraint pos_catalog_source_department_definitions_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_department_definitions_key_length_check
    check (char_length(source_department_key) between 1 and 64),
  constraint pos_catalog_source_department_definitions_name_length_check
    check (char_length(source_name) between 1 and 512),
  constraint pos_catalog_source_department_definitions_category_key_length_check
    check (char_length(source_category_key) between 1 and 64),
  constraint pos_catalog_source_department_definitions_product_code_key_length_check
    check (char_length(source_product_code_key) between 1 and 64),
  constraint pos_catalog_source_department_definitions_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_department_definitions_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create table public.pos_catalog_source_age_service_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  enabled boolean not null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_master_data_run_id uuid not null,
  last_master_data_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_age_service_settings_store_source_key
    unique (store_id, source_system),
  constraint pos_catalog_source_age_service_settings_first_run_store_fkey
    foreign key (first_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_age_service_settings_last_run_store_fkey
    foreign key (last_master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_age_service_settings_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_age_service_settings_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_age_service_settings_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create table public.pos_catalog_source_department_tax_links (
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_department_key text not null,
  source_tax_key text not null,
  master_data_run_id uuid not null,
  observed_at timestamptz not null,

  primary key (store_id, source_system, source_department_key, source_tax_key),
  constraint pos_catalog_source_department_tax_links_department_fkey
    foreign key (store_id, source_system, source_department_key)
    references public.pos_catalog_source_department_definitions(store_id, source_system, source_department_key)
    on delete cascade,
  constraint pos_catalog_source_department_tax_links_tax_fkey
    foreign key (store_id, source_system, source_tax_key)
    references public.pos_catalog_source_tax_definitions(store_id, source_system, source_tax_key)
    on delete cascade,
  constraint pos_catalog_source_department_tax_links_run_store_fkey
    foreign key (master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_department_tax_links_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$')
);

create table public.pos_catalog_source_department_age_validation_links (
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_department_key text not null,
  source_age_validation_key text not null,
  master_data_run_id uuid not null,
  observed_at timestamptz not null,

  primary key (store_id, source_system, source_department_key, source_age_validation_key),
  constraint pos_catalog_source_department_age_validation_links_department_fkey
    foreign key (store_id, source_system, source_department_key)
    references public.pos_catalog_source_department_definitions(store_id, source_system, source_department_key)
    on delete cascade,
  constraint pos_catalog_source_department_age_validation_links_age_fkey
    foreign key (store_id, source_system, source_age_validation_key)
    references public.pos_catalog_source_age_validations(store_id, source_system, source_age_validation_key)
    on delete cascade,
  constraint pos_catalog_source_department_age_validation_links_run_store_fkey
    foreign key (master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_department_age_validation_links_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$')
);

create index pos_catalog_source_master_data_runs_store_collected_idx
  on public.pos_catalog_source_master_data_runs(store_id, source_system, collected_at desc);
create index pos_catalog_source_categories_present_idx
  on public.pos_catalog_source_categories(store_id, source_system, is_present, last_observed_at desc);
create index pos_catalog_source_product_codes_present_idx
  on public.pos_catalog_source_product_codes(store_id, source_system, is_present, last_observed_at desc);
create index pos_catalog_source_department_definitions_present_idx
  on public.pos_catalog_source_department_definitions(store_id, source_system, is_present, last_observed_at desc);
create index pos_catalog_source_tax_definitions_present_idx
  on public.pos_catalog_source_tax_definitions(store_id, source_system, is_present, last_observed_at desc);
create index pos_catalog_source_age_validations_present_idx
  on public.pos_catalog_source_age_validations(store_id, source_system, is_present, last_observed_at desc);

create trigger pos_catalog_source_master_data_runs_set_updated_at
before update on public.pos_catalog_source_master_data_runs
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_categories_set_updated_at
before update on public.pos_catalog_source_categories
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_product_codes_set_updated_at
before update on public.pos_catalog_source_product_codes
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_department_definitions_set_updated_at
before update on public.pos_catalog_source_department_definitions
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_tax_definitions_set_updated_at
before update on public.pos_catalog_source_tax_definitions
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_age_validations_set_updated_at
before update on public.pos_catalog_source_age_validations
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_age_service_settings_set_updated_at
before update on public.pos_catalog_source_age_service_settings
for each row execute function public.set_pos_catalog_updated_at();

alter table public.pos_catalog_source_master_data_runs enable row level security;
alter table public.pos_catalog_source_categories enable row level security;
alter table public.pos_catalog_source_product_codes enable row level security;
alter table public.pos_catalog_source_department_definitions enable row level security;
alter table public.pos_catalog_source_tax_definitions enable row level security;
alter table public.pos_catalog_source_age_validations enable row level security;
alter table public.pos_catalog_source_age_service_settings enable row level security;
alter table public.pos_catalog_source_department_tax_links enable row level security;
alter table public.pos_catalog_source_department_age_validation_links enable row level security;

create policy "owners_read_pos_catalog_source_master_data_runs"
on public.pos_catalog_source_master_data_runs for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_master_data_runs.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_categories"
on public.pos_catalog_source_categories for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_categories.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_product_codes"
on public.pos_catalog_source_product_codes for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_product_codes.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_department_definitions"
on public.pos_catalog_source_department_definitions for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_department_definitions.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_tax_definitions"
on public.pos_catalog_source_tax_definitions for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_tax_definitions.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_age_validations"
on public.pos_catalog_source_age_validations for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_age_validations.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_age_service_settings"
on public.pos_catalog_source_age_service_settings for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_age_service_settings.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_department_tax_links"
on public.pos_catalog_source_department_tax_links for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_department_tax_links.store_id
    and s.owner_id = (select auth.uid())
));
create policy "owners_read_pos_catalog_source_department_age_validation_links"
on public.pos_catalog_source_department_age_validation_links for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = pos_catalog_source_department_age_validation_links.store_id
    and s.owner_id = (select auth.uid())
));

revoke all on table
  public.pos_catalog_source_master_data_runs,
  public.pos_catalog_source_categories,
  public.pos_catalog_source_product_codes,
  public.pos_catalog_source_department_definitions,
  public.pos_catalog_source_tax_definitions,
  public.pos_catalog_source_age_validations,
  public.pos_catalog_source_age_service_settings,
  public.pos_catalog_source_department_tax_links,
  public.pos_catalog_source_department_age_validation_links
from anon, authenticated;

grant select on table
  public.pos_catalog_source_master_data_runs,
  public.pos_catalog_source_categories,
  public.pos_catalog_source_product_codes,
  public.pos_catalog_source_department_definitions,
  public.pos_catalog_source_tax_definitions,
  public.pos_catalog_source_age_validations,
  public.pos_catalog_source_age_service_settings,
  public.pos_catalog_source_department_tax_links,
  public.pos_catalog_source_department_age_validation_links
to authenticated;

grant select, insert, update, delete on table
  public.pos_catalog_source_master_data_runs,
  public.pos_catalog_source_categories,
  public.pos_catalog_source_product_codes,
  public.pos_catalog_source_department_definitions,
  public.pos_catalog_source_tax_definitions,
  public.pos_catalog_source_age_validations,
  public.pos_catalog_source_age_service_settings,
  public.pos_catalog_source_department_tax_links,
  public.pos_catalog_source_department_age_validation_links
to service_role;

create or replace function public.import_pos_catalog_source_master_data_snapshot(
  p_import_run jsonb,
  p_categories jsonb,
  p_product_codes jsonb,
  p_department_definitions jsonb,
  p_tax_definitions jsonb,
  p_age_validations jsonb,
  p_age_service_setting jsonb,
  p_department_tax_links jsonb,
  p_department_age_validation_links jsonb
)
returns table (
  master_data_run_id uuid,
  master_data_run_reused boolean,
  department_count integer,
  category_count integer,
  product_code_count integer,
  tax_definition_count integer,
  age_validation_count integer,
  department_tax_link_count integer,
  department_age_validation_link_count integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_meta record;
  v_run public.pos_catalog_source_master_data_runs%rowtype;
begin
  if jsonb_typeof(p_import_run) <> 'object'
    or jsonb_typeof(p_categories) <> 'array'
    or jsonb_typeof(p_product_codes) <> 'array'
    or jsonb_typeof(p_department_definitions) <> 'array'
    or jsonb_typeof(p_tax_definitions) <> 'array'
    or jsonb_typeof(p_age_validations) <> 'array'
    or jsonb_typeof(p_age_service_setting) <> 'object'
    or jsonb_typeof(p_department_tax_links) <> 'array'
    or jsonb_typeof(p_department_age_validation_links) <> 'array' then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  select * into v_meta
  from jsonb_to_record(p_import_run) as value(
    store_id uuid,
    source_system text,
    source_site text,
    master_data_payload_sha256 text,
    pos_config_normalized_sha256 text,
    tax_rate_normalized_sha256 text,
    restrictions_normalized_sha256 text,
    age_validation_normalized_sha256 text,
    age_service_normalized_sha256 text,
    collected_at timestamptz,
    department_count integer,
    category_count integer,
    product_code_count integer,
    tax_definition_count integer,
    age_validation_count integer,
    department_tax_link_count integer,
    department_age_validation_link_count integer,
    restrictions_summary jsonb
  );

  if v_meta.store_id is null
    or v_meta.source_system is null or v_meta.source_system !~ '^[a-z][a-z0-9_]{0,63}$'
    or v_meta.source_site is null or char_length(v_meta.source_site) not between 1 and 64
    or v_meta.master_data_payload_sha256 is null or v_meta.master_data_payload_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.pos_config_normalized_sha256 is null or v_meta.pos_config_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.tax_rate_normalized_sha256 is null or v_meta.tax_rate_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.restrictions_normalized_sha256 is null or v_meta.restrictions_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.age_validation_normalized_sha256 is null or v_meta.age_validation_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.age_service_normalized_sha256 is null or v_meta.age_service_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.collected_at is null
    or v_meta.department_count < 0 or v_meta.department_count <> jsonb_array_length(p_department_definitions)
    or v_meta.category_count < 0 or v_meta.category_count <> jsonb_array_length(p_categories)
    or v_meta.product_code_count < 0 or v_meta.product_code_count <> jsonb_array_length(p_product_codes)
    or v_meta.tax_definition_count < 0 or v_meta.tax_definition_count <> jsonb_array_length(p_tax_definitions)
    or v_meta.age_validation_count < 0 or v_meta.age_validation_count <> jsonb_array_length(p_age_validations)
    or v_meta.department_tax_link_count < 0 or v_meta.department_tax_link_count <> jsonb_array_length(p_department_tax_links)
    or v_meta.department_age_validation_link_count < 0 or v_meta.department_age_validation_link_count <> jsonb_array_length(p_department_age_validation_links)
    or v_meta.department_count > 50000 or v_meta.category_count > 50000 or v_meta.product_code_count > 50000
    or v_meta.tax_definition_count > 50000 or v_meta.age_validation_count > 50000
    or v_meta.department_tax_link_count > 50000 or v_meta.department_age_validation_link_count > 50000
    or jsonb_typeof(v_meta.restrictions_summary) is distinct from 'object'
    or jsonb_typeof(v_meta.restrictions_summary -> 'age_validation_count') is distinct from 'number'
    or jsonb_typeof(v_meta.restrictions_summary -> 'blue_laws_container_present') is distinct from 'boolean'
    or jsonb_typeof(v_meta.restrictions_summary -> 'plu_promos_container_present') is distinct from 'boolean' then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  perform 1 from public.stores s where s.id = v_meta.store_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'master_data_import_store_invalid';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_categories) x(source_category_key text)
    group by x.source_category_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_product_codes) x(source_product_code_key text)
    group by x.source_product_code_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_department_definitions) x(source_department_key text)
    group by x.source_department_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tax_definitions) x(source_tax_key text)
    group by x.source_tax_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_age_validations) x(source_age_validation_key text)
    group by x.source_age_validation_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_department_tax_links) x(source_department_key text, source_tax_key text)
    group by x.source_department_key, x.source_tax_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_department_age_validation_links) x(source_department_key text, source_age_validation_key text)
    group by x.source_department_key, x.source_age_validation_key having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_categories) x(
      source_category_key text, source_name text, source_values jsonb,
      normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_category_key is null or char_length(x.source_category_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) or exists (
    select 1
    from jsonb_to_recordset(p_product_codes) x(
      source_product_code_key text, source_name text, is_not_sold boolean, is_fuel boolean,
      source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_product_code_key is null or char_length(x.source_product_code_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or x.is_not_sold is null or x.is_fuel is null
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) or exists (
    select 1
    from jsonb_to_recordset(p_department_definitions) x(
      source_department_key text, source_name text, source_category_key text,
      source_product_code_key text, source_values jsonb, normalized_observation_hash text,
      observed_at timestamptz, is_present boolean
    )
    where x.source_department_key is null or char_length(x.source_department_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or x.source_category_key is null or char_length(x.source_category_key) not between 1 and 64
      or x.source_product_code_key is null or char_length(x.source_product_code_key) not between 1 and 64
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) or exists (
    select 1
    from jsonb_to_recordset(p_tax_definitions) x(
      source_tax_key text, source_name text, source_indicator text,
      source_price_includes_tax boolean, source_prompt_exemption boolean,
      source_rate text, source_percent_start_amount text, source_values jsonb,
      normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_tax_key is null or char_length(x.source_tax_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or (x.source_indicator is not null and char_length(x.source_indicator) not between 1 and 64)
      or x.source_price_includes_tax is null or x.source_prompt_exemption is null
      or x.source_rate is null or x.source_rate !~ '^[0-9]{1,18}(?:\.[0-9]{1,8})?$'
      or x.source_percent_start_amount is null or x.source_percent_start_amount !~ '^[0-9]{1,18}(?:\.[0-9]{1,8})?$'
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) or exists (
    select 1
    from jsonb_to_recordset(p_age_validations) x(
      source_age_validation_key text, source_name text, source_min_age text,
      source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_age_validation_key is null or char_length(x.source_age_validation_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or (x.source_min_age is not null and x.source_min_age !~ '^[0-9]{1,9}$')
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if not exists (
    select 1
    from jsonb_to_record(p_age_service_setting) x(
      enabled boolean, source_values jsonb, normalized_observation_hash text,
      observed_at timestamptz, is_present boolean
    )
    where x.enabled is not null
      and jsonb_typeof(x.source_values) = 'object'
      and x.normalized_observation_hash ~ '^[0-9a-f]{64}$'
      and x.observed_at is not distinct from v_meta.collected_at
      and x.is_present is true
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_department_definitions) d(source_category_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_categories) c(source_category_key text)
      where c.source_category_key = d.source_category_key
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_department_definitions) d(source_product_code_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_product_codes) p(source_product_code_key text)
      where p.source_product_code_key = d.source_product_code_key
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_department_tax_links) l(source_department_key text, source_tax_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_department_definitions) d(source_department_key text)
      where d.source_department_key = l.source_department_key
    ) or not exists (
      select 1 from jsonb_to_recordset(p_tax_definitions) t(source_tax_key text)
      where t.source_tax_key = l.source_tax_key
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_department_age_validation_links) l(source_department_key text, source_age_validation_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_department_definitions) d(source_department_key text)
      where d.source_department_key = l.source_department_key
    ) or not exists (
      select 1 from jsonb_to_recordset(p_age_validations) a(source_age_validation_key text)
      where a.source_age_validation_key = l.source_age_validation_key
    )
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_relationship_invalid';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_department_tax_links)
      x(source_department_key text, source_tax_key text, observed_at timestamptz)
    where x.observed_at is distinct from v_meta.collected_at
  ) or exists (
    select 1 from jsonb_to_recordset(p_department_age_validation_links)
      x(source_department_key text, source_age_validation_key text, observed_at timestamptz)
    where x.observed_at is distinct from v_meta.collected_at
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  insert into public.pos_catalog_source_master_data_runs (
    store_id, source_system, source_site, master_data_payload_sha256,
    pos_config_normalized_sha256, tax_rate_normalized_sha256,
    restrictions_normalized_sha256, age_validation_normalized_sha256,
    age_service_normalized_sha256, collected_at, department_count,
    category_count, product_code_count, tax_definition_count,
    age_validation_count, department_tax_link_count,
    department_age_validation_link_count, restrictions_summary
  ) values (
    v_meta.store_id, v_meta.source_system, v_meta.source_site, v_meta.master_data_payload_sha256,
    v_meta.pos_config_normalized_sha256, v_meta.tax_rate_normalized_sha256,
    v_meta.restrictions_normalized_sha256, v_meta.age_validation_normalized_sha256,
    v_meta.age_service_normalized_sha256, v_meta.collected_at, v_meta.department_count,
    v_meta.category_count, v_meta.product_code_count, v_meta.tax_definition_count,
    v_meta.age_validation_count, v_meta.department_tax_link_count,
    v_meta.department_age_validation_link_count, v_meta.restrictions_summary
  )
  on conflict (store_id, source_system, master_data_payload_sha256, collected_at) do nothing
  returning * into v_run;

  if not found then
    select * into v_run
    from public.pos_catalog_source_master_data_runs r
    where r.store_id = v_meta.store_id
      and r.source_system = v_meta.source_system
      and r.master_data_payload_sha256 = v_meta.master_data_payload_sha256
      and r.collected_at = v_meta.collected_at
    for update;

    if not found
      or v_run.source_site <> v_meta.source_site
      or v_run.pos_config_normalized_sha256 <> v_meta.pos_config_normalized_sha256
      or v_run.tax_rate_normalized_sha256 <> v_meta.tax_rate_normalized_sha256
      or v_run.restrictions_normalized_sha256 <> v_meta.restrictions_normalized_sha256
      or v_run.age_validation_normalized_sha256 <> v_meta.age_validation_normalized_sha256
      or v_run.age_service_normalized_sha256 <> v_meta.age_service_normalized_sha256
      or v_run.department_count <> v_meta.department_count
      or v_run.category_count <> v_meta.category_count
      or v_run.product_code_count <> v_meta.product_code_count
      or v_run.tax_definition_count <> v_meta.tax_definition_count
      or v_run.age_validation_count <> v_meta.age_validation_count
      or v_run.department_tax_link_count <> v_meta.department_tax_link_count
      or v_run.department_age_validation_link_count <> v_meta.department_age_validation_link_count
      or v_run.restrictions_summary <> v_meta.restrictions_summary then
      raise exception using errcode = 'P0001', message = 'master_data_import_conflict';
    end if;

    return query select
      v_run.id, true, v_run.department_count, v_run.category_count,
      v_run.product_code_count, v_run.tax_definition_count, v_run.age_validation_count,
      v_run.department_tax_link_count, v_run.department_age_validation_link_count;
    return;
  end if;

  insert into public.pos_catalog_source_categories (
    store_id, source_system, source_category_key, source_name, source_values,
    normalized_observation_hash, first_master_data_run_id, last_master_data_run_id,
    first_observed_at, last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_category_key, x.source_name, x.source_values,
    x.normalized_observation_hash, v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_categories) x(
    source_category_key text, source_name text, source_values jsonb,
    normalized_observation_hash text, observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_category_key) do update
  set source_name = excluded.source_name,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_categories.last_observed_at;

  update public.pos_catalog_source_categories c
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where c.store_id = v_meta.store_id and c.source_system = v_meta.source_system
    and c.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_categories) x(source_category_key text)
      where x.source_category_key = c.source_category_key
    );

  insert into public.pos_catalog_source_product_codes (
    store_id, source_system, source_product_code_key, source_name, is_not_sold, is_fuel,
    source_values, normalized_observation_hash, first_master_data_run_id, last_master_data_run_id,
    first_observed_at, last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_product_code_key, x.source_name,
    x.is_not_sold, x.is_fuel, x.source_values, x.normalized_observation_hash,
    v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_product_codes) x(
    source_product_code_key text, source_name text, is_not_sold boolean, is_fuel boolean,
    source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_product_code_key) do update
  set source_name = excluded.source_name,
      is_not_sold = excluded.is_not_sold,
      is_fuel = excluded.is_fuel,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_product_codes.last_observed_at;

  update public.pos_catalog_source_product_codes p
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where p.store_id = v_meta.store_id and p.source_system = v_meta.source_system
    and p.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_product_codes) x(source_product_code_key text)
      where x.source_product_code_key = p.source_product_code_key
    );

  insert into public.pos_catalog_source_tax_definitions (
    store_id, source_system, source_tax_key, source_name, source_indicator,
    source_price_includes_tax, source_prompt_exemption, source_rate,
    source_percent_start_amount, source_values, normalized_observation_hash,
    first_master_data_run_id, last_master_data_run_id, first_observed_at,
    last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_tax_key, x.source_name, x.source_indicator,
    x.source_price_includes_tax, x.source_prompt_exemption, x.source_rate::numeric,
    x.source_percent_start_amount::numeric, x.source_values, x.normalized_observation_hash,
    v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_tax_definitions) x(
    source_tax_key text, source_name text, source_indicator text,
    source_price_includes_tax boolean, source_prompt_exemption boolean,
    source_rate text, source_percent_start_amount text, source_values jsonb,
    normalized_observation_hash text, observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_tax_key) do update
  set source_name = excluded.source_name,
      source_indicator = excluded.source_indicator,
      source_price_includes_tax = excluded.source_price_includes_tax,
      source_prompt_exemption = excluded.source_prompt_exemption,
      source_rate = excluded.source_rate,
      source_percent_start_amount = excluded.source_percent_start_amount,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_tax_definitions.last_observed_at;

  update public.pos_catalog_source_tax_definitions t
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where t.store_id = v_meta.store_id and t.source_system = v_meta.source_system
    and t.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_tax_definitions) x(source_tax_key text)
      where x.source_tax_key = t.source_tax_key
    );

  insert into public.pos_catalog_source_age_validations (
    store_id, source_system, source_age_validation_key, source_name, source_min_age,
    source_values, normalized_observation_hash, first_master_data_run_id,
    last_master_data_run_id, first_observed_at, last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_age_validation_key, x.source_name,
    case when x.source_min_age is null then null else x.source_min_age::integer end,
    x.source_values, x.normalized_observation_hash, v_run.id, v_run.id,
    x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_age_validations) x(
    source_age_validation_key text, source_name text, source_min_age text,
    source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_age_validation_key) do update
  set source_name = excluded.source_name,
      source_min_age = excluded.source_min_age,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_age_validations.last_observed_at;

  update public.pos_catalog_source_age_validations a
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where a.store_id = v_meta.store_id and a.source_system = v_meta.source_system
    and a.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_age_validations) x(source_age_validation_key text)
      where x.source_age_validation_key = a.source_age_validation_key
    );

  insert into public.pos_catalog_source_department_definitions (
    store_id, source_system, source_department_key, source_name, source_category_key,
    source_product_code_key, source_values, normalized_observation_hash,
    first_master_data_run_id, last_master_data_run_id, first_observed_at,
    last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_department_key, x.source_name,
    x.source_category_key, x.source_product_code_key, x.source_values,
    x.normalized_observation_hash, v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_department_definitions) x(
    source_department_key text, source_name text, source_category_key text,
    source_product_code_key text, source_values jsonb, normalized_observation_hash text,
    observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_department_key) do update
  set source_name = excluded.source_name,
      source_category_key = excluded.source_category_key,
      source_product_code_key = excluded.source_product_code_key,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_department_definitions.last_observed_at;

  update public.pos_catalog_source_department_definitions d
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where d.store_id = v_meta.store_id and d.source_system = v_meta.source_system
    and d.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_department_definitions) x(source_department_key text)
      where x.source_department_key = d.source_department_key
    );

  insert into public.pos_catalog_source_age_service_settings (
    store_id, source_system, enabled, source_values, normalized_observation_hash,
    first_master_data_run_id, last_master_data_run_id, first_observed_at,
    last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.enabled, x.source_values,
    x.normalized_observation_hash, v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_record(p_age_service_setting) x(
    enabled boolean, source_values jsonb, normalized_observation_hash text,
    observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system) do update
  set enabled = excluded.enabled,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_age_service_settings.last_observed_at;

  delete from public.pos_catalog_source_department_tax_links l
  where l.store_id = v_meta.store_id and l.source_system = v_meta.source_system;

  insert into public.pos_catalog_source_department_tax_links (
    store_id, source_system, source_department_key, source_tax_key, master_data_run_id, observed_at
  )
  select v_meta.store_id, v_meta.source_system, x.source_department_key, x.source_tax_key, v_run.id, x.observed_at
  from jsonb_to_recordset(p_department_tax_links) x(
    source_department_key text, source_tax_key text, observed_at timestamptz
  );

  delete from public.pos_catalog_source_department_age_validation_links l
  where l.store_id = v_meta.store_id and l.source_system = v_meta.source_system;

  insert into public.pos_catalog_source_department_age_validation_links (
    store_id, source_system, source_department_key, source_age_validation_key,
    master_data_run_id, observed_at
  )
  select v_meta.store_id, v_meta.source_system, x.source_department_key,
    x.source_age_validation_key, v_run.id, x.observed_at
  from jsonb_to_recordset(p_department_age_validation_links) x(
    source_department_key text, source_age_validation_key text, observed_at timestamptz
  );

  return query select
    v_run.id, false, v_meta.department_count, v_meta.category_count,
    v_meta.product_code_count, v_meta.tax_definition_count, v_meta.age_validation_count,
    v_meta.department_tax_link_count, v_meta.department_age_validation_link_count;
end;
$function$;

revoke all on function public.import_pos_catalog_source_master_data_snapshot(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.import_pos_catalog_source_master_data_snapshot(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;
