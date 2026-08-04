-- Generalize the one-product Commander pilot without changing product creation,
-- deletion, or any non-price field. This migration is intentionally additive to
-- the deployed controlled pilot migration.

drop function if exists public.request_controlled_commander_price_update(uuid, uuid, numeric, numeric, text);

create unique index pos_publish_jobs_active_store_product_uidx
  on public.pos_publish_jobs (store_id, product_id)
  where status in ('pending', 'claimed', 'sending', 'verifying');

create or replace function public.request_commander_price_update(
  p_store_id uuid,
  p_product_id uuid,
  p_expected_price numeric,
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
  v_product public.products%rowtype;
  v_identity public.product_source_identities%rowtype;
  v_observation public.pos_catalog_source_observations%rowtype;
  v_connector_id uuid;
  v_connector_count integer;
  v_identity_count integer;
  v_existing public.pos_publish_jobs%rowtype;
  v_inserted public.pos_publish_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_expected_price is null or p_expected_price <= 0 or p_expected_price > 999999.99
    or p_expected_price <> round(p_expected_price, 2) then
    raise exception using errcode = '22023', message = 'expected price is invalid';
  end if;
  if p_requested_price is null or p_requested_price <= 0 or p_requested_price > 999999.99
    or p_requested_price <> round(p_requested_price, 2) or p_requested_price = p_expected_price then
    raise exception using errcode = '22023', message = 'requested price is invalid';
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

  select product.* into v_product
  from public.products product
  where product.id = p_product_id and product.store_id = p_store_id
  for update;
  if not found or v_product.upc is null or v_product.upc !~ '^[0-9]{14}$'
    or v_product.selling_price is null or v_product.selling_price is distinct from p_expected_price then
    raise exception using errcode = '23514', message = 'product mapping is stale or invalid';
  end if;

  select count(*)::integer into v_identity_count
  from public.product_source_identities identity
  where identity.store_id = p_store_id
    and identity.product_id = p_product_id
    and identity.source_system = 'commander'
    and identity.source_upc ~ '^[0-9]{14}$'
    and identity.source_modifier ~ '^[0-9]{3}$'
    and identity.source_product_key = identity.source_upc || '/' || identity.source_modifier;
  if v_identity_count <> 1 then
    raise exception using errcode = '23514', message = 'exact Commander identity is required';
  end if;

  select identity.* into v_identity
  from public.product_source_identities identity
  where identity.store_id = p_store_id
    and identity.product_id = p_product_id
    and identity.source_system = 'commander'
    and identity.source_upc ~ '^[0-9]{14}$'
    and identity.source_modifier ~ '^[0-9]{3}$'
    and identity.source_product_key = identity.source_upc || '/' || identity.source_modifier;
  if v_product.upc is distinct from v_identity.source_upc then
    raise exception using errcode = '23514', message = 'product identity does not match Commander identity';
  end if;

  select observation.* into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = p_store_id
    and observation.source_system = 'commander'
    and observation.source_product_key = v_identity.source_product_key
    and observation.source_upc = v_identity.source_upc
    and observation.source_modifier = v_identity.source_modifier
  order by observation.observed_at desc, observation.id desc
  limit 1;
  if not found or v_observation.source_price is distinct from p_expected_price then
    raise exception using errcode = '23514', message = 'latest Commander observation is stale or missing';
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

  select job.* into v_existing
  from public.pos_publish_jobs job
  where job.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.store_id is distinct from p_store_id
      or v_existing.product_id is distinct from p_product_id
      or v_existing.requested_by is distinct from v_user_id
      or v_existing.expected_price is distinct from p_expected_price
      or v_existing.requested_price is distinct from p_requested_price then
      raise exception using errcode = '23505', message = 'idempotency key conflict';
    end if;
    return query select v_existing.id, v_existing.status::text,
      to_char(v_existing.expected_price, 'FM9999999999990.00'),
      to_char(v_existing.requested_price, 'FM9999999999990.00'), v_existing.created_at;
    return;
  end if;

  if exists (
    select 1 from public.pos_publish_jobs active_job
    where active_job.store_id = p_store_id
      and active_job.product_id = p_product_id
      and active_job.status in ('pending', 'claimed', 'sending', 'verifying')
  ) then
    raise exception using errcode = '23505', message = 'a price update is already active';
  end if;

  insert into public.pos_publish_jobs (
    store_id, product_id, requested_by, assigned_connector_id, operation, status,
    payload, expected_price, requested_price, idempotency_key, audit_metadata
  ) values (
    p_store_id, p_product_id, v_user_id, v_connector_id, 'update_price', 'pending',
    jsonb_build_object('price', p_requested_price), p_expected_price, p_requested_price,
    p_idempotency_key, '{}'::jsonb
  ) returning * into v_inserted;

  return query select v_inserted.id, v_inserted.status::text,
    to_char(v_inserted.expected_price, 'FM9999999999990.00'),
    to_char(v_inserted.requested_price, 'FM9999999999990.00'), v_inserted.created_at;
end;
$$;

drop function if exists public.claim_pos_publish_job(uuid);
create function public.claim_pos_publish_job(p_connector_id uuid)
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
  v_product public.products%rowtype;
  v_identity public.product_source_identities%rowtype;
  v_observation public.pos_catalog_source_observations%rowtype;
  v_identity_count integer;
  v_failure_code text;
  v_claimed_at timestamptz := now();
begin
  select connector.store_id into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id and connector.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'connector is not authorized to claim publishing jobs';
  end if;

  select job.* into v_job
  from public.pos_publish_jobs job
  where job.assigned_connector_id = p_connector_id
    and job.store_id = v_connector_store_id
    and job.status = 'pending'
  order by job.created_at asc, job.id asc
  for update skip locked
  limit 1;
  if not found then return; end if;

  select product.* into v_product
  from public.products product
  where product.id = v_job.product_id and product.store_id = v_job.store_id;
  if not found or v_product.upc is null or v_product.upc !~ '^[0-9]{14}$' then
    v_failure_code := 'product_store_mismatch';
  elsif v_product.selling_price is distinct from v_job.expected_price then
    v_failure_code := 'stale_expected_price';
  else
    select count(*)::integer into v_identity_count
    from public.product_source_identities identity
    where identity.store_id = v_job.store_id and identity.product_id = v_job.product_id
      and identity.source_system = 'commander'
      and identity.source_upc ~ '^[0-9]{14}$' and identity.source_modifier ~ '^[0-9]{3}$'
      and identity.source_product_key = identity.source_upc || '/' || identity.source_modifier;
    if v_identity_count <> 1 then
      v_failure_code := 'source_identity_missing';
    else
      select identity.* into v_identity
      from public.product_source_identities identity
      where identity.store_id = v_job.store_id and identity.product_id = v_job.product_id
        and identity.source_system = 'commander'
        and identity.source_upc ~ '^[0-9]{14}$' and identity.source_modifier ~ '^[0-9]{3}$'
        and identity.source_product_key = identity.source_upc || '/' || identity.source_modifier;
      if v_product.upc is distinct from v_identity.source_upc then
        v_failure_code := 'source_identity_mismatch';
      else
        select observation.* into v_observation
        from public.pos_catalog_source_observations observation
        where observation.store_id = v_job.store_id and observation.source_system = 'commander'
          and observation.source_product_key = v_identity.source_product_key
          and observation.source_upc = v_identity.source_upc
          and observation.source_modifier = v_identity.source_modifier
        order by observation.observed_at desc, observation.id desc
        limit 1;
        if not found or v_observation.source_price is distinct from v_job.expected_price then
          v_failure_code := 'stale_expected_price';
        end if;
      end if;
    end if;
  end if;
  if v_failure_code is not null then
    update public.pos_publish_jobs
    set status = 'failed', failed_at = v_claimed_at,
      audit_metadata = jsonb_build_object('failure_code', v_failure_code)
    where id = v_job.id;
    return;
  end if;

  update public.pos_publish_jobs
  set status = 'claimed', claimed_by_connector_id = p_connector_id,
    claimed_at = v_claimed_at, attempt_count = attempt_count + 1
  where id = v_job.id;

  return query select v_job.id, 'update_price'::text, v_job.product_id,
    v_identity.source_upc, v_identity.source_modifier,
    to_char(v_job.expected_price, 'FM9999999999990.00'),
    to_char(v_job.requested_price, 'FM9999999999990.00'),
    v_job.attempt_count + 1, v_claimed_at;
end;
$$;

drop function if exists public.report_pos_publish_job_status(uuid, uuid, text, text, numeric, text, text);
create function public.report_pos_publish_job_status(
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
  if not found then
    raise exception using errcode = '42501', message = 'connector is not authorized to report publishing jobs';
  end if;
  select job.* into v_job from public.pos_publish_jobs job where job.id = p_job_id for update;
  if not found or v_job.store_id is distinct from v_connector_store_id
    or v_job.assigned_connector_id is distinct from p_connector_id
    or v_job.claimed_by_connector_id is distinct from p_connector_id then
    raise exception using errcode = '42501', message = 'connector is not authorized to report this publishing job';
  end if;

  if p_status = 'sending' then
    if v_job.status <> 'claimed' then raise exception using errcode = '23514', message = 'publishing job status transition is not allowed'; end if;
    update public.pos_publish_jobs set status = 'sending' where id = v_job.id;
  elsif p_status = 'verifying' then
    if v_job.status <> 'sending' then raise exception using errcode = '23514', message = 'publishing job status transition is not allowed'; end if;
    update public.pos_publish_jobs set status = 'verifying' where id = v_job.id;
  elsif p_status = 'completed' then
    if v_job.status <> 'verifying'
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

    update public.products set selling_price = v_job.requested_price
    where id = v_job.product_id and store_id = v_job.store_id;
    update public.pos_catalog_source_observations
    set source_price = v_job.requested_price, observation_status = 'observed',
      observed_at = v_now, updated_at = v_now
    where store_id = v_job.store_id and source_system = 'commander'
      and source_product_key = v_identity.source_product_key
      and source_upc = v_identity.source_upc
      and source_modifier = v_identity.source_modifier;
    if not found then
      raise exception using errcode = '23514', message = 'verified Commander observation is missing';
    end if;
    update public.pos_publish_jobs
    set status = 'completed', completed_at = v_now,
      audit_metadata = jsonb_build_object(
        'verification_upc', p_verification_upc,
        'verification_modifier', p_verification_modifier,
        'verification_price', p_verification_price
      )
    where id = v_job.id;
  else
    if v_job.status not in ('claimed', 'sending', 'verifying')
      or p_failure_code is null or not (p_failure_code = any(v_safe_failure_codes))
      or not public.pos_publish_failure_message_is_safe(p_failure_message) then
      raise exception using errcode = '23514', message = 'publishing job failure details are invalid';
    end if;
    update public.pos_publish_jobs
    set status = 'failed', failed_at = v_now,
      audit_metadata = jsonb_strip_nulls(jsonb_build_object(
        'failure_code', p_failure_code, 'completion_note', nullif(p_failure_message, '')
      ))
    where id = v_job.id;
  end if;
  return query select v_job.id, p_status;
end;
$$;

revoke all on function public.request_commander_price_update(uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.request_commander_price_update(uuid, uuid, numeric, numeric, text) to authenticated;
revoke all on function public.claim_pos_publish_job(uuid) from public, anon, authenticated;
revoke all on function public.report_pos_publish_job_status(uuid, uuid, text, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.claim_pos_publish_job(uuid) to service_role;
grant execute on function public.report_pos_publish_job_status(uuid, uuid, text, text, text, numeric, text, text) to service_role;

comment on function public.request_commander_price_update(uuid, uuid, numeric, numeric, text) is
  'Owner-only manual update_price request for one exact store-scoped Commander identity. StorePulse changes only after verified Commander readback.';
comment on function public.claim_pos_publish_job(uuid) is
  'Service-role-only claim RPC returning only the bounded update_price job identity and prices.';

notify pgrst, 'reload schema';
