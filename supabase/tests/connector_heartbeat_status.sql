begin;

do $$
declare
  v_owner_id uuid := '10000000-0000-4000-8000-000000000001';
  v_other_owner_id uuid := '10000000-0000-4000-8000-000000000002';
  v_store_id uuid := '20000000-0000-4000-8000-000000000001';
  v_other_store_id uuid := '20000000-0000-4000-8000-000000000002';
  v_connector_id uuid := '30000000-0000-4000-8000-000000000001';
  v_other_connector_id uuid := '30000000-0000-4000-8000-000000000002';
  v_token_hash text := repeat('a', 64);
  v_other_token_hash text := repeat('b', 64);
  v_required_columns text[] := array[
    'installation_id',
    'service_version',
    'runtime_mode',
    'reported_state',
    'runtime_started_at',
    'last_heartbeat_at',
    'reported_heartbeat_at',
    'last_sync_started_at',
    'last_sync_completed_at',
    'last_success_at',
    'last_failure_at',
    'last_error_code',
    'commander_status',
    'cloud_status',
    'live_poll_interval_seconds',
    'last_canonical_record_count',
    'last_inserted_count',
    'last_updated_count',
    'last_unchanged_count',
    'last_failed_count',
    'last_request_id',
    'heartbeat_payload_version'
  ];
  v_column text;
  v_count integer;
  v_can_select_token boolean;
  v_function_oid oid;
begin
  foreach v_column in array v_required_columns loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'store_pos_connectors'
        and column_name = v_column
    ) then
      raise exception 'missing heartbeat column: %', v_column;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'store_pos_connectors'
      and t.tgname = 'prevent_authenticated_connector_heartbeat_update'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'heartbeat protection trigger is missing or disabled';
  end if;

  select p.oid
  into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'prevent_authenticated_connector_heartbeat_update'
  limit 1;

  if v_function_oid is null then
    raise exception 'heartbeat protection trigger function is missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) privilege
    where p.oid = v_function_oid
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC must not execute heartbeat protection trigger function directly';
  end if;

  if has_function_privilege('anon', v_function_oid, 'EXECUTE') then
    raise exception 'anon must not execute heartbeat protection trigger function directly';
  end if;

  if has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'authenticated must not execute heartbeat protection trigger function directly';
  end if;

  select has_column_privilege('authenticated', 'public.store_pos_connectors', 'token_hash', 'SELECT')
  into v_can_select_token;

  if v_can_select_token then
    raise exception 'authenticated users must not have column privilege to select token_hash';
  end if;

  if not has_column_privilege('authenticated', 'public.store_pos_connectors', 'last_heartbeat_at', 'SELECT') then
    raise exception 'authenticated users should be able to read permitted heartbeat status columns';
  end if;

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at
  ) values
    (
      v_owner_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'heartbeat-owner@example.invalid',
      'x',
      now(),
      now(),
      now()
    ),
    (
      v_other_owner_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'heartbeat-other-owner@example.invalid',
      'x',
      now(),
      now(),
      now()
    )
  on conflict (id) do nothing;

  insert into public.stores (
    id,
    owner_id,
    store_name,
    store_address
  ) values
    (
      v_store_id,
      v_owner_id,
      'Heartbeat Test Store',
      'Synthetic address'
    ),
    (
      v_other_store_id,
      v_other_owner_id,
      'Other Heartbeat Test Store',
      'Synthetic address'
    )
  on conflict (id) do nothing;

  insert into public.store_pos_connectors (
    id,
    store_id,
    connector_name,
    source_system,
    source_store_number,
    token_hash,
    status
  ) values
    (
      v_connector_id,
      v_store_id,
      'Heartbeat test connector',
      'verifone_commander',
      'TEST01',
      v_token_hash,
      'active'
    ),
    (
      v_other_connector_id,
      v_other_store_id,
      'Other heartbeat test connector',
      'verifone_commander',
      'TEST02',
      v_other_token_hash,
      'active'
    )
  on conflict (id) do nothing;

  select count(*)
  into v_count
  from public.store_pos_connectors
  where id in (v_connector_id, v_other_connector_id)
    and status = 'active';

  if v_count <> 2 then
    raise exception 'existing active connector rows should remain valid';
  end if;

  begin
    update public.store_pos_connectors
    set reported_state = 'offline'
    where id = v_connector_id;
    raise exception 'invalid reported_state should fail';
  exception
    when check_violation then
      null;
  end;

  begin
    update public.store_pos_connectors
    set commander_status = 'not_a_state'
    where id = v_connector_id;
    raise exception 'invalid commander_status should fail';
  exception
    when check_violation then
      null;
  end;

  begin
    update public.store_pos_connectors
    set cloud_status = 'not_a_state'
    where id = v_connector_id;
    raise exception 'invalid cloud_status should fail';
  exception
    when check_violation then
      null;
  end;

  begin
    update public.store_pos_connectors
    set live_poll_interval_seconds = 0
    where id = v_connector_id;
    raise exception 'invalid poll interval should fail';
  exception
    when check_violation then
      null;
  end;

  begin
    update public.store_pos_connectors
    set last_failed_count = -1
    where id = v_connector_id;
    raise exception 'negative last_failed_count should fail';
  exception
    when check_violation then
      null;
  end;

  begin
    update public.store_pos_connectors
    set last_canonical_record_count = -1
    where id = v_connector_id;
    raise exception 'negative last_canonical_record_count should fail';
  exception
    when check_violation then
      null;
  end;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  execute format(
    'select count(*) from public.store_pos_connectors where id = %L',
    v_connector_id
  )
  into v_count;

  if v_count <> 1 then
    raise exception 'store owner should read own connector status';
  end if;

  execute format(
    'select count(*) from public.store_pos_connectors where id = %L',
    v_other_connector_id
  )
  into v_count;

  if v_count <> 0 then
    raise exception 'store owner must not read another store connector';
  end if;

  begin
    execute format(
      'select token_hash from public.store_pos_connectors where id = %L',
      v_connector_id
    );
    raise exception 'authenticated token_hash select should fail';
  exception
    when insufficient_privilege then
      null;
    when undefined_column then
      null;
  end;

  begin
    update public.store_pos_connectors
    set last_heartbeat_at = now()
    where id = v_connector_id;
    raise exception 'authenticated heartbeat-managed update should fail';
  exception
    when insufficient_privilege then
      null;
  end;

  update public.store_pos_connectors
  set connector_name = 'Heartbeat test connector renamed'
  where id = v_connector_id;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'heartbeat trigger should not block unrelated authorized connector updates';
  end if;

  update public.store_pos_connectors
  set connector_name = 'Unauthorized rename attempt'
  where id = v_other_connector_id;

  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'RLS should prevent owner updating another store connector';
  end if;

  reset role;

  set local role anon;
  perform set_config('request.jwt.claim.role', 'anon', true);
  begin
    update public.store_pos_connectors
    set connector_name = 'Anon write attempt'
    where id = v_connector_id;
    raise exception 'anon connector direct write should fail';
  exception
    when insufficient_privilege then
      null;
  end;

  reset role;

  set local role service_role;
  perform set_config('request.jwt.claim.role', 'service_role', true);

  update public.store_pos_connectors
  set
    installation_id = '40000000-0000-4000-8000-000000000001',
    service_version = '3.1.2-heartbeat3',
    runtime_mode = 'Run',
    reported_state = 'ready',
    runtime_started_at = now() - interval '5 minutes',
    last_heartbeat_at = now(),
    reported_heartbeat_at = now() - interval '1 second',
    last_sync_started_at = now() - interval '2 minutes',
    last_sync_completed_at = now() - interval '1 minute',
    last_success_at = now() - interval '1 minute',
    last_failure_at = null,
    last_error_code = null,
    last_error = null,
    consecutive_failure_count = 0,
    commander_status = 'connected',
    cloud_status = 'connected',
    live_poll_interval_seconds = 120,
    last_canonical_record_count = 10,
    last_inserted_count = 1,
    last_updated_count = 2,
    last_unchanged_count = 7,
    last_failed_count = 0,
    last_request_id = 'heartbeat-sql-test',
    heartbeat_payload_version = '1'
  where id = v_connector_id;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'service_role heartbeat update should succeed';
  end if;

  reset role;

  if exists (
    select 1
    from public.store_pos_connectors
    where id = v_connector_id
      and (
        status <> 'active'
        or token_hash <> v_token_hash
        or installation_id <> '40000000-0000-4000-8000-000000000001'
        or reported_heartbeat_at is null
      )
  ) then
    raise exception 'service-role heartbeat update mutated protected administrative/token fields or missed reported heartbeat timestamp';
  end if;

  update public.store_pos_connectors
  set reported_state = 'syncing'
  where id = v_connector_id;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'postgres migration/admin operation should not be blocked by heartbeat trigger';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_pos_connectors'
      and policyname in (
        'select_own_store_pos_connectors',
        'insert_own_store_pos_connectors',
        'update_own_store_pos_connectors',
        'delete_own_store_pos_connectors'
      )
  ) <> 4 then
    raise exception 'expected owner-scoped store_pos_connectors RLS policies are missing';
  end if;
end $$;

rollback;
