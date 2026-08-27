-- Live Commander catalog payloads preserve department_number in source_values.
-- Normalize that proven source fact into source_department_key without creating
-- a synthetic department for Commander sentinel 0.
create or replace function public.normalize_live_commander_product_department()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_department_number text;
begin
  if new.source_system <> 'commander'
    or new.last_seen_sync_run_id is null
    or jsonb_typeof(new.source_values) <> 'object'
    or not (new.source_values ? 'department_number') then
    return new;
  end if;

  v_department_number := new.source_values ->> 'department_number';
  if v_department_number is null or v_department_number !~ '^[0-9]{1,64}$' then
    raise exception using errcode = 'P0001', message = 'catalog_source_department_invalid';
  end if;

  new.source_department_key := case when v_department_number = '0' then null else v_department_number end;
  -- source_department_id belongs to the historical static staging model; do
  -- not infer one for a live Commander observation.
  new.source_department_id := null;
  return new;
end;
$function$;

drop trigger if exists pos_catalog_source_product_observations_live_department_normalize
  on public.pos_catalog_source_product_observations;
create trigger pos_catalog_source_product_observations_live_department_normalize
before insert or update of source_system, source_values, last_seen_sync_run_id
on public.pos_catalog_source_product_observations
for each row execute function public.normalize_live_commander_product_department();

-- Backfill only the authoritative completed live catalog for each Commander
-- store scope. Historical/static rows remain untouched.
select set_config('storepulse.live_catalog_sync_writer', 'complete', true);

update public.pos_catalog_source_product_observations observation
set source_department_key = case
      when observation.source_values ->> 'department_number' = '0' then null
      else observation.source_values ->> 'department_number'
    end,
    source_department_id = null
where observation.source_system = 'commander'
  and observation.last_seen_sync_run_id is not null
  and jsonb_typeof(observation.source_values) = 'object'
  and observation.source_values ? 'department_number'
  and observation.source_values ->> 'department_number' ~ '^[0-9]{1,64}$'
  and exists (
    select 1
    from public.pos_catalog_sync_runs current_run
    where current_run.id = observation.last_seen_sync_run_id
      and current_run.store_id = observation.store_id
      and current_run.source_system = observation.source_system
      and current_run.status = 'completed'
      and current_run.catalog_complete = true
      and current_run.import_mode = 'full_catalog'
      and current_run.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
      and not exists (
        select 1
        from public.pos_catalog_sync_runs newer_run
        where newer_run.store_id = current_run.store_id
          and newer_run.source_system = current_run.source_system
          and newer_run.status = 'completed'
          and newer_run.catalog_complete = true
          and newer_run.import_mode = 'full_catalog'
          and newer_run.metadata ->> 'catalog_contract' = 'live_source_catalog_v1'
          and (newer_run.completed_at, newer_run.id) > (current_run.completed_at, current_run.id)
      )
  );

create index if not exists pos_catalog_source_product_observations_live_department_resolution_idx
  on public.pos_catalog_source_product_observations (
    store_id,
    source_system,
    last_seen_sync_run_id,
    source_department_key
  )
  where source_system = 'commander' and last_seen_sync_run_id is not null;

revoke all on function public.normalize_live_commander_product_department() from public, anon, authenticated, service_role;
