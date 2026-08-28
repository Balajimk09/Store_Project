-- A completed create_product job has already passed exact connector readback
-- verification. Use that verified state only until a newer complete catalog
-- observation or verified update supersedes it.

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
    select run_row.id
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
      observation.source_description,
      observation.source_department_key,
      observation.source_price,
      observation.last_observed_at as observed_at
    from latest_catalog_run live_run
    join exact_identity identity_row on true
    join public.pos_catalog_source_product_observations observation
      on observation.store_id = p_store_id
     and observation.source_system = 'commander'
     and observation.source_product_key = identity_row.source_product_key
     and observation.source_upc = identity_row.source_upc
     and observation.source_modifier = identity_row.source_modifier
     and observation.last_seen_sync_run_id = live_run.id
     and observation.is_present = true
  ), latest_verified_create_product as (
    select
      job.audit_metadata ->> 'verification_description' as verification_description,
      job.audit_metadata ->> 'verification_department' as verification_department,
      (job.audit_metadata ->> 'verification_price')::numeric as verification_price,
      job.completed_at
    from public.pos_publish_jobs job
    join exact_identity identity_row on true
    where job.store_id = p_store_id
      and job.product_id = p_product_id
      and job.operation::text = 'create_product'
      and job.status::text = 'completed'
      and job.completed_at is not null
      and public.pos_publish_payload_is_valid(
        job.operation,
        job.payload,
        job.expected_price,
        job.requested_price
      )
      and jsonb_typeof(job.audit_metadata -> 'verification_upc') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_modifier') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_description') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_department') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_price') = 'number'
      and job.audit_metadata ->> 'verification_upc' = identity_row.source_upc
      and job.audit_metadata ->> 'verification_modifier' = identity_row.source_modifier
      and job.payload ->> 'upc' = job.audit_metadata ->> 'verification_upc'
      and job.payload ->> 'modifier' = job.audit_metadata ->> 'verification_modifier'
      and job.audit_metadata ->> 'verification_description' = job.payload ->> 'description'
      and job.audit_metadata ->> 'verification_department' = job.payload ->> 'department'
      and job.audit_metadata ->> 'verification_description' !~ '[[:cntrl:]]'
      and char_length(job.audit_metadata ->> 'verification_description') between 1 and 512
      and job.audit_metadata ->> 'verification_department' ~ '^[0-9]{1,16}$'
      and (job.audit_metadata ->> 'verification_price')::numeric = job.requested_price
      and jsonb_typeof(job.payload -> 'price') = 'number'
      and (job.payload ->> 'price')::numeric = (job.audit_metadata ->> 'verification_price')::numeric
    order by job.completed_at desc, job.id desc
    limit 1
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
  ), verified_create_department_name as (
    select department.name
    from latest_verified_create_product verified
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
    identity_row.source_product_key,
    identity_row.source_upc,
    identity_row.source_modifier,
    case
      when verified_product.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified_product.verification_description
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.source_description
      else verified_create.verification_description
    end as commander_description,
    case
      when verified_product.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified_product.verification_department
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.source_department_key
      else verified_create.verification_department
    end as commander_department_key,
    case
      when verified_product.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified_department.name
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then current_department.name
      else verified_create_department.name
    end as commander_department_name,
    case
      when verified_price.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified_price.verification_price
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.source_price
      else verified_create.verification_price
    end as commander_price,
    product.item_name as canonical_description,
    product.department as canonical_department,
    product.selling_price as canonical_price,
    greatest(
      catalog.observed_at,
      verified_create.completed_at,
      verified_product.completed_at,
      verified_price.completed_at
    ) as observed_at
  from public.products product
  join exact_identity identity_row on identity_row.product_id = product.id
  left join current_catalog_observation catalog on true
  left join latest_verified_create_product verified_create on true
  left join latest_verified_product_publish verified_product on true
  left join latest_verified_price_publish verified_price on true
  left join current_department_name current_department on true
  left join verified_create_department_name verified_create_department on true
  left join verified_department_name verified_department on true
  where product.id = p_product_id
    and product.store_id = p_store_id
    and product.upc = identity_row.source_upc
    and (catalog.observed_at is not null or verified_create.completed_at is not null)
    and (select count(*) from exact_identity) = 1;
$$;

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
     and observation.source_upc = base.source_upc
     and observation.source_modifier = base.source_modifier
     and observation.is_present = true
     and observation.last_seen_sync_run_id = live_run.id
    where jsonb_typeof(observation.source_values -> 'payment_product_code') = 'string'
      and jsonb_typeof(observation.source_values -> 'selling_unit') = 'string'
      and jsonb_typeof(observation.source_values -> 'maximum_quantity_per_transaction') = 'string'
      and jsonb_typeof(observation.source_values -> 'taxable_rebate') = 'string'
      and jsonb_typeof(observation.source_values -> 'tax_rate_ids') = 'array'
      and jsonb_typeof(observation.source_values -> 'id_check_ids') = 'array'
      and jsonb_typeof(observation.source_values -> 'flag_ids') = 'array'
  ), latest_verified_create_product as (
    select
      job.payload ->> 'payment_product_code' as payment_product_code,
      job.payload ->> 'selling_unit' as selling_unit,
      job.payload ->> 'max_qty_per_trans' as max_qty_per_trans,
      job.payload ->> 'taxable_rebate' as taxable_rebate,
      array(select jsonb_array_elements_text(job.payload -> 'tax_rate_ids')) as tax_rate_ids,
      array(select jsonb_array_elements_text(job.payload -> 'id_check_ids')) as id_check_ids,
      array(select jsonb_array_elements_text(job.payload -> 'flag_ids')) as flag_ids,
      job.completed_at
    from public.pos_publish_jobs job
    join base_state base on true
    where job.store_id = p_store_id
      and job.product_id = p_product_id
      and job.operation::text = 'create_product'
      and job.status::text = 'completed'
      and job.completed_at is not null
      and public.pos_publish_payload_is_valid(
        job.operation,
        job.payload,
        job.expected_price,
        job.requested_price
      )
      and jsonb_typeof(job.audit_metadata -> 'verification_upc') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_modifier') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_description') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_department') = 'string'
      and jsonb_typeof(job.audit_metadata -> 'verification_price') = 'number'
      and job.audit_metadata ->> 'verification_upc' = base.source_upc
      and job.audit_metadata ->> 'verification_modifier' = base.source_modifier
      and job.payload ->> 'upc' = job.audit_metadata ->> 'verification_upc'
      and job.payload ->> 'modifier' = job.audit_metadata ->> 'verification_modifier'
      and job.audit_metadata ->> 'verification_description' = job.payload ->> 'description'
      and job.audit_metadata ->> 'verification_department' = job.payload ->> 'department'
      and job.audit_metadata ->> 'verification_description' !~ '[[:cntrl:]]'
      and char_length(job.audit_metadata ->> 'verification_description') between 1 and 512
      and job.audit_metadata ->> 'verification_department' ~ '^[0-9]{1,16}$'
      and (job.audit_metadata ->> 'verification_price')::numeric = job.requested_price
      and jsonb_typeof(job.payload -> 'price') = 'number'
      and (job.payload ->> 'price')::numeric = (job.audit_metadata ->> 'verification_price')::numeric
    order by job.completed_at desc, job.id desc
    limit 1
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
    case
      when verified.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified.verification_payment_product_code
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.payment_product_code
      else verified_create.payment_product_code
    end,
    case
      when verified.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified.verification_selling_unit
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.selling_unit
      else verified_create.selling_unit
    end,
    case
      when verified.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified.verification_max_qty_per_trans
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.max_qty_per_trans
      else verified_create.max_qty_per_trans
    end,
    case
      when verified.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified.verification_taxable_rebate
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.taxable_rebate
      else verified_create.taxable_rebate
    end,
    case
      when verified.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified.verification_tax_rate_ids
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.tax_rate_ids
      else verified_create.tax_rate_ids
    end,
    case
      when verified.completed_at > coalesce(catalog.observed_at, verified_create.completed_at)
        then verified.verification_id_check_ids
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.id_check_ids
      else verified_create.id_check_ids
    end,
    case
      when catalog.observed_at is not null
        and (verified_create.completed_at is null or catalog.observed_at >= verified_create.completed_at)
        then catalog.flag_ids
      else verified_create.flag_ids
    end,
    base.canonical_description,
    base.canonical_department,
    base.canonical_price,
    greatest(
      base.observed_at,
      catalog.observed_at,
      verified_create.completed_at,
      verified.completed_at
    )
  from base_state base
  left join current_catalog_observation catalog on true
  left join latest_verified_create_product verified_create on true
  left join latest_verified_full_publish verified on true;
$$;
