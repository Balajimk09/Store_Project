-- StorePulse connector heartbeat and remote runtime status.
-- Additive only: administrative store_pos_connectors.status remains active/disabled.

alter table public.store_pos_connectors
  add column if not exists installation_id uuid,
  add column if not exists service_version text,
  add column if not exists runtime_mode text,
  add column if not exists reported_state text,
  add column if not exists runtime_started_at timestamptz,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists reported_heartbeat_at timestamptz,
  add column if not exists last_sync_started_at timestamptz,
  add column if not exists last_sync_completed_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists commander_status text,
  add column if not exists cloud_status text,
  add column if not exists live_poll_interval_seconds integer,
  add column if not exists last_canonical_record_count integer not null default 0,
  add column if not exists last_inserted_count integer not null default 0,
  add column if not exists last_updated_count integer not null default 0,
  add column if not exists last_unchanged_count integer not null default 0,
  add column if not exists last_failed_count integer not null default 0,
  add column if not exists last_request_id text,
  add column if not exists heartbeat_payload_version text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_pos_connectors_reported_state_check'
  ) then
    alter table public.store_pos_connectors
      add constraint store_pos_connectors_reported_state_check
      check (
        reported_state is null
        or reported_state in ('starting', 'ready', 'syncing', 'degraded', 'error', 'stopping')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_pos_connectors_commander_status_check'
  ) then
    alter table public.store_pos_connectors
      add constraint store_pos_connectors_commander_status_check
      check (
        commander_status is null
        or commander_status in ('unknown', 'connected', 'unreachable', 'authentication_failed', 'error')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_pos_connectors_cloud_status_check'
  ) then
    alter table public.store_pos_connectors
      add constraint store_pos_connectors_cloud_status_check
      check (
        cloud_status is null
        or cloud_status in ('unknown', 'connected', 'error')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_pos_connectors_live_poll_interval_check'
  ) then
    alter table public.store_pos_connectors
      add constraint store_pos_connectors_live_poll_interval_check
      check (
        live_poll_interval_seconds is null
        or live_poll_interval_seconds between 1 and 86400
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_pos_connectors_last_counts_check'
  ) then
    alter table public.store_pos_connectors
      add constraint store_pos_connectors_last_counts_check
      check (
        last_canonical_record_count >= 0
        and last_inserted_count >= 0
        and last_updated_count >= 0
        and last_unchanged_count >= 0
        and last_failed_count >= 0
      );
  end if;
end $$;

create index if not exists store_pos_connectors_store_heartbeat_idx
  on public.store_pos_connectors(store_id, last_heartbeat_at desc);

create or replace function public.prevent_authenticated_connector_heartbeat_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );
begin
  if request_role = 'authenticated' and (
    new.installation_id is distinct from old.installation_id
    or new.service_version is distinct from old.service_version
    or new.runtime_mode is distinct from old.runtime_mode
    or new.reported_state is distinct from old.reported_state
    or new.runtime_started_at is distinct from old.runtime_started_at
    or new.last_heartbeat_at is distinct from old.last_heartbeat_at
    or new.reported_heartbeat_at is distinct from old.reported_heartbeat_at
    or new.last_sync_started_at is distinct from old.last_sync_started_at
    or new.last_sync_completed_at is distinct from old.last_sync_completed_at
    or new.last_failure_at is distinct from old.last_failure_at
    or new.last_error_code is distinct from old.last_error_code
    or new.commander_status is distinct from old.commander_status
    or new.cloud_status is distinct from old.cloud_status
    or new.live_poll_interval_seconds is distinct from old.live_poll_interval_seconds
    or new.last_canonical_record_count is distinct from old.last_canonical_record_count
    or new.last_inserted_count is distinct from old.last_inserted_count
    or new.last_updated_count is distinct from old.last_updated_count
    or new.last_unchanged_count is distinct from old.last_unchanged_count
    or new.last_failed_count is distinct from old.last_failed_count
    or new.last_request_id is distinct from old.last_request_id
    or new.heartbeat_payload_version is distinct from old.heartbeat_payload_version
  ) then
    raise exception using
      errcode = '42501',
      message = 'connector heartbeat fields are service managed';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_authenticated_connector_heartbeat_update() from public, anon, authenticated;

drop trigger if exists prevent_authenticated_connector_heartbeat_update
  on public.store_pos_connectors;

create trigger prevent_authenticated_connector_heartbeat_update
before update on public.store_pos_connectors
for each row
execute function public.prevent_authenticated_connector_heartbeat_update();

grant select (
  installation_id,
  service_version,
  runtime_mode,
  reported_state,
  runtime_started_at,
  last_heartbeat_at,
  reported_heartbeat_at,
  last_sync_started_at,
  last_sync_completed_at,
  last_success_at,
  last_failure_at,
  last_error_code,
  commander_status,
  cloud_status,
  live_poll_interval_seconds,
  last_canonical_record_count,
  last_inserted_count,
  last_updated_count,
  last_unchanged_count,
  last_failed_count,
  last_request_id,
  heartbeat_payload_version
) on public.store_pos_connectors to authenticated;

comment on column public.store_pos_connectors.reported_state is
  'Connector-reported runtime state. Offline is derived server-side from stale last_heartbeat_at.';
comment on column public.store_pos_connectors.installation_id is
  'Stable machine installation UUID reported by the connector. Replacement requires an authorized reset workflow.';
comment on column public.store_pos_connectors.last_heartbeat_at is
  'Server authoritative time at which a valid heartbeat was received.';
comment on column public.store_pos_connectors.reported_heartbeat_at is
  'Connector laptop-reported heartbeat timestamp from the validated payload; server receipt time remains last_heartbeat_at.';

notify pgrst, 'reload schema';
