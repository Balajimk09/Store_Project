-- Commander full-product catalog state V2.
--
-- V1 completion remains unchanged for existing connector/snapshot callers.
-- V2 is selected explicitly by the existing sync endpoint only when every
-- extended product field has been normalized and hash-bound by the connector.

create or replace function public.commander_live_catalog_v2_product_text(
  p_source_upc text,
  p_source_modifier text,
  p_source_description text,
  p_source_price text,
  p_source_department_number text,
  p_source_active boolean,
  p_payment_product_code text,
  p_selling_unit text,
  p_max_qty_per_trans text,
  p_taxable_rebate text,
  p_tax_rate_ids text[],
  p_id_check_ids text[],
  p_flag_ids text[]
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_tax_rate_ids text;
  v_id_check_ids text;
  v_flag_ids text;
begin
  select cardinality(p_tax_rate_ids)::text || ':' || coalesce(
    string_agg(octet_length(entry.value)::text || ':' || entry.value, ',' order by entry.ordinality),
    ''
  ) into v_tax_rate_ids
  from unnest(p_tax_rate_ids) with ordinality as entry(value, ordinality);

  select cardinality(p_id_check_ids)::text || ':' || coalesce(
    string_agg(octet_length(entry.value)::text || ':' || entry.value, ',' order by entry.ordinality),
    ''
  ) into v_id_check_ids
  from unnest(p_id_check_ids) with ordinality as entry(value, ordinality);

  select cardinality(p_flag_ids)::text || ':' || coalesce(
    string_agg(octet_length(entry.value)::text || ':' || entry.value, ',' order by entry.ordinality),
    ''
  ) into v_flag_ids
  from unnest(p_flag_ids) with ordinality as entry(value, ordinality);

  return format(
    'u=%s:%s|m=%s:%s|desc=%s:%s|price=%s:%s|department=%s|active=%s|pcode=%s:%s|selling_unit=%s:%s|max_qty_per_trans=%s:%s|taxable_rebate=%s:%s|tax_rate_ids=%s|id_check_ids=%s|flag_ids=%s',
    octet_length(p_source_upc), p_source_upc,
    octet_length(p_source_modifier), p_source_modifier,
    octet_length(p_source_description), p_source_description,
    octet_length(p_source_price::numeric::text), p_source_price::numeric::text,
    case when p_source_department_number is null then 'N'
      else 'V' || octet_length(p_source_department_number)::text || ':' || p_source_department_number end,
    case when p_source_active is null then 'N' when p_source_active then 'T' else 'F' end,
    octet_length(p_payment_product_code), p_payment_product_code,
    octet_length(p_selling_unit), p_selling_unit,
    octet_length(p_max_qty_per_trans), p_max_qty_per_trans,
    octet_length(p_taxable_rebate), p_taxable_rebate,
    v_tax_rate_ids,
    v_id_check_ids,
    v_flag_ids
  );
end;
$function$;

create or replace function public.complete_pos_catalog_source_sync_v2(
  p_sync_run_id uuid,
  p_products jsonb
)
returns table (
  new_count integer,
  changed_count integer,
  unchanged_count integer,
  missing_count integer,
  conflict_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run public.pos_catalog_sync_runs%rowtype;
  v_previous_completed_run_id uuid;
  v_now timestamptz := statement_timestamp();
  v_new_count integer := 0;
  v_changed_count integer := 0;
  v_unchanged_count integer := 0;
  v_missing_count integer := 0;
  v_conflict_count integer := 0;
  v_catalog_payload_text text;
  v_catalog_payload_sha256 text;
begin
  if p_sync_run_id is null or jsonb_typeof(p_products) <> 'array' then
    raise exception using errcode = 'P0001', message = 'catalog_sync_invalid';
  end if;

  select run_row.* into v_run
  from public.pos_catalog_sync_runs run_row
  where run_row.id = p_sync_run_id
  for update;
  if not found
    or v_run.status <> 'running'
    or v_run.import_mode <> 'full_catalog'
    or v_run.metadata ->> 'catalog_contract' <> 'live_source_catalog_v1' then
    raise exception using errcode = 'P0001', message = 'catalog_sync_run_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_run.store_id::text || ':' || v_run.source_system, 0)
  );

  if exists (
    select 1
    from jsonb_array_elements(p_products) as element(value)
    where jsonb_typeof(element.value) <> 'object'
      or (select count(*) from jsonb_object_keys(
        case when jsonb_typeof(element.value) = 'object' then element.value else '{}'::jsonb end
      )) <> 15
      or not element.value ?& array[
        'source_product_key', 'source_upc', 'source_modifier',
        'source_description', 'source_price', 'source_department_number',
        'source_active', 'source_payment_product_code',
        'source_selling_unit', 'source_max_qty_per_trans',
        'source_taxable_rebate', 'source_tax_rate_ids',
        'source_id_check_ids', 'source_flag_ids',
        'normalized_observation_hash'
      ]
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_sync_payload_invalid';
  end if;

  drop table if exists pg_temp.live_catalog_sync_input;
  create temporary table pg_temp.live_catalog_sync_input (
    source_product_key text not null,
    source_upc text not null,
    source_modifier text not null,
    source_description text not null,
    source_price text not null,
    source_department_number text null,
    source_active boolean null,
    source_payment_product_code text,
    source_selling_unit text,
    source_max_qty_per_trans text,
    source_taxable_rebate text,
    source_tax_rate_ids text[],
    source_id_check_ids text[],
    source_flag_ids text[],
    normalized_observation_hash text not null
  ) on commit drop;

  insert into pg_temp.live_catalog_sync_input (
    source_product_key, source_upc, source_modifier, source_description,
    source_price, source_department_number, source_active,
    source_payment_product_code, source_selling_unit,
    source_max_qty_per_trans, source_taxable_rebate,
    source_tax_rate_ids, source_id_check_ids, source_flag_ids,
    normalized_observation_hash
  )
  select
    value.source_product_key, value.source_upc, value.source_modifier,
    value.source_description, value.source_price,
    value.source_department_number, value.source_active,
    value.source_payment_product_code, value.source_selling_unit,
    value.source_max_qty_per_trans, value.source_taxable_rebate,
    value.source_tax_rate_ids, value.source_id_check_ids, value.source_flag_ids,
    value.normalized_observation_hash
  from jsonb_to_recordset(p_products) as value(
    source_product_key text,
    source_upc text,
    source_modifier text,
    source_description text,
    source_price text,
    source_department_number text,
    source_active boolean,
    source_payment_product_code text,
    source_selling_unit text,
    source_max_qty_per_trans text,
    source_taxable_rebate text,
    source_tax_rate_ids text[],
    source_id_check_ids text[],
    source_flag_ids text[],
    normalized_observation_hash text
  );

  if (select count(*) from pg_temp.live_catalog_sync_input) <> v_run.received_product_count
    or v_run.received_product_count <> v_run.unique_products_received
    or exists (
      select 1 from pg_temp.live_catalog_sync_input input_row
      where input_row.source_product_key <> input_row.source_upc || '/' || input_row.source_modifier
        or input_row.source_upc !~ '^[0-9]{1,32}$'
        or input_row.source_modifier !~ '^[0-9]{1,32}$'
        or char_length(input_row.source_description) > 512
        or input_row.source_description ~ '[\x00-\x1f\x7f-\x9f]'
        or input_row.source_price !~ '^[0-9]+(?:\.[0-9]{1,8})?$'
        or input_row.source_price::numeric < 0
        or input_row.source_price::numeric > 9999999999.99
        or (input_row.source_department_number is not null and (
          char_length(input_row.source_department_number) not between 1 and 128
          or input_row.source_department_number ~ '[\x00-\x1f\x7f-\x9f]'
        ))
        or input_row.source_payment_product_code is null
        or input_row.source_payment_product_code !~ '^[0-9]{1,16}$'
        or input_row.source_selling_unit is null
        or input_row.source_selling_unit !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'
        or input_row.source_max_qty_per_trans is null
        or input_row.source_max_qty_per_trans !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
        or input_row.source_taxable_rebate is null
        or input_row.source_taxable_rebate !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
        or input_row.source_tax_rate_ids is null
        or not public.pos_publish_commander_sysid_array_is_valid(input_row.source_tax_rate_ids)
        or input_row.source_id_check_ids is null
        or not public.pos_publish_commander_sysid_array_is_valid(input_row.source_id_check_ids)
        or input_row.source_flag_ids is null
        or not public.pos_publish_commander_sysid_array_is_valid(input_row.source_flag_ids)
        or input_row.normalized_observation_hash !~ '^[0-9a-f]{64}$'
    )
    or exists (
      select 1 from pg_temp.live_catalog_sync_input input_row
      group by input_row.source_product_key having count(*) > 1
    ) then
    raise exception using errcode = 'P0001', message = 'catalog_sync_payload_invalid';
  end if;

  if exists (
    select 1 from pg_temp.live_catalog_sync_input input_row
    where input_row.normalized_observation_hash <> encode(
      extensions.digest(convert_to(public.commander_live_catalog_v2_product_text(
        input_row.source_upc, input_row.source_modifier,
        input_row.source_description, input_row.source_price,
        input_row.source_department_number, input_row.source_active,
        input_row.source_payment_product_code, input_row.source_selling_unit,
        input_row.source_max_qty_per_trans, input_row.source_taxable_rebate,
        input_row.source_tax_rate_ids, input_row.source_id_check_ids,
        input_row.source_flag_ids
      ), 'UTF8'), 'sha256'), 'hex'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_sync_payload_invalid';
  end if;

  select 'live_catalog_payload_v2' || E'\n' || coalesce(
    string_agg(
      public.commander_live_catalog_v2_product_text(
        input_row.source_upc, input_row.source_modifier,
        input_row.source_description, input_row.source_price,
        input_row.source_department_number, input_row.source_active,
        input_row.source_payment_product_code, input_row.source_selling_unit,
        input_row.source_max_qty_per_trans, input_row.source_taxable_rebate,
        input_row.source_tax_rate_ids, input_row.source_id_check_ids,
        input_row.source_flag_ids
      ),
      E'\n' order by input_row.source_upc, input_row.source_modifier
    ), ''
  ) into v_catalog_payload_text
  from pg_temp.live_catalog_sync_input input_row;

  v_catalog_payload_sha256 := encode(
    extensions.digest(convert_to(v_catalog_payload_text, 'UTF8'), 'sha256'), 'hex'
  );
  if v_catalog_payload_sha256 <> v_run.catalog_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'catalog_sync_payload_hash_mismatch';
  end if;

  perform set_config('storepulse.live_catalog_sync_writer', 'complete', true);

  select run_row.id into v_previous_completed_run_id
  from public.pos_catalog_sync_runs run_row
  where run_row.store_id = v_run.store_id
    and run_row.source_system = v_run.source_system
    and run_row.status = 'completed'
    and run_row.catalog_complete = true
    and run_row.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
    and run_row.id <> v_run.id
  order by run_row.completed_at desc, run_row.id desc
  limit 1;

  with compared as (
    select input_row.source_product_key, existing_row.id as existing_id,
      existing_row.normalized_observation_hash
        is distinct from input_row.normalized_observation_hash as is_changed
    from pg_temp.live_catalog_sync_input input_row
    left join public.pos_catalog_source_product_observations existing_row
      on existing_row.store_id = v_run.store_id
      and existing_row.source_system = v_run.source_system
      and existing_row.source_product_key = input_row.source_product_key
      and existing_row.last_reconciled_sync_run_id = v_previous_completed_run_id
  )
  select
    count(*) filter (where existing_id is null)::integer,
    count(*) filter (where existing_id is not null and is_changed)::integer,
    count(*) filter (where existing_id is not null and not is_changed)::integer
  into v_new_count, v_changed_count, v_unchanged_count
  from compared;

  update public.product_source_field_overrides override_row
  set status = 'conflict', updated_at = v_now
  from public.product_source_identities identity_row
  join pg_temp.live_catalog_sync_input input_row
    on input_row.source_product_key = identity_row.source_product_key
  where override_row.source_identity_id = identity_row.id
    and override_row.store_id = v_run.store_id
    and identity_row.store_id = v_run.store_id
    and identity_row.source_system = v_run.source_system
    and override_row.status = 'pending_publish'
    and override_row.source_value_at_edit is distinct from case override_row.field_name
      when 'description' then to_jsonb(input_row.source_description)
      when 'price' then to_jsonb(input_row.source_price)
      when 'department' then to_jsonb(input_row.source_department_number)
    end;
  get diagnostics v_conflict_count = row_count;

  insert into public.pos_catalog_source_product_observations as target (
    store_id, source_system, source_product_key, source_upc, source_modifier,
    source_description, source_price, source_department_key, source_department_id,
    source_active, source_values, normalized_observation_hash,
    first_import_run_id, last_import_run_id, first_observed_at, last_observed_at,
    is_present, last_seen_sync_run_id, last_reconciled_sync_run_id,
    missing_from_source, missing_from_source_at
  )
  select
    v_run.store_id, v_run.source_system, input_row.source_product_key,
    input_row.source_upc, input_row.source_modifier, input_row.source_description,
    input_row.source_price::numeric, null, null, input_row.source_active,
    jsonb_build_object(
      'department_number', input_row.source_department_number,
      'source_active', input_row.source_active,
      'payment_product_code', input_row.source_payment_product_code,
      'selling_unit', input_row.source_selling_unit,
      'maximum_quantity_per_transaction', input_row.source_max_qty_per_trans,
      'taxable_rebate', input_row.source_taxable_rebate,
      'tax_rate_ids', to_jsonb(input_row.source_tax_rate_ids),
      'id_check_ids', to_jsonb(input_row.source_id_check_ids),
      'flag_ids', to_jsonb(input_row.source_flag_ids)
    ),
    input_row.normalized_observation_hash,
    null, null, v_now, v_now, true, v_run.id, v_run.id, false, null
  from pg_temp.live_catalog_sync_input input_row
  on conflict (store_id, source_system, source_product_key) do update
  set source_upc = excluded.source_upc,
      source_modifier = excluded.source_modifier,
      source_description = excluded.source_description,
      source_price = excluded.source_price,
      source_department_key = null,
      source_department_id = null,
      source_active = excluded.source_active,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_observed_at = v_now,
      is_present = true,
      last_seen_sync_run_id = v_run.id,
      last_reconciled_sync_run_id = v_run.id,
      missing_from_source = false,
      missing_from_source_at = null;

  update public.pos_catalog_source_product_observations observation_row
  set is_present = false,
      last_reconciled_sync_run_id = v_run.id,
      missing_from_source = true,
      missing_from_source_at = v_now
  where v_previous_completed_run_id is not null
    and observation_row.store_id = v_run.store_id
    and observation_row.source_system = v_run.source_system
    and observation_row.last_reconciled_sync_run_id = v_previous_completed_run_id
    and observation_row.is_present = true
    and not exists (
      select 1 from pg_temp.live_catalog_sync_input input_row
      where input_row.source_product_key = observation_row.source_product_key
    );
  get diagnostics v_missing_count = row_count;

  update public.pos_catalog_sync_runs
  set status = 'completed',
      catalog_complete = true,
      completed_at = v_now,
      changed_count = v_changed_count,
      new_count = v_new_count,
      unchanged_count = v_unchanged_count,
      missing_count = v_missing_count,
      conflict_count = v_conflict_count,
      error_count = 0,
      safe_error_code = null,
      safe_error_message = null,
      failure_stage = null
  where id = v_run.id;

  return query select v_new_count, v_changed_count, v_unchanged_count,
    v_missing_count, v_conflict_count;
end;
$function$;

create or replace function public.commander_effective_full_product_state(
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
  commander_payment_product_code text,
  commander_selling_unit text,
  commander_max_qty_per_trans text,
  commander_taxable_rebate text,
  commander_tax_rate_ids text[],
  commander_id_check_ids text[],
  commander_flag_ids text[],
  canonical_description text,
  canonical_department text,
  canonical_price numeric,
  observed_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with base_state as (
    select *
    from public.commander_effective_product_state(p_store_id, p_product_id)
  ), latest_catalog_run as (
    select run_row.id
    from public.pos_catalog_sync_runs run_row
    where run_row.store_id = p_store_id
      and run_row.source_system = 'commander'
      and run_row.status = 'completed'
      and run_row.catalog_complete = true
      and run_row.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
    order by run_row.completed_at desc, run_row.id desc
    limit 1
  ), current_catalog_observation as (
    select
      observation.source_product_key,
      observation.last_observed_at as observed_at,
      observation.source_values ->> 'payment_product_code' as payment_product_code,
      observation.source_values ->> 'selling_unit' as selling_unit,
      observation.source_values ->> 'maximum_quantity_per_transaction' as max_qty_per_trans,
      observation.source_values ->> 'taxable_rebate' as taxable_rebate,
      array(select jsonb_array_elements_text(observation.source_values -> 'tax_rate_ids')) as tax_rate_ids,
      array(select jsonb_array_elements_text(observation.source_values -> 'id_check_ids')) as id_check_ids,
      array(select jsonb_array_elements_text(observation.source_values -> 'flag_ids')) as flag_ids
    from base_state base
    join latest_catalog_run live_run on true
    join public.pos_catalog_source_product_observations observation
      on observation.store_id = p_store_id
     and observation.source_system = 'commander'
     and observation.source_product_key = base.source_product_key
     and observation.is_present = true
     and observation.last_seen_sync_run_id = live_run.id
    where jsonb_typeof(observation.source_values -> 'payment_product_code') = 'string'
      and jsonb_typeof(observation.source_values -> 'selling_unit') = 'string'
      and jsonb_typeof(observation.source_values -> 'maximum_quantity_per_transaction') = 'string'
      and jsonb_typeof(observation.source_values -> 'taxable_rebate') = 'string'
      and jsonb_typeof(observation.source_values -> 'tax_rate_ids') = 'array'
      and jsonb_typeof(observation.source_values -> 'id_check_ids') = 'array'
      and jsonb_typeof(observation.source_values -> 'flag_ids') = 'array'
  ), latest_verified_full_publish as (
    select
      job.verification_payment_product_code,
      job.verification_selling_unit,
      job.verification_max_qty_per_trans,
      job.verification_taxable_rebate,
      job.verification_tax_rate_ids,
      job.verification_id_check_ids,
      job.completed_at
    from public.pos_publish_jobs job
    join base_state base on true
    where job.store_id = p_store_id
      and job.product_id = p_product_id
      and job.operation::text = 'update_product'
      and job.status::text = 'completed'
      and job.completed_at is not null
      and job.audit_metadata ->> 'verification_upc' = base.source_upc
      and job.audit_metadata ->> 'verification_modifier' = base.source_modifier
      and job.verification_payment_product_code ~ '^[0-9]{1,16}$'
      and job.verification_selling_unit ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'
      and job.verification_max_qty_per_trans ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
      and job.verification_taxable_rebate ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
      and public.pos_publish_commander_sysid_array_is_valid(job.verification_tax_rate_ids)
      and public.pos_publish_commander_sysid_array_is_valid(job.verification_id_check_ids)
    order by job.completed_at desc, job.id desc
    limit 1
  )
  select
    base.product_id,
    base.source_product_key,
    base.source_upc,
    base.source_modifier,
    base.commander_description,
    base.commander_department_key,
    base.commander_department_name,
    base.commander_price,
    case when verified.completed_at > catalog.observed_at
      then verified.verification_payment_product_code else catalog.payment_product_code end,
    case when verified.completed_at > catalog.observed_at
      then verified.verification_selling_unit else catalog.selling_unit end,
    case when verified.completed_at > catalog.observed_at
      then verified.verification_max_qty_per_trans else catalog.max_qty_per_trans end,
    case when verified.completed_at > catalog.observed_at
      then verified.verification_taxable_rebate else catalog.taxable_rebate end,
    case when verified.completed_at > catalog.observed_at
      then verified.verification_tax_rate_ids else catalog.tax_rate_ids end,
    case when verified.completed_at > catalog.observed_at
      then verified.verification_id_check_ids else catalog.id_check_ids end,
    catalog.flag_ids,
    base.canonical_description,
    base.canonical_department,
    base.canonical_price,
    greatest(base.observed_at, coalesce(verified.completed_at, base.observed_at))
  from base_state base
  join current_catalog_observation catalog on catalog.source_product_key = base.source_product_key
  left join latest_verified_full_publish verified on true;
$$;

create or replace function public.get_commander_full_product_context(
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
  commander_payment_product_code text,
  commander_selling_unit text,
  commander_max_qty_per_trans text,
  commander_taxable_rebate text,
  commander_tax_rate_ids text[],
  commander_id_check_ids text[],
  commander_flag_ids text[],
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
    state.commander_payment_product_code,
    state.commander_selling_unit,
    state.commander_max_qty_per_trans,
    state.commander_taxable_rebate,
    state.commander_tax_rate_ids,
    state.commander_id_check_ids,
    state.commander_flag_ids,
    state.canonical_description,
    state.canonical_department,
    to_char(state.canonical_price, 'FM9999999999990.00'),
    state.observed_at
  from public.commander_effective_full_product_state(p_store_id, p_product_id) state
  where auth.uid() is not null
    and exists (
      select 1
      from public.stores store_row
      where store_row.id = p_store_id
        and store_row.owner_id = auth.uid()
    );
$$;

revoke all on function public.commander_live_catalog_v2_product_text(
  text, text, text, text, text, boolean, text, text, text, text, text[], text[], text[]
) from public, anon, authenticated;
revoke all on function public.complete_pos_catalog_source_sync_v2(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.commander_effective_full_product_state(uuid, uuid)
  from public, anon;
revoke all on function public.get_commander_full_product_context(uuid, uuid)
  from public, anon;

grant execute on function public.complete_pos_catalog_source_sync_v2(uuid, jsonb)
  to service_role;
grant execute on function public.commander_effective_full_product_state(uuid, uuid)
  to service_role;
grant execute on function public.get_commander_full_product_context(uuid, uuid)
  to authenticated;

comment on function public.complete_pos_catalog_source_sync_v2(uuid, jsonb) is
  'Atomic V2 Commander live-catalog completion with hash-bound full source product state. V1 completion remains available for legacy callers.';
comment on function public.commander_effective_full_product_state(uuid, uuid) is
  'Current full Commander source state for one exact durable Commander identity; newer verified update_product values override catalog values except read-only flag IDs.';
comment on function public.get_commander_full_product_context(uuid, uuid) is
  'Owner-only sanitized full Commander product context. No transport, XML, cookie, credential, or secret data is exposed.';

notify pgrst, 'reload schema';
