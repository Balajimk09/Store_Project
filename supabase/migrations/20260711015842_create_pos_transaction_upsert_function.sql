-- Atomic idempotent upsert for one canonical normalized POS transaction.
-- The function is backend-only and deliberately does not finalize import counters.

create or replace function public.upsert_pos_transaction(
  p_store_id uuid,
  p_owner_id uuid,
  p_connector_id uuid,
  p_import_id uuid,
  p_transaction jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_store_timezone text;
  v_source_system text;
  v_source_unique_id text;
  v_transaction_type text;
  v_transaction_time timestamptz;
  v_business_date date;
  v_canonical_hash text;
  v_existing_id uuid;
  v_existing_hash text;
  v_transaction_id uuid;
  v_action text;
  v_items jsonb;
  v_payments jsonb;
  v_shadow_ids jsonb;
  v_shadow_source_unique_ids text[];
  v_metadata jsonb;
  v_item_count integer;
  v_payment_count integer;
  v_relationship_count integer;
  v_original_source_unique_id text;
  v_original_ticket text;
  v_recalled_from_ticket text;
  v_is_fuel_transaction boolean;
  v_was_recalled boolean;
begin
  if p_store_id is null or p_owner_id is null or p_import_id is null then
    raise exception using
      errcode = '22023',
      message = 'store_id, owner_id, and import_id are required';
  end if;

  if p_transaction is null or jsonb_typeof(p_transaction) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'transaction payload must be a JSON object';
  end if;

  v_source_system := coalesce(nullif(btrim(p_transaction ->> 'source_system'), ''), 'verifone_commander');
  v_source_unique_id := nullif(btrim(p_transaction ->> 'source_unique_id'), '');
  v_transaction_type := nullif(btrim(p_transaction ->> 'transaction_type'), '');

  if v_source_unique_id is null then
    raise exception using errcode = '22023', message = 'source_unique_id is required';
  end if;

  if v_transaction_type is null then
    raise exception using errcode = '22023', message = 'transaction_type is required';
  end if;

  if nullif(btrim(p_transaction ->> 'transaction_time'), '') is null then
    raise exception using errcode = '22023', message = 'transaction_time is required';
  end if;

  begin
    v_transaction_time := (p_transaction ->> 'transaction_time')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22007',
        message = format('invalid transaction_time for source_unique_id %s', v_source_unique_id);
  end;

  select coalesce(nullif(timezone, ''), 'America/Chicago')
    into v_store_timezone
  from public.stores
  where id = p_store_id
    and owner_id = p_owner_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'store and owner do not match';
  end if;

  if p_connector_id is not null and not exists (
    select 1
    from public.store_pos_connectors
    where id = p_connector_id
      and store_id = p_store_id
      and status = 'active'
      and source_system = v_source_system
  ) then
    raise exception using
      errcode = '42501',
      message = 'connector is not active for the store and source system';
  end if;

  if not exists (
    select 1
    from public.pos_transaction_imports
    where id = p_import_id
      and store_id = p_store_id
      and owner_id = p_owner_id
      and source_system = v_source_system
      and (p_connector_id is null or connector_id = p_connector_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'import does not match store, owner, connector, or source system';
  end if;

  v_business_date := (v_transaction_time at time zone v_store_timezone)::date;
  v_canonical_hash := encode(extensions.digest(p_transaction::text, 'sha256'), 'hex');

  v_items := case
    when jsonb_typeof(p_transaction -> 'items') = 'array' then p_transaction -> 'items'
    else '[]'::jsonb
  end;

  v_payments := case
    when jsonb_typeof(p_transaction -> 'payments') = 'array' then p_transaction -> 'payments'
    else '[]'::jsonb
  end;

  v_shadow_ids := case
    when jsonb_typeof(p_transaction -> 'shadow_source_unique_ids') = 'array'
      then p_transaction -> 'shadow_source_unique_ids'
    else '[]'::jsonb
  end;

  select coalesce(array_agg(value), '{}'::text[])
    into v_shadow_source_unique_ids
  from jsonb_array_elements_text(v_shadow_ids) as shadow(value)
  where nullif(btrim(value), '') is not null;

  v_metadata := case
    when jsonb_typeof(p_transaction -> 'metadata') = 'object' then p_transaction -> 'metadata'
    else '{}'::jsonb
  end;

  v_item_count := jsonb_array_length(v_items);
  v_payment_count := jsonb_array_length(v_payments);
  v_original_source_unique_id := nullif(btrim(p_transaction ->> 'original_source_unique_id'), '');
  v_original_ticket := nullif(btrim(p_transaction ->> 'original_ticket'), '');
  v_recalled_from_ticket := nullif(btrim(p_transaction ->> 'recalled_from_ticket'), '');
  v_is_fuel_transaction := coalesce((p_transaction ->> 'is_fuel_transaction')::boolean, false);
  v_was_recalled := coalesce((p_transaction ->> 'was_recalled')::boolean, false);

  select id, canonical_hash
    into v_existing_id, v_existing_hash
  from public.pos_transactions
  where store_id = p_store_id
    and source_system = v_source_system
    and source_unique_id = v_source_unique_id
  for update;

  if v_existing_id is null then
    insert into public.pos_transactions (
      store_id,
      owner_id,
      connector_id,
      first_import_id,
      last_import_id,
      source_system,
      source_unique_id,
      canonical_record,
      store_number,
      transaction_time,
      business_date,
      register_number,
      physical_register_id,
      transaction_sequence,
      transaction_serial,
      terminal_message_serial,
      cashier,
      till,
      duration_seconds,
      transaction_type,
      subtotal,
      tax_total,
      total,
      current_total,
      cash_back_amount,
      cash_back_fee,
      has_cash_back,
      has_item_voids,
      item_void_count,
      has_rounding_adjustment,
      rounding_adjustment_count,
      was_recalled,
      recalled_from_ticket,
      is_fuel_transaction,
      fuel_transaction_type,
      original_ticket,
      original_source_unique_id,
      shadow_source_unique_ids,
      item_count,
      payment_count,
      canonical_hash,
      metadata
    ) values (
      p_store_id,
      p_owner_id,
      p_connector_id,
      p_import_id,
      p_import_id,
      v_source_system,
      v_source_unique_id,
      coalesce((p_transaction ->> 'canonical_record')::boolean, true),
      nullif(p_transaction ->> 'store_number', ''),
      v_transaction_time,
      v_business_date,
      nullif(p_transaction ->> 'register_number', ''),
      nullif(p_transaction ->> 'physical_register_id', ''),
      nullif(p_transaction ->> 'transaction_sequence', ''),
      nullif(p_transaction ->> 'transaction_serial', ''),
      nullif(p_transaction ->> 'terminal_message_serial', ''),
      nullif(p_transaction ->> 'cashier', ''),
      nullif(p_transaction ->> 'till', ''),
      nullif(p_transaction ->> 'duration_seconds', '')::numeric,
      v_transaction_type,
      coalesce(nullif(p_transaction ->> 'subtotal', '')::numeric, 0),
      coalesce(nullif(p_transaction ->> 'tax_total', '')::numeric, 0),
      coalesce(nullif(p_transaction ->> 'total', '')::numeric, 0),
      coalesce(nullif(p_transaction ->> 'current_total', '')::numeric, 0),
      coalesce(nullif(p_transaction ->> 'cash_back_amount', '')::numeric, 0),
      coalesce(nullif(p_transaction ->> 'cash_back_fee', '')::numeric, 0),
      coalesce((p_transaction ->> 'has_cash_back')::boolean, false),
      coalesce((p_transaction ->> 'has_item_voids')::boolean, false),
      coalesce(nullif(p_transaction ->> 'item_void_count', '')::integer, 0),
      coalesce((p_transaction ->> 'has_rounding_adjustment')::boolean, false),
      coalesce(nullif(p_transaction ->> 'rounding_adjustment_count', '')::integer, 0),
      v_was_recalled,
      v_recalled_from_ticket,
      v_is_fuel_transaction,
      nullif(p_transaction ->> 'fuel_transaction_type', ''),
      v_original_ticket,
      v_original_source_unique_id,
      v_shadow_source_unique_ids,
      v_item_count,
      v_payment_count,
      v_canonical_hash,
      v_metadata
    )
    returning id into v_transaction_id;

    v_action := 'inserted';
  elsif v_existing_hash = v_canonical_hash then
    update public.pos_transactions
    set connector_id = coalesce(p_connector_id, connector_id),
        last_import_id = p_import_id,
        last_seen_at = now(),
        updated_at = now()
    where id = v_existing_id
    returning id into v_transaction_id;

    v_action := 'unchanged';
  else
    update public.pos_transactions
    set owner_id = p_owner_id,
        connector_id = p_connector_id,
        last_import_id = p_import_id,
        canonical_record = coalesce((p_transaction ->> 'canonical_record')::boolean, true),
        store_number = nullif(p_transaction ->> 'store_number', ''),
        transaction_time = v_transaction_time,
        business_date = v_business_date,
        register_number = nullif(p_transaction ->> 'register_number', ''),
        physical_register_id = nullif(p_transaction ->> 'physical_register_id', ''),
        transaction_sequence = nullif(p_transaction ->> 'transaction_sequence', ''),
        transaction_serial = nullif(p_transaction ->> 'transaction_serial', ''),
        terminal_message_serial = nullif(p_transaction ->> 'terminal_message_serial', ''),
        cashier = nullif(p_transaction ->> 'cashier', ''),
        till = nullif(p_transaction ->> 'till', ''),
        duration_seconds = nullif(p_transaction ->> 'duration_seconds', '')::numeric,
        transaction_type = v_transaction_type,
        subtotal = coalesce(nullif(p_transaction ->> 'subtotal', '')::numeric, 0),
        tax_total = coalesce(nullif(p_transaction ->> 'tax_total', '')::numeric, 0),
        total = coalesce(nullif(p_transaction ->> 'total', '')::numeric, 0),
        current_total = coalesce(nullif(p_transaction ->> 'current_total', '')::numeric, 0),
        cash_back_amount = coalesce(nullif(p_transaction ->> 'cash_back_amount', '')::numeric, 0),
        cash_back_fee = coalesce(nullif(p_transaction ->> 'cash_back_fee', '')::numeric, 0),
        has_cash_back = coalesce((p_transaction ->> 'has_cash_back')::boolean, false),
        has_item_voids = coalesce((p_transaction ->> 'has_item_voids')::boolean, false),
        item_void_count = coalesce(nullif(p_transaction ->> 'item_void_count', '')::integer, 0),
        has_rounding_adjustment = coalesce((p_transaction ->> 'has_rounding_adjustment')::boolean, false),
        rounding_adjustment_count = coalesce(nullif(p_transaction ->> 'rounding_adjustment_count', '')::integer, 0),
        was_recalled = v_was_recalled,
        recalled_from_ticket = v_recalled_from_ticket,
        is_fuel_transaction = v_is_fuel_transaction,
        fuel_transaction_type = nullif(p_transaction ->> 'fuel_transaction_type', ''),
        original_ticket = v_original_ticket,
        original_source_unique_id = v_original_source_unique_id,
        shadow_source_unique_ids = v_shadow_source_unique_ids,
        item_count = v_item_count,
        payment_count = v_payment_count,
        canonical_hash = v_canonical_hash,
        metadata = v_metadata,
        last_seen_at = now(),
        updated_at = now()
    where id = v_existing_id
    returning id into v_transaction_id;

    v_action := 'updated';
  end if;

  if v_action in ('inserted', 'updated') then
    delete from public.pos_transaction_lines
    where transaction_id = v_transaction_id;

    delete from public.pos_transaction_payments
    where transaction_id = v_transaction_id;

    delete from public.pos_transaction_relationships
    where transaction_id = v_transaction_id;

    insert into public.pos_transaction_lines (
      transaction_id,
      store_id,
      owner_id,
      line_number,
      line_type,
      upc,
      description,
      department,
      network_code,
      modifier,
      quantity,
      sign,
      signed_quantity,
      selling_unit,
      unit_price,
      line_total,
      tax_base,
      tax_rate,
      void_line_index,
      is_voided,
      is_refund,
      is_fuel,
      raw_data
    )
    select
      v_transaction_id,
      p_store_id,
      p_owner_id,
      item.ordinality::integer,
      coalesce(nullif(item.value ->> 'line_type', ''), 'unknown'),
      nullif(item.value ->> 'upc', ''),
      nullif(item.value ->> 'description', ''),
      nullif(item.value ->> 'department', ''),
      nullif(item.value ->> 'network_code', ''),
      nullif(item.value ->> 'modifier', ''),
      nullif(item.value ->> 'quantity', '')::numeric,
      nullif(item.value ->> 'sign', '')::numeric,
      nullif(item.value ->> 'signed_quantity', '')::numeric,
      nullif(item.value ->> 'selling_unit', '')::numeric,
      nullif(item.value ->> 'unit_price', '')::numeric,
      nullif(item.value ->> 'line_total', '')::numeric,
      nullif(item.value ->> 'tax_base', '')::numeric,
      nullif(item.value ->> 'tax_rate', '')::numeric,
      nullif(item.value ->> 'void_line_index', ''),
      coalesce(item.value ->> 'line_type', '') = 'item_void',
      v_transaction_type = 'refund'
        or coalesce(nullif(item.value ->> 'signed_quantity', '')::numeric, 0) < 0,
      coalesce(item.value ->> 'line_type', '') in ('fuel', 'fuel_deposit'),
      item.value
    from jsonb_array_elements(v_items) with ordinality as item(value, ordinality);

    insert into public.pos_transaction_payments (
      transaction_id,
      store_id,
      owner_id,
      payment_number,
      payment_code,
      amount,
      direction,
      card_type,
      card_last_four,
      entry_method,
      host,
      is_change,
      is_refund,
      raw_data
    )
    select
      v_transaction_id,
      p_store_id,
      p_owner_id,
      payment.ordinality::integer,
      nullif(payment.value ->> 'payment_code', ''),
      coalesce(nullif(payment.value ->> 'amount', '')::numeric, 0),
      nullif(payment.value ->> 'direction', ''),
      nullif(payment.value ->> 'card_type', ''),
      nullif(payment.value ->> 'card_last_four', ''),
      nullif(payment.value ->> 'entry_method', ''),
      nullif(payment.value ->> 'host', ''),
      lower(coalesce(payment.value ->> 'payment_code', '')) = 'change',
      v_transaction_type = 'refund'
        or coalesce(nullif(payment.value ->> 'amount', '')::numeric, 0) < 0
        or lower(coalesce(payment.value ->> 'direction', '')) = 'paid_to_customer',
      payment.value
    from jsonb_array_elements(v_payments) with ordinality as payment(value, ordinality);

    if v_original_source_unique_id is not null then
      insert into public.pos_transaction_relationships (
        transaction_id,
        store_id,
        owner_id,
        related_transaction_id,
        related_source_unique_id,
        relationship_type
      )
      select
        v_transaction_id,
        p_store_id,
        p_owner_id,
        related.id,
        v_original_source_unique_id,
        case
          when v_is_fuel_transaction then 'fuel_original_source'
          when v_transaction_type = 'refund' then 'refund_original_source'
          when v_was_recalled then 'recall_original_source'
          else 'original_source'
        end
      from (select 1) as seed
      left join public.pos_transactions as related
        on related.store_id = p_store_id
       and related.source_system = v_source_system
       and related.source_unique_id = v_original_source_unique_id
      on conflict do nothing;
    end if;

    if v_original_ticket is not null then
      insert into public.pos_transaction_relationships (
        transaction_id,
        store_id,
        owner_id,
        related_ticket,
        relationship_type
      ) values (
        v_transaction_id,
        p_store_id,
        p_owner_id,
        v_original_ticket,
        case
          when v_is_fuel_transaction then 'fuel_original_ticket'
          when v_transaction_type = 'refund' then 'refund_original_ticket'
          else 'original_ticket'
        end
      )
      on conflict do nothing;
    end if;

    if v_recalled_from_ticket is not null then
      insert into public.pos_transaction_relationships (
        transaction_id,
        store_id,
        owner_id,
        related_ticket,
        relationship_type
      ) values (
        v_transaction_id,
        p_store_id,
        p_owner_id,
        v_recalled_from_ticket,
        'recalled_from_ticket'
      )
      on conflict do nothing;
    end if;

    insert into public.pos_transaction_relationships (
      transaction_id,
      store_id,
      owner_id,
      related_source_unique_id,
      relationship_type
    )
    select
      v_transaction_id,
      p_store_id,
      p_owner_id,
      shadow.value,
      'fuel_shadow_source'
    from jsonb_array_elements_text(v_shadow_ids) as shadow(value)
    where nullif(btrim(shadow.value), '') is not null
    on conflict do nothing;
  end if;

  select count(*)
    into v_relationship_count
  from public.pos_transaction_relationships
  where transaction_id = v_transaction_id;

  return jsonb_build_object(
    'action', v_action,
    'transaction_id', v_transaction_id,
    'source_unique_id', v_source_unique_id,
    'canonical_hash', v_canonical_hash,
    'line_count', v_item_count,
    'payment_count', v_payment_count,
    'relationship_count', v_relationship_count
  );
end;
$$;

revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) to service_role;

comment on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) is
  'Backend-only atomic idempotent upsert for one canonical normalized POS transaction.';

notify pgrst, 'reload schema';;
