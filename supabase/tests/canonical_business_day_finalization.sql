-- Synthetic regression checks for canonical business-day finalization.
-- Run against a local Supabase/Postgres test database after applying migrations.
-- This script uses only synthetic IDs and rolls back all data at the end.

begin;

do $$
declare
  v_owner_id uuid := '11111111-1111-4111-8111-111111111111';
  v_store_id uuid := '22222222-2222-4222-8222-222222222222';
  v_other_store_id uuid := '33333333-3333-4333-8333-333333333333';
  v_import_id uuid := '44444444-4444-4444-8444-444444444444';
  v_final_import_id uuid := '55555555-5555-4555-8555-555555555555';
  v_other_import_id uuid := '66666666-6666-4666-8666-666666666666';
  v_batch_import_id uuid := '77777777-7777-4777-8777-777777777777';
  v_other_source_import_id uuid := '88888888-8888-4888-8888-888888888888';
  v_finalization_id uuid;
  v_result jsonb;
  v_failed_expected boolean;
  v_count integer;
  v_before_count integer;
  v_transaction_id uuid;
  v_other_transaction_id uuid;
  v_payment_id uuid;
  v_other_payment_id uuid;
  v_second_finalization_id uuid;
  v_amount numeric;
  v_summary record;
begin
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
  ) values (
    v_owner_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'synthetic-business-day@example.test',
    'not-a-real-password',
    now(),
    now(),
    now()
  ) on conflict (id) do nothing;

  insert into public.stores (id, owner_id, store_name, store_address, pos_type, has_fuel, register_count)
  values
    (v_store_id, v_owner_id, 'Synthetic Finalization Store', 'Synthetic Address', 'Verifone', true, 1),
    (v_other_store_id, v_owner_id, 'Synthetic Other Store', 'Synthetic Address', 'Verifone', true, 1)
  on conflict (id) do nothing;

  insert into public.pos_transaction_imports (
    id,
    store_id,
    owner_id,
    source_system,
    source_store_number,
    source_file_name,
    normalized_file_name,
    payload_hash,
    status,
    canonical_record_count
  ) values
    (v_import_id, v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', 'synthetic-live.json', 'synthetic-live-normalized.json', 'synthetic-live-payload', 'received', 8),
    (v_final_import_id, v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', 'synthetic-closed.json', 'synthetic-closed-normalized.json', 'synthetic-closed-payload', 'received', 3),
    (v_other_import_id, v_other_store_id, v_owner_id, 'verifone_commander', 'SYNTH2', 'synthetic-other.json', 'synthetic-other-normalized.json', 'synthetic-other-payload', 'received', 1),
    (v_batch_import_id, v_store_id, v_owner_id, 'verifone_commander', 'SYNTH', 'synthetic-finalized-noop-batch.json', 'synthetic-finalized-noop-batch-normalized.json', 'synthetic-finalized-noop-batch-payload', 'received', 1),
    (v_other_source_import_id, v_store_id, v_owner_id, 'synthetic_other_source', 'SYNTH', 'synthetic-other-source.json', 'synthetic-other-source-normalized.json', 'synthetic-other-source-payload', 'received', 1);

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-shared-unchanged',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-02T10:00:00-06:00',
    'business_date', '2026-01-02',
    'transaction_type', 'completed_sale',
    'total', 10.00,
    'tax_total', 1.00,
    'cash_back_amount', 2.00,
    'cash_back_fee', 0.25,
    'has_cash_back', true,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 12.00, 'direction', 'received_from_customer'))
  ));

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-stale-live-only',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-02T11:00:00-06:00',
    'business_date', '2026-01-02',
    'transaction_type', 'completed_sale',
    'total', 100.00,
    'tax_total', 10.00,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 100.00, 'direction', 'received_from_customer'))
  ));

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-shared-changed',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-02T12:00:00-06:00',
    'business_date', '2026-01-02',
    'transaction_type', 'completed_sale',
    'total', 20.00,
    'tax_total', 2.00,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 20.00, 'direction', 'received_from_customer'))
  ));

  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and business_date = '2026-01-02'
    and record_lifecycle = 'provisional'
    and is_active = true;
  if v_count <> 3 then
    raise exception 'Expected 3 active provisional rows before finalization, got %', v_count;
  end if;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id,
    v_owner_id,
    null,
    'verifone_commander',
    'SYNTH',
    '2026-01-02',
    'day',
    'synthetic-001',
    'Synthetic Day',
    '2026-01-02T06:00:00-06:00',
    '2026-01-03T03:00:00-06:00',
    v_final_import_id,
    3,
    'synthetic-source-file-hash',
    'synthetic-final-payload-hash',
    null,
    '{"test": true}'::jsonb
  );
  v_finalization_id := (v_result ->> 'finalization_id')::uuid;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id,
    v_owner_id,
    null,
    'verifone_commander',
    'SYNTH',
    '2026-01-02',
    'day',
    'synthetic-001',
    'Synthetic Day',
    '2026-01-02T06:00:00-06:00',
    '2026-01-03T03:00:00-06:00',
    v_final_import_id,
    3,
    'synthetic-source-file-hash',
    'synthetic-final-payload-hash',
    null,
    '{"test": true}'::jsonb
  );
  v_second_finalization_id := (v_result ->> 'finalization_id')::uuid;
  if v_second_finalization_id <> v_finalization_id then
    raise exception 'Expected repeated matching begin call to resume finalization %, got %',
      v_finalization_id, v_second_finalization_id;
  end if;
  select count(*) into v_count
  from public.pos_business_day_finalizations
  where store_id = v_store_id
    and source_system = 'verifone_commander'
    and source_store_number = 'SYNTH'
    and business_date = '2026-01-02'
    and period_type = 'day'
    and period_number = 'synthetic-001'
    and payload_hash = 'synthetic-final-payload-hash'
    and status in ('uploading', 'uploaded', 'reconciling');
  if v_count <> 1 then
    raise exception 'Expected one mutable matching finalization session after repeated begin, got %', v_count;
  end if;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id,
    v_owner_id,
    null,
    'verifone_commander',
    'SYNTH',
    '2026-01-02',
    'day',
    'synthetic-001',
    'Synthetic Day',
    '2026-01-02T06:00:00-06:00',
    '2026-01-03T03:00:00-06:00',
    v_final_import_id,
    3,
    'synthetic-source-file-hash',
    'synthetic-conflicting-payload-hash',
    null,
    '{"test": true}'::jsonb
  );
  v_second_finalization_id := (v_result ->> 'finalization_id')::uuid;
  if v_second_finalization_id = v_finalization_id then
    raise exception 'Expected incompatible mutable payload to create a separate session, not reuse %',
      v_finalization_id;
  end if;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id,
    v_owner_id,
    null,
    'verifone_commander',
    'SYNTH',
    '2026-01-02',
    'day',
    'synthetic-001-other',
    'Synthetic Day Other Period',
    '2026-01-02T06:00:00-06:00',
    '2026-01-03T03:00:00-06:00',
    v_final_import_id,
    3,
    'synthetic-source-file-hash',
    'synthetic-final-payload-hash',
    null,
    '{"test": true}'::jsonb
  );
  v_second_finalization_id := (v_result ->> 'finalization_id')::uuid;
  if v_second_finalization_id = v_finalization_id then
    raise exception 'Expected different period identity to create a separate session, not reuse %',
      v_finalization_id;
  end if;

  perform public.stage_pos_business_day_finalization_batch(v_finalization_id, jsonb_build_array(
    jsonb_build_object(
      'source_system', 'verifone_commander',
      'source_unique_id', 'synthetic-shared-unchanged',
      'store_number', 'SYNTH',
      'transaction_time', '2026-01-02T10:00:00-06:00',
      'business_date', '2026-01-02',
      'transaction_type', 'completed_sale',
      'total', 10.00,
      'tax_total', 1.00,
      'cash_back_amount', 2.00,
      'cash_back_fee', 0.25,
      'has_cash_back', true,
      'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 12.00, 'direction', 'received_from_customer'))
    ),
    jsonb_build_object(
      'source_system', 'verifone_commander',
      'source_unique_id', 'synthetic-shared-changed',
      'store_number', 'SYNTH',
      'transaction_time', '2026-01-02T12:00:00-06:00',
      'business_date', '2026-01-02',
      'transaction_type', 'completed_sale',
      'total', 25.00,
      'tax_total', 2.50,
      'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 25.00, 'direction', 'received_from_customer'))
    ),
    jsonb_build_object(
      'source_system', 'verifone_commander',
      'source_unique_id', 'synthetic-final-only',
      'store_number', 'SYNTH',
      'transaction_time', '2026-01-02T13:00:00-06:00',
      'business_date', '2026-01-02',
      'transaction_type', 'completed_sale',
      'total', 5.00,
      'tax_total', 0.50,
      'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 5.00, 'direction', 'received_from_customer'))
    )
  ));

  v_result := public.finalize_pos_business_day(v_finalization_id);
  if v_result ->> 'status' <> 'finalized' then
    raise exception 'Expected finalized status, got %', v_result;
  end if;

  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and business_date = '2026-01-02'
    and record_lifecycle = 'final'
    and is_active = true;
  if v_count <> 3 then
    raise exception 'Expected 3 final active rows, got %', v_count;
  end if;

  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and source_unique_id = 'synthetic-stale-live-only'
    and record_lifecycle = 'superseded'
    and is_active = false
    and superseded_reason = 'absent_from_closed_period';
  if v_count <> 1 then
    raise exception 'Expected stale provisional row to be superseded, got %', v_count;
  end if;

  select *
    into v_summary
  from public.get_canonical_report_summary(v_store_id, '2026-01-02', '2026-01-02');
  if v_summary.gross_sales <> 40.00 or v_summary.net_tax <> 4.00 or v_summary.completed_sale_count <> 3 then
    raise exception 'Unexpected finalized report summary: gross %, tax %, count %', v_summary.gross_sales, v_summary.net_tax, v_summary.completed_sale_count;
  end if;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-02',
    'day', 'synthetic-001', 'Synthetic Day', '2026-01-02T06:00:00-06:00',
    '2026-01-03T03:00:00-06:00', v_final_import_id, 3, 'synthetic-source-file-hash',
    'synthetic-final-payload-hash', null, '{}'::jsonb
  );
  if coalesce((v_result ->> 'already_finalized')::boolean, false) is not true then
    raise exception 'Expected same final closed payload to be idempotent, got %', v_result;
  end if;

  v_failed_expected := false;
  begin
    perform public.begin_pos_business_day_finalization(
      v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-02',
      'day', 'synthetic-001', 'Synthetic Day', '2026-01-02T06:00:00-06:00',
      '2026-01-03T03:00:00-06:00', v_final_import_id, 3, 'different-source-file-hash',
      'different-payload-hash', null, '{}'::jsonb
    );
  exception when unique_violation then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected conflicting finalized payload to be rejected';
  end if;

  v_result := public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-live-after-final',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-02T14:00:00-06:00',
    'business_date', '2026-01-02',
    'transaction_type', 'completed_sale',
    'total', 1.00,
    'tax_total', 0.10
  ));
  if v_result ->> 'action' <> 'unchanged'
     or v_result ->> 'ignored_reason' <> 'business_day_finalized' then
    raise exception 'Expected live ingestion into finalized business date to be a compatible no-op, got %', v_result;
  end if;

  select *
    into v_summary
  from public.get_canonical_report_summary(v_store_id, '2026-01-02', '2026-01-02');
  if v_summary.gross_sales <> 40.00 or v_summary.net_tax <> 4.00 or v_summary.completed_sale_count <> 3 then
    raise exception 'Finalized-day no-op changed active totals: gross %, tax %, count %', v_summary.gross_sales, v_summary.net_tax, v_summary.completed_sale_count;
  end if;

  v_result := public.ingest_pos_transaction_batch(v_store_id, v_owner_id, null, v_batch_import_id, jsonb_build_array(jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-live-after-final-batch',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-02T14:05:00-06:00',
    'business_date', '2026-01-02',
    'transaction_type', 'completed_sale',
    'total', 2.00,
    'tax_total', 0.20
  )));
  if (v_result ->> 'failed_count')::integer <> 0
     or (v_result ->> 'unchanged_count')::integer <> 1 then
    raise exception 'Expected batch no-op for finalized date to count as unchanged without failure, got %', v_result;
  end if;

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-paid-out',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-03T10:00:00-06:00',
    'business_date', '2026-01-03',
    'transaction_type', 'paid_out',
    'total', 0,
    'current_total', 25.00,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 25.00, 'direction', 'cash_paid_out'))
  ));

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-safe-drop',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-03T11:00:00-06:00',
    'business_date', '2026-01-03',
    'transaction_type', 'safe_drop',
    'total', 0,
    'current_total', 30.00,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 30.00, 'direction', 'cash_to_safe'))
  ));

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-lottery-payout',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-03T12:00:00-06:00',
    'business_date', '2026-01-03',
    'transaction_type', 'paid_out',
    'total', 0,
    'current_total', 50.00,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 50.00, 'direction', 'cash_paid_out', 'cash_event_type', 'lottery_payout', 'source_event_type', 'synthetic_lottery'))
  ));

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-unknown-cash',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-03T13:00:00-06:00',
    'business_date', '2026-01-03',
    'transaction_type', 'zero_value_event',
    'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 7.00, 'direction', 'cash_paid_out', 'cash_event_type', 'mystery_drawer_event'))
  ));

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-cash-refund',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-03T14:00:00-06:00',
    'business_date', '2026-01-03',
    'transaction_type', 'refund',
    'total', -8.00,
    'tax_total', -0.80,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', -8.00, 'direction', 'refund_to_customer'))
  ));

  select coalesce(sum(signed_amount), 0) into v_amount
  from public.pos_transaction_cash_events
  where store_id = v_store_id
    and cash_event_type in ('cashback', 'paid_out', 'safe_drop', 'lottery_payout', 'cash_refund');
  if v_amount <> -115.00 then
    raise exception 'Expected net drawer cash movement -115.00, got %', v_amount;
  end if;

  select count(*) into v_count
  from public.pos_transaction_cash_events
  where store_id = v_store_id
    and cash_event_type = 'unknown_cash_event'
    and requires_review = true
    and affects_sales = false
    and affects_drawer_cash = false;
  if v_count <> 1 then
    raise exception 'Expected one reviewed unknown cash event with no sales/drawer effect, got %', v_count;
  end if;

  select count(*) into v_count
  from public.pos_transaction_relationships
  where store_id = v_store_id;
  if v_count < 0 then
    raise exception 'Relationship audit table should remain queryable';
  end if;

  perform public.upsert_pos_transaction(v_other_store_id, v_owner_id, null, v_other_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-other-store',
    'store_number', 'SYNTH2',
    'transaction_time', '2026-01-02T10:00:00-06:00',
    'business_date', '2026-01-02',
    'transaction_type', 'completed_sale',
    'total', 99.00,
    'tax_total', 9.90
  ));

  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_other_store_id
    and record_lifecycle = 'provisional'
    and is_active = true;
  if v_count <> 1 then
    raise exception 'Expected other store to be unaffected, got % rows', v_count;
  end if;

  if has_table_privilege('authenticated', 'public.pos_business_day_finalization_records', 'SELECT') then
    raise exception 'authenticated must not have SELECT on raw finalization staging records';
  end if;

  -- Lifecycle constraint accepts the three valid state shapes.
  insert into public.pos_transactions (
    store_id, owner_id, source_system, source_unique_id, transaction_time, business_date,
    transaction_type, total, canonical_hash, record_lifecycle, is_active
  ) values (
    v_store_id, v_owner_id, 'synthetic_lifecycle', 'synthetic-valid-provisional',
    '2026-01-04T08:00:00-06:00', '2026-01-04', 'completed_sale', 1.00,
    'synthetic-valid-provisional-hash', 'provisional', true
  );

  insert into public.pos_transactions (
    store_id, owner_id, source_system, source_unique_id, transaction_time, business_date,
    transaction_type, total, canonical_hash, record_lifecycle, is_active,
    finalization_id, final_import_id
  ) values (
    v_store_id, v_owner_id, 'synthetic_lifecycle', 'synthetic-valid-final',
    '2026-01-04T08:01:00-06:00', '2026-01-04', 'completed_sale', 1.00,
    'synthetic-valid-final-hash', 'final', true, v_finalization_id, v_final_import_id
  );

  insert into public.pos_transactions (
    store_id, owner_id, source_system, source_unique_id, transaction_time, business_date,
    transaction_type, total, canonical_hash, record_lifecycle, is_active,
    superseded_by_finalization_id, superseded_at, superseded_reason
  ) values (
    v_store_id, v_owner_id, 'synthetic_lifecycle', 'synthetic-valid-superseded',
    '2026-01-04T08:02:00-06:00', '2026-01-04', 'completed_sale', 1.00,
    'synthetic-valid-superseded-hash', 'superseded', false, v_finalization_id, now(), 'synthetic_superseded'
  );

  v_failed_expected := false;
  begin
    insert into public.pos_transactions (
      store_id, owner_id, source_system, source_unique_id, transaction_time, business_date,
      transaction_type, total, canonical_hash, record_lifecycle, is_active
    ) values (
      v_store_id, v_owner_id, 'synthetic_lifecycle', 'synthetic-invalid-inactive-provisional',
      '2026-01-04T08:03:00-06:00', '2026-01-04', 'completed_sale', 1.00,
      'synthetic-invalid-inactive-provisional-hash', 'provisional', false
    );
  exception when check_violation then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected inactive provisional lifecycle state to be rejected';
  end if;

  v_failed_expected := false;
  begin
    insert into public.pos_transactions (
      store_id, owner_id, source_system, source_unique_id, transaction_time, business_date,
      transaction_type, total, canonical_hash, record_lifecycle, is_active
    ) values (
      v_store_id, v_owner_id, 'synthetic_lifecycle', 'synthetic-invalid-final-without-audit',
      '2026-01-04T08:04:00-06:00', '2026-01-04', 'completed_sale', 1.00,
      'synthetic-invalid-final-without-audit-hash', 'final', true
    );
  exception when check_violation then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected final lifecycle without finalization audit to be rejected';
  end if;

  v_failed_expected := false;
  begin
    insert into public.pos_transactions (
      store_id, owner_id, source_system, source_unique_id, transaction_time, business_date,
      transaction_type, total, canonical_hash, record_lifecycle, is_active,
      superseded_by_finalization_id, superseded_at
    ) values (
      v_store_id, v_owner_id, 'synthetic_lifecycle', 'synthetic-invalid-superseded-no-reason',
      '2026-01-04T08:05:00-06:00', '2026-01-04', 'completed_sale', 1.00,
      'synthetic-invalid-superseded-no-reason-hash', 'superseded', false, v_finalization_id, now()
    );
  exception when check_violation then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected superseded lifecycle without reason to be rejected';
  end if;

  -- Authoritative child replacement: changed final record replaces the complete child set.
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-child-replace',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-05T10:00:00-06:00',
    'business_date', '2026-01-05',
    'transaction_type', 'completed_sale',
    'total', 12.00,
    'tax_total', 1.20,
    'original_ticket', 'ORIGINAL-A',
    'recalled_from_ticket', 'RECALL-A',
    'items', jsonb_build_array(
      jsonb_build_object('line_number', 1, 'description', 'kept line', 'line_total', 5.00),
      jsonb_build_object('line_number', 2, 'description', 'removed line', 'line_total', 7.00)
    ),
    'payments', jsonb_build_array(
      jsonb_build_object('payment_number', 1, 'payment_code', 'CASH', 'amount', 5.00, 'direction', 'received_from_customer'),
      jsonb_build_object('payment_number', 2, 'payment_code', 'CASH', 'amount', 7.00, 'direction', 'received_from_customer')
    )
  ));

  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-05',
    'day', 'synthetic-child', 'Synthetic Child Day', '2026-01-05T06:00:00-06:00',
    '2026-01-06T03:00:00-06:00', v_final_import_id, 1, 'synthetic-child-file',
    'synthetic-child-payload', null, '{}'::jsonb
  );
  v_finalization_id := (v_result ->> 'finalization_id')::uuid;
  perform public.stage_pos_business_day_finalization_batch(v_finalization_id, jsonb_build_array(jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-child-replace',
    'store_number', 'SYNTH',
    'transaction_time', '2026-01-05T10:00:00-06:00',
    'business_date', '2026-01-05',
    'transaction_type', 'completed_sale',
    'total', 9.00,
    'tax_total', 0.90,
    'original_ticket', 'ORIGINAL-B',
    'items', jsonb_build_array(jsonb_build_object('line_number', 1, 'description', 'final kept line', 'line_total', 9.00)),
    'payments', jsonb_build_array(jsonb_build_object('payment_number', 1, 'payment_code', 'CASH', 'amount', 9.00, 'direction', 'received_from_customer'))
  )));
  perform public.finalize_pos_business_day(v_finalization_id);

  select id into v_transaction_id
  from public.pos_transactions
  where store_id = v_store_id
    and source_unique_id = 'synthetic-child-replace'
    and record_lifecycle = 'final'
    and is_active = true;

  select count(*) into v_count from public.pos_transaction_lines where transaction_id = v_transaction_id;
  if v_count <> 1 then
    raise exception 'Expected exactly one final child line after replacement, got %', v_count;
  end if;
  select count(*) into v_count from public.pos_transaction_lines where transaction_id = v_transaction_id and description = 'removed line';
  if v_count <> 0 then
    raise exception 'Expected removed provisional line to be gone, got %', v_count;
  end if;
  select count(*) into v_count from public.pos_transaction_payments where transaction_id = v_transaction_id;
  if v_count <> 1 then
    raise exception 'Expected exactly one final payment after replacement, got %', v_count;
  end if;
  select count(*) into v_count from public.pos_transaction_relationships where transaction_id = v_transaction_id;
  if v_count <> 1 then
    raise exception 'Expected exactly one final relationship after replacement, got %', v_count;
  end if;

  -- Failed finalization rolls back all active state changes.
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-rollback-a',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-06T10:00:00-06:00',
    'business_date', '2026-01-06', 'transaction_type', 'completed_sale', 'total', 10.00,
    'items', jsonb_build_array(jsonb_build_object('line_number', 1, 'description', 'rollback line', 'line_total', 10.00))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-rollback-b',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-06T11:00:00-06:00',
    'business_date', '2026-01-06', 'transaction_type', 'completed_sale', 'total', 20.00
  ));
  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-06',
    'day', 'synthetic-rollback', 'Synthetic Rollback Day', '2026-01-06T06:00:00-06:00',
    '2026-01-07T03:00:00-06:00', v_final_import_id, 2, 'synthetic-rollback-file',
    'synthetic-rollback-payload', null, '{}'::jsonb
  );
  v_finalization_id := (v_result ->> 'finalization_id')::uuid;
  perform public.stage_pos_business_day_finalization_batch(v_finalization_id, jsonb_build_array(
    jsonb_build_object(
      'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-rollback-a',
      'store_number', 'SYNTH', 'transaction_time', '2026-01-06T10:00:00-06:00',
      'business_date', '2026-01-06', 'transaction_type', 'completed_sale', 'total', 11.00
    ),
    jsonb_build_object(
      'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-rollback-b',
      'store_number', 'SYNTH', 'transaction_time', '2026-01-06T11:00:00-06:00',
      'business_date', '2026-01-06', 'transaction_type', 'completed_sale', 'total', 'not-a-number'
    )
  ));
  v_failed_expected := false;
  begin
    perform public.finalize_pos_business_day(v_finalization_id);
  exception when others then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected rollback finalization to fail';
  end if;
  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and business_date = '2026-01-06'
    and record_lifecycle = 'provisional'
    and is_active = true;
  if v_count <> 2 then
    raise exception 'Expected failed finalization to leave 2 provisional rows active, got %', v_count;
  end if;
  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and business_date = '2026-01-06'
    and record_lifecycle in ('final', 'superseded');
  if v_count <> 0 then
    raise exception 'Expected failed finalization to create no final/superseded rows, got %', v_count;
  end if;
  select *
    into v_summary
  from public.get_canonical_report_summary(v_store_id, '2026-01-06', '2026-01-06');
  if v_summary.gross_sales <> 30.00 or v_summary.completed_sale_count <> 2 then
    raise exception 'Failed finalization changed report totals: gross %, count %', v_summary.gross_sales, v_summary.completed_sale_count;
  end if;
  select id into v_transaction_id
  from public.pos_transactions
  where store_id = v_store_id
    and source_unique_id = 'synthetic-rollback-a'
    and record_lifecycle = 'provisional'
    and is_active = true;
  select count(*) into v_count
  from public.pos_transaction_lines
  where transaction_id = v_transaction_id
    and description = 'rollback line';
  if v_count <> 1 then
    raise exception 'Failed finalization changed existing child rows, got % rollback lines', v_count;
  end if;

  -- Cross-scope isolation: source system, business date, and store boundaries.
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_other_source_import_id, jsonb_build_object(
    'source_system', 'synthetic_other_source', 'source_unique_id', 'synthetic-other-source-row',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-07T10:00:00-06:00',
    'business_date', '2026-01-07', 'transaction_type', 'completed_sale', 'total', 70.00
  ));
  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-07',
    'day', 'synthetic-source-isolation', 'Synthetic Source Isolation', '2026-01-07T06:00:00-06:00',
    '2026-01-08T03:00:00-06:00', v_final_import_id, 0, 'synthetic-source-isolation-file',
    'synthetic-source-isolation-payload', null, '{}'::jsonb
  );
  perform public.finalize_pos_business_day((v_result ->> 'finalization_id')::uuid);
  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and source_system = 'synthetic_other_source'
    and source_unique_id = 'synthetic-other-source-row'
    and is_active = true;
  if v_count <> 1 then
    raise exception 'Finalization for one source system affected another source system';
  end if;

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-other-date-row',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-08T10:00:00-06:00',
    'business_date', '2026-01-08', 'transaction_type', 'completed_sale', 'total', 80.00
  ));
  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-09',
    'day', 'synthetic-date-isolation', 'Synthetic Date Isolation', '2026-01-09T06:00:00-06:00',
    '2026-01-10T03:00:00-06:00', v_final_import_id, 0, 'synthetic-date-isolation-file',
    'synthetic-date-isolation-payload', null, '{}'::jsonb
  );
  perform public.finalize_pos_business_day((v_result ->> 'finalization_id')::uuid);
  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and source_unique_id = 'synthetic-other-date-row'
    and is_active = true;
  if v_count <> 1 then
    raise exception 'Finalization for one business date affected another date';
  end if;

  -- Staging idempotency and mutable changed-hash updates before finalization.
  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-10',
    'day', 'synthetic-stage', 'Synthetic Stage Day', '2026-01-10T06:00:00-06:00',
    '2026-01-11T03:00:00-06:00', v_final_import_id, 1, 'synthetic-stage-file',
    'synthetic-stage-payload', null, '{}'::jsonb
  );
  v_finalization_id := (v_result ->> 'finalization_id')::uuid;
  v_result := public.stage_pos_business_day_finalization_batch(v_finalization_id, jsonb_build_array(jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-stage-dup',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-10T10:00:00-06:00',
    'business_date', '2026-01-10', 'transaction_type', 'completed_sale', 'total', 1.00
  )));
  v_result := public.stage_pos_business_day_finalization_batch(v_finalization_id, jsonb_build_array(jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-stage-dup',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-10T10:00:00-06:00',
    'business_date', '2026-01-10', 'transaction_type', 'completed_sale', 'total', 1.00
  )));
  if (v_result ->> 'stage_unchanged_count')::integer <> 1 then
    raise exception 'Expected restaging same record/hash to be unchanged, got %', v_result;
  end if;
  v_result := public.stage_pos_business_day_finalization_batch(v_finalization_id, jsonb_build_array(jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-stage-dup',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-10T10:00:00-06:00',
    'business_date', '2026-01-10', 'transaction_type', 'completed_sale', 'total', 2.00
  )));
  if (v_result ->> 'stage_updated_count')::integer <> 1 then
    raise exception 'Expected restaging changed record/hash to update mutable staging row, got %', v_result;
  end if;
  select count(*) into v_count
  from public.pos_business_day_finalization_records
  where finalization_id = v_finalization_id
    and source_unique_id = 'synthetic-stage-dup';
  if v_count <> 1 then
    raise exception 'Expected one staging row after duplicate stage batches, got %', v_count;
  end if;

  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-11',
    'day', 'synthetic-incomplete', 'Synthetic Incomplete Day', '2026-01-11T06:00:00-06:00',
    '2026-01-12T03:00:00-06:00', v_final_import_id, 2, 'synthetic-incomplete-file',
    'synthetic-incomplete-payload', null, '{}'::jsonb
  );
  v_finalization_id := (v_result ->> 'finalization_id')::uuid;
  perform public.stage_pos_business_day_finalization_batch(v_finalization_id, jsonb_build_array(jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-incomplete-one',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-11T10:00:00-06:00',
    'business_date', '2026-01-11', 'transaction_type', 'completed_sale', 'total', 1.00
  )));
  v_before_count := (
    select count(*)
    from public.pos_transactions
    where store_id = v_store_id
      and business_date = '2026-01-11'
  );
  v_failed_expected := false;
  begin
    perform public.finalize_pos_business_day(v_finalization_id);
  exception when invalid_parameter_value then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected incomplete expected count to fail before active state changes';
  end if;
  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_store_id
    and business_date = '2026-01-11';
  if v_count <> v_before_count then
    raise exception 'Incomplete finalization changed active transaction state';
  end if;

  -- Generated cash events are idempotent; manual reviewed events survive sync; removed generated events are removed.
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-paidout',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:00:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'paid_out', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 15.00, 'direction', 'cash_paid_out'))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-paidout',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:00:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'paid_out', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 15.00, 'direction', 'cash_paid_out'))
  ));
  select id into v_transaction_id from public.pos_transactions where store_id = v_store_id and source_unique_id = 'synthetic-generated-paidout';
  select count(*) into v_count from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'generated' and cash_event_type = 'paid_out';
  if v_count <> 1 then
    raise exception 'Expected repeated paid_out sync to keep one generated event, got %', v_count;
  end if;

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-cashback',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:05:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'completed_sale', 'total', 5.00,
    'cash_back_amount', 4.00, 'cash_back_fee', 0.50, 'has_cash_back', true,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 9.50, 'direction', 'received_from_customer'))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-cashback',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:05:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'completed_sale', 'total', 5.00,
    'cash_back_amount', 4.00, 'cash_back_fee', 0.50, 'has_cash_back', true,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 9.50, 'direction', 'received_from_customer'))
  ));
  select id into v_transaction_id from public.pos_transactions where store_id = v_store_id and source_unique_id = 'synthetic-generated-cashback';
  select count(*) into v_count from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'generated' and cash_event_type = 'cashback';
  if v_count <> 1 then
    raise exception 'Expected repeated cashback sync to keep one generated event, got %', v_count;
  end if;

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-safedrop',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:10:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'safe_drop', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 18.00, 'direction', 'cash_to_safe'))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-safedrop',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:10:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'safe_drop', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 18.00, 'direction', 'cash_to_safe'))
  ));
  select id into v_transaction_id from public.pos_transactions where store_id = v_store_id and source_unique_id = 'synthetic-generated-safedrop';
  select count(*) into v_count from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'generated' and cash_event_type = 'safe_drop';
  if v_count <> 1 then
    raise exception 'Expected repeated safe_drop sync to keep one generated event, got %', v_count;
  end if;

  select id into v_transaction_id from public.pos_transactions where store_id = v_store_id and source_unique_id = 'synthetic-generated-paidout';

  insert into public.pos_transaction_cash_events (
    store_id, owner_id, transaction_id, event_origin, event_number, source_system, source_event_type,
    cash_event_type, direction, amount, signed_amount, affects_sales, affects_drawer_cash,
    affects_tender_mix, requires_review, metadata
  ) values
    (v_store_id, v_owner_id, v_transaction_id, 'manual', 1, 'verifone_commander', 'manual_lottery_review',
     'lottery_payout', 'out', 12.00, -12.00, false, true, false, false, '{}'::jsonb),
    (v_store_id, v_owner_id, v_transaction_id, 'manual', 2, 'verifone_commander', 'manual_unknown_review',
     'other_cash_adjustment', 'out', 3.00, -3.00, false, true, false, false, '{}'::jsonb);

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-paidout',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:00:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'paid_out', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 15.00, 'direction', 'cash_paid_out'))
  ));
  select count(*) into v_count from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'manual';
  if v_count <> 2 then
    raise exception 'Expected manual cash events to survive generated sync, got %', v_count;
  end if;

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-generated-paidout',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-12T10:00:00-06:00',
    'business_date', '2026-01-12', 'transaction_type', 'zero_value_event', 'total', 0,
    'payments', jsonb_build_array()
  ));
  select count(*) into v_count from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'generated';
  if v_count <> 0 then
    raise exception 'Expected removed generated cash event to be deleted, got %', v_count;
  end if;
  select count(*) into v_count from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'manual';
  if v_count <> 2 then
    raise exception 'Expected manual cash events to remain after generated removal, got %', v_count;
  end if;

  -- Cash-event payment references must match the same transaction and tenant.
  select id into v_transaction_id
  from public.pos_transactions
  where store_id = v_store_id
    and source_unique_id = 'synthetic-generated-safedrop';
  select id into v_payment_id
  from public.pos_transaction_payments
  where transaction_id = v_transaction_id
  limit 1;

  insert into public.pos_transaction_cash_events (
    store_id, owner_id, transaction_id, payment_id, event_origin, event_number,
    source_system, source_event_type, cash_event_type, direction, amount, signed_amount,
    affects_sales, affects_drawer_cash, affects_tender_mix, requires_review, metadata
  ) values (
    v_store_id, v_owner_id, v_transaction_id, v_payment_id, 'manual', 3,
    'verifone_commander', 'manual_payment_match', 'other_cash_adjustment', 'out', 1.00, -1.00,
    false, true, false, false, '{}'::jsonb
  );

  insert into public.pos_transaction_cash_events (
    store_id, owner_id, transaction_id, payment_id, event_origin, event_number,
    source_system, source_event_type, cash_event_type, direction, amount, signed_amount,
    affects_sales, affects_drawer_cash, affects_tender_mix, requires_review, metadata
  ) values (
    v_store_id, v_owner_id, v_transaction_id, null, 'manual', 4,
    'verifone_commander', 'manual_null_payment', 'other_cash_adjustment', 'out', 1.00, -1.00,
    false, true, false, false, '{}'::jsonb
  );

  select id into v_other_transaction_id
  from public.pos_transactions
  where store_id = v_store_id
    and source_unique_id = 'synthetic-generated-cashback';
  select id into v_other_payment_id
  from public.pos_transaction_payments
  where transaction_id = v_other_transaction_id
  limit 1;

  v_failed_expected := false;
  begin
    insert into public.pos_transaction_cash_events (
      store_id, owner_id, transaction_id, payment_id, event_origin, event_number,
      source_system, source_event_type, cash_event_type, direction, amount, signed_amount,
      affects_sales, affects_drawer_cash, affects_tender_mix, requires_review, metadata
    ) values (
      v_store_id, v_owner_id, v_transaction_id, v_other_payment_id, 'manual', 5,
      'verifone_commander', 'manual_wrong_transaction_payment', 'other_cash_adjustment', 'out', 1.00, -1.00,
      false, true, false, false, '{}'::jsonb
    );
  exception when foreign_key_violation then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected cash-event payment from another transaction to be rejected';
  end if;

  perform public.upsert_pos_transaction(v_other_store_id, v_owner_id, null, v_other_import_id, jsonb_build_object(
    'source_system', 'verifone_commander',
    'source_unique_id', 'synthetic-other-store-payment',
    'store_number', 'SYNTH2',
    'transaction_time', '2026-01-12T11:00:00-06:00',
    'business_date', '2026-01-12',
    'transaction_type', 'safe_drop',
    'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 2.00, 'direction', 'cash_to_safe'))
  ));
  select id into v_other_transaction_id
  from public.pos_transactions
  where store_id = v_other_store_id
    and source_unique_id = 'synthetic-other-store-payment';
  select id into v_other_payment_id
  from public.pos_transaction_payments
  where transaction_id = v_other_transaction_id
  limit 1;

  v_failed_expected := false;
  begin
    insert into public.pos_transaction_cash_events (
      store_id, owner_id, transaction_id, payment_id, event_origin, event_number,
      source_system, source_event_type, cash_event_type, direction, amount, signed_amount,
      affects_sales, affects_drawer_cash, affects_tender_mix, requires_review, metadata
    ) values (
      v_store_id, v_owner_id, v_transaction_id, v_other_payment_id, 'manual', 6,
      'verifone_commander', 'manual_wrong_store_payment', 'other_cash_adjustment', 'out', 1.00, -1.00,
      false, true, false, false, '{}'::jsonb
    );
  exception when foreign_key_violation then
    v_failed_expected := true;
  end;
  if v_failed_expected is not true then
    raise exception 'Expected cash-event payment from another store to be rejected';
  end if;

  -- Report fallback counts rows with generated cash events or legacy payment directions once, never twice.
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-a',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T10:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'paid_out', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 10.00, 'direction', 'cash_paid_out'))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-b',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T11:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'paid_out', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 20.00, 'direction', 'cash_paid_out'))
  ));
  select id into v_transaction_id from public.pos_transactions where store_id = v_store_id and source_unique_id = 'synthetic-fallback-b';
  delete from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'generated';
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-c',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T12:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'paid_out', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 30.00, 'direction', 'cash_paid_out'))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-superseded',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T13:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'paid_out', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 40.00, 'direction', 'cash_paid_out'))
  ));
  update public.pos_transactions
  set record_lifecycle = 'superseded',
      is_active = false,
      superseded_by_finalization_id = v_finalization_id,
      superseded_at = now(),
      superseded_reason = 'synthetic_report_exclusion',
      updated_at = now()
  where store_id = v_store_id
    and source_unique_id = 'synthetic-fallback-superseded';

  select *
    into v_summary
  from public.get_canonical_report_summary(v_store_id, '2026-01-13', '2026-01-13');
  if v_summary.paid_out_count <> 3 or v_summary.paid_out_amount <> 60.00 then
    raise exception 'Expected mixed cash-event/payment fallback paid-out amount 60 once per active row, got count %, amount %',
      v_summary.paid_out_count, v_summary.paid_out_amount;
  end if;

  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-safe-a',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T14:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'safe_drop', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 6.00, 'direction', 'cash_to_safe'))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-safe-b',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T15:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'safe_drop', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 7.00, 'direction', 'cash_to_safe'))
  ));
  select id into v_transaction_id from public.pos_transactions where store_id = v_store_id and source_unique_id = 'synthetic-fallback-safe-b';
  delete from public.pos_transaction_cash_events where transaction_id = v_transaction_id and event_origin = 'generated';
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-safe-c',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T16:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'safe_drop', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 8.00, 'direction', 'cash_to_safe'))
  ));
  perform public.upsert_pos_transaction(v_store_id, v_owner_id, null, v_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-fallback-safe-superseded',
    'store_number', 'SYNTH', 'transaction_time', '2026-01-13T17:00:00-06:00',
    'business_date', '2026-01-13', 'transaction_type', 'safe_drop', 'total', 0,
    'payments', jsonb_build_array(jsonb_build_object('payment_code', 'CASH', 'amount', 9.00, 'direction', 'cash_to_safe'))
  ));
  update public.pos_transactions
  set record_lifecycle = 'superseded',
      is_active = false,
      superseded_by_finalization_id = v_finalization_id,
      superseded_at = now(),
      superseded_reason = 'synthetic_report_exclusion',
      updated_at = now()
  where store_id = v_store_id
    and source_unique_id = 'synthetic-fallback-safe-superseded';

  select *
    into v_summary
  from public.get_canonical_report_summary(v_store_id, '2026-01-13', '2026-01-13');
  if v_summary.safe_drop_count <> 3 or v_summary.safe_drop_amount <> 21.00 then
    raise exception 'Expected mixed cash-event/payment fallback safe-drop amount 21 once per active row, got count %, amount %',
      v_summary.safe_drop_count, v_summary.safe_drop_amount;
  end if;
  if v_summary.paid_out_count <> 3 or v_summary.paid_out_amount <> 60.00 then
    raise exception 'Safe-drop fallback changed paid-out totals, got count %, amount %',
      v_summary.paid_out_count, v_summary.paid_out_amount;
  end if;
  if v_summary.gross_sales <> 0 or v_summary.net_sales <> 0 then
    raise exception 'Cash-management fallback should not affect sales totals, got gross %, net %',
      v_summary.gross_sales, v_summary.net_sales;
  end if;

  perform public.upsert_pos_transaction(v_other_store_id, v_owner_id, null, v_other_import_id, jsonb_build_object(
    'source_system', 'verifone_commander', 'source_unique_id', 'synthetic-other-store-same-date',
    'store_number', 'SYNTH2', 'transaction_time', '2026-01-14T10:00:00-06:00',
    'business_date', '2026-01-14', 'transaction_type', 'completed_sale', 'total', 140.00
  ));
  v_result := public.begin_pos_business_day_finalization(
    v_store_id, v_owner_id, null, 'verifone_commander', 'SYNTH', '2026-01-14',
    'day', 'synthetic-store-isolation', 'Synthetic Store Isolation', '2026-01-14T06:00:00-06:00',
    '2026-01-15T03:00:00-06:00', v_final_import_id, 0, 'synthetic-store-isolation-file',
    'synthetic-store-isolation-payload', null, '{}'::jsonb
  );
  perform public.finalize_pos_business_day((v_result ->> 'finalization_id')::uuid);
  select count(*) into v_count
  from public.pos_transactions
  where store_id = v_other_store_id
    and source_unique_id = 'synthetic-other-store-same-date'
    and is_active = true
    and record_lifecycle = 'provisional';
  if v_count <> 1 then
    raise exception 'Finalization for one store affected another store on the same source/date';
  end if;
end;
$$;

rollback;
