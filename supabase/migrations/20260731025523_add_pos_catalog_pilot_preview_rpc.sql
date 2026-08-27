-- Atomic persistence for connector-authenticated, selected-products catalog previews.
--
-- This function is SECURITY INVOKER and executable only by service_role. It
-- creates a preview run plus normalized staging items in one transaction. It
-- cannot create or update public.products and does not enable POS publishing.

create or replace function public.create_pos_catalog_pilot_preview(
  p_run jsonb,
  p_items jsonb
)
returns table(sync_run_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_existing_fingerprint text;
  v_store_id uuid;
  v_owner_id uuid;
  v_connector_id uuid;
  v_idempotency_key text;
  v_request_fingerprint text;
  v_source_system text;
  v_source_store_number text;
  v_selection_count integer;
  v_received_count integer;
  v_item_count integer;
begin
  if p_run is null or p_items is null or jsonb_typeof(p_run) <> 'object' or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = 'P0001', message = 'catalog_pilot_payload_invalid';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count > 10 then
    raise exception using errcode = 'P0001', message = 'catalog_pilot_payload_invalid';
  end if;

  begin
    v_store_id := (p_run ->> 'store_id')::uuid;
    v_owner_id := (p_run ->> 'owner_id')::uuid;
    v_connector_id := (p_run ->> 'connector_id')::uuid;
    v_selection_count := (p_run ->> 'selection_count')::integer;
    v_received_count := (p_run ->> 'received_product_count')::integer;
  exception when others then
    raise exception using errcode = 'P0001', message = 'catalog_pilot_payload_invalid';
  end;

  v_idempotency_key := p_run ->> 'idempotency_key';
  v_request_fingerprint := p_run ->> 'request_fingerprint';
  v_source_system := p_run ->> 'source_system';
  v_source_store_number := p_run ->> 'source_store_number';

  if
    v_source_system <> 'verifone_commander'
    or p_run ->> 'import_mode' <> 'selected_products'
    or p_run ->> 'status' <> 'previewed'
    or coalesce((p_run ->> 'catalog_complete')::boolean, true) <> false
    or p_run ->> 'submitted_by_type' <> 'connector'
    or (p_run ->> 'submitted_by_connector_id')::uuid <> v_connector_id
    or v_selection_count < 1
    or v_selection_count > 10
    or v_received_count <> v_item_count
    or v_received_count > v_selection_count
    or v_idempotency_key is null
    or char_length(v_idempotency_key) < 16
    or char_length(v_idempotency_key) > 128
    or v_request_fingerprint !~ '^[0-9a-f]{64}$'
    or p_run ->> 'catalog_hash' !~ '^[0-9a-f]{64}$'
    or p_run ->> 'selection_hash' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_run -> 'metadata', '{}'::jsonb)) <> 'object'
    or coalesce((p_run -> 'metadata' ->> 'preview_only')::boolean, false) <> true
    or coalesce((p_run -> 'metadata' ->> 'automatic_product_creation')::boolean, true) <> false
    or coalesce((p_run -> 'metadata' ->> 'automatic_publishing_enabled')::boolean, true) <> false
  then
    raise exception using errcode = 'P0001', message = 'catalog_pilot_payload_invalid';
  end if;

  if not exists (
    select 1
    from public.stores s
    where s.id = v_store_id
      and s.owner_id = v_owner_id
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_pilot_store_mismatch';
  end if;

  if not exists (
    select 1
    from public.store_pos_connectors c
    where c.id = v_connector_id
      and c.store_id = v_store_id
      and c.status = 'active'
      and c.source_system = v_source_system
      and (
        c.source_store_number is null
        or c.source_store_number = v_source_store_number
      )
  ) then
    raise exception using errcode = 'P0001', message = 'catalog_pilot_connector_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_connector_id::text || ':' || v_idempotency_key, 0)
  );

  select r.id, r.request_fingerprint
  into v_run_id, v_existing_fingerprint
  from public.pos_catalog_sync_runs r
  where r.connector_id = v_connector_id
    and r.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_existing_fingerprint is distinct from v_request_fingerprint then
      raise exception using errcode = 'P0001', message = 'catalog_pilot_idempotency_conflict';
    end if;

    return query select v_run_id, false;
    return;
  end if;

  insert into public.pos_catalog_sync_runs (
    store_id,
    owner_id,
    connector_id,
    source_system,
    source_store_number,
    import_mode,
    status,
    catalog_complete,
    captured_at,
    selection_count,
    received_product_count,
    ready_count,
    catalog_hash,
    selection_hash,
    idempotency_key,
    request_fingerprint,
    normalizer_version,
    source_schema_version,
    submitted_by_type,
    submitted_by_connector_id,
    metadata,
    started_at,
    completed_at
  ) values (
    v_store_id,
    v_owner_id,
    v_connector_id,
    v_source_system,
    v_source_store_number,
    'selected_products',
    'previewed',
    false,
    (p_run ->> 'captured_at')::timestamptz,
    v_selection_count,
    v_received_count,
    v_received_count,
    p_run ->> 'catalog_hash',
    p_run ->> 'selection_hash',
    v_idempotency_key,
    v_request_fingerprint,
    p_run ->> 'normalizer_version',
    p_run ->> 'source_schema_version',
    'connector',
    v_connector_id,
    p_run -> 'metadata',
    now(),
    now()
  )
  returning id into v_run_id;

  insert into public.pos_catalog_sync_items (
    sync_run_id,
    store_id,
    record_index,
    source_system,
    source_product_key,
    source_upc,
    source_modifier,
    source_payload_hash,
    source_values,
    reconciliation_status,
    proposed_changes,
    conflict_fields,
    validation_errors,
    transaction_evidence
  )
  select
    v_run_id,
    v_store_id,
    (entry.ordinality - 1)::integer,
    entry.item ->> 'source_system',
    entry.item ->> 'source_product_key',
    entry.item ->> 'source_upc',
    entry.item ->> 'source_modifier',
    entry.item ->> 'source_payload_hash',
    entry.item -> 'source_values',
    'ready',
    '{}'::jsonb,
    '{}'::text[],
    '[]'::jsonb,
    '{}'::jsonb
  from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
  where
    entry.item ->> 'source_system' = v_source_system
    and (entry.item -> 'source_values' ->> 'sourceStoreNumber') is not distinct from v_source_store_number;

  if (select count(*) from public.pos_catalog_sync_items i where i.sync_run_id = v_run_id) <> v_received_count then
    raise exception using errcode = 'P0001', message = 'catalog_pilot_item_mismatch';
  end if;

  return query select v_run_id, true;
end;
$$;

revoke all on function public.create_pos_catalog_pilot_preview(jsonb, jsonb) from public;
revoke all on function public.create_pos_catalog_pilot_preview(jsonb, jsonb) from anon, authenticated;
grant execute on function public.create_pos_catalog_pilot_preview(jsonb, jsonb) to service_role;

comment on function public.create_pos_catalog_pilot_preview(jsonb, jsonb) is
  'Atomically persists a connector-authenticated selected-products catalog preview. No product writes or POS publishing.';

notify pgrst, 'reload schema';;
