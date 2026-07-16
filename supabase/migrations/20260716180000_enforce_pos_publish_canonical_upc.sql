-- Publish jobs use GTIN-14-style canonical UPCs only. PLU values remain separate identifiers.

create or replace function public.pos_publish_audit_metadata_is_safe(p_audit_metadata jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
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
          'verification_price'
        )
        or jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null')
        or (jsonb_typeof(entry.value) = 'string' and not public.pos_publish_failure_message_is_safe(entry.value #>> '{}'))
        or (entry.key = 'verification_upc' and (jsonb_typeof(entry.value) <> 'string' or entry.value #>> '{}' !~ '^[0-9]{14}$'))
        or (entry.key = 'verification_price' and jsonb_typeof(entry.value) <> 'number')
    );
$$;

create or replace function public.claim_pos_publish_job(p_connector_id uuid)
returns table (
  job_id uuid,
  operation text,
  product_id uuid,
  upc text,
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

  if not found then
    return;
  end if;

  select product.store_id, product.upc
  into v_product_store_id, v_product_upc
  from public.products product
  where product.id = v_job.product_id;

  if not found or v_product_store_id is distinct from v_job.store_id then
    v_failure_code := 'product_store_mismatch';
  elsif v_product_upc is null or v_product_upc !~ '^[0-9]{14}$' then
    v_failure_code := 'invalid_product_upc';
  elsif v_job.requested_price <= 0 or v_job.requested_price <> round(v_job.requested_price, 2) then
    v_failure_code := 'invalid_requested_price';
  end if;

  if v_failure_code is not null then
    update public.pos_publish_jobs
    set status = 'failed',
        failed_at = v_claimed_at,
        audit_metadata = jsonb_build_object('failure_code', v_failure_code)
    where id = v_job.id;
    return;
  end if;

  update public.pos_publish_jobs
  set status = 'claimed',
      claimed_by_connector_id = p_connector_id,
      claimed_at = v_claimed_at,
      attempt_count = attempt_count + 1
  where id = v_job.id;

  return query
  select
    v_job.id,
    'update_price'::text,
    v_job.product_id,
    v_product_upc,
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
  v_now timestamptz := now();
  v_safe_failure_codes text[] := array[
    'commander_auth_failed',
    'commander_unreachable',
    'commander_tls_failed',
    'plu_not_found',
    'plu_identity_mismatch',
    'update_rejected',
    'verification_failed',
    'job_expired',
    'internal_connector_error'
  ];
begin
  if p_status not in ('sending', 'verifying', 'completed', 'failed') then
    raise exception using errcode = '22023', message = 'publishing job status is not allowed';
  end if;

  select connector.store_id
  into v_connector_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id
    and connector.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'connector is not authorized to report publishing jobs';
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
    raise exception using errcode = '42501', message = 'connector is not authorized to report this publishing job';
  end if;

  if p_status = 'sending' then
    if v_job.status <> 'claimed' then
      raise exception using errcode = '23514', message = 'publishing job status transition is not allowed';
    end if;
    update public.pos_publish_jobs set status = 'sending' where id = v_job.id;
  elsif p_status = 'verifying' then
    if v_job.status <> 'sending' then
      raise exception using errcode = '23514', message = 'publishing job status transition is not allowed';
    end if;
    update public.pos_publish_jobs set status = 'verifying' where id = v_job.id;
  elsif p_status = 'completed' then
    if v_job.status <> 'verifying'
      or p_verification_upc is null
      or p_verification_upc !~ '^[0-9]{14}$'
      or p_verification_price is null
      or p_verification_price <= 0
      or p_verification_price <> round(p_verification_price, 2) then
      raise exception using errcode = '23514', message = 'publishing job completion verification is invalid';
    end if;

    select product.store_id, product.upc
    into v_product_store_id, v_product_upc
    from public.products product
    where product.id = v_job.product_id;

    if not found
      or v_product_store_id is distinct from v_job.store_id
      or v_product_upc is distinct from p_verification_upc
      or v_job.requested_price is distinct from p_verification_price then
      raise exception using errcode = '23514', message = 'publishing job completion verification does not match';
    end if;

    update public.pos_publish_jobs
    set status = 'completed',
        completed_at = v_now,
        audit_metadata = jsonb_build_object(
          'verification_upc', p_verification_upc,
          'verification_price', p_verification_price
        )
    where id = v_job.id;
  else
    if v_job.status not in ('claimed', 'sending', 'verifying')
      or p_failure_code is null
      or not (p_failure_code = any(v_safe_failure_codes))
      or not public.pos_publish_failure_message_is_safe(p_failure_message) then
      raise exception using errcode = '23514', message = 'publishing job failure details are invalid';
    end if;

    update public.pos_publish_jobs
    set status = 'failed',
        failed_at = v_now,
        audit_metadata = jsonb_strip_nulls(jsonb_build_object(
          'failure_code', p_failure_code,
          'completion_note', nullif(p_failure_message, '')
        ))
    where id = v_job.id;
  end if;

  return query select v_job.id, p_status;
end;
$$;

revoke all on function public.claim_pos_publish_job(uuid) from public, anon, authenticated;
revoke all on function public.report_pos_publish_job_status(uuid, uuid, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.claim_pos_publish_job(uuid) to service_role;
grant execute on function public.report_pos_publish_job_status(uuid, uuid, text, text, numeric, text, text) to service_role;

comment on function public.claim_pos_publish_job(uuid) is
  'Service-role-only atomic claim RPC. Returns safe update_price work with a canonical 14-digit UPC only.';

notify pgrst, 'reload schema';
