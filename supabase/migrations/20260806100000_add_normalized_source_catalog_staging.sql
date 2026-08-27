-- Lossless, POS-independent full-catalog source staging.
--
-- public.pos_catalog_source_observations remains the selected-product review
-- contract: its existing callers require a nonblank description and textual
-- department. Full feeds must retain blank descriptions and source department
-- identifiers, so these adjacent tables deliberately avoid changing that
-- reviewed UI/RPC contract or canonical public.products.

create table public.pos_catalog_source_import_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_snapshot_hash text not null,
  item_source_sha256 text not null,
  department_source_sha256 text not null,
  product_normalized_sha256 text not null,
  department_normalized_sha256 text not null,
  collected_at timestamptz not null,
  status text not null default 'completed',
  product_count integer not null,
  department_count integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_import_runs_id_store_key unique (id, store_id),
  constraint pos_catalog_source_import_runs_store_source_snapshot_key
    unique (store_id, source_system, source_snapshot_hash),
  constraint pos_catalog_source_import_runs_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_import_runs_snapshot_hash_check
    check (source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_import_runs_item_source_hash_check
    check (item_source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_import_runs_department_source_hash_check
    check (department_source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_import_runs_product_normalized_hash_check
    check (product_normalized_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_import_runs_department_normalized_hash_check
    check (department_normalized_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_source_import_runs_status_check
    check (status in ('completed', 'failed')),
  constraint pos_catalog_source_import_runs_nonnegative_counts_check
    check (product_count >= 0 and department_count >= 0)
);

create table public.pos_catalog_source_departments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_department_key text not null,
  source_name text null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_import_run_id uuid not null,
  last_import_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_departments_id_store_key unique (id, store_id),
  constraint pos_catalog_source_departments_store_source_key
    unique (store_id, source_system, source_department_key),
  constraint pos_catalog_source_departments_first_run_store_fkey
    foreign key (first_import_run_id, store_id)
    references public.pos_catalog_source_import_runs(id, store_id),
  constraint pos_catalog_source_departments_last_run_store_fkey
    foreign key (last_import_run_id, store_id)
    references public.pos_catalog_source_import_runs(id, store_id),
  constraint pos_catalog_source_departments_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_departments_key_length_check
    check (char_length(source_department_key) between 1 and 128),
  constraint pos_catalog_source_departments_name_length_check
    check (source_name is null or char_length(source_name) <= 512),
  constraint pos_catalog_source_departments_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_departments_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create table public.pos_catalog_source_product_observations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_product_key text not null,
  source_upc text null,
  source_modifier text null,
  source_description text null,
  source_price numeric(18, 8) null,
  source_department_key text null,
  source_department_id uuid null,
  source_active boolean null,
  source_values jsonb not null,
  normalized_observation_hash text not null,
  first_import_run_id uuid not null,
  last_import_run_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  is_present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_product_observations_id_store_key unique (id, store_id),
  constraint pos_catalog_source_product_observations_store_source_key
    unique (store_id, source_system, source_product_key),
  constraint pos_catalog_source_product_observations_first_run_store_fkey
    foreign key (first_import_run_id, store_id)
    references public.pos_catalog_source_import_runs(id, store_id),
  constraint pos_catalog_source_product_observations_last_run_store_fkey
    foreign key (last_import_run_id, store_id)
    references public.pos_catalog_source_import_runs(id, store_id),
  constraint pos_catalog_source_product_observations_department_store_fkey
    foreign key (source_department_id, store_id)
    references public.pos_catalog_source_departments(id, store_id)
    on delete set null (source_department_id),
  constraint pos_catalog_source_product_observations_source_system_check
    check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_catalog_source_product_observations_key_length_check
    check (char_length(source_product_key) between 1 and 256),
  constraint pos_catalog_source_product_observations_upc_length_check
    check (source_upc is null or char_length(source_upc) between 1 and 64),
  constraint pos_catalog_source_product_observations_modifier_length_check
    check (source_modifier is null or char_length(source_modifier) between 1 and 64),
  constraint pos_catalog_source_product_observations_description_length_check
    check (source_description is null or char_length(source_description) <= 512),
  constraint pos_catalog_source_product_observations_price_check
    check (source_price is null or source_price >= 0),
  constraint pos_catalog_source_product_observations_department_key_length_check
    check (source_department_key is null or char_length(source_department_key) between 1 and 128),
  constraint pos_catalog_source_product_observations_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_source_product_observations_hash_check
    check (normalized_observation_hash ~ '^[0-9a-f]{64}$')
);

create index pos_catalog_source_import_runs_store_source_collected_idx
  on public.pos_catalog_source_import_runs (store_id, source_system, collected_at desc);
create index pos_catalog_source_departments_store_source_present_idx
  on public.pos_catalog_source_departments (store_id, source_system, is_present, last_observed_at desc);
create index pos_catalog_source_product_observations_store_source_present_idx
  on public.pos_catalog_source_product_observations (store_id, source_system, is_present, last_observed_at desc);
create index pos_catalog_source_product_observations_store_upc_modifier_idx
  on public.pos_catalog_source_product_observations (store_id, source_system, source_upc, source_modifier)
  where source_upc is not null;

create trigger pos_catalog_source_import_runs_set_updated_at
before update on public.pos_catalog_source_import_runs
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_departments_set_updated_at
before update on public.pos_catalog_source_departments
for each row execute function public.set_pos_catalog_updated_at();
create trigger pos_catalog_source_product_observations_set_updated_at
before update on public.pos_catalog_source_product_observations
for each row execute function public.set_pos_catalog_updated_at();

alter table public.pos_catalog_source_import_runs enable row level security;
alter table public.pos_catalog_source_departments enable row level security;
alter table public.pos_catalog_source_product_observations enable row level security;

drop policy if exists "owners_read_pos_catalog_source_import_runs" on public.pos_catalog_source_import_runs;
create policy "owners_read_pos_catalog_source_import_runs"
on public.pos_catalog_source_import_runs for select to authenticated
using (exists (
  select 1 from public.stores store_row
  where store_row.id = pos_catalog_source_import_runs.store_id
    and store_row.owner_id = (select auth.uid())
));

drop policy if exists "owners_read_pos_catalog_source_departments" on public.pos_catalog_source_departments;
create policy "owners_read_pos_catalog_source_departments"
on public.pos_catalog_source_departments for select to authenticated
using (exists (
  select 1 from public.stores store_row
  where store_row.id = pos_catalog_source_departments.store_id
    and store_row.owner_id = (select auth.uid())
));

drop policy if exists "owners_read_pos_catalog_source_product_observations" on public.pos_catalog_source_product_observations;
create policy "owners_read_pos_catalog_source_product_observations"
on public.pos_catalog_source_product_observations for select to authenticated
using (exists (
  select 1 from public.stores store_row
  where store_row.id = pos_catalog_source_product_observations.store_id
    and store_row.owner_id = (select auth.uid())
));

revoke all on table public.pos_catalog_source_import_runs,
  public.pos_catalog_source_departments,
  public.pos_catalog_source_product_observations from anon, authenticated;
grant select on table public.pos_catalog_source_import_runs,
  public.pos_catalog_source_departments,
  public.pos_catalog_source_product_observations to authenticated;
grant select, insert, update on table public.pos_catalog_source_import_runs,
  public.pos_catalog_source_departments,
  public.pos_catalog_source_product_observations to service_role;

create or replace function public.import_pos_catalog_source_snapshot(
  p_import_run jsonb,
  p_departments jsonb,
  p_products jsonb
)
returns table (
  import_run_id uuid,
  import_run_reused boolean,
  product_rows_inserted integer,
  product_rows_updated integer,
  department_rows_inserted integer,
  department_rows_updated integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_meta record;
  v_run public.pos_catalog_source_import_runs%rowtype;
  v_department record;
  v_product record;
  v_existing_department public.pos_catalog_source_departments%rowtype;
  v_existing_product public.pos_catalog_source_product_observations%rowtype;
  v_source_department_id uuid;
  v_product_inserted integer := 0;
  v_product_updated integer := 0;
  v_department_inserted integer := 0;
  v_department_updated integer := 0;
begin
  if jsonb_typeof(p_import_run) <> 'object'
    or jsonb_typeof(p_departments) <> 'array'
    or jsonb_typeof(p_products) <> 'array' then
    raise exception using errcode = 'P0001', message = 'catalog_import_invalid';
  end if;

  select * into v_meta
  from jsonb_to_record(p_import_run) as value(
    store_id uuid,
    source_system text,
    source_snapshot_hash text,
    item_source_sha256 text,
    department_source_sha256 text,
    product_normalized_sha256 text,
    department_normalized_sha256 text,
    collected_at timestamptz,
    product_count integer,
    department_count integer
  );

  if v_meta.store_id is null
    or v_meta.source_system is null or v_meta.source_system !~ '^[a-z][a-z0-9_]{0,63}$'
    or v_meta.source_snapshot_hash is null or v_meta.source_snapshot_hash !~ '^[0-9a-f]{64}$'
    or v_meta.item_source_sha256 is null or v_meta.item_source_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.department_source_sha256 is null or v_meta.department_source_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.product_normalized_sha256 is null or v_meta.product_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.department_normalized_sha256 is null or v_meta.department_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.collected_at is null
    or v_meta.product_count < 0
    or v_meta.department_count < 0
    or jsonb_array_length(p_products) <> v_meta.product_count
    or jsonb_array_length(p_departments) <> v_meta.department_count then
    raise exception using errcode = 'P0001', message = 'catalog_import_invalid';
  end if;

  perform 1 from public.stores store_row where store_row.id = v_meta.store_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'catalog_import_store_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_departments) as value(source_department_key text)
    group by value.source_department_key having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_products) as value(source_product_key text)
    group by value.source_product_key having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_import_invalid';
  end if;

  for v_department in
    select * from jsonb_to_recordset(p_departments) as value(
      source_department_key text,
      source_name text,
      source_values jsonb,
      normalized_observation_hash text,
      observed_at timestamptz,
      is_present boolean
    )
  loop
    if v_department.source_department_key is null
      or char_length(v_department.source_department_key) not between 1 and 128
      or (v_department.source_name is not null and char_length(v_department.source_name) > 512)
      or jsonb_typeof(v_department.source_values) is distinct from 'object'
      or v_department.normalized_observation_hash is null or v_department.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or v_department.observed_at is distinct from v_meta.collected_at
      or v_department.is_present is null then
      raise exception using errcode = 'P0001', message = 'catalog_import_invalid';
    end if;
  end loop;

  for v_product in
    select * from jsonb_to_recordset(p_products) as value(
      source_product_key text,
      source_upc text,
      source_modifier text,
      source_description text,
      source_price text,
      source_department_key text,
      source_active boolean,
      source_values jsonb,
      normalized_observation_hash text,
      observed_at timestamptz,
      is_present boolean
    )
  loop
    if v_product.source_product_key is null
      or char_length(v_product.source_product_key) not between 1 and 256
      or (v_product.source_upc is not null and char_length(v_product.source_upc) not between 1 and 64)
      or (v_product.source_modifier is not null and char_length(v_product.source_modifier) not between 1 and 64)
      or (v_product.source_description is not null and char_length(v_product.source_description) > 512)
      or (v_product.source_department_key is not null and char_length(v_product.source_department_key) not between 1 and 128)
      or jsonb_typeof(v_product.source_values) is distinct from 'object'
      or v_product.normalized_observation_hash is null or v_product.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or v_product.observed_at is distinct from v_meta.collected_at
      or v_product.is_present is null
      or (v_product.source_price is not null and (v_product.source_price !~ '^[0-9]{1,18}(?:\.[0-9]{1,8})?$' or v_product.source_price::numeric < 0)) then
      raise exception using errcode = 'P0001', message = 'catalog_import_invalid';
    end if;
    if v_meta.source_system = 'commander' and (
      v_product.source_upc is null or v_product.source_upc !~ '^[0-9]{14}$'
      or v_product.source_modifier is null or v_product.source_modifier !~ '^[0-9]{3}$'
      or v_product.source_product_key <> v_product.source_upc || '/' || v_product.source_modifier
    ) then
      raise exception using errcode = 'P0001', message = 'catalog_import_identity_invalid';
    end if;
  end loop;

  insert into public.pos_catalog_source_import_runs (
    store_id, source_system, source_snapshot_hash, item_source_sha256,
    department_source_sha256, product_normalized_sha256,
    department_normalized_sha256, collected_at, product_count, department_count
  ) values (
    v_meta.store_id, v_meta.source_system, v_meta.source_snapshot_hash,
    v_meta.item_source_sha256, v_meta.department_source_sha256,
    v_meta.product_normalized_sha256, v_meta.department_normalized_sha256,
    v_meta.collected_at, v_meta.product_count, v_meta.department_count
  ) on conflict (store_id, source_system, source_snapshot_hash) do nothing
  returning * into v_run;

  if found then
    null;
  else
    select * into v_run
    from public.pos_catalog_source_import_runs run_row
    where run_row.store_id = v_meta.store_id
      and run_row.source_system = v_meta.source_system
      and run_row.source_snapshot_hash = v_meta.source_snapshot_hash
    for update;
    if not found or v_run.status <> 'completed'
      or v_run.item_source_sha256 <> v_meta.item_source_sha256
      or v_run.department_source_sha256 <> v_meta.department_source_sha256
      or v_run.product_normalized_sha256 <> v_meta.product_normalized_sha256
      or v_run.department_normalized_sha256 <> v_meta.department_normalized_sha256
      or v_run.product_count <> v_meta.product_count
      or v_run.department_count <> v_meta.department_count then
      raise exception using errcode = 'P0001', message = 'catalog_import_conflict';
    end if;
    return query select v_run.id, true, 0, 0, 0, 0;
    return;
  end if;

  for v_department in
    select * from jsonb_to_recordset(p_departments) as value(
      source_department_key text,
      source_name text,
      source_values jsonb,
      normalized_observation_hash text,
      observed_at timestamptz,
      is_present boolean
    )
  loop
    select * into v_existing_department
    from public.pos_catalog_source_departments department_row
    where department_row.store_id = v_meta.store_id
      and department_row.source_system = v_meta.source_system
      and department_row.source_department_key = v_department.source_department_key
    for update;
    if not found then
      insert into public.pos_catalog_source_departments (
        store_id, source_system, source_department_key, source_name, source_values,
        normalized_observation_hash, first_import_run_id, last_import_run_id,
        first_observed_at, last_observed_at, is_present
      ) values (
        v_meta.store_id, v_meta.source_system, v_department.source_department_key,
        v_department.source_name, v_department.source_values, v_department.normalized_observation_hash,
        v_run.id, v_run.id, v_department.observed_at, v_department.observed_at,
        v_department.is_present
      );
      v_department_inserted := v_department_inserted + 1;
    elsif v_department.observed_at >= v_existing_department.last_observed_at then
      update public.pos_catalog_source_departments
      set source_name = v_department.source_name,
          source_values = v_department.source_values,
          normalized_observation_hash = v_department.normalized_observation_hash,
          last_import_run_id = v_run.id,
          last_observed_at = v_department.observed_at,
          is_present = v_department.is_present
      where id = v_existing_department.id;
      v_department_updated := v_department_updated + 1;
    end if;
  end loop;

  for v_product in
    select * from jsonb_to_recordset(p_products) as value(
      source_product_key text,
      source_upc text,
      source_modifier text,
      source_description text,
      source_price text,
      source_department_key text,
      source_active boolean,
      source_values jsonb,
      normalized_observation_hash text,
      observed_at timestamptz,
      is_present boolean
    )
  loop
    v_source_department_id := null;
    if v_product.source_department_key is not null then
      select department_row.id into v_source_department_id
      from public.pos_catalog_source_departments department_row
      where department_row.store_id = v_meta.store_id
        and department_row.source_system = v_meta.source_system
        and department_row.source_department_key = v_product.source_department_key;
    end if;
    select * into v_existing_product
    from public.pos_catalog_source_product_observations product_row
    where product_row.store_id = v_meta.store_id
      and product_row.source_system = v_meta.source_system
      and product_row.source_product_key = v_product.source_product_key
    for update;
    if not found then
      insert into public.pos_catalog_source_product_observations (
        store_id, source_system, source_product_key, source_upc, source_modifier,
        source_description, source_price, source_department_key, source_department_id,
        source_active, source_values, normalized_observation_hash, first_import_run_id,
        last_import_run_id, first_observed_at, last_observed_at, is_present
      ) values (
        v_meta.store_id, v_meta.source_system, v_product.source_product_key,
        v_product.source_upc, v_product.source_modifier, v_product.source_description,
        v_product.source_price::numeric, v_product.source_department_key,
        v_source_department_id, v_product.source_active, v_product.source_values,
        v_product.normalized_observation_hash, v_run.id, v_run.id,
        v_product.observed_at, v_product.observed_at, v_product.is_present
      );
      v_product_inserted := v_product_inserted + 1;
    elsif v_product.observed_at >= v_existing_product.last_observed_at then
      update public.pos_catalog_source_product_observations
      set source_upc = v_product.source_upc,
          source_modifier = v_product.source_modifier,
          source_description = v_product.source_description,
          source_price = v_product.source_price::numeric,
          source_department_key = v_product.source_department_key,
          source_department_id = v_source_department_id,
          source_active = v_product.source_active,
          source_values = v_product.source_values,
          normalized_observation_hash = v_product.normalized_observation_hash,
          last_import_run_id = v_run.id,
          last_observed_at = v_product.observed_at,
          is_present = v_product.is_present
      where id = v_existing_product.id;
      v_product_updated := v_product_updated + 1;
    end if;
  end loop;

  return query select v_run.id, false, v_product_inserted, v_product_updated,
    v_department_inserted, v_department_updated;
end;
$function$;

revoke all on function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb)
  to service_role;

comment on table public.pos_catalog_source_import_runs is
  'Idempotent, source-scoped full-catalog snapshot runs. No raw XML or credentials.';
comment on table public.pos_catalog_source_departments is
  'Current normalized source department observations; names are optional.';
comment on table public.pos_catalog_source_product_observations is
  'Lossless current source product observations; descriptions and department identities are optional.';
comment on function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb) is
  'Atomic service-role-only full-catalog source staging. It does not update canonical products.';

notify pgrst, 'reload schema';
