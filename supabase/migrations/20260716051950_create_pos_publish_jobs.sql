-- Internal queue foundation for future connector-mediated POS publishing.
-- This table intentionally stores no Commander URL, XML, command, credential, cookie, or session token.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pos_publish_job_operation') then
    create type public.pos_publish_job_operation as enum ('update_price');
  end if;

  if not exists (select 1 from pg_type where typname = 'pos_publish_job_status') then
    create type public.pos_publish_job_status as enum (
      'pending',
      'claimed',
      'sending',
      'verifying',
      'completed',
      'failed',
      'cancelled'
    );
  end if;
end $$;

create or replace function public.pos_publish_payload_is_valid(
  p_payload jsonb,
  p_requested_price numeric
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_typeof(p_payload) = 'object'
    and p_payload = jsonb_build_object('price', p_requested_price);
$$;

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
      where entry.key not in ('claim_id', 'failure_code', 'completion_note')
        or jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null')
    );
$$;

create table if not exists public.pos_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  assigned_connector_id uuid not null references public.store_pos_connectors(id) on delete restrict,
  claimed_by_connector_id uuid references public.store_pos_connectors(id) on delete restrict,
  operation public.pos_publish_job_operation not null default 'update_price',
  status public.pos_publish_job_status not null default 'pending',
  payload jsonb not null,
  requested_price numeric(12,2) not null,
  idempotency_key text not null,
  attempt_count integer not null default 0,
  audit_metadata jsonb not null default '{}'::jsonb,
  claimed_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_publish_jobs_operation_check check (operation = 'update_price'),
  constraint pos_publish_jobs_status_check check (
    status in ('pending', 'claimed', 'sending', 'verifying', 'completed', 'failed', 'cancelled')
  ),
  constraint pos_publish_jobs_requested_price_check check (requested_price > 0),
  constraint pos_publish_jobs_attempt_count_check check (attempt_count >= 0),
  constraint pos_publish_jobs_payload_check check (public.pos_publish_payload_is_valid(payload, requested_price)),
  constraint pos_publish_jobs_audit_metadata_check check (public.pos_publish_audit_metadata_is_safe(audit_metadata)),
  constraint pos_publish_jobs_claimed_connector_check check (
    status <> 'claimed' or (
      claimed_by_connector_id = assigned_connector_id
      and claimed_at is not null
    )
  )
);

create unique index if not exists pos_publish_jobs_idempotency_key_uidx
  on public.pos_publish_jobs (idempotency_key);

create index if not exists pos_publish_jobs_pending_connector_idx
  on public.pos_publish_jobs (assigned_connector_id, created_at)
  where status = 'pending';

create index if not exists pos_publish_jobs_store_created_idx
  on public.pos_publish_jobs (store_id, created_at desc);

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

drop trigger if exists enforce_pos_publish_job_integrity on public.pos_publish_jobs;
create trigger enforce_pos_publish_job_integrity
before insert or update on public.pos_publish_jobs
for each row
execute function public.enforce_pos_publish_job_integrity();

alter table public.pos_publish_jobs enable row level security;

revoke all on public.pos_publish_jobs from anon, authenticated;
grant select on public.pos_publish_jobs to authenticated;
grant select, insert, update on public.pos_publish_jobs to service_role;

drop policy if exists "select_own_pos_publish_jobs" on public.pos_publish_jobs;
create policy "select_own_pos_publish_jobs"
on public.pos_publish_jobs
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = pos_publish_jobs.store_id
      and stores.owner_id = auth.uid()
  )
);

revoke all on function public.pos_publish_payload_is_valid(jsonb, numeric) from public, anon, authenticated;
revoke all on function public.pos_publish_audit_metadata_is_safe(jsonb) from public, anon, authenticated;
revoke all on function public.enforce_pos_publish_job_integrity() from public, anon, authenticated;
grant execute on function public.pos_publish_payload_is_valid(jsonb, numeric) to service_role;
grant execute on function public.pos_publish_audit_metadata_is_safe(jsonb) to service_role;

comment on table public.pos_publish_jobs is
  'Internal update_price queue. Never store Commander XML, URLs, commands, credentials, cookies, or session tokens.';

notify pgrst, 'reload schema';
