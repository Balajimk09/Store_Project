-- Controlled one-product StorePulse -> Commander price bridge.
-- This migration stores only normalized identifiers and decimal prices.
-- It never stores Commander XML, URLs, credentials, cookies, certificates, or sessions.

alter table public.pos_publish_jobs
  add column if not exists expected_price numeric(12,2);

-- Publishing had no production adapter before this migration. Preserve any historical
-- row structurally while making the new column non-null; only the controlled request
-- RPC below can create executable pilot work.
update public.pos_publish_jobs
set expected_price = requested_price
where expected_price is null;

alter table public.pos_publish_jobs
  alter column expected_price set not null;

alter table public.pos_publish_jobs
  drop constraint if exists pos_publish_jobs_expected_price_check;

alter table public.pos_publish_jobs
  add constraint pos_publish_jobs_expected_price_check
  check (expected_price > 0 and expected_price <= 999999.99 and expected_price = round(expected_price, 2));

alter table public.pos_publish_jobs
  drop constraint if exists pos_publish_jobs_requested_price_check;

alter table public.pos_publish_jobs
  add constraint pos_publish_jobs_requested_price_check
  check (requested_price > 0 and requested_price <= 999999.99 and requested_price = round(requested_price, 2));

create or replace function public.enforce_pos_publish_job_integrity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.store_pos_connectors connector
      where connector.id = new.assigned_connector_id
        and connector.store_id = new.store_id
    ) then
      raise exception using errcode = '23514', message = 'publishing jobs must be assigned to a connector for the same store';
    end if;

    if new.status <> 'pending'
      or new.claimed_by_connector_id is not null
      or new.claimed_at is not null
      or new.completed_at is not null
      or new.failed_at is not null then
      raise exception using errcode = '23514', message = 'new publishing jobs must start pending and unclaimed';
    end if;
    return new;
  end if;

  if new.store_id is distinct from old.store_id
    or new.product_id is distinct from old.product_id
    or new.requested_by is distinct from old.requested_by
    or new.assigned_connector_id is distinct from old.assigned_connector_id
    or new.operation is distinct from old.operation
    or new.payload is distinct from old.payload
    or new.expected_price is distinct from old.expected_price
    or new.requested_price is distinct from old.requested_price
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception using errcode = '23514', message = 'publishing job request data is immutable';
  end if;

  if old.status in ('completed', 'failed', 'cancelled') then
    if new.status is distinct from old.status
      or new.claimed_by_connector_id is distinct from old.claimed_by_connector_id
      or new.claimed_at is distinct from old.claimed_at
      or new.completed_at is distinct from old.completed_at
      or new.failed_at is distinct from old.failed_at
      or new.attempt_count is distinct from old.attempt_count then
      raise exception using errcode = '23514', message = 'completed publishing jobs are immutable except audit metadata';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status = new.status then
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'pending' and new.status = 'claimed' then
    if new.claimed_by_connector_id is distinct from old.assigned_connector_id or new.claimed_at is null then
      raise exception using errcode = '42501', message = 'only the assigned connector may claim a publishing job';
    end if;
  elsif old.status = 'pending' and new.status = 'failed' then
    if new.claimed_by_connector_id is not null
      or new.claimed_at is not null
      or new.failed_at is null
      or coalesce(new.audit_metadata ->> 'failure_code', '') not in (
        'product_store_mismatch',
        'invalid_product_upc',
        'invalid_expected_price',
        'invalid_requested_price',
        'controlled_product_mismatch'
      ) then
      raise exception using errcode = '23514', message = 'only validated pending jobs may fail before claim';
    end if;
  elsif old.status = 'pending' and new.status = 'cancelled' then
    if new.claimed_by_connector_id is not null or new.claimed_at is not null then
      raise exception using errcode = '23514', message = 'cancelled pending publishing jobs must remain unclaimed';
    end if;
  elsif old.status = 'claimed' and new.status = 'pending' then
    if new.claimed_by_connector_id is not null or new.claimed_at is not null then
      raise exception using errcode = '23514', message = 'requeued publishing jobs must clear their claim';
    end if;
  elsif old.status = 'claimed' and new.status = 'sending' then
    if new.claimed_by_connector_id is distinct from old.assigned_connector_id then
      raise exception using errcode = '42501', message = 'only the assigned connector may send a publishing job';
    end if;
  elsif old.status = 'sending' and new.status = 'verifying' then
    if new.claimed_by_connector_id is distinct from old.assigned_connector_id then
      raise exception using errcode = '42501', message = 'only the assigned connector may verify a publishing job';
    end if;
  elsif old.status = 'verifying' and new.status = 'completed' then
    if new.claimed_by_connector_id is distinct from old.assigned_connector_id or new.completed_at is null then
      raise exception using errcode = '42501', message = 'only the assigned connector may complete a publishing job';
    end if;
  elsif old.status in ('claimed', 'sending', 'verifying') and new.status = 'failed' then
    if new.claimed_by_connector_id is distinct from old.assigned_connector_id or new.failed_at is null then
      raise exception using errcode = '42501', message = 'only the assigned connector may fail a publishing job';
    end if;
  else
    raise exception using errcode = '23514', message = 'publishing job status transition is not allowed';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.request_controlled_commander_price_update(
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
  v_observation public.pos_catalog_source_observations%rowtype;
  v_connector_id uuid;
  v_connector_count integer;
  v_existing public.pos_publish_jobs%rowtype;
  v_inserted public.pos_publish_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_expected_price is null or p_expected_price <= 0 or p_expected_price > 999999.99 or p_expected_price <> round(p_expected_price, 2) then
    raise exception using errcode = '22023', message = 'expected price is invalid';
  end if;
  if p_requested_price is null or p_requested_price <= 0 or p_requested_price > 999999.99 or p_requested_price <> round(p_requested_price, 2) or p_requested_price = p_expected_price then
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

  select product.*
  into v_product
  from public.products product
  where product.id = p_product_id and product.store_id = p_store_id
  for update;

  if not found
    or v_product.upc is distinct from '00999999999993'
    or upper(btrim(coalesce(v_product.item_name, ''))) is distinct from 'STOREPULSE TEST' then
    raise exception using errcode = '42501', message = 'controlled product access denied';
  end if;

  if v_product.selling_price is null or v_product.selling_price is distinct from p_expected_price then
    raise exception using errcode = '23514', message = 'StorePulse price changed before publishing';
  end if;

  select observation.*
  into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = p_store_id
    and observation.source_system = 'commander'
    and observation.source_upc = '00999999999993'
    and observation.source_modifier = '000'
  order by observation.observed_at desc, observation.id desc
  limit 1;

  if not found
    or upper(btrim(v_observation.source_description)) is distinct from 'STOREPULSE TEST'
    or v_observation.source_price is distinct from p_expected_price then
    raise exception using errcode = '23514', message = 'Commander observation is missing or stale';
  end if;

  select count(*)::integer
  into v_connector_count
  from public.store_pos_connectors connector
  where connector.store_id = p_store_id
    and connector.status = 'active';

  if v_connector_count <> 1 then
    raise exception using errcode = '23514', message = 'exactly one active connector is required';
  end if;

  select connector.id
  into v_connector_id
  from public.store_pos_connectors connector
  where connector.store_id = p_store_id
    and connector.status = 'active';

  select job.*
  into v_existing
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
    return query select
      v_existing.id,
      v_existing.status::text,
      to_char(v_existing.expected_price, 'FM9999999999990.00'),
      to_char(v_existing.requested_price, 'FM9999999999990.00'),
      v_existing.created_at;
    return;
  end if;

  if exists (
    select 1
    from public.pos_publish_jobs active_job
    where active_job.product_id = p_product_id
      and active_job.status in ('pending', 'claimed', 'sending', 'verifying')
  ) then
    raise exception using errcode = '23505', message = 'a controlled price update is already active';
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
    idempotency_key,
    audit_metadata
  ) values (
    p_store_id,
    p_product_id,
    v_user_id,
    v_connector_id,
    'update_price',
    'pending',
    jsonb_build_object('price', p_requested_price),
    p_expected_price,
    p_requested_price,
    p_idempotency_key,
    '{}'::jsonb
  )
  returning * into v_inserted;

  return query select
    v_inserted.id,
    v_inserted.status::text,
    to_char(v_inserted.expected_price, 'FM9999999999990.00'),
    to_char(v_inserted.requested_price, 'FM9999999999990.00'),
    v_inserted.created_at;
end;
$$;

drop function if exists public.claim_pos_publish_job(uuid);

create function public.claim_pos_publish_job(p_connector_id uuid)
returns table (
  job_id uuid,
  operation text,
  product_id uuid,
  upc text,
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
  v_product_store_id uuid;
  v_product_upc text;
  v_product_name text;
  v_failure_code text;
  v_claimed_at timestamptz := now();
begin
  select connector.store_id
  into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id
    and connector.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'connector is not authorized to claim publishing jobs';
  end if;

  select job.*
  into v_job
  from public.pos_publish_jobs job
  where job.assigned_connector_id = p_connector_id
    and job.store_id = v_connector_store_id
    and job.status = 'pending'
  order by job.created_at asc, job.id asc
  for update skip locked
  limit 1;

  if not found then return; end if;

  select product.store_id, product.upc, product.item_name
  into v_product_store_id, v_product_upc, v_product_name
  from public.products product
  where product.id = v_job.product_id;

  if not found or v_product_store_id is distinct from v_job.store_id then
    v_failure_code := 'product_store_mismatch';
  elsif v_product_upc is null or v_product_upc !~ '^[0-9]{14}$' then
    v_failure_code := 'invalid_product_upc';
  elsif v_product_upc is distinct from '00999999999993' or upper(btrim(coalesce(v_product_name, ''))) is distinct from 'STOREPULSE TEST' then
    v_failure_code := 'controlled_product_mismatch';
  elsif v_job.expected_price <= 0 or v_job.expected_price > 999999.99 or v_job.expected_price <> round(v_job.expected_price, 2) then
    v_failure_code := 'invalid_expected_price';
  elsif v_job.requested_price <= 0 or v_job.requested_price > 999999.99 or v_job.requested_price <> round(v_job.requested_price, 2) or v_job.requested_price = v_job.expected_price then
    v_failure_code := 'invalid_requested_price';
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

  return query
  select
    v_job.id,
    'update_price'::text,
    v_job.product_id,
    v_product_upc,
    to_char(v_job.expected_price, 'FM9999999999990.00'),
    to_char(v_job.requested_price, 'FM9999999999990.00'),
    v_job.attempt_count + 1,
    v_claimed_at;
end;
$$;

create or replace function public.report_pos_publish_job_status(
  p_connector_id uuid,
  p_job_id uuid,
  p_status text,
  p_verification_upc text default null,
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
  v_product_store_id uuid;
  v_product_upc text;
  v_product_name text;
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

  select job.* into v_job
  from public.pos_publish_jobs job
  where job.id = p_job_id
  for update;

  if not found
    or v_job.store_id is distinct from v_connector_store_id
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
      or p_verification_price is null or p_verification_price <= 0 or p_verification_price > 999999.99
      or p_verification_price <> round(p_verification_price, 2) then
      raise exception using errcode = '23514', message = 'publishing job completion verification is invalid';
    end if;

    select product.store_id, product.upc, product.item_name
    into v_product_store_id, v_product_upc, v_product_name
    from public.products product
    where product.id = v_job.product_id
    for update;

    if not found
      or v_product_store_id is distinct from v_job.store_id
      or v_product_upc is distinct from '00999999999993'
      or v_product_upc is distinct from p_verification_upc
      or upper(btrim(coalesce(v_product_name, ''))) is distinct from 'STOREPULSE TEST'
      or v_job.requested_price is distinct from p_verification_price then
      raise exception using errcode = '23514', message = 'publishing job completion verification does not match';
    end if;

    -- StorePulse changes only after the connector reports a matching Commander readback.
    update public.products
    set selling_price = v_job.requested_price
    where id = v_job.product_id and store_id = v_job.store_id;

    update public.pos_catalog_source_observations
    set source_price = v_job.requested_price,
        observation_status = 'imported',
        observed_at = v_now,
        updated_at = v_now
    where store_id = v_job.store_id
      and source_system = 'commander'
      and source_upc = '00999999999993'
      and source_modifier = '000';

    update public.pos_publish_jobs
    set status = 'completed', completed_at = v_now,
        audit_metadata = jsonb_build_object(
          'verification_upc', p_verification_upc,
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
          'failure_code', p_failure_code,
          'completion_note', nullif(p_failure_message, '')
        ))
    where id = v_job.id;
  end if;

  return query select v_job.id, p_status;
end;
$$;

revoke all on function public.request_controlled_commander_price_update(uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.request_controlled_commander_price_update(uuid, uuid, numeric, numeric, text) to authenticated;

revoke all on function public.claim_pos_publish_job(uuid) from public, anon, authenticated;
revoke all on function public.report_pos_publish_job_status(uuid, uuid, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.claim_pos_publish_job(uuid) to service_role;
grant execute on function public.report_pos_publish_job_status(uuid, uuid, text, text, numeric, text, text) to service_role;

comment on function public.request_controlled_commander_price_update(uuid, uuid, numeric, numeric, text) is
  'Owner-only request RPC for UPC 00999999999993 / modifier 000 / STOREPULSE TEST. Does not update StorePulse until Commander readback succeeds.';
comment on function public.claim_pos_publish_job(uuid) is
  'Service-role-only claim RPC returning expected and requested prices for the one controlled test product.';
comment on table public.pos_publish_jobs is
  'Internal update_price queue. Never store Commander XML, URLs, commands, credentials, cookies, certificates, or session tokens.';

notify pgrst, 'reload schema';
