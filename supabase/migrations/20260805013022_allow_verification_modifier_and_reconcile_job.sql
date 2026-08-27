create or replace function public.pos_publish_audit_metadata_is_safe(p_audit_metadata jsonb)
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $function$
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
          'verification_price'
        )
        or jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null')
        or (
          jsonb_typeof(entry.value) = 'string'
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
          entry.key = 'verification_price'
          and jsonb_typeof(entry.value) <> 'number'
        )
    );
$function$;

comment on function public.pos_publish_audit_metadata_is_safe(jsonb) is
  'Allows only bounded publish audit fields; Commander verification modifier must be exactly three digits.';

do $repair$
declare
  v_job public.pos_publish_jobs%rowtype;
  v_product public.products%rowtype;
  v_identity public.product_source_identities%rowtype;
  v_observation public.pos_catalog_source_observations%rowtype;
  v_identity_count integer;
  v_observation_count integer;
  v_other_active_count integer;
  v_now timestamptz := statement_timestamp();
begin
  select job.*
  into v_job
  from public.pos_publish_jobs job
  where job.id = 'e6d17a01-b8bc-4d2d-9fdb-ac3f31a07033'::uuid
  for update;

  if not found then
    -- This migration also contains a one-time repair for a historical
    -- production publish job. Fresh databases intentionally do not have
    -- that job, so there is nothing to reconcile.
    return;
  end if;

  if v_job.status::text <> 'verifying'
    or v_job.expected_price is distinct from 0.04::numeric
    or v_job.requested_price is distinct from 0.09::numeric
    or v_job.attempt_count <> 1
    or v_job.completed_at is not null
    or v_job.failed_at is not null
    or v_job.assigned_connector_id is null
    or v_job.claimed_by_connector_id is null
    or v_job.assigned_connector_id is distinct from v_job.claimed_by_connector_id
    or v_job.audit_metadata is distinct from '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'authorized publish job preconditions do not match';
  end if;

  select product.*
  into v_product
  from public.products product
  where product.id = v_job.product_id
    and product.store_id = v_job.store_id
  for update;

  if not found
    or v_product.upc is distinct from '00999999999993'
    or v_product.selling_price is distinct from 0.04::numeric then
    raise exception using errcode = 'P0001', message = 'StorePulse product preconditions do not match';
  end if;

  select count(*)::integer
  into v_identity_count
  from public.product_source_identities identity
  where identity.store_id = v_job.store_id
    and identity.product_id = v_job.product_id
    and identity.source_system = 'commander'
    and identity.source_product_key = '00999999999993/000'
    and identity.source_upc = '00999999999993'
    and identity.source_modifier = '000';

  if v_identity_count <> 1 then
    raise exception using errcode = 'P0001', message = 'exact Commander identity precondition does not match';
  end if;

  select identity.*
  into v_identity
  from public.product_source_identities identity
  where identity.store_id = v_job.store_id
    and identity.product_id = v_job.product_id
    and identity.source_system = 'commander'
    and identity.source_product_key = '00999999999993/000'
    and identity.source_upc = '00999999999993'
    and identity.source_modifier = '000';

  select count(*)::integer
  into v_observation_count
  from public.pos_catalog_source_observations observation
  where observation.store_id = v_job.store_id
    and observation.source_system = 'commander'
    and observation.source_product_key = v_identity.source_product_key
    and observation.source_upc = v_identity.source_upc
    and observation.source_modifier = v_identity.source_modifier
    and observation.source_price = 0.04::numeric;

  if v_observation_count <> 1 then
    raise exception using errcode = 'P0001', message = 'Commander observation precondition does not match';
  end if;

  select observation.*
  into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = v_job.store_id
    and observation.source_system = 'commander'
    and observation.source_product_key = v_identity.source_product_key
    and observation.source_upc = v_identity.source_upc
    and observation.source_modifier = v_identity.source_modifier
    and observation.source_price = 0.04::numeric
  for update;

  select count(*)::integer
  into v_other_active_count
  from public.pos_publish_jobs active_job
  where active_job.store_id = v_job.store_id
    and active_job.product_id = v_job.product_id
    and active_job.id <> v_job.id
    and active_job.status in ('pending', 'claimed', 'sending', 'verifying');

  if v_other_active_count <> 0 then
    raise exception using errcode = 'P0001', message = 'another active publish job exists';
  end if;

  update public.products
  set selling_price = 0.09::numeric,
      updated_at = v_now
  where id = v_job.product_id
    and store_id = v_job.store_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'StorePulse product reconciliation failed';
  end if;

  update public.pos_catalog_source_observations
  set source_price = 0.09::numeric,
      observation_status = 'observed',
      observed_at = v_now,
      updated_at = v_now
  where id = v_observation.id;

  if not found then
    raise exception using errcode = 'P0001', message = 'Commander observation reconciliation failed';
  end if;

  update public.pos_publish_jobs
  set status = 'completed',
      completed_at = v_now,
      failed_at = null,
      audit_metadata = jsonb_build_object(
        'verification_upc', '00999999999993',
        'verification_modifier', '000',
        'verification_price', 0.09::numeric
      ),
      updated_at = v_now
  where id = v_job.id
    and status = 'verifying';

  if not found then
    raise exception using errcode = 'P0001', message = 'publish job reconciliation failed';
  end if;
end;
$repair$;

notify pgrst, 'reload schema';;
