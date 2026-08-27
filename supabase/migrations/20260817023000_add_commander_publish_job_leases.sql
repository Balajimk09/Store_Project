-- Add bounded leases for Commander mutation jobs so an abandoned active job
-- cannot permanently block the store's next supported product update.
--
-- This migration does not enqueue, claim, or publish any Commander mutation.
-- It only hardens database lifecycle rules and marks already-stale jobs failed
-- when an authenticated owner or connector asks for lease cleanup.

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

  -- All request intent is immutable after insertion, including the widened
  -- Commander fields introduced by the full-product contract.
  if new.store_id is distinct from old.store_id
    or new.product_id is distinct from old.product_id
    or new.requested_by is distinct from old.requested_by
    or new.assigned_connector_id is distinct from old.assigned_connector_id
    or new.operation is distinct from old.operation
    or new.payload is distinct from old.payload
    or new.expected_price is distinct from old.expected_price
    or new.requested_price is distinct from old.requested_price
    or new.expected_payment_product_code is distinct from old.expected_payment_product_code
    or new.requested_payment_product_code is distinct from old.requested_payment_product_code
    or new.expected_selling_unit is distinct from old.expected_selling_unit
    or new.requested_selling_unit is distinct from old.requested_selling_unit
    or new.expected_max_qty_per_trans is distinct from old.expected_max_qty_per_trans
    or new.requested_max_qty_per_trans is distinct from old.requested_max_qty_per_trans
    or new.expected_taxable_rebate is distinct from old.expected_taxable_rebate
    or new.requested_taxable_rebate is distinct from old.requested_taxable_rebate
    or new.expected_tax_rate_ids is distinct from old.expected_tax_rate_ids
    or new.requested_tax_rate_ids is distinct from old.requested_tax_rate_ids
    or new.expected_id_check_ids is distinct from old.expected_id_check_ids
    or new.requested_id_check_ids is distinct from old.requested_id_check_ids
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception using errcode = '23514', message = 'publishing job request data is immutable';
  end if;

  -- Verification columns may be populated only by the verifying -> completed
  -- transition. They cannot be pre-seeded, altered on an in-flight state, or
  -- rewritten after the job becomes terminal.
  if (
      new.verification_payment_product_code is distinct from old.verification_payment_product_code
      or new.verification_selling_unit is distinct from old.verification_selling_unit
      or new.verification_max_qty_per_trans is distinct from old.verification_max_qty_per_trans
      or new.verification_taxable_rebate is distinct from old.verification_taxable_rebate
      or new.verification_tax_rate_ids is distinct from old.verification_tax_rate_ids
      or new.verification_id_check_ids is distinct from old.verification_id_check_ids
    )
    and not (old.status = 'verifying' and new.status = 'completed') then
    raise exception using errcode = '23514', message = 'publishing job verification data may only be written on completion';
  end if;

  if old.status in ('completed', 'failed', 'cancelled') then
    if new.status is distinct from old.status
      or new.claimed_by_connector_id is distinct from old.claimed_by_connector_id
      or new.claimed_at is distinct from old.claimed_at
      or new.completed_at is distinct from old.completed_at
      or new.failed_at is distinct from old.failed_at
      or new.attempt_count is distinct from old.attempt_count
      or new.verification_payment_product_code is distinct from old.verification_payment_product_code
      or new.verification_selling_unit is distinct from old.verification_selling_unit
      or new.verification_max_qty_per_trans is distinct from old.verification_max_qty_per_trans
      or new.verification_taxable_rebate is distinct from old.verification_taxable_rebate
      or new.verification_tax_rate_ids is distinct from old.verification_tax_rate_ids
      or new.verification_id_check_ids is distinct from old.verification_id_check_ids then
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
        'controlled_product_mismatch',
        'source_identity_missing',
        'stale_expected_price',
        'job_expired'
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

-- Internal store-scoped cleanup. Stale jobs fail; they are never silently
-- requeued because a previous uPLUs request may have reached Commander before
-- the connector disappeared. A new user action can safely create a fresh job
-- after this terminal state releases the one-active-job unique index.
create or replace function public.expire_stale_commander_publish_jobs_internal(
  p_store_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if p_store_id is null then
    raise exception using errcode = '22023', message = 'store id is required';
  end if;

  update public.pos_publish_jobs job
  set
    status = 'failed',
    failed_at = v_now,
    audit_metadata = jsonb_build_object('failure_code', 'job_expired')
  where job.store_id = p_store_id
    and job.operation::text in ('update_price', 'update_product')
    and (
      (
        job.status::text = 'pending'
        and job.updated_at < v_now - interval '60 minutes'
      )
      or
      (
        job.status::text in ('claimed', 'sending', 'verifying')
        and job.updated_at < v_now - interval '30 minutes'
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Store-owner entry point used immediately before a new Commander mutation is
-- requested. It cannot target another owner's store.
create or replace function public.expire_stale_commander_publish_jobs(
  p_store_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.stores store
    where store.id = p_store_id
      and store.owner_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'store access denied';
  end if;

  return public.expire_stale_commander_publish_jobs_internal(p_store_id);
end;
$$;

-- Connector entry point used before claim. It derives the store from the
-- already-authenticated connector identity instead of accepting a store id.
create or replace function public.expire_stale_commander_publish_jobs_for_connector(
  p_connector_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_store_id uuid;
begin
  select connector.store_id
  into v_store_id
  from public.store_pos_connectors connector
  where connector.id = p_connector_id
    and connector.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'connector is not authorized to expire publishing jobs';
  end if;

  return public.expire_stale_commander_publish_jobs_internal(v_store_id);
end;
$$;

revoke all on function public.expire_stale_commander_publish_jobs_internal(uuid)
from public, anon, authenticated;
grant execute on function public.expire_stale_commander_publish_jobs_internal(uuid)
to service_role;

revoke all on function public.expire_stale_commander_publish_jobs(uuid)
from public, anon, service_role;
grant execute on function public.expire_stale_commander_publish_jobs(uuid)
to authenticated;

revoke all on function public.expire_stale_commander_publish_jobs_for_connector(uuid)
from public, anon, authenticated;
grant execute on function public.expire_stale_commander_publish_jobs_for_connector(uuid)
to service_role;

comment on function public.expire_stale_commander_publish_jobs(uuid) is
  'Fails only stale active Commander mutation jobs for a store owned by the authenticated user; does not publish or requeue.';

comment on function public.expire_stale_commander_publish_jobs_for_connector(uuid) is
  'Fails only stale active Commander mutation jobs for the authenticated connector store before claim; does not publish or requeue.';
