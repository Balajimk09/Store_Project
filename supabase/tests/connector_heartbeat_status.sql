begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_connector uuid := gen_random_uuid();
begin
  if has_column_privilege('authenticated', 'public.store_pos_connectors', 'token_hash', 'select') then
    raise exception 'authenticated must not be able to select token_hash';
  end if;

  if not has_column_privilege('authenticated', 'public.store_pos_connectors', 'reported_heartbeat_at', 'select') then
    raise exception 'authenticated store-owner reads should include reported_heartbeat_at';
  end if;

  insert into public.stores (
    id,
    owner_id,
    store_name
  ) values (
    v_store,
    v_owner,
    'Synthetic heartbeat test store'
  );

  insert into public.store_pos_connectors (
    id,
    store_id,
    connector_name,
    source_system,
    token_hash,
    status
  ) values (
    v_connector,
    v_store,
    'Synthetic connector',
    'verifone_commander',
    repeat('0', 64),
    'active'
  );

  update public.store_pos_connectors
  set
    reported_state = 'ready',
    commander_status = 'connected',
    cloud_status = 'connected',
    live_poll_interval_seconds = 120,
    last_canonical_record_count = 1,
    last_inserted_count = 0,
    last_updated_count = 1,
    last_unchanged_count = 0,
    last_failed_count = 0,
    last_heartbeat_at = now(),
    reported_heartbeat_at = now()
  where id = v_connector;

  begin
    update public.store_pos_connectors
    set reported_state = 'offline'
    where id = v_connector;
    raise exception 'invalid reported_state should fail';
  exception when check_violation then
    null;
  end;

  begin
    update public.store_pos_connectors
    set commander_status = 'bad'
    where id = v_connector;
    raise exception 'invalid commander_status should fail';
  exception when check_violation then
    null;
  end;

  begin
    update public.store_pos_connectors
    set cloud_status = 'bad'
    where id = v_connector;
    raise exception 'invalid cloud_status should fail';
  exception when check_violation then
    null;
  end;

  begin
    update public.store_pos_connectors
    set live_poll_interval_seconds = -1
    where id = v_connector;
    raise exception 'invalid poll interval should fail';
  exception when check_violation then
    null;
  end;

  begin
    update public.store_pos_connectors
    set last_failed_count = -1
    where id = v_connector;
    raise exception 'negative heartbeat count should fail';
  exception when check_violation then
    null;
  end;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    update public.store_pos_connectors
    set last_heartbeat_at = now()
    where id = v_connector;
    raise exception 'authenticated heartbeat column update should fail';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.store_pos_connectors
  set
    last_heartbeat_at = now(),
    reported_heartbeat_at = now(),
    reported_state = 'syncing'
  where id = v_connector;

  if not exists (
    select 1
    from public.store_pos_connectors
    where id = v_connector
      and reported_state = 'syncing'
      and last_heartbeat_at is not null
      and reported_heartbeat_at is not null
  ) then
    raise exception 'service-role heartbeat update should succeed';
  end if;
end $$;

rollback;
