-- Process one normalized transaction snapshot in a single backend call while
-- isolating individual record failures.

create or replace function public.ingest_pos_transaction_batch(
  p_store_id uuid,
  p_owner_id uuid,
  p_connector_id uuid,
  p_import_id uuid,
  p_transactions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_import_status text;
  v_existing_inserted integer;
  v_existing_updated integer;
  v_existing_unchanged integer;
  v_existing_failed integer;
  v_record jsonb;
  v_record_index integer;
  v_result jsonb;
  v_action text;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_failed_count integer := 0;
  v_total_count integer;
  v_source_unique_id text;
  v_error_code text;
  v_error_message text;
begin
  if p_store_id is null or p_owner_id is null or p_import_id is null then
    raise exception using
      errcode = '22023',
      message = 'store_id, owner_id, and import_id are required';
  end if;

  if p_transactions is null or jsonb_typeof(p_transactions) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'transactions payload must be a JSON array';
  end if;

  v_total_count := jsonb_array_length(p_transactions);

  if v_total_count > 10000 then
    raise exception using
      errcode = '54000',
      message = 'transaction batch exceeds the 10,000-record safety limit';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pos-import|' || p_import_id::text, 0)
  );

  select
    status,
    inserted_count,
    updated_count,
    unchanged_count,
    failed_count
  into
    v_import_status,
    v_existing_inserted,
    v_existing_updated,
    v_existing_unchanged,
    v_existing_failed
  from public.pos_transaction_imports
  where id = p_import_id
    and store_id = p_store_id
    and owner_id = p_owner_id
    and (p_connector_id is null or connector_id = p_connector_id)
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'import does not match store, owner, or connector';
  end if;

  if v_import_status in ('completed', 'completed_with_errors', 'duplicate') then
    return jsonb_build_object(
      'import_id', p_import_id,
      'status', v_import_status,
      'already_processed', true,
      'canonical_record_count', v_total_count,
      'inserted_count', v_existing_inserted,
      'updated_count', v_existing_updated,
      'unchanged_count', v_existing_unchanged,
      'failed_count', v_existing_failed
    );
  end if;

  update public.pos_transaction_imports
  set status = 'processing',
      canonical_record_count = v_total_count,
      inserted_count = 0,
      updated_count = 0,
      unchanged_count = 0,
      failed_count = 0,
      error_message = null,
      completed_at = null,
      updated_at = now()
  where id = p_import_id;

  delete from public.pos_transaction_import_errors
  where import_id = p_import_id;

  for v_record_index, v_record in
    select (record.ordinality - 1)::integer, record.value
    from jsonb_array_elements(p_transactions) with ordinality as record(value, ordinality)
  loop
    begin
      v_result := public.upsert_pos_transaction(
        p_store_id,
        p_owner_id,
        p_connector_id,
        p_import_id,
        v_record
      );

      v_action := v_result ->> 'action';

      case v_action
        when 'inserted' then
          v_inserted_count := v_inserted_count + 1;
        when 'updated' then
          v_updated_count := v_updated_count + 1;
        when 'unchanged' then
          v_unchanged_count := v_unchanged_count + 1;
        else
          raise exception using
            errcode = 'P0001',
            message = format('unexpected upsert action: %s', coalesce(v_action, '<null>'));
      end case;
    exception
      when others then
        v_failed_count := v_failed_count + 1;
        v_source_unique_id := nullif(btrim(v_record ->> 'source_unique_id'), '');
        v_error_code := sqlstate;
        v_error_message := sqlerrm;

        insert into public.pos_transaction_import_errors (
          import_id,
          store_id,
          owner_id,
          record_index,
          source_unique_id,
          error_code,
          error_message,
          raw_record
        ) values (
          p_import_id,
          p_store_id,
          p_owner_id,
          v_record_index,
          v_source_unique_id,
          v_error_code,
          v_error_message,
          v_record
        );
    end;
  end loop;

  update public.pos_transaction_imports
  set status = case
        when v_failed_count = 0 then 'completed'
        else 'completed_with_errors'
      end,
      inserted_count = v_inserted_count,
      updated_count = v_updated_count,
      unchanged_count = v_unchanged_count,
      failed_count = v_failed_count,
      error_message = case
        when v_failed_count = 0 then null
        else format('%s of %s canonical records failed', v_failed_count, v_total_count)
      end,
      completed_at = now(),
      updated_at = now()
  where id = p_import_id;

  if p_connector_id is not null then
    update public.store_pos_connectors
    set last_seen_at = now(),
        last_upload_at = now(),
        last_success_at = now(),
        last_import_id = p_import_id,
        consecutive_failure_count = 0,
        last_error = case
          when v_failed_count = 0 then null
          else format('%s of %s canonical records failed', v_failed_count, v_total_count)
        end,
        updated_at = now()
    where id = p_connector_id
      and store_id = p_store_id;
  end if;

  return jsonb_build_object(
    'import_id', p_import_id,
    'status', case
      when v_failed_count = 0 then 'completed'
      else 'completed_with_errors'
    end,
    'already_processed', false,
    'canonical_record_count', v_total_count,
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'unchanged_count', v_unchanged_count,
    'failed_count', v_failed_count
  );
end;
$$;

revoke all on function public.ingest_pos_transaction_batch(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.ingest_pos_transaction_batch(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.ingest_pos_transaction_batch(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.ingest_pos_transaction_batch(uuid, uuid, uuid, uuid, jsonb) to service_role;

comment on function public.ingest_pos_transaction_batch(uuid, uuid, uuid, uuid, jsonb) is
  'Backend-only batch ingestion with per-record savepoints, counters, import finalization, and connector heartbeat updates.';

notify pgrst, 'reload schema';;
