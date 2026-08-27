-- Generalize the proven Commander price bridge to a bounded product update for
-- description + department + price. UPC/modifier remain immutable identities.
-- No raw Commander XML, credentials, cookies, tokens, or certificate data are stored.

alter table public.pos_publish_jobs
  drop constraint if exists pos_publish_jobs_operation_check;

alter table public.pos_publish_jobs
  add constraint pos_publish_jobs_operation_check
  check (operation::text in ('update_price', 'update_product'));

create or replace function public.pos_publish_payload_is_valid(
  p_operation public.pos_publish_job_operation,
  p_payload jsonb,
  p_expected_price numeric,
  p_requested_price numeric
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_operation::text = 'update_price' then
      jsonb_typeof(p_payload) = 'object'
      and p_payload = jsonb_build_object('price', p_requested_price)
    when p_operation::text = 'update_product' then
      jsonb_typeof(p_payload) = 'object'
      and jsonb_typeof(p_payload -> 'expected') = 'object'
      and jsonb_typeof(p_payload -> 'requested') = 'object'
      and jsonb_typeof(p_payload #> '{expected,description}') = 'string'
      and char_length(p_payload #>> '{expected,description}') between 1 and 512
      and (p_payload #>> '{expected,description}') !~ '[[:cntrl:]]'
      and jsonb_typeof(p_payload #> '{expected,department}') = 'string'
      and (p_payload #>> '{expected,department}') ~ '^[0-9]{1,16}$'
      and jsonb_typeof(p_payload #> '{requested,description}') = 'string'
      and char_length(p_payload #>> '{requested,description}') between 1 and 512
      and (p_payload #>> '{requested,description}') !~ '[[:cntrl:]]'
      and jsonb_typeof(p_payload #> '{requested,department}') = 'string'
      and (p_payload #>> '{requested,department}') ~ '^[0-9]{1,16}$'
      and jsonb_typeof(p_payload #> '{requested,department_name}') = 'string'
      and char_length(p_payload #>> '{requested,department_name}') between 1 and 256
      and (p_payload #>> '{requested,department_name}') !~ '[[:cntrl:]]'
      and p_payload = jsonb_build_object(
        'expected', jsonb_build_object(
          'description', p_payload #>> '{expected,description}',
          'department', p_payload #>> '{expected,department}',
          'price', p_expected_price
        ),
        'requested', jsonb_build_object(
          'description', p_payload #>> '{requested,description}',
          'department', p_payload #>> '{requested,department}',
          'department_name', p_payload #>> '{requested,department_name}',
          'price', p_requested_price
        )
      )
    else false
  end;
$$;

alter table public.pos_publish_jobs
  drop constraint if exists pos_publish_jobs_payload_check;

alter table public.pos_publish_jobs
  add constraint pos_publish_jobs_payload_check
  check (public.pos_publish_payload_is_valid(operation, payload, expected_price, requested_price));

create or replace function public.pos_publish_audit_metadata_is_safe(p_audit_metadata jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select jsonb_typeof(p_audit_metadata) = 'object'
    and not exists (
      select 1
      from jsonb_each(p_audit_metadata) as entry(key, value)
      where entry.key not in (
          'claim_id',
          'failure_code',
          'completion_note',
          'verification_upc',
          'verification_modifier',
          'verification_description',
          'verification_department',
          'verification_price'
        )
        or jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null')
        or (
          entry.key in ('claim_id', 'failure_code', 'completion_note')
          and jsonb_typeof(entry.value) = 'string'
          and not public.pos_publish_failure_message_is_safe(entry.value #>> '{}')
        )
        or (
          entry.key = 'verification_upc'
          and (
            jsonb_typeof(entry.value) <> 'string'
            or entry.value #>> '{}' !~ '^[0-9]{14}$'
          )
        )
        or (
          entry.key = 'verification_modifier'
          and (
            jsonb_typeof(entry.value) <> 'string'
            or entry.value #>> '{}' !~ '^[0-9]{3}$'
          )
        )
        or (
          entry.key = 'verification_description'
          and (
            jsonb_typeof(entry.value) <> 'string'
            or char_length(entry.value #>> '{}') not between 1 and 512
            or entry.value #>> '{}' ~ '[[:cntrl:]]'
          )
        )
        or (
          entry.key = 'verification_department'
          and (
            jsonb_typeof(entry.value) <> 'string'
            or entry.value #>> '{}' !~ '^[0-9]{1,16}$'
          )
        )
        or (
          entry.key = 'verification_price'
          and jsonb_typeof(entry.value) <> 'number'
        )
    );
$$;

alter table public.pos_publish_jobs
  drop constraint if exists pos_publish_jobs_audit_metadata_check;

alter table public.pos_publish_jobs
  add constraint pos_publish_jobs_audit_metadata_check
  check (public.pos_publish_audit_metadata_is_safe(audit_metadata));

drop index if exists public.pos_publish_jobs_one_active_update_price_per_store_uidx;

create unique index if not exists pos_publish_jobs_one_active_commander_mutation_per_store_uidx
  on public.pos_publish_jobs (store_id)
  where operation in ('update_price'::public.pos_publish_job_operation, 'update_product'::public.pos_publish_job_operation)
    and status in (
      'pending'::public.pos_publish_job_status,
      'claimed'::public.pos_publish_job_status,
      'sending'::public.pos_publish_job_status,
      'verifying'::public.pos_publish_job_status
    );

create or replace function public.commander_effective_product_state(
  p_store_id uuid,
  p_product_id uuid
)
returns table (
  product_id uuid,
  source_product_key text,
  source_upc text,
  source_modifier text,
  commander_description text,
  commander_department_key text,
  commander_department_name text,
  commander_price numeric,
  canonical_description text,
  canonical_department text,
  canonical_price numeric,
  observed_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with latest_catalog_run as (
    select run_row.id, run_row.completed_at
    from public.pos_catalog_sync_runs run_row
    where run_row.store_id = p_store_id
      and run_row.source_system = 'commander'
      and run_row.status = 'completed'
      and run_row.catalog_complete = true
      and run_row.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
    order by run_row.completed_at desc, run_row.id desc
    limit 1
  ), exact_identity as (
    select
      identity_row.product_id,
      identity_row.source_product_key,
      identity_row.source_upc,
      identity_row.source_modifier
    from public.product_source_identities identity_row
    where identity_row.store_id = p_store_id
      and identity_row.product_id = p_product_id
      and identity_row.source_system = 'commander'
      and identity_row.source_upc ~ '^[0-9]{14}$'
      and identity_row.source_modifier ~ '^[0-9]{3}$'
      and identity_row.source_product_key = identity_row.source_upc || '/' || identity_row.source_modifier
    limit 2
  ), current_catalog_observation as (
    select
      observation.source_product_key,
      observation.source_upc,
      observation.source_modifier,
      observation.source_description,
      observation.source_department_key,
      observation.source_price,
      observation.last_observed_at as observed_at
    from latest_catalog_run
    join exact_identity identity_row on true
    join public.pos_catalog_source_product_observations observation
      on observation.store_id = p_store_id
     and observation.source_system = 'commander'
     and observation.source_product_key = identity_row.source_product_key
     and observation.source_upc = identity_row.source_upc
     and observation.source_modifier = identity_row.source_modifier
     and observation.last_seen_sync_run_id = latest_catalog_run.id
     and observation.is_present = true
  ), latest_verified_product_publish as (
    select
      job.audit_metadata ->> 'verification_description' as verification_description,
      job.audit_metadata ->> 'verification_department' as verification_department,
      (job.audit_metadata ->> 'verification_price')::numeric as verification_price,
      job.completed_at
    from public.pos_publish_jobs job
    join exact_identity identity_row on true
    where job.store_id = p_store_id
      and job.product_id = p_product_id
      and job.operation::text = 'update_product'
      and job.status::text = 'completed'
      and job.completed_at is not null
      and jsonb_typeof(job.audit_metadata -> 'verification_upc') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_modifier') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_description') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_department') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_price') = 'number'
      and job.audit_metadata ->> 'verification_upc' = identity_row.source_upc
      and job.audit_metadata ->> 'verification_modifier' = identity_row.source_modifier
      and job.audit_metadata ->> 'verification_department' ~ '^[0-9]{1,16}$'
      and (job.audit_metadata ->> 'verification_price')::numeric = job.requested_price
    order by job.completed_at desc, job.id desc
    limit 1
  ), latest_verified_price_publish as (
    select
      (job.audit_metadata ->> 'verification_price')::numeric as verification_price,
      job.completed_at
    from public.pos_publish_jobs job
    join exact_identity identity_row on true
    where job.store_id = p_store_id
      and job.product_id = p_product_id
      and job.operation::text in ('update_price', 'update_product')
      and job.status::text = 'completed'
      and job.completed_at is not null
      and jsonb_typeof(job.audit_metadata -> 'verification_upc') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_modifier') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_price') = 'number'
      and job.audit_metadata ->> 'verification_upc' = identity_row.source_upc
      and job.audit_metadata ->> 'verification_modifier' = identity_row.source_modifier
      and (job.audit_metadata ->> 'verification_price')::numeric = job.requested_price
    order by job.completed_at desc, job.id desc
    limit 1
  ), current_department_name as (
    select department.name
    from current_catalog_observation catalog
    join public.pos_catalog_source_master_data_mappings mapping
      on mapping.store_id = p_store_id
     and mapping.source_system = 'commander'
     and mapping.entity_type = 'department'
     and mapping.source_key = catalog.source_department_key
     and mapping.status = 'mapped'
    join public.store_departments department
      on department.id = mapping.canonical_department_id
     and department.store_id = p_store_id
    order by mapping.updated_at desc, mapping.id desc
    limit 1
  ), verified_department_name as (
    select department.name
    from latest_verified_product_publish verified
    join public.pos_catalog_source_master_data_mappings mapping
      on mapping.store_id = p_store_id
     and mapping.source_system = 'commander'
     and mapping.entity_type = 'department'
     and mapping.source_key = verified.verification_department
     and mapping.status = 'mapped'
    join public.store_departments department
      on department.id = mapping.canonical_department_id
     and department.store_id = p_store_id
    order by mapping.updated_at desc, mapping.id desc
    limit 1
  )
  select
    product.id,
    catalog.source_product_key,
    catalog.source_upc,
    catalog.source_modifier,
    case
      when verified_product.completed_at > catalog.observed_at then verified_product.verification_description
      else catalog.source_description
    end as commander_description,
    case
      when verified_product.completed_at > catalog.observed_at then verified_product.verification_department
      else catalog.source_department_key
    end as commander_department_key,
    case
      when verified_product.completed_at > catalog.observed_at then verified_department.name
      else current_department.name
    end as commander_department_name,
    case
      when verified_price.completed_at > catalog.observed_at then verified_price.verification_price
      else catalog.source_price
    end as commander_price,
    product.item_name as canonical_description,
    product.department as canonical_department,
    product.selling_price as canonical_price,
    greatest(
      catalog.observed_at,
      coalesce(verified_product.completed_at, catalog.observed_at),
      coalesce(verified_price.completed_at, catalog.observed_at)
    ) as observed_at
  from public.products product
  join exact_identity identity_row on identity_row.product_id = product.id
  join current_catalog_observation catalog on true
  left join latest_verified_product_publish verified_product on true
  left join latest_verified_price_publish verified_price on true
  left join current_department_name current_department on true
  left join verified_department_name verified_department on true
  where product.id = p_product_id
    and product.store_id = p_store_id
    and product.upc = identity_row.source_upc
    and (select count(*) from exact_identity) = 1;
$$;

create or replace function public.commander_effective_price_state(
  p_store_id uuid,
  p_product_id uuid
)
returns table (
  product_id uuid,
  source_product_key text,
  source_upc text,
  source_modifier text,
  commander_price numeric,
  canonical_price numeric,
  observed_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    state.product_id,
    state.source_product_key,
    state.source_upc,
    state.source_modifier,
    state.commander_price,
    state.canonical_price,
    state.observed_at
  from public.commander_effective_product_state(p_store_id, p_product_id) state;
$$;

create or replace function public.get_commander_product_context(
  p_store_id uuid,
  p_product_id uuid
)
returns table (
  product_id uuid,
  source_product_key text,
  source_upc text,
  source_modifier text,
  commander_description text,
  commander_department_key text,
  commander_department_name text,
  commander_price text,
  canonical_description text,
  canonical_department text,
  canonical_price text,
  observed_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    state.product_id,
    state.source_product_key,
    state.source_upc,
    state.source_modifier,
    state.commander_description,
    state.commander_department_key,
    state.commander_department_name,
    to_char(state.commander_price, 'FM9999999999990.00'),
    state.canonical_description,
    state.canonical_department,
    to_char(state.canonical_price, 'FM9999999999990.00'),
    state.observed_at
  from public.commander_effective_product_state(p_store_id, p_product_id) state
  where auth.uid() is not null
    and exists (
      select 1 from public.stores store
      where store.id = p_store_id and store.owner_id = auth.uid()
    );
$$;

create or replace function public.request_commander_product_update(
  p_store_id uuid,
  p_product_id uuid,
  p_expected_description text,
  p_expected_department text,
  p_expected_price numeric,
  p_requested_description text,
  p_requested_department_name text,
  p_requested_price numeric,
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
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_expected_description is null or char_length(p_expected_description) not between 1 and 512 or p_expected_description ~ '[[:cntrl:]]'
    or p_requested_description is null or char_length(p_requested_description) not between 1 and 512 or p_requested_description ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'product description is invalid';
  end if;
  if p_expected_department is null or p_expected_department !~ '^[0-9]{1,16}$' then
    raise exception using errcode = '22023', message = 'expected department is invalid';
  end if;
  if p_requested_department_name is not null
    and (char_length(btrim(p_requested_department_name)) not between 1 and 256 or btrim(p_requested_department_name) ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'requested department is invalid';
  end if;
  if p_expected_price is null or p_expected_price <= 0 or p_expected_price > 999999.99 or p_expected_price <> round(p_expected_price, 2)
    or p_requested_price is null or p_requested_price <= 0 or p_requested_price > 999999.99 or p_requested_price <> round(p_requested_price, 2) then
    raise exception using errcode = '22023', message = 'product price is invalid';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;

  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.owner_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'store access denied';
  end if;

  perform 1 from public.products product
  where product.id = p_product_id and product.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'product mapping is stale or invalid';
  end if;

  select * into v_effective
  from public.commander_effective_product_state(p_store_id, p_product_id);
  if not found
    or v_effective.commander_description is distinct from p_expected_description
    or v_effective.commander_department_key is distinct from p_expected_department
    or v_effective.commander_price is distinct from p_expected_price then
    raise exception using errcode = '23514', message = 'effective Commander product state is stale or missing';
  end if;

  if p_requested_department_name is null then
    v_requested_department := p_expected_department;
  else
    select count(*)::integer into v_department_count
    from public.pos_catalog_source_master_data_mappings mapping
    join public.store_departments department
      on department.id = mapping.canonical_department_id
     and department.store_id = p_store_id
    where mapping.store_id = p_store_id
      and mapping.source_system = 'commander'
      and mapping.entity_type = 'department'
      and mapping.status = 'mapped'
      and lower(btrim(department.name)) = lower(btrim(p_requested_department_name));
    if v_department_count <> 1 then
      raise exception using errcode = '23514', message = 'requested department mapping is unavailable or ambiguous';
    end if;
    select mapping.source_key into v_requested_department
    from public.pos_catalog_source_master_data_mappings mapping
    join public.store_departments department
      on department.id = mapping.canonical_department_id
     and department.store_id = p_store_id
    where mapping.store_id = p_store_id
      and mapping.source_system = 'commander'
      and mapping.entity_type = 'department'
      and mapping.status = 'mapped'
      and lower(btrim(department.name)) = lower(btrim(p_requested_department_name));
  end if;

  select count(*)::integer, min(department.name)
  into v_department_count, v_requested_department_name
  from public.pos_catalog_source_master_data_mappings mapping
  join public.store_departments department
    on department.id = mapping.canonical_department_id
   and department.store_id = p_store_id
  where mapping.store_id = p_store_id
    and mapping.source_system = 'commander'
    and mapping.entity_type = 'department'
    and mapping.status = 'mapped'
    and mapping.source_key = v_requested_department;
  if v_department_count <> 1 or v_requested_department !~ '^[0-9]{1,16}$' then
    raise exception using errcode = '23514', message = 'Commander department mapping is unavailable or ambiguous';
  end if;

  if p_expected_description = p_requested_description
    and p_expected_department = v_requested_department
    and p_expected_price = p_requested_price then
    raise exception using errcode = '22023', message = 'requested product state is unchanged';
  end if;

  select count(*)::integer into v_connector_count
  from public.store_pos_connectors connector
  where connector.store_id = p_store_id and connector.status = 'active';
  if v_connector_count <> 1 then
    raise exception using errcode = '23514', message = 'exactly one active connector is required';
  end if;
  select connector.id into v_connector_id
  from public.store_pos_connectors connector
  where connector.store_id = p_store_id and connector.status = 'active';

  v_payload := jsonb_build_object(
    'expected', jsonb_build_object(
      'description', p_expected_description,
      'department', p_expected_department,
      'price', p_expected_price
    ),
    'requested', jsonb_build_object(
      'description', p_requested_description,
      'department', v_requested_department,
      'department_name', v_requested_department_name,
      'price', p_requested_price
    )
  );

  select job.* into v_existing
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
      or v_existing.requested_price is distinct from p_requested_price then
      raise exception using errcode = '23505', message = 'idempotency key conflict';
    end if;
    return query select v_existing.id, v_existing.status::text,
      to_char(v_existing.expected_price, 'FM9999999999990.00'),
      to_char(v_existing.requested_price, 'FM9999999999990.00'),
      v_existing.created_at;
    return;
  end if;

  select active_job.* into v_existing
  from public.pos_publish_jobs active_job
  where active_job.store_id = p_store_id
    and active_job.operation::text in ('update_price', 'update_product')
    and active_job.status::text in ('pending', 'claimed', 'sending', 'verifying')
  order by active_job.created_at asc, active_job.id asc
  limit 1
  for update;

  if found then
    if v_existing.operation::text = 'update_product'
      and v_existing.product_id is not distinct from p_product_id
      and v_existing.requested_by is not distinct from v_user_id
      and v_existing.assigned_connector_id is not distinct from v_connector_id
      and v_existing.payload is not distinct from v_payload
      and v_existing.expected_price is not distinct from p_expected_price
      and v_existing.requested_price is not distinct from p_requested_price then
      return query select v_existing.id, v_existing.status::text,
        to_char(v_existing.expected_price, 'FM9999999999990.00'),
        to_char(v_existing.requested_price, 'FM9999999999990.00'),
        v_existing.created_at;
      return;
    end if;
    raise exception using errcode = '23505', message = 'a different Commander update is already active';
  end if;

  insert into public.pos_publish_jobs (
    store_id, product_id, requested_by, assigned_connector_id, operation, status,
    payload, expected_price, requested_price, idempotency_key, audit_metadata
  ) values (
    p_store_id, p_product_id, v_user_id, v_connector_id, 'update_product', 'pending',
    v_payload, p_expected_price, p_requested_price, p_idempotency_key, '{}'::jsonb
  ) returning * into v_inserted;

  return query select v_inserted.id, v_inserted.status::text,
    to_char(v_inserted.expected_price, 'FM9999999999990.00'),
    to_char(v_inserted.requested_price, 'FM9999999999990.00'),
    v_inserted.created_at;
end;
$$;

-- Legacy one-argument claim remains price-only so an old deployed Edge/connector
-- can never claim an update_product job.
create or replace function public.claim_pos_publish_job(p_connector_id uuid)
returns table (
  job_id uuid,
  operation text,
  product_id uuid,
  upc text,
  modifier text,
  expected_price text,
  price text,
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
  select connector.store_id into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id and connector.status = 'active';
  if not found then raise exception using errcode = '42501', message = 'connector is not authorized to claim publishing jobs'; end if;

  select job.* into v_job
  from public.pos_publish_jobs job
  where job.assigned_connector_id = p_connector_id
    and job.store_id = v_connector_store_id
    and job.status::text = 'pending'
    and job.operation::text = 'update_price'
  order by job.created_at asc, job.id asc
  for update skip locked
  limit 1;
  if not found then return; end if;

  select * into v_effective from public.commander_effective_price_state(v_job.store_id, v_job.product_id);
  if not found then v_failure_code := 'source_identity_missing';
  elsif v_effective.commander_price is distinct from v_job.expected_price then v_failure_code := 'stale_expected_price';
  end if;
  if v_failure_code is not null then
    update public.pos_publish_jobs
    set status = 'failed', failed_at = v_claimed_at, audit_metadata = jsonb_build_object('failure_code', v_failure_code)
    where id = v_job.id;
    return;
  end if;

  update public.pos_publish_jobs
  set status = 'claimed', claimed_by_connector_id = p_connector_id,
    claimed_at = v_claimed_at, attempt_count = attempt_count + 1
  where id = v_job.id;

  return query select v_job.id, 'update_price'::text, v_job.product_id,
    v_effective.source_upc, v_effective.source_modifier,
    to_char(v_job.expected_price, 'FM9999999999990.00'),
    to_char(v_job.requested_price, 'FM9999999999990.00'),
    v_job.attempt_count + 1, v_claimed_at;
end;
$$;

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
  v_effective_price record;
  v_effective_product record;
  v_failure_code text;
  v_claimed_at timestamptz := now();
begin
  if p_capabilities is null or cardinality(p_capabilities) not between 1 and 2
    or exists (
      select 1
      from unnest(p_capabilities) as requested_capability(capability)
      where capability not in ('update_price', 'update_product')
    )
    or (select count(*) from unnest(p_capabilities)) <>
       (select count(distinct capability) from unnest(p_capabilities) as requested_capability(capability)) then
    raise exception using errcode = '22023', message = 'publish capabilities are invalid';
  end if;

  select connector.store_id into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id and connector.status = 'active';
  if not found then raise exception using errcode = '42501', message = 'connector is not authorized to claim publishing jobs'; end if;

  select job.* into v_job
  from public.pos_publish_jobs job
  where job.assigned_connector_id = p_connector_id
    and job.store_id = v_connector_store_id
    and job.status::text = 'pending'
    and job.operation::text = any(p_capabilities)
  order by job.created_at asc, job.id asc
  for update skip locked
  limit 1;
  if not found then return; end if;

  if v_job.operation::text = 'update_product' then
    select * into v_effective_product
    from public.commander_effective_product_state(v_job.store_id, v_job.product_id);
    if not found then
      v_failure_code := 'source_identity_missing';
    elsif v_effective_product.commander_description is distinct from (v_job.payload #>> '{expected,description}')
      or v_effective_product.commander_department_key is distinct from (v_job.payload #>> '{expected,department}')
      or v_effective_product.commander_price is distinct from v_job.expected_price then
      v_failure_code := 'stale_expected_price';
    end if;
  else
    select * into v_effective_price
    from public.commander_effective_price_state(v_job.store_id, v_job.product_id);
    if not found then
      v_failure_code := 'source_identity_missing';
    elsif v_effective_price.commander_price is distinct from v_job.expected_price then
      v_failure_code := 'stale_expected_price';
    end if;
  end if;

  if v_failure_code is not null then
    update public.pos_publish_jobs
    set status = 'failed', failed_at = v_claimed_at, audit_metadata = jsonb_build_object('failure_code', v_failure_code)
    where id = v_job.id;
    return;
  end if;

  update public.pos_publish_jobs
  set status = 'claimed', claimed_by_connector_id = p_connector_id,
    claimed_at = v_claimed_at, attempt_count = attempt_count + 1
  where id = v_job.id;

  if v_job.operation::text = 'update_product' then
    return query select
      v_job.id,
      'update_product'::text,
      v_job.product_id,
      v_effective_product.source_upc,
      v_effective_product.source_modifier,
      v_job.payload #>> '{expected,description}',
      v_job.payload #>> '{requested,description}',
      v_job.payload #>> '{expected,department}',
      v_job.payload #>> '{requested,department}',
      to_char(v_job.expected_price, 'FM9999999999990.00'),
      to_char(v_job.requested_price, 'FM9999999999990.00'),
      v_job.attempt_count + 1,
      v_claimed_at;
  else
    return query select
      v_job.id,
      'update_price'::text,
      v_job.product_id,
      v_effective_price.source_upc,
      v_effective_price.source_modifier,
      null::text,
      null::text,
      null::text,
      null::text,
      to_char(v_job.expected_price, 'FM9999999999990.00'),
      to_char(v_job.requested_price, 'FM9999999999990.00'),
      v_job.attempt_count + 1,
      v_claimed_at;
  end if;
end;
$$;

create or replace function public.report_pos_publish_job_status(
  p_connector_id uuid,
  p_job_id uuid,
  p_status text,
  p_verification_upc text,
  p_verification_modifier text,
  p_verification_description text,
  p_verification_department text,
  p_verification_price numeric,
  p_failure_code text,
  p_failure_message text
)
returns table (job_id uuid, status text)
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
  v_now timestamptz := now();
  v_safe_failure_codes text[] := array[
    'commander_auth_failed', 'commander_unreachable', 'commander_tls_failed',
    'plu_not_found', 'plu_identity_mismatch', 'update_rejected',
    'price_conflict', 'verification_failed', 'job_expired', 'internal_connector_error'
  ];
begin
  if p_status not in ('sending', 'verifying', 'completed', 'failed') then
    raise exception using errcode = '22023', message = 'publishing job status is not allowed';
  end if;
  select connector.store_id into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id and connector.status = 'active';
  if not found then raise exception using errcode = '42501', message = 'connector is not authorized to report publishing jobs'; end if;

  select job.* into v_job from public.pos_publish_jobs job where job.id = p_job_id for update;
  if not found or v_job.store_id is distinct from v_connector_store_id
    or v_job.assigned_connector_id is distinct from p_connector_id
    or v_job.claimed_by_connector_id is distinct from p_connector_id then
    raise exception using errcode = '42501', message = 'connector is not authorized to report this publishing job';
  end if;

  if p_status = 'sending' then
    if v_job.status::text <> 'claimed' then raise exception using errcode = '23514', message = 'publishing job status transition is not allowed'; end if;
    update public.pos_publish_jobs set status = 'sending' where id = v_job.id;
  elsif p_status = 'verifying' then
    if v_job.status::text <> 'sending' then raise exception using errcode = '23514', message = 'publishing job status transition is not allowed'; end if;
    update public.pos_publish_jobs set status = 'verifying' where id = v_job.id;
  elsif p_status = 'completed' then
    if v_job.status::text <> 'verifying'
      or p_verification_upc is null or p_verification_upc !~ '^[0-9]{14}$'
      or p_verification_modifier is null or p_verification_modifier !~ '^[0-9]{3}$'
      or p_verification_price is null or p_verification_price <= 0 or p_verification_price > 999999.99
      or p_verification_price <> round(p_verification_price, 2) then
      raise exception using errcode = '23514', message = 'publishing job completion verification is invalid';
    end if;

    select product.* into v_product
    from public.products product
    where product.id = v_job.product_id and product.store_id = v_job.store_id
    for update;
    select count(*)::integer into v_identity_count
    from public.product_source_identities identity
    where identity.store_id = v_job.store_id and identity.product_id = v_job.product_id
      and identity.source_system = 'commander'
      and identity.source_upc ~ '^[0-9]{14}$' and identity.source_modifier ~ '^[0-9]{3}$'
      and identity.source_product_key = identity.source_upc || '/' || identity.source_modifier;
    if v_product.id is null or v_identity_count <> 1 then
      raise exception using errcode = '23514', message = 'publishing job completion identity is invalid';
    end if;
    select identity.* into v_identity
    from public.product_source_identities identity
    where identity.store_id = v_job.store_id and identity.product_id = v_job.product_id
      and identity.source_system = 'commander'
      and identity.source_upc ~ '^[0-9]{14}$' and identity.source_modifier ~ '^[0-9]{3}$'
      and identity.source_product_key = identity.source_upc || '/' || identity.source_modifier;

    if v_product.upc is distinct from v_identity.source_upc
      or p_verification_upc is distinct from v_identity.source_upc
      or p_verification_modifier is distinct from v_identity.source_modifier
      or v_job.requested_price is distinct from p_verification_price then
      raise exception using errcode = '23514', message = 'publishing job completion verification does not match';
    end if;

    if v_job.operation::text = 'update_product' then
      if p_verification_description is null
        or char_length(p_verification_description) not between 1 and 512
        or p_verification_description ~ '[[:cntrl:]]'
        or p_verification_department is null
        or p_verification_department !~ '^[0-9]{1,16}$'
        or p_verification_description is distinct from (v_job.payload #>> '{requested,description}')
        or p_verification_department is distinct from (v_job.payload #>> '{requested,department}') then
        raise exception using errcode = '23514', message = 'product verification does not match requested state';
      end if;
      update public.products
      set item_name = v_job.payload #>> '{requested,description}',
          department = v_job.payload #>> '{requested,department_name}',
          selling_price = v_job.requested_price,
          updated_at = v_now
      where id = v_job.product_id and store_id = v_job.store_id;
      update public.pos_publish_jobs
      set status = 'completed', completed_at = v_now,
        audit_metadata = jsonb_build_object(
          'verification_upc', p_verification_upc,
          'verification_modifier', p_verification_modifier,
          'verification_description', p_verification_description,
          'verification_department', p_verification_department,
          'verification_price', p_verification_price
        )
      where id = v_job.id;
    elsif v_job.operation::text = 'update_price' then
      if p_verification_description is not null or p_verification_department is not null then
        raise exception using errcode = '23514', message = 'price verification contained unsupported product fields';
      end if;
      update public.products set selling_price = v_job.requested_price, updated_at = v_now
      where id = v_job.product_id and store_id = v_job.store_id;
      update public.pos_publish_jobs
      set status = 'completed', completed_at = v_now,
        audit_metadata = jsonb_build_object(
          'verification_upc', p_verification_upc,
          'verification_modifier', p_verification_modifier,
          'verification_price', p_verification_price
        )
      where id = v_job.id;
    else
      raise exception using errcode = '23514', message = 'publishing job operation is not supported';
    end if;
  else
    if v_job.status::text not in ('claimed', 'sending', 'verifying')
      or p_failure_code is null or not (p_failure_code = any(v_safe_failure_codes))
      or not public.pos_publish_failure_message_is_safe(p_failure_message) then
      raise exception using errcode = '23514', message = 'publishing job failure details are invalid';
    end if;
    update public.pos_publish_jobs
    set status = 'failed', failed_at = v_now,
      audit_metadata = jsonb_strip_nulls(jsonb_build_object(
        'failure_code', p_failure_code,
        'completion_note', nullif(p_failure_message, '')
      ))
    where id = v_job.id;
  end if;
  return query select v_job.id, p_status;
end;
$$;

-- Legacy report overload remains price-only for old deployed Edge functions.
create or replace function public.report_pos_publish_job_status(
  p_connector_id uuid,
  p_job_id uuid,
  p_status text,
  p_verification_upc text default null,
  p_verification_modifier text default null,
  p_verification_price numeric default null,
  p_failure_code text default null,
  p_failure_message text default null
)
returns table (job_id uuid, status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation text;
begin
  select job.operation::text into v_operation
  from public.pos_publish_jobs job
  where job.id = p_job_id;
  if found and v_operation <> 'update_price' then
    raise exception using errcode = '23514', message = 'legacy report contract cannot report product updates';
  end if;
  return query
  select * from public.report_pos_publish_job_status(
    p_connector_id,
    p_job_id,
    p_status,
    p_verification_upc,
    p_verification_modifier,
    null::text,
    null::text,
    p_verification_price,
    p_failure_code,
    p_failure_message
  );
end;
$$;

revoke all on function public.pos_publish_payload_is_valid(public.pos_publish_job_operation, jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.commander_effective_product_state(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_commander_product_context(uuid, uuid) from public, anon;
grant execute on function public.get_commander_product_context(uuid, uuid) to authenticated;
revoke all on function public.request_commander_product_update(uuid, uuid, text, text, numeric, text, text, numeric, text) from public, anon;
grant execute on function public.request_commander_product_update(uuid, uuid, text, text, numeric, text, text, numeric, text) to authenticated;
revoke all on function public.claim_pos_publish_job(uuid, text[]) from public, anon, authenticated;
grant execute on function public.claim_pos_publish_job(uuid, text[]) to service_role;
revoke all on function public.claim_pos_publish_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_pos_publish_job(uuid) to service_role;
revoke all on function public.report_pos_publish_job_status(uuid, uuid, text, text, text, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.report_pos_publish_job_status(uuid, uuid, text, text, text, text, text, numeric, text, text) to service_role;
revoke all on function public.report_pos_publish_job_status(uuid, uuid, text, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.report_pos_publish_job_status(uuid, uuid, text, text, text, numeric, text, text) to service_role;

comment on function public.commander_effective_product_state(uuid, uuid) is
  'Current exact Commander description, department, and price state using the latest complete catalog plus newer verified product/price publishes.';
comment on function public.request_commander_product_update(uuid, uuid, text, text, numeric, text, text, numeric, text) is
  'Owner-only bounded update_product request for description, mapped Commander department, and price. Canonical fields change only after verified readback.';

comment on table public.pos_publish_jobs is
  'Internal Commander mutation queue for bounded update_price and update_product jobs. Never store Commander XML, URLs, commands, credentials, cookies, or session tokens.';

notify pgrst, 'reload schema';
