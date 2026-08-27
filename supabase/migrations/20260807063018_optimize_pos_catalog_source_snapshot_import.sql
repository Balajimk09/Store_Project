-- Replace the initial row-by-row full-catalog staging RPC with set-based work.
-- The staging tables, their RLS policies, and the RPC signature remain unchanged.

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

  perform 1
  from public.stores as store_row
  where store_row.id = v_meta.store_id
  for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'catalog_import_store_invalid';
  end if;

  if exists (
    with departments as materialized (
      select *
      from jsonb_to_recordset(p_departments) as value(source_department_key text)
    )
    select 1
    from departments
    group by source_department_key
    having count(*) > 1
  ) or exists (
    with products as materialized (
      select *
      from jsonb_to_recordset(p_products) as value(source_product_key text)
    )
    select 1
    from products
    group by source_product_key
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_import_invalid';
  end if;

  if exists (
    with departments as materialized (
      select *
      from jsonb_to_recordset(p_departments) as value(
        source_department_key text,
        source_name text,
        source_values jsonb,
        normalized_observation_hash text,
        observed_at timestamptz,
        is_present boolean
      )
    )
    select 1
    from departments
    where source_department_key is null
      or char_length(source_department_key) not between 1 and 128
      or (source_name is not null and char_length(source_name) > 512)
      or jsonb_typeof(source_values) is distinct from 'object'
      or normalized_observation_hash is null or normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or observed_at is distinct from v_meta.collected_at
      or is_present is null
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_import_invalid';
  end if;

  if exists (
    with products as materialized (
      select *
      from jsonb_to_recordset(p_products) as value(
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
    )
    select 1
    from products
    where source_product_key is null
      or char_length(source_product_key) not between 1 and 256
      or (source_upc is not null and char_length(source_upc) not between 1 and 64)
      or (source_modifier is not null and char_length(source_modifier) not between 1 and 64)
      or (source_description is not null and char_length(source_description) > 512)
      or (source_department_key is not null and char_length(source_department_key) not between 1 and 128)
      or jsonb_typeof(source_values) is distinct from 'object'
      or normalized_observation_hash is null or normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or observed_at is distinct from v_meta.collected_at
      or is_present is null
      or (source_price is not null and (
        source_price !~ '^[0-9]{1,18}(?:\.[0-9]{1,8})?$'
        or case when source_price ~ '^[0-9]{1,18}(?:\.[0-9]{1,8})?$' then source_price::numeric < 0 else false end
      ))
      or (v_meta.source_system = 'commander' and (
        source_upc is null or source_upc !~ '^[0-9]{14}$'
        or source_modifier is null or source_modifier !~ '^[0-9]{3}$'
        or source_product_key <> source_upc || '/' || source_modifier
      ))
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_import_identity_invalid';
  end if;

  -- Serialize same-store/source imports so the pre-upsert counts are exact.
  perform pg_advisory_xact_lock(hashtextextended(v_meta.store_id::text || ':' || v_meta.source_system, 0));

  select * into v_run
  from public.pos_catalog_source_import_runs as run_row
  where run_row.store_id = v_meta.store_id
    and run_row.source_system = v_meta.source_system
    and run_row.source_snapshot_hash = v_meta.source_snapshot_hash
  for update;

  if found then
    if v_run.status <> 'completed'
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

  insert into public.pos_catalog_source_import_runs (
    store_id, source_system, source_snapshot_hash, item_source_sha256,
    department_source_sha256, product_normalized_sha256,
    department_normalized_sha256, collected_at, product_count, department_count
  ) values (
    v_meta.store_id, v_meta.source_system, v_meta.source_snapshot_hash,
    v_meta.item_source_sha256, v_meta.department_source_sha256,
    v_meta.product_normalized_sha256, v_meta.department_normalized_sha256,
    v_meta.collected_at, v_meta.product_count, v_meta.department_count
  ) returning * into v_run;

  with departments as materialized (
    select *
    from jsonb_to_recordset(p_departments) as value(
      source_department_key text,
      source_name text,
      source_values jsonb,
      normalized_observation_hash text,
      observed_at timestamptz,
      is_present boolean
    )
  )
  select
    count(*) filter (where current_row.id is null)::integer,
    count(*) filter (where current_row.id is not null and departments.observed_at >= current_row.last_observed_at)::integer
  into v_department_inserted, v_department_updated
  from departments
  left join public.pos_catalog_source_departments as current_row
    on current_row.store_id = v_meta.store_id
   and current_row.source_system = v_meta.source_system
   and current_row.source_department_key = departments.source_department_key;

  insert into public.pos_catalog_source_departments as target (
    store_id, source_system, source_department_key, source_name, source_values,
    normalized_observation_hash, first_import_run_id, last_import_run_id,
    first_observed_at, last_observed_at, is_present
  )
  select
    v_meta.store_id, v_meta.source_system, departments.source_department_key,
    departments.source_name, departments.source_values, departments.normalized_observation_hash,
    v_run.id, v_run.id, departments.observed_at, departments.observed_at, departments.is_present
  from jsonb_to_recordset(p_departments) as departments(
    source_department_key text,
    source_name text,
    source_values jsonb,
    normalized_observation_hash text,
    observed_at timestamptz,
    is_present boolean
  )
  on conflict (store_id, source_system, source_department_key) do update
  set source_name = excluded.source_name,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_import_run_id = excluded.last_import_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = excluded.is_present
  where excluded.last_observed_at >= target.last_observed_at;

  with products as materialized (
    select *
    from jsonb_to_recordset(p_products) as value(
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
  )
  select
    count(*) filter (where current_row.id is null)::integer,
    count(*) filter (where current_row.id is not null and products.observed_at >= current_row.last_observed_at)::integer
  into v_product_inserted, v_product_updated
  from products
  left join public.pos_catalog_source_product_observations as current_row
    on current_row.store_id = v_meta.store_id
   and current_row.source_system = v_meta.source_system
   and current_row.source_product_key = products.source_product_key;

  insert into public.pos_catalog_source_product_observations as target (
    store_id, source_system, source_product_key, source_upc, source_modifier,
    source_description, source_price, source_department_key, source_department_id,
    source_active, source_values, normalized_observation_hash, first_import_run_id,
    last_import_run_id, first_observed_at, last_observed_at, is_present
  )
  select
    v_meta.store_id, v_meta.source_system, products.source_product_key,
    products.source_upc, products.source_modifier, products.source_description,
    products.source_price::numeric, products.source_department_key, departments.id,
    products.source_active, products.source_values, products.normalized_observation_hash,
    v_run.id, v_run.id, products.observed_at, products.observed_at, products.is_present
  from jsonb_to_recordset(p_products) as products(
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
  left join public.pos_catalog_source_departments as departments
    on departments.store_id = v_meta.store_id
   and departments.source_system = v_meta.source_system
   and departments.source_department_key = products.source_department_key
  on conflict (store_id, source_system, source_product_key) do update
  set source_upc = excluded.source_upc,
      source_modifier = excluded.source_modifier,
      source_description = excluded.source_description,
      source_price = excluded.source_price,
      source_department_key = excluded.source_department_key,
      source_department_id = excluded.source_department_id,
      source_active = excluded.source_active,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_import_run_id = excluded.last_import_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = excluded.is_present
  where excluded.last_observed_at >= target.last_observed_at;

  return query select v_run.id, false, v_product_inserted, v_product_updated,
    v_department_inserted, v_department_updated;
end;
$function$;

revoke all on function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb)
  to service_role;

comment on function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb) is
  'Atomic service-role-only full-catalog source staging using set-based validation and upserts.';

notify pgrst, 'reload schema';
