-- Completed full-catalog source synchronization.
--
-- This migration extends the existing POS-independent catalog-pilot run and
-- identity contracts. It stages only normalized source observations; it never
-- writes public.products or creates Commander publishing work.

alter table public.pos_catalog_sync_runs
  add column if not exists pages_read integer not null default 0,
  add column if not exists unique_products_received integer not null default 0,
  add column if not exists new_count integer not null default 0,
  add column if not exists unchanged_count integer not null default 0,
  add column if not exists missing_count integer not null default 0,
  add column if not exists error_count integer not null default 0,
  add column if not exists failure_stage text null,
  add column if not exists catalog_payload_sha256 text null;

alter table public.pos_catalog_sync_runs
  add constraint pos_catalog_sync_runs_live_counts_check
  check (
    pages_read >= 0
    and unique_products_received >= 0
    and new_count >= 0
    and unchanged_count >= 0
    and missing_count >= 0
    and error_count >= 0
  );

alter table public.pos_catalog_sync_runs
  add constraint pos_catalog_sync_runs_failure_stage_length_check
  check (failure_stage is null or failure_stage ~ '^[a-z0-9_]{1,128}$');

alter table public.pos_catalog_sync_runs
  add constraint pos_catalog_sync_runs_catalog_payload_hash_check
  check (catalog_payload_sha256 is null or catalog_payload_sha256 ~ '^[0-9a-f]{64}$');

alter table public.pos_catalog_sync_runs
  add constraint pos_catalog_sync_runs_live_payload_hash_required_check
  check (
    metadata ->> 'catalog_contract' <> 'live_source_catalog_v1'
    or catalog_payload_sha256 ~ '^[0-9a-f]{64}$'
  );

create unique index pos_catalog_sync_runs_one_running_live_source_uidx
  on public.pos_catalog_sync_runs (store_id, source_system)
  where status = 'running'
    and metadata ->> 'catalog_contract' = 'live_source_catalog_v1';

-- Static XML import lineage is distinct from a completed live catalog run. A
-- live observation has no import-run record because it is not an XML import.
alter table public.pos_catalog_source_product_observations
  alter column first_import_run_id drop not null,
  alter column last_import_run_id drop not null,
  add column if not exists last_seen_sync_run_id uuid null,
  add column if not exists last_reconciled_sync_run_id uuid null,
  add column if not exists missing_from_source boolean not null default false,
  add column if not exists missing_from_source_at timestamptz null;

alter table public.pos_catalog_source_product_observations
  add constraint pos_catalog_source_product_observations_last_seen_sync_store_fkey
  foreign key (last_seen_sync_run_id, store_id)
  references public.pos_catalog_sync_runs(id, store_id)
  on delete set null (last_seen_sync_run_id);

alter table public.pos_catalog_source_product_observations
  add constraint pos_catalog_source_product_observations_last_reconciled_sync_store_fkey
  foreign key (last_reconciled_sync_run_id, store_id)
  references public.pos_catalog_sync_runs(id, store_id)
  on delete set null (last_reconciled_sync_run_id);

alter table public.pos_catalog_source_product_observations
  add constraint pos_catalog_source_product_observations_missing_state_check
  check (
    (missing_from_source = false and missing_from_source_at is null)
    or (missing_from_source = true and missing_from_source_at is not null)
  );

create index if not exists pos_catalog_source_product_observations_store_live_state_idx
  on public.pos_catalog_source_product_observations (
    store_id,
    source_system,
    last_reconciled_sync_run_id
  );

create index if not exists pos_catalog_source_product_observations_missing_idx
  on public.pos_catalog_source_product_observations (
    store_id,
    source_system,
    missing_from_source,
    missing_from_source_at desc
  ) where missing_from_source;

create unique index product_source_identities_id_product_store_uidx
  on public.product_source_identities (id, product_id, store_id);

create table public.product_source_field_overrides (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null,
  source_identity_id uuid not null,
  field_name text not null,
  desired_value jsonb not null,
  source_value_at_edit jsonb not null,
  status text not null default 'pending_publish',
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_source_field_overrides_identity_product_store_fkey
    foreign key (source_identity_id, product_id, store_id)
    references public.product_source_identities(id, product_id, store_id)
    on delete restrict,
  constraint product_source_field_overrides_field_name_check
    check (field_name in ('description', 'price', 'department')),
  constraint product_source_field_overrides_scalar_values_check
    check (
      jsonb_typeof(desired_value) in ('string', 'number', 'boolean', 'null')
      and jsonb_typeof(source_value_at_edit) in ('string', 'number', 'boolean', 'null')
    ),
  constraint product_source_field_overrides_status_check
    check (status in ('pending_publish', 'conflict', 'published', 'reverted'))
);

create unique index product_source_field_overrides_active_identity_field_uidx
  on public.product_source_field_overrides (source_identity_id, field_name)
  where status in ('pending_publish', 'conflict');

create index product_source_field_overrides_store_status_idx
  on public.product_source_field_overrides (store_id, status, updated_at desc);

create trigger product_source_field_overrides_set_updated_at
before update on public.product_source_field_overrides
for each row execute function public.set_pos_catalog_updated_at();

alter table public.product_source_field_overrides enable row level security;

drop policy if exists "owners_read_product_source_field_overrides"
  on public.product_source_field_overrides;
create policy "owners_read_product_source_field_overrides"
on public.product_source_field_overrides
for select
to authenticated
using (
  exists (
    select 1
    from public.stores store_row
    where store_row.id = product_source_field_overrides.store_id
      and store_row.owner_id = (select auth.uid())
  )
);

revoke all on table public.product_source_field_overrides
  from anon, authenticated;
grant select on table public.product_source_field_overrides
  to authenticated;
grant select, insert, update on table public.product_source_field_overrides
  to service_role;

-- Source observations are a shared legacy/live table. Static XML import is
-- permitted only before completed live synchronization exists for that exact
-- store/source. The live completion RPC sets this transaction-local marker.
create or replace function public.enforce_live_catalog_source_observation_writer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store_id uuid;
  v_source_system text;
begin
  if tg_op = 'DELETE' then
    v_store_id := old.store_id;
    v_source_system := old.source_system;
  else
    v_store_id := new.store_id;
    v_source_system := new.source_system;
  end if;

  if exists (
    select 1
    from public.pos_catalog_sync_runs run_row
    where run_row.store_id = v_store_id
      and run_row.source_system = v_source_system
      and run_row.status = 'completed'
      and run_row.catalog_complete = true
      and run_row.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
  ) and current_setting('storepulse.live_catalog_sync_writer', true) is distinct from 'complete' then
    raise exception using errcode = 'P0001', message = 'catalog_live_state_write_forbidden';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create trigger pos_catalog_source_product_observations_live_writer_guard
before insert or update or delete on public.pos_catalog_source_product_observations
for each row execute function public.enforce_live_catalog_source_observation_writer();

-- Preserve static-import compatibility without permitting direct service-role
-- DML. This existing RPC is guarded by the trigger above after live sync starts.
alter function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb)
  security definer;
alter function public.import_pos_catalog_source_snapshot(jsonb, jsonb, jsonb)
  set search_path = '';

revoke insert, update, delete on table public.pos_catalog_source_product_observations
  from service_role;
grant select on table public.pos_catalog_source_product_observations
  to service_role;

drop function if exists public.begin_pos_catalog_source_sync(uuid, text, text, integer, integer, integer);

create or replace function public.begin_pos_catalog_source_sync(
  p_store_id uuid,
  p_source_system text,
  p_snapshot_file_sha256 text,
  p_catalog_payload_sha256 text,
  p_pages_read integer,
  p_products_received integer,
  p_unique_products_received integer
)
returns table (sync_run_id uuid, reused_completed_run boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_existing_id uuid;
  v_inserted_id uuid;
begin
  if p_store_id is null
    or p_source_system is null or p_source_system !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_snapshot_file_sha256 is null or p_snapshot_file_sha256 !~ '^[0-9a-f]{64}$'
    or p_catalog_payload_sha256 is null or p_catalog_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_pages_read not between 1 and 500
    or p_products_received < 0
    or p_unique_products_received < 0
    or p_products_received <> p_unique_products_received then
    raise exception using errcode = 'P0001', message = 'catalog_sync_invalid';
  end if;

  select store_row.owner_id into v_owner_id
  from public.stores store_row
  where store_row.id = p_store_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'catalog_sync_store_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_store_id::text || ':' || p_source_system, 0)
  );

  select run_row.id into v_existing_id
  from public.pos_catalog_sync_runs run_row
  where run_row.store_id = p_store_id
    and run_row.source_system = p_source_system
    and run_row.catalog_payload_sha256 = p_catalog_payload_sha256
    and run_row.status = 'completed'
    and run_row.catalog_complete = true
    and run_row.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
  order by run_row.completed_at desc, run_row.id desc
  limit 1;
  if found then
    return query select v_existing_id, true;
    return;
  end if;

  if exists (
    select 1
    from public.pos_catalog_sync_runs run_row
    where run_row.store_id = p_store_id
      and run_row.source_system = p_source_system
      and run_row.status = 'running'
      and run_row.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_sync_running';
  end if;

  insert into public.pos_catalog_sync_runs (
    store_id, owner_id, source_system, import_mode, status, catalog_complete,
    captured_at, received_product_count, unique_products_received, catalog_hash,
    catalog_payload_sha256,
    submitted_by_type, metadata, started_at, pages_read
  ) values (
    p_store_id, v_owner_id, p_source_system, 'full_catalog', 'running', false,
    statement_timestamp(), p_products_received, p_unique_products_received,
    p_snapshot_file_sha256, p_catalog_payload_sha256, 'system',
    jsonb_build_object('catalog_contract', 'live_source_catalog_v1'),
    statement_timestamp(), p_pages_read
  ) returning id into v_inserted_id;

  return query select v_inserted_id, false;
end;
$function$;

create or replace function public.complete_pos_catalog_source_sync(
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

  drop table if exists pg_temp.live_catalog_sync_input;
  create temporary table pg_temp.live_catalog_sync_input (
    source_product_key text not null,
    source_upc text not null,
    source_modifier text not null,
    source_description text not null,
    source_price text not null,
    source_department_number text null,
    source_active boolean null,
    normalized_observation_hash text not null
  ) on commit drop;

  insert into pg_temp.live_catalog_sync_input (
    source_product_key, source_upc, source_modifier, source_description,
    source_price, source_department_number, source_active,
    normalized_observation_hash
  )
  select
    value.source_product_key, value.source_upc, value.source_modifier,
    value.source_description, value.source_price,
    value.source_department_number, value.source_active,
    value.normalized_observation_hash
  from jsonb_to_recordset(p_products) as value(
    source_product_key text,
    source_upc text,
    source_modifier text,
    source_description text,
    source_price text,
    source_department_number text,
    source_active boolean,
    normalized_observation_hash text
  );

  if (select count(*) from pg_temp.live_catalog_sync_input) <> v_run.received_product_count
    or v_run.received_product_count <> v_run.unique_products_received
    or exists (
      select 1
      from pg_temp.live_catalog_sync_input input_row
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
        or input_row.normalized_observation_hash !~ '^[0-9a-f]{64}$'
    )
    or exists (
      select 1
      from pg_temp.live_catalog_sync_input input_row
      group by input_row.source_product_key
      having count(*) > 1
    ) then
    raise exception using errcode = 'P0001', message = 'catalog_sync_payload_invalid';
  end if;

  if exists (
    select 1
    from pg_temp.live_catalog_sync_input input_row
    where input_row.normalized_observation_hash <> encode(
      extensions.digest(
        convert_to(
          format(
            'u=%s:%s|m=%s:%s|desc=%s:%s|price=%s:%s|department=%s|active=%s',
            octet_length(input_row.source_upc), input_row.source_upc,
            octet_length(input_row.source_modifier), input_row.source_modifier,
            octet_length(input_row.source_description), input_row.source_description,
            octet_length(input_row.source_price::numeric::text), input_row.source_price::numeric::text,
            case when input_row.source_department_number is null then 'N'
              else 'V' || octet_length(input_row.source_department_number)::text || ':' || input_row.source_department_number end,
            case when input_row.source_active is null then 'N'
              when input_row.source_active then 'T' else 'F' end
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_sync_payload_invalid';
  end if;

  select
    'live_catalog_payload_v1' || E'\n' || coalesce(
      string_agg(
        format(
          'u=%s:%s|m=%s:%s|desc=%s:%s|price=%s:%s|department=%s|active=%s',
          octet_length(input_row.source_upc), input_row.source_upc,
          octet_length(input_row.source_modifier), input_row.source_modifier,
          octet_length(input_row.source_description), input_row.source_description,
          octet_length(input_row.source_price::numeric::text), input_row.source_price::numeric::text,
          case when input_row.source_department_number is null then 'N'
            else 'V' || octet_length(input_row.source_department_number)::text || ':' || input_row.source_department_number end,
          case when input_row.source_active is null then 'N'
            when input_row.source_active then 'T' else 'F' end
        ),
        E'\n'
        order by input_row.source_upc, input_row.source_modifier
      ),
      ''
    )
  into v_catalog_payload_text
  from pg_temp.live_catalog_sync_input input_row;

  v_catalog_payload_sha256 := encode(
    extensions.digest(convert_to(v_catalog_payload_text, 'UTF8'), 'sha256'),
    'hex'
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
    select
      input_row.source_product_key,
      existing_row.id as existing_id,
      existing_row.source_description is distinct from input_row.source_description
        or existing_row.source_price is distinct from input_row.source_price::numeric
        or existing_row.source_values ->> 'department_number'
          is distinct from input_row.source_department_number as is_changed
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
      'source_active', input_row.source_active
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
      select 1
      from pg_temp.live_catalog_sync_input input_row
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

  return query select
    v_new_count,
    v_changed_count,
    v_unchanged_count,
    v_missing_count,
    v_conflict_count;
end;
$function$;

create or replace function public.fail_pos_catalog_source_sync(
  p_sync_run_id uuid,
  p_error_code text,
  p_failure_stage text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_sync_run_id is null
    or p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,128}$'
    or p_failure_stage is null or p_failure_stage !~ '^[a-z0-9_]{1,128}$' then
    raise exception using errcode = 'P0001', message = 'catalog_sync_invalid';
  end if;

  update public.pos_catalog_sync_runs
  set status = 'failed',
      catalog_complete = false,
      failed_at = statement_timestamp(),
      safe_error_code = p_error_code,
      safe_error_message = null,
      failure_stage = p_failure_stage,
      error_count = 1
  where id = p_sync_run_id
    and status = 'running'
    and metadata ->> 'catalog_contract' = 'live_source_catalog_v1';
  if not found then
    raise exception using errcode = 'P0001', message = 'catalog_sync_run_invalid';
  end if;
end;
$function$;

revoke all on function public.begin_pos_catalog_source_sync(uuid, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_pos_catalog_source_sync(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_pos_catalog_source_sync(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_pos_catalog_source_sync(uuid, text, text, text, integer, integer, integer)
  to service_role;
grant execute on function public.complete_pos_catalog_source_sync(uuid, jsonb)
  to service_role;
grant execute on function public.fail_pos_catalog_source_sync(uuid, text, text)
  to service_role;

comment on table public.product_source_field_overrides is
  'Explicit field-level StorePulse ownership intent. Active overrides block automatic resolution only for their field; they never publish by themselves.';
comment on function public.complete_pos_catalog_source_sync(uuid, jsonb) is
  'Service-role-only atomic completed full-catalog source staging. Failed or incomplete runs never advance current source observations or canonical products.';

notify pgrst, 'reload schema';
