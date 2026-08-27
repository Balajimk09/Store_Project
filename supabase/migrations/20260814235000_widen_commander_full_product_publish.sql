-- Widen the existing Commander update_product queue contract to carry the
-- proven explicit vPLU/uPLU fields through the same connector worker.
--
-- Commander-specific identifiers remain source-specific. This migration does
-- not invent canonical product columns for Commander tax IDs, ID-check IDs,
-- selling unit, max quantity, taxable rebate, or payment product code.
--
-- No raw XML, credentials, cookies, tokens, certificates, URLs, or sessions
-- are stored by this migration.

create or replace function public.pos_publish_commander_sysid_array_is_valid(
  p_values text[]
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_value text;
  v_seen text[] := array[]::text[];
begin
  if p_values is null or cardinality(p_values) > 16 then
    return false;
  end if;

  foreach v_value in array p_values loop
    if v_value is null
      or v_value !~ '^[0-9]{1,16}$'
      or v_value = any(v_seen) then
      return false;
    end if;

    v_seen := array_append(v_seen, v_value);
  end loop;

  return true;
end;
$$;

alter table public.pos_publish_jobs
  add column if not exists expected_payment_product_code text,
  add column if not exists requested_payment_product_code text,

  add column if not exists expected_selling_unit text,
  add column if not exists requested_selling_unit text,

  add column if not exists expected_max_qty_per_trans text,
  add column if not exists requested_max_qty_per_trans text,

  add column if not exists expected_taxable_rebate text,
  add column if not exists requested_taxable_rebate text,

  add column if not exists expected_tax_rate_ids text[],
  add column if not exists requested_tax_rate_ids text[],

  add column if not exists expected_id_check_ids text[],
  add column if not exists requested_id_check_ids text[],

  add column if not exists verification_payment_product_code text,
  add column if not exists verification_selling_unit text,
  add column if not exists verification_max_qty_per_trans text,
  add column if not exists verification_taxable_rebate text,
  add column if not exists verification_tax_rate_ids text[],
  add column if not exists verification_id_check_ids text[];

alter table public.pos_publish_jobs
  drop constraint if exists pos_publish_jobs_full_product_contract_check;

alter table public.pos_publish_jobs
  add constraint pos_publish_jobs_full_product_contract_check
  check (
    (
      operation::text = 'update_price'
      and expected_payment_product_code is null
      and requested_payment_product_code is null
      and expected_selling_unit is null
      and requested_selling_unit is null
      and expected_max_qty_per_trans is null
      and requested_max_qty_per_trans is null
      and expected_taxable_rebate is null
      and requested_taxable_rebate is null
      and expected_tax_rate_ids is null
      and requested_tax_rate_ids is null
      and expected_id_check_ids is null
      and requested_id_check_ids is null
    )
    or
    (
      operation::text = 'update_product'
      and (
        (
          -- Legacy update_product rows remain structurally valid during rollout.
          expected_payment_product_code is null
          and requested_payment_product_code is null
          and expected_selling_unit is null
          and requested_selling_unit is null
          and expected_max_qty_per_trans is null
          and requested_max_qty_per_trans is null
          and expected_taxable_rebate is null
          and requested_taxable_rebate is null
          and expected_tax_rate_ids is null
          and requested_tax_rate_ids is null
          and expected_id_check_ids is null
          and requested_id_check_ids is null
        )
        or
        (
          expected_payment_product_code ~ '^[0-9]{1,16}$'
          and requested_payment_product_code ~ '^[0-9]{1,16}$'

          and expected_selling_unit
            ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'
          and requested_selling_unit
            ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'

          and expected_max_qty_per_trans
            ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
          and requested_max_qty_per_trans
            ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'

          and expected_taxable_rebate
            ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
          and requested_taxable_rebate
            ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'

          and public.pos_publish_commander_sysid_array_is_valid(
            expected_tax_rate_ids
          )
          and public.pos_publish_commander_sysid_array_is_valid(
            requested_tax_rate_ids
          )

          and public.pos_publish_commander_sysid_array_is_valid(
            expected_id_check_ids
          )
          and public.pos_publish_commander_sysid_array_is_valid(
            requested_id_check_ids
          )
        )
      )
    )
  );

alter table public.pos_publish_jobs
  drop constraint if exists pos_publish_jobs_full_product_verification_check;

alter table public.pos_publish_jobs
  add constraint pos_publish_jobs_full_product_verification_check
  check (
    (
      verification_payment_product_code is null
      and verification_selling_unit is null
      and verification_max_qty_per_trans is null
      and verification_taxable_rebate is null
      and verification_tax_rate_ids is null
      and verification_id_check_ids is null
    )
    or
    (
      verification_payment_product_code ~ '^[0-9]{1,16}$'

      and verification_selling_unit
        ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'

      and verification_max_qty_per_trans
        ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'

      and verification_taxable_rebate
        ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'

      and public.pos_publish_commander_sysid_array_is_valid(
        verification_tax_rate_ids
      )

      and public.pos_publish_commander_sysid_array_is_valid(
        verification_id_check_ids
      )
    )
  );

-- A legacy active update_product cannot safely be converted to the new contract,
-- because the database did not previously persist its expected Commander values.
-- Refuse migration application rather than inventing those values.
do $$
begin
  if exists (
    select 1
    from public.pos_publish_jobs job
    where job.operation::text = 'update_product'
      and job.status::text in (
        'pending',
        'claimed',
        'sending',
        'verifying'
      )
      and job.expected_payment_product_code is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'active legacy Commander product publish job must be resolved before contract upgrade';
  end if;
end;
$$;

-- New full-product request overload.
-- The existing legacy request overload is intentionally retained for rollout
-- compatibility. New application code will use this exact extended signature.
create or replace function public.request_commander_product_update(
  p_store_id uuid,
  p_product_id uuid,

  p_expected_description text,
  p_requested_description text,

  p_expected_department text,
  p_requested_department_name text,

  p_expected_price numeric,
  p_requested_price numeric,

  p_expected_payment_product_code text,
  p_requested_payment_product_code text,

  p_expected_selling_unit text,
  p_requested_selling_unit text,

  p_expected_max_qty_per_trans text,
  p_requested_max_qty_per_trans text,

  p_expected_taxable_rebate text,
  p_requested_taxable_rebate text,

  p_expected_tax_rate_ids text[],
  p_requested_tax_rate_ids text[],

  p_expected_id_check_ids text[],
  p_requested_id_check_ids text[],

  p_idempotency_key text
)
returns table (
  job_id uuid,
  status text,
  expected_price text,
  requested_price text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_effective record;

  v_connector_id uuid;
  v_connector_count integer;

  v_requested_department text;
  v_requested_department_name text;
  v_department_count integer;

  v_payload jsonb;

  v_existing public.pos_publish_jobs%rowtype;
  v_inserted public.pos_publish_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if p_expected_description is null
    or char_length(p_expected_description) not between 1 and 512
    or p_expected_description ~ '[[:cntrl:]]'
    or p_requested_description is null
    or char_length(p_requested_description) not between 1 and 512
    or p_requested_description ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '22023',
      message = 'product description is invalid';
  end if;

  if p_expected_department is null
    or p_expected_department !~ '^[0-9]{1,16}$' then
    raise exception using
      errcode = '22023',
      message = 'expected department is invalid';
  end if;

  if p_requested_department_name is not null
    and (
      char_length(btrim(p_requested_department_name)) not between 1 and 256
      or btrim(p_requested_department_name) ~ '[[:cntrl:]]'
    ) then
    raise exception using
      errcode = '22023',
      message = 'requested department is invalid';
  end if;

  if p_expected_price is null
    or p_expected_price <= 0
    or p_expected_price > 999999.99
    or p_expected_price <> round(p_expected_price, 2)
    or p_requested_price is null
    or p_requested_price <= 0
    or p_requested_price > 999999.99
    or p_requested_price <> round(p_requested_price, 2) then
    raise exception using
      errcode = '22023',
      message = 'product price is invalid';
  end if;

  if p_expected_payment_product_code is null
    or p_expected_payment_product_code !~ '^[0-9]{1,16}$'
    or p_requested_payment_product_code is null
    or p_requested_payment_product_code !~ '^[0-9]{1,16}$' then
    raise exception using
      errcode = '22023',
      message = 'payment product code is invalid';
  end if;

  if p_expected_selling_unit is null
    or p_expected_selling_unit
      !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'
    or p_requested_selling_unit is null
    or p_requested_selling_unit
      !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$' then
    raise exception using
      errcode = '22023',
      message = 'selling unit is invalid';
  end if;

  if p_expected_max_qty_per_trans is null
    or p_expected_max_qty_per_trans
      !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
    or p_requested_max_qty_per_trans is null
    or p_requested_max_qty_per_trans
      !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' then
    raise exception using
      errcode = '22023',
      message = 'maximum quantity per transaction is invalid';
  end if;

  if p_expected_taxable_rebate is null
    or p_expected_taxable_rebate
      !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
    or p_requested_taxable_rebate is null
    or p_requested_taxable_rebate
      !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' then
    raise exception using
      errcode = '22023',
      message = 'taxable rebate is invalid';
  end if;

  if not public.pos_publish_commander_sysid_array_is_valid(
      p_expected_tax_rate_ids
    )
    or not public.pos_publish_commander_sysid_array_is_valid(
      p_requested_tax_rate_ids
    ) then
    raise exception using
      errcode = '22023',
      message = 'tax rate identifiers are invalid';
  end if;

  if not public.pos_publish_commander_sysid_array_is_valid(
      p_expected_id_check_ids
    )
    or not public.pos_publish_commander_sysid_array_is_valid(
      p_requested_id_check_ids
    ) then
    raise exception using
      errcode = '22023',
      message = 'ID check identifiers are invalid';
  end if;

  if p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' then
    raise exception using
      errcode = '22023',
      message = 'idempotency key is invalid';
  end if;

  if not exists (
    select 1
    from public.stores store
    where store.id = p_store_id
      and store.owner_id = v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'store access denied';
  end if;

  perform 1
  from public.products product
  where product.id = p_product_id
    and product.store_id = p_store_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'product mapping is stale or invalid';
  end if;

  -- The normalized source catalog currently persists the proven base product
  -- state only. Therefore the database can stale-check description,
  -- department, and price here. The existing connector adapter performs the
  -- full live pre-read stale check for every extended expected field before
  -- Commander mutation.
  select *
  into v_effective
  from public.commander_effective_product_state(
    p_store_id,
    p_product_id
  );

  if not found
    or v_effective.commander_description
      is distinct from p_expected_description
    or v_effective.commander_department_key
      is distinct from p_expected_department
    or v_effective.commander_price
      is distinct from p_expected_price then
    raise exception using
      errcode = '23514',
      message = 'effective Commander product state is stale or missing';
  end if;

  if p_requested_department_name is null then
    v_requested_department :=
      p_expected_department;
  else
    select count(*)::integer
    into v_department_count
    from public.pos_catalog_source_master_data_mappings mapping
    join public.store_departments department
      on department.id = mapping.canonical_department_id
     and department.store_id = p_store_id
    where mapping.store_id = p_store_id
      and mapping.source_system = 'commander'
      and mapping.entity_type = 'department'
      and mapping.status = 'mapped'
      and lower(btrim(department.name))
        = lower(btrim(p_requested_department_name));

    if v_department_count <> 1 then
      raise exception using
        errcode = '23514',
        message = 'requested department mapping is unavailable or ambiguous';
    end if;

    select mapping.source_key
    into v_requested_department
    from public.pos_catalog_source_master_data_mappings mapping
    join public.store_departments department
      on department.id = mapping.canonical_department_id
     and department.store_id = p_store_id
    where mapping.store_id = p_store_id
      and mapping.source_system = 'commander'
      and mapping.entity_type = 'department'
      and mapping.status = 'mapped'
      and lower(btrim(department.name))
        = lower(btrim(p_requested_department_name));
  end if;

  select
    count(*)::integer,
    min(department.name)
  into
    v_department_count,
    v_requested_department_name
  from public.pos_catalog_source_master_data_mappings mapping
  join public.store_departments department
    on department.id = mapping.canonical_department_id
   and department.store_id = p_store_id
  where mapping.store_id = p_store_id
    and mapping.source_system = 'commander'
    and mapping.entity_type = 'department'
    and mapping.status = 'mapped'
    and mapping.source_key = v_requested_department;

  if v_department_count <> 1
    or v_requested_department !~ '^[0-9]{1,16}$' then
    raise exception using
      errcode = '23514',
      message = 'Commander department mapping is unavailable or ambiguous';
  end if;

  if p_expected_description = p_requested_description
    and p_expected_department = v_requested_department
    and p_expected_price = p_requested_price

    and p_expected_payment_product_code
      = p_requested_payment_product_code

    and p_expected_selling_unit
      = p_requested_selling_unit

    and p_expected_max_qty_per_trans
      = p_requested_max_qty_per_trans

    and p_expected_taxable_rebate
      = p_requested_taxable_rebate

    and p_expected_tax_rate_ids
      = p_requested_tax_rate_ids

    and p_expected_id_check_ids
      = p_requested_id_check_ids then
    raise exception using
      errcode = '22023',
      message = 'requested product state is unchanged';
  end if;

  select count(*)::integer
  into v_connector_count
  from public.store_pos_connectors connector
  where connector.store_id = p_store_id
    and connector.status = 'active';

  if v_connector_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'exactly one active connector is required';
  end if;

  select connector.id
  into v_connector_id
  from public.store_pos_connectors connector
  where connector.store_id = p_store_id
    and connector.status = 'active';

  -- Keep the existing bounded payload schema unchanged.
  -- Extended normalized values have dedicated columns.
  v_payload := jsonb_build_object(
    'expected',
    jsonb_build_object(
      'description', p_expected_description,
      'department', p_expected_department,
      'price', p_expected_price
    ),
    'requested',
    jsonb_build_object(
      'description', p_requested_description,
      'department', v_requested_department,
      'department_name', v_requested_department_name,
      'price', p_requested_price
    )
  );

  select job.*
  into v_existing
  from public.pos_publish_jobs job
  where job.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.store_id is distinct from p_store_id
      or v_existing.product_id is distinct from p_product_id
      or v_existing.requested_by is distinct from v_user_id
      or v_existing.assigned_connector_id is distinct from v_connector_id
      or v_existing.operation::text <> 'update_product'
      or v_existing.payload is distinct from v_payload
      or v_existing.expected_price is distinct from p_expected_price
      or v_existing.requested_price is distinct from p_requested_price

      or v_existing.expected_payment_product_code
        is distinct from p_expected_payment_product_code
      or v_existing.requested_payment_product_code
        is distinct from p_requested_payment_product_code

      or v_existing.expected_selling_unit
        is distinct from p_expected_selling_unit
      or v_existing.requested_selling_unit
        is distinct from p_requested_selling_unit

      or v_existing.expected_max_qty_per_trans
        is distinct from p_expected_max_qty_per_trans
      or v_existing.requested_max_qty_per_trans
        is distinct from p_requested_max_qty_per_trans

      or v_existing.expected_taxable_rebate
        is distinct from p_expected_taxable_rebate
      or v_existing.requested_taxable_rebate
        is distinct from p_requested_taxable_rebate

      or v_existing.expected_tax_rate_ids
        is distinct from p_expected_tax_rate_ids
      or v_existing.requested_tax_rate_ids
        is distinct from p_requested_tax_rate_ids

      or v_existing.expected_id_check_ids
        is distinct from p_expected_id_check_ids
      or v_existing.requested_id_check_ids
        is distinct from p_requested_id_check_ids then
      raise exception using
        errcode = '23505',
        message = 'idempotency key conflict';
    end if;

    return query
    select
      v_existing.id,
      v_existing.status::text,
      to_char(
        v_existing.expected_price,
        'FM9999999999990.00'
      ),
      to_char(
        v_existing.requested_price,
        'FM9999999999990.00'
      ),
      v_existing.created_at;

    return;
  end if;

  select active_job.*
  into v_existing
  from public.pos_publish_jobs active_job
  where active_job.store_id = p_store_id
    and active_job.operation::text in (
      'update_price',
      'update_product'
    )
    and active_job.status::text in (
      'pending',
      'claimed',
      'sending',
      'verifying'
    )
  order by
    active_job.created_at asc,
    active_job.id asc
  limit 1
  for update;

  if found then
    if v_existing.operation::text = 'update_product'
      and v_existing.product_id is not distinct from p_product_id
      and v_existing.requested_by is not distinct from v_user_id
      and v_existing.assigned_connector_id is not distinct from v_connector_id
      and v_existing.payload is not distinct from v_payload
      and v_existing.expected_price is not distinct from p_expected_price
      and v_existing.requested_price is not distinct from p_requested_price

      and v_existing.expected_payment_product_code
        is not distinct from p_expected_payment_product_code
      and v_existing.requested_payment_product_code
        is not distinct from p_requested_payment_product_code

      and v_existing.expected_selling_unit
        is not distinct from p_expected_selling_unit
      and v_existing.requested_selling_unit
        is not distinct from p_requested_selling_unit

      and v_existing.expected_max_qty_per_trans
        is not distinct from p_expected_max_qty_per_trans
      and v_existing.requested_max_qty_per_trans
        is not distinct from p_requested_max_qty_per_trans

      and v_existing.expected_taxable_rebate
        is not distinct from p_expected_taxable_rebate
      and v_existing.requested_taxable_rebate
        is not distinct from p_requested_taxable_rebate

      and v_existing.expected_tax_rate_ids
        is not distinct from p_expected_tax_rate_ids
      and v_existing.requested_tax_rate_ids
        is not distinct from p_requested_tax_rate_ids

      and v_existing.expected_id_check_ids
        is not distinct from p_expected_id_check_ids
      and v_existing.requested_id_check_ids
        is not distinct from p_requested_id_check_ids then

      return query
      select
        v_existing.id,
        v_existing.status::text,
        to_char(
          v_existing.expected_price,
          'FM9999999999990.00'
        ),
        to_char(
          v_existing.requested_price,
          'FM9999999999990.00'
        ),
        v_existing.created_at;

      return;
    end if;

    raise exception using
      errcode = '23505',
      message = 'a different Commander update is already active';
  end if;

  insert into public.pos_publish_jobs (
    store_id,
    product_id,
    requested_by,
    assigned_connector_id,
    operation,
    status,
    payload,
    expected_price,
    requested_price,

    expected_payment_product_code,
    requested_payment_product_code,

    expected_selling_unit,
    requested_selling_unit,

    expected_max_qty_per_trans,
    requested_max_qty_per_trans,

    expected_taxable_rebate,
    requested_taxable_rebate,

    expected_tax_rate_ids,
    requested_tax_rate_ids,

    expected_id_check_ids,
    requested_id_check_ids,

    idempotency_key,
    audit_metadata
  )
  values (
    p_store_id,
    p_product_id,
    v_user_id,
    v_connector_id,
    'update_product',
    'pending',
    v_payload,
    p_expected_price,
    p_requested_price,

    p_expected_payment_product_code,
    p_requested_payment_product_code,

    p_expected_selling_unit,
    p_requested_selling_unit,

    p_expected_max_qty_per_trans,
    p_requested_max_qty_per_trans,

    p_expected_taxable_rebate,
    p_requested_taxable_rebate,

    p_expected_tax_rate_ids,
    p_requested_tax_rate_ids,

    p_expected_id_check_ids,
    p_requested_id_check_ids,

    p_idempotency_key,
    '{}'::jsonb
  )
  returning *
  into v_inserted;

  return query
  select
    v_inserted.id,
    v_inserted.status::text,
    to_char(
      v_inserted.expected_price,
      'FM9999999999990.00'
    ),
    to_char(
      v_inserted.requested_price,
      'FM9999999999990.00'
    ),
    v_inserted.created_at;
end;
$$;

-- Full connector claim overload.
-- The one-argument legacy claim function remains available for the older
-- price-only contract.
-- PostgreSQL cannot change a function's RETURNS TABLE shape through CREATE OR
-- REPLACE. This exact two-argument overload was introduced by the prior
-- product-publish migration with the smaller V1 claim shape, so replace only
-- that overload. The grants are re-established below with the other hardened
-- full-product RPC grants.
drop function if exists public.claim_pos_publish_job(uuid, text[]);

create or replace function public.claim_pos_publish_job(
  p_connector_id uuid,
  p_capabilities text[]
)
returns table (
  job_id uuid,
  operation text,
  product_id uuid,
  upc text,
  modifier text,

  expected_description text,
  description text,

  expected_department text,
  department text,

  expected_price text,
  price text,

  expected_payment_product_code text,
  payment_product_code text,

  expected_selling_unit text,
  selling_unit text,

  expected_max_qty_per_trans text,
  max_qty_per_trans text,

  expected_taxable_rebate text,
  taxable_rebate text,

  expected_tax_rate_ids text[],
  tax_rate_ids text[],

  expected_id_check_ids text[],
  id_check_ids text[],

  attempt integer,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_connector_store_id uuid;
  v_job public.pos_publish_jobs%rowtype;
  v_effective record;
  v_failure_code text;
  v_claimed_at timestamptz := now();
begin
  if p_capabilities is null
    or cardinality(p_capabilities) > 16 then
    raise exception using
      errcode = '22023',
      message = 'connector capabilities are invalid';
  end if;

  select connector.store_id
  into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id
    and connector.status = 'active';

  if not found then
    raise exception using
      errcode = '42501',
      message = 'connector is not authorized to claim publishing jobs';
  end if;

  select job.*
  into v_job
  from public.pos_publish_jobs job
  where job.assigned_connector_id = p_connector_id
    and job.store_id = v_connector_store_id
    and job.status::text = 'pending'
    and (
      job.operation::text = 'update_price'
      or (
        job.operation::text = 'update_product'
        and 'update_product' = any(p_capabilities)
      )
    )
  order by
    job.created_at asc,
    job.id asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  if v_job.operation::text = 'update_price' then
    select *
    into v_effective
    from public.commander_effective_price_state(
      v_job.store_id,
      v_job.product_id
    );

    if not found then
      v_failure_code := 'source_identity_missing';
    elsif v_effective.commander_price
      is distinct from v_job.expected_price then
      v_failure_code := 'stale_expected_price';
    end if;

  elsif v_job.operation::text = 'update_product' then
    -- Never allow a legacy partial product contract to reach Commander.
    if v_job.expected_payment_product_code is null then
      update public.pos_publish_jobs
      set
        status = 'failed',
        failed_at = v_claimed_at,
        audit_metadata = jsonb_build_object(
          'failure_code',
          'internal_connector_error'
        )
      where id = v_job.id;

      return;
    end if;

    select *
    into v_effective
    from public.commander_effective_product_state(
      v_job.store_id,
      v_job.product_id
    );

    if not found then
      v_failure_code := 'source_identity_missing';

    elsif v_effective.commander_description
      is distinct from (v_job.payload #>> '{expected,description}') then
      v_failure_code := 'stale_expected_product';

    elsif v_effective.commander_department_key
      is distinct from (v_job.payload #>> '{expected,department}') then
      v_failure_code := 'stale_expected_product';

    elsif v_effective.commander_price
      is distinct from v_job.expected_price then
      v_failure_code := 'stale_expected_price';
    end if;

  else
    v_failure_code := 'internal_connector_error';
  end if;

  if v_failure_code is not null then
    -- Persist only an existing safe diagnostic code in audit metadata.
    -- Do not expose Commander response contents.
    update public.pos_publish_jobs
    set
      status = 'failed',
      failed_at = v_claimed_at,
      audit_metadata = jsonb_build_object(
        'failure_code',
        case
          when v_failure_code in (
            'source_identity_missing',
            'stale_expected_price'
          )
          then v_failure_code
          else 'internal_connector_error'
        end
      )
    where id = v_job.id;

    return;
  end if;

  update public.pos_publish_jobs
  set
    status = 'claimed',
    claimed_by_connector_id = p_connector_id,
    claimed_at = v_claimed_at,
    attempt_count = attempt_count + 1
  where id = v_job.id;

  return query
  select
    v_job.id,
    v_job.operation::text,
    v_job.product_id,

    v_effective.source_upc,
    v_effective.source_modifier,

    case
      when v_job.operation::text = 'update_product'
      then v_job.payload #>> '{expected,description}'
      else null
    end,

    case
      when v_job.operation::text = 'update_product'
      then v_job.payload #>> '{requested,description}'
      else null
    end,

    case
      when v_job.operation::text = 'update_product'
      then v_job.payload #>> '{expected,department}'
      else null
    end,

    case
      when v_job.operation::text = 'update_product'
      then v_job.payload #>> '{requested,department}'
      else null
    end,

    to_char(
      v_job.expected_price,
      'FM9999999999990.00'
    ),

    to_char(
      v_job.requested_price,
      'FM9999999999990.00'
    ),

    v_job.expected_payment_product_code,
    v_job.requested_payment_product_code,

    v_job.expected_selling_unit,
    v_job.requested_selling_unit,

    v_job.expected_max_qty_per_trans,
    v_job.requested_max_qty_per_trans,

    v_job.expected_taxable_rebate,
    v_job.requested_taxable_rebate,

    v_job.expected_tax_rate_ids,
    v_job.requested_tax_rate_ids,

    v_job.expected_id_check_ids,
    v_job.requested_id_check_ids,

    v_job.attempt_count + 1,
    v_claimed_at;
end;
$$;

-- Full verification overload consumed by the widened Edge report contract.
-- Existing old overloads remain in place for rollout compatibility.
create or replace function public.report_pos_publish_job_status(
  p_connector_id uuid,
  p_job_id uuid,
  p_status text,

  p_verification_upc text,
  p_verification_modifier text,

  p_verification_description text,
  p_verification_department text,
  p_verification_price numeric,

  p_verification_payment_product_code text,
  p_verification_selling_unit text,
  p_verification_max_qty_per_trans text,
  p_verification_taxable_rebate text,
  p_verification_tax_rate_ids text[],
  p_verification_id_check_ids text[],

  p_failure_code text,
  p_failure_message text
)
returns table (
  job_id uuid,
  status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_connector_store_id uuid;

  v_job public.pos_publish_jobs%rowtype;
  v_product public.products%rowtype;
  v_identity public.product_source_identities%rowtype;

  v_identity_count integer;
  v_full_product_contract boolean;

  v_now timestamptz := now();

  v_safe_failure_codes text[] := array[
    'commander_auth_failed',
    'commander_unreachable',
    'commander_tls_failed',
    'plu_not_found',
    'plu_identity_mismatch',
    'update_rejected',
    'price_conflict',
    'verification_failed',
    'job_expired',
    'internal_connector_error'
  ];
begin
  if p_status not in (
    'sending',
    'verifying',
    'completed',
    'failed'
  ) then
    raise exception using
      errcode = '22023',
      message = 'publishing job status is not allowed';
  end if;

  select connector.store_id
  into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id
    and connector.status = 'active';

  if not found then
    raise exception using
      errcode = '42501',
      message = 'connector is not authorized to report publishing jobs';
  end if;

  select job.*
  into v_job
  from public.pos_publish_jobs job
  where job.id = p_job_id
  for update;

  if not found
    or v_job.store_id is distinct from v_connector_store_id
    or v_job.assigned_connector_id is distinct from p_connector_id
    or v_job.claimed_by_connector_id is distinct from p_connector_id then
    raise exception using
      errcode = '42501',
      message = 'connector is not authorized to report this publishing job';
  end if;

  if p_status = 'sending' then
    if v_job.status::text <> 'claimed' then
      raise exception using
        errcode = '23514',
        message = 'publishing job status transition is not allowed';
    end if;

    update public.pos_publish_jobs
    set status = 'sending'
    where id = v_job.id;

  elsif p_status = 'verifying' then
    if v_job.status::text <> 'sending' then
      raise exception using
        errcode = '23514',
        message = 'publishing job status transition is not allowed';
    end if;

    update public.pos_publish_jobs
    set status = 'verifying'
    where id = v_job.id;

  elsif p_status = 'completed' then
    if v_job.status::text <> 'verifying'
      or p_verification_upc is null
      or p_verification_upc !~ '^[0-9]{14}$'
      or p_verification_modifier is null
      or p_verification_modifier !~ '^[0-9]{3}$'
      or p_verification_price is null
      or p_verification_price <= 0
      or p_verification_price > 999999.99
      or p_verification_price <> round(p_verification_price, 2) then
      raise exception using
        errcode = '23514',
        message = 'publishing job completion verification is invalid';
    end if;

    select product.*
    into v_product
    from public.products product
    where product.id = v_job.product_id
      and product.store_id = v_job.store_id
    for update;

    select count(*)::integer
    into v_identity_count
    from public.product_source_identities identity
    where identity.store_id = v_job.store_id
      and identity.product_id = v_job.product_id
      and identity.source_system = 'commander'
      and identity.source_upc ~ '^[0-9]{14}$'
      and identity.source_modifier ~ '^[0-9]{3}$'
      and identity.source_product_key
        = identity.source_upc
          || '/'
          || identity.source_modifier;

    if v_product.id is null
      or v_identity_count <> 1 then
      raise exception using
        errcode = '23514',
        message = 'publishing job completion identity is invalid';
    end if;

    select identity.*
    into v_identity
    from public.product_source_identities identity
    where identity.store_id = v_job.store_id
      and identity.product_id = v_job.product_id
      and identity.source_system = 'commander'
      and identity.source_upc ~ '^[0-9]{14}$'
      and identity.source_modifier ~ '^[0-9]{3}$'
      and identity.source_product_key
        = identity.source_upc
          || '/'
          || identity.source_modifier;

    if v_product.upc is distinct from v_identity.source_upc
      or p_verification_upc is distinct from v_identity.source_upc
      or p_verification_modifier is distinct from v_identity.source_modifier
      or v_job.requested_price is distinct from p_verification_price then
      raise exception using
        errcode = '23514',
        message = 'publishing job completion verification does not match';
    end if;

    if v_job.operation::text = 'update_product' then
      if p_verification_description is null
        or char_length(p_verification_description) not between 1 and 512
        or p_verification_description ~ '[[:cntrl:]]'
        or p_verification_department is null
        or p_verification_department !~ '^[0-9]{1,16}$'
        or p_verification_description
          is distinct from (
            v_job.payload #>> '{requested,description}'
          )
        or p_verification_department
          is distinct from (
            v_job.payload #>> '{requested,department}'
          ) then
        raise exception using
          errcode = '23514',
          message = 'product verification does not match requested state';
      end if;

      v_full_product_contract :=
        v_job.expected_payment_product_code is not null;

      if v_full_product_contract then
        if p_verification_payment_product_code is null
          or p_verification_payment_product_code
            !~ '^[0-9]{1,16}$'

          or p_verification_selling_unit is null
          or p_verification_selling_unit
            !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'

          or p_verification_max_qty_per_trans is null
          or p_verification_max_qty_per_trans
            !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'

          or p_verification_taxable_rebate is null
          or p_verification_taxable_rebate
            !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'

          or not public.pos_publish_commander_sysid_array_is_valid(
            p_verification_tax_rate_ids
          )

          or not public.pos_publish_commander_sysid_array_is_valid(
            p_verification_id_check_ids
          )

          or p_verification_payment_product_code
            is distinct from v_job.requested_payment_product_code

          or p_verification_selling_unit
            is distinct from v_job.requested_selling_unit

          or p_verification_max_qty_per_trans
            is distinct from v_job.requested_max_qty_per_trans

          or p_verification_taxable_rebate
            is distinct from v_job.requested_taxable_rebate

          or p_verification_tax_rate_ids
            is distinct from v_job.requested_tax_rate_ids

          or p_verification_id_check_ids
            is distinct from v_job.requested_id_check_ids then
          raise exception using
            errcode = '23514',
            message = 'full product verification does not match requested state';
        end if;

      elsif p_verification_payment_product_code is not null
        or p_verification_selling_unit is not null
        or p_verification_max_qty_per_trans is not null
        or p_verification_taxable_rebate is not null
        or p_verification_tax_rate_ids is not null
        or p_verification_id_check_ids is not null then
        raise exception using
          errcode = '23514',
          message = 'legacy product verification contained unsupported extended fields';
      end if;

      -- Canonical StorePulse fields are updated only where an existing
      -- canonical semantic already exists. Commander-specific values remain
      -- normalized on the verified publish job until their canonical mappings
      -- are explicitly defined.
      update public.products
      set
        item_name =
          v_job.payload #>> '{requested,description}',

        department =
          v_job.payload #>> '{requested,department_name}',

        selling_price =
          v_job.requested_price,

        updated_at =
          v_now
      where id = v_job.product_id
        and store_id = v_job.store_id;

      update public.pos_publish_jobs
      set
        status = 'completed',
        completed_at = v_now,

        verification_payment_product_code =
          case
            when v_full_product_contract
            then p_verification_payment_product_code
            else null
          end,

        verification_selling_unit =
          case
            when v_full_product_contract
            then p_verification_selling_unit
            else null
          end,

        verification_max_qty_per_trans =
          case
            when v_full_product_contract
            then p_verification_max_qty_per_trans
            else null
          end,

        verification_taxable_rebate =
          case
            when v_full_product_contract
            then p_verification_taxable_rebate
            else null
          end,

        verification_tax_rate_ids =
          case
            when v_full_product_contract
            then p_verification_tax_rate_ids
            else null
          end,

        verification_id_check_ids =
          case
            when v_full_product_contract
            then p_verification_id_check_ids
            else null
          end,

        audit_metadata =
          jsonb_build_object(
            'verification_upc',
            p_verification_upc,

            'verification_modifier',
            p_verification_modifier,

            'verification_description',
            p_verification_description,

            'verification_department',
            p_verification_department,

            'verification_price',
            p_verification_price
          )
      where id = v_job.id;

    elsif v_job.operation::text = 'update_price' then
      if p_verification_description is not null
        or p_verification_department is not null

        or p_verification_payment_product_code is not null
        or p_verification_selling_unit is not null
        or p_verification_max_qty_per_trans is not null
        or p_verification_taxable_rebate is not null
        or p_verification_tax_rate_ids is not null
        or p_verification_id_check_ids is not null then
        raise exception using
          errcode = '23514',
          message = 'price verification contained unsupported product fields';
      end if;

      update public.products
      set
        selling_price = v_job.requested_price,
        updated_at = v_now
      where id = v_job.product_id
        and store_id = v_job.store_id;

      update public.pos_publish_jobs
      set
        status = 'completed',
        completed_at = v_now,
        audit_metadata =
          jsonb_build_object(
            'verification_upc',
            p_verification_upc,

            'verification_modifier',
            p_verification_modifier,

            'verification_price',
            p_verification_price
          )
      where id = v_job.id;

    else
      raise exception using
        errcode = '23514',
        message = 'publishing job operation is not supported';
    end if;

  else
    if v_job.status::text not in (
        'claimed',
        'sending',
        'verifying'
      )
      or p_failure_code is null
      or not (
        p_failure_code = any(v_safe_failure_codes)
      )
      or not public.pos_publish_failure_message_is_safe(
        p_failure_message
      ) then
      raise exception using
        errcode = '23514',
        message = 'publishing job failure details are invalid';
    end if;

    update public.pos_publish_jobs
    set
      status = 'failed',
      failed_at = v_now,

      audit_metadata =
        jsonb_strip_nulls(
          jsonb_build_object(
            'failure_code',
            p_failure_code,

            'completion_note',
            nullif(p_failure_message, '')
          )
        )
    where id = v_job.id;
  end if;

  return query
  select
    v_job.id,
    p_status;
end;
$$;

revoke all
on function public.request_commander_product_update(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  text[],
  text[],
  text
)
from public;

grant execute
on function public.request_commander_product_update(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  text[],
  text[],
  text
)
to authenticated;

revoke all
on function public.claim_pos_publish_job(
  uuid,
  text[]
)
from public, anon, authenticated;

grant execute
on function public.claim_pos_publish_job(
  uuid,
  text[]
)
to service_role;

revoke all
on function public.report_pos_publish_job_status(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text[],
  text[],
  text,
  text
)
from public, anon, authenticated;

grant execute
on function public.report_pos_publish_job_status(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text[],
  text[],
  text,
  text
)
to service_role;
