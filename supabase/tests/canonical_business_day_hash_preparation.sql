begin;

do $$
declare
  v_owner_id uuid := 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1';
  v_store_id uuid := 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbb1';
  v_import_id uuid := 'cccccccc-cccc-4ccc-cccc-ccccccccccc1';
  v_finalization_id uuid;
  v_prepare jsonb;
  v_prepare_reordered jsonb;
  v_prepare_changed jsonb;
  v_result jsonb;
  v_payload jsonb;
  v_reordered jsonb;
  v_property_a jsonb;
  v_property_b jsonb;
  v_computed_staged_hash text;
  v_failed boolean;
  v_session_count integer;
begin
  insert into auth.users (id, email)
  values (v_owner_id, 'phase2-hash-test@example.invalid')
  on conflict (id) do nothing;

  insert into public.stores (id, owner_id, store_name, has_fuel, register_count)
  values (v_store_id, v_owner_id, 'Phase 2 Hash Test Store', false, 1)
  on conflict (id) do nothing;

  insert into public.pos_transaction_imports (
    id, store_id, owner_id, source_system, source_store_number,
    source_file_name, normalized_file_name, payload_hash, status, canonical_record_count
  ) values (
    v_import_id, v_store_id, v_owner_id, 'verifone_commander', 'SYNTH',
    'hash-test.xml', 'hash-test.json',
    '1111111111111111111111111111111111111111111111111111111111111111',
    'received', 2
  );

  v_property_a := jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'hash-order',
    'store_number', 'SYNTH',
    'canonical_record', true,
    'transaction_time', '2026-01-06T00:10:00-05:00',
    'business_date', '2026-01-05',
    'transaction_type', 'completed_sale',
    'subtotal', 1.00,
    'tax_total', 0.00,
    'total', 1.00,
    'current_total', 1.00,
    'items', jsonb_build_array(jsonb_build_object('line_type', 'item', 'line_total', 1.00)),
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 1.00, 'direction', 'received_from_customer'))
  );

  v_property_b := jsonb_build_object(
    'payments', jsonb_build_array(jsonb_build_object('direction', 'received_from_customer', 'amount', 1.00, 'payment_code', 'CASH')),
    'items', jsonb_build_array(jsonb_build_object('line_total', 1.00, 'line_type', 'item')),
    'current_total', 1.00,
    'total', 1.00,
    'tax_total', 0.00,
    'subtotal', 1.00,
    'transaction_type', 'completed_sale',
    'business_date', '2026-01-05',
    'transaction_time', '2026-01-06T00:10:00-05:00',
    'canonical_record', true,
    'store_number', 'SYNTH',
    'source_unique_id', 'hash-order',
    'source_system', 'verifone_commander'
  );

  v_payload := jsonb_build_array(
    v_property_a,
    jsonb_build_object(
      'source_system', 'verifone_commander',
      'source_unique_id', 'hash-second',
      'store_number', 'SYNTH',
      'canonical_record', true,
      'transaction_time', '2026-01-06T00:20:00-05:00',
      'business_date', '2026-01-05',
      'transaction_type', 'completed_sale',
      'subtotal', 2.00,
      'tax_total', 0.00,
      'total', 2.00,
      'current_total', 2.00,
      'items', jsonb_build_array(jsonb_build_object('line_type', 'item', 'line_total', 2.00)),
      'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 2.00, 'direction', 'received_from_customer'))
    )
  );

  v_reordered := jsonb_build_array(v_payload -> 1, v_payload -> 0);

  if has_function_privilege('public', 'public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb)', 'EXECUTE') then
    raise exception 'PUBLIC must not have execute privilege on prepare hash RPC';
  end if;
  if has_function_privilege('anon', 'public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb)', 'EXECUTE') then
    raise exception 'anon must not have execute privilege on prepare hash RPC';
  end if;
  if has_function_privilege('authenticated', 'public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb)', 'EXECUTE') then
    raise exception 'authenticated must not have execute privilege on prepare hash RPC';
  end if;
  if not has_function_privilege('service_role', 'public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb)', 'EXECUTE') then
    raise exception 'service_role must have execute privilege on prepare hash RPC';
  end if;

  begin
    execute 'set local role anon';
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', v_payload);
    execute 'reset role';
    raise exception 'anon invocation should fail';
  exception when insufficient_privilege then
    execute 'reset role';
  end;

  begin
    execute 'set local role authenticated';
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', v_payload);
    execute 'reset role';
    raise exception 'authenticated invocation should fail';
  exception when insufficient_privilege then
    execute 'reset role';
  end;

  execute 'set local role service_role';
  perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', v_payload);
  execute 'reset role';

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', '[]'::jsonb);
    raise exception 'empty records should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_build_object('source_system', 'verifone_commander')));
    raise exception 'missing source_unique_id should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{source_unique_id}', 'null'::jsonb)));
    raise exception 'null source_unique_id should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(v_property_a - 'source_system'));
    raise exception 'missing source_system should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{source_system}', 'null'::jsonb)));
    raise exception 'null source_system should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{source_system}', '""'::jsonb)));
    raise exception 'blank source_system should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{source_system}', '7'::jsonb)));
    raise exception 'non-string source_system should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(v_property_a, v_property_b));
    raise exception 'duplicate source_unique_id should fail';
  exception when unique_violation then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'other', 'SYNTH', '2026-01-05', v_payload);
    raise exception 'wrong source system should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(v_property_a - 'canonical_record'));
    raise exception 'missing canonical_record should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{canonical_record}', 'null'::jsonb)));
    raise exception 'null canonical_record should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{canonical_record}', '"bad"'::jsonb)));
    raise exception 'string canonical_record should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{canonical_record}', 'false'::jsonb)));
    raise exception 'false canonical_record should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{canonical_record}', jsonb_build_object('verified', true))));
    raise exception 'object canonical_record should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{canonical_record}', '1'::jsonb)));
    raise exception 'numeric canonical_record should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{canonical_record}', '[]'::jsonb)));
    raise exception 'array canonical_record should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(v_property_a - 'items'));
    raise exception 'missing items should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{items}', 'null'::jsonb)));
    raise exception 'null items should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{items}', '{}'::jsonb)));
    raise exception 'non-array items should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(v_property_a - 'payments'));
    raise exception 'missing payments should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{payments}', 'null'::jsonb)));
    raise exception 'null payments should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{payments}', '{}'::jsonb)));
    raise exception 'non-array payments should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{store_number}', 'null'::jsonb)));
    raise exception 'null store_number should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', jsonb_build_array(jsonb_set(v_property_a, '{business_date}', 'null'::jsonb)));
    raise exception 'null business_date should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'OTHER', '2026-01-05', v_payload);
    raise exception 'wrong store number should fail';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-04', v_payload);
    raise exception 'wrong business date should fail';
  exception when invalid_parameter_value then
    null;
  end;

  v_prepare := public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', v_payload);
  if (v_prepare ->> 'expected_record_count')::integer <> 2 or (v_prepare ->> 'record_hash_count')::integer <> 2 then
    raise exception 'unexpected prepare count: %', v_prepare;
  end if;

  v_prepare_reordered := public.prepare_pos_business_day_finalization_hash(v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05', v_reordered);
  if v_prepare ->> 'final_source_set_hash' <> v_prepare_reordered ->> 'final_source_set_hash' then
    raise exception 'reordered records changed final_source_set_hash';
  end if;

  v_prepare_changed := public.prepare_pos_business_day_finalization_hash(
    v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', '2026-01-05',
    jsonb_build_array(jsonb_set(v_payload -> 0, '{total}', '1.01'::jsonb), v_payload -> 1)
  );
  if v_prepare ->> 'final_source_set_hash' = v_prepare_changed ->> 'final_source_set_hash' then
    raise exception 'economic mutation did not change final_source_set_hash';
  end if;

  if encode(extensions.digest(v_property_a::text, 'sha256'), 'hex') <> encode(extensions.digest(v_property_b::text, 'sha256'), 'hex') then
    raise exception 'property order changed canonical jsonb hash';
  end if;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-05',
    'day', '555', '2026-01-06.555', '2026-01-05T22:00:00-05:00',
    '2026-01-06T00:30:00-05:00', v_import_id, 2,
    '2222222222222222222222222222222222222222222222222222222222222222',
    '1111111111111111111111111111111111111111111111111111111111111111',
    v_prepare ->> 'final_source_set_hash',
    '{}'::jsonb
  );
  v_finalization_id := (v_result ->> 'finalization_id')::uuid;

  perform public.stage_pos_business_day_finalization_batch(v_finalization_id, v_payload);

  select encode(
      extensions.digest(
        coalesce(string_agg(r.source_unique_id || ':' || r.canonical_hash, ',' order by r.source_unique_id), ''),
        'sha256'
      ),
      'hex'
    )
    into v_computed_staged_hash
  from public.pos_business_day_finalization_records as r
  where r.finalization_id = v_finalization_id;

  if v_computed_staged_hash <> v_prepare ->> 'final_source_set_hash' then
    raise exception 'prepared hash % did not match staged hash %', v_prepare ->> 'final_source_set_hash', v_computed_staged_hash;
  end if;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-05',
    'day', '555', '2026-01-06.555', '2026-01-05T22:00:00-05:00',
    '2026-01-06T00:30:00-05:00', v_import_id, 2,
    '2222222222222222222222222222222222222222222222222222222222222222',
    '1111111111111111111111111111111111111111111111111111111111111111',
    v_prepare ->> 'final_source_set_hash',
    '{}'::jsonb
  );
  if (v_result ->> 'finalization_id')::uuid <> v_finalization_id or coalesce((v_result ->> 'idempotent')::boolean, false) is not true then
    raise exception 'identical retry did not resume same session: %', v_result;
  end if;

  select count(*)::integer
    into v_session_count
  from public.pos_business_day_finalizations
  where store_id = v_store_id
    and source_system = 'verifone_commander'
    and source_store_number = 'SYNTH'
    and business_date = '2026-01-05'
    and period_type = 'day'
    and period_number = '555';
  if v_session_count <> 1 then
    raise exception 'identical retries created % finalization sessions', v_session_count;
  end if;

  perform public.finalize_pos_business_day(v_finalization_id);

  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-05',
    'day', '555', '2026-01-06.555', '2026-01-05T22:00:00-05:00',
    '2026-01-06T00:30:00-05:00', v_import_id, 2,
    '2222222222222222222222222222222222222222222222222222222222222222',
    '1111111111111111111111111111111111111111111111111111111111111111',
    v_prepare ->> 'final_source_set_hash',
    '{}'::jsonb
  );
  if coalesce((v_result ->> 'already_finalized')::boolean, false) is not true then
    raise exception 'finalized identical payload was not idempotent: %', v_result;
  end if;

  v_failed := false;
  begin
    perform public.begin_pos_business_day_finalization(
      v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-05',
      'day', '555', '2026-01-06.555', '2026-01-05T22:00:00-05:00',
      '2026-01-06T00:30:00-05:00', v_import_id, 2,
      '3333333333333333333333333333333333333333333333333333333333333333',
      '4444444444444444444444444444444444444444444444444444444444444444',
      v_prepare_changed ->> 'final_source_set_hash',
      '{}'::jsonb
    );
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'conflicting finalized payload was not rejected';
  end if;
end;
$$;

-- The outer transaction is intentionally rolled back so all synthetic rows are removed.
rollback;
