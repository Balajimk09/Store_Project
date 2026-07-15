-- Prepare the authoritative PostgreSQL-compatible source-set hash for closed-day finalization.
-- This function is read-only: it does not create imports, staging rows, or finalization sessions.

create or replace function public.prepare_pos_business_day_finalization_hash(
  p_store_id uuid,
  p_owner_id uuid,
  p_source_system text,
  p_source_store_number text,
  p_business_date date,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source_system text;
  v_source_store_number text;
  v_record_count integer;
  v_final_source_set_hash text;
begin
  if p_store_id is null or p_owner_id is null or p_business_date is null then
    raise exception using errcode = '22023', message = 'store_id, owner_id, and business_date are required';
  end if;

  v_source_system := nullif(btrim(coalesce(p_source_system, '')), '');
  if v_source_system is null then
    raise exception using errcode = '22023', message = 'source_system is required';
  end if;
  if v_source_system <> 'verifone_commander' then
    raise exception using errcode = '22023', message = 'source_system must be verifone_commander';
  end if;

  v_source_store_number := nullif(btrim(coalesce(p_source_store_number, '')), '');
  if v_source_store_number is null then
    raise exception using errcode = '22023', message = 'source_store_number is required';
  end if;

  if not exists (
    select 1
    from public.stores
    where id = p_store_id
      and owner_id = p_owner_id
  ) then
    raise exception using errcode = '42501', message = 'store and owner do not match';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception using errcode = '22023', message = 'records payload must be a JSON array';
  end if;

  v_record_count := jsonb_array_length(p_records);
  if v_record_count <= 0 then
    raise exception using errcode = '22023', message = 'records payload must contain at least one record';
  end if;

  if v_record_count > 10000 then
    raise exception using errcode = '54000', message = 'records payload exceeds the 10,000-record safety limit';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where jsonb_typeof(record.value) <> 'object'
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'every record must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'source_unique_id')
       or jsonb_typeof(record.value -> 'source_unique_id') <> 'string'
       or btrim(record.value ->> 'source_unique_id') = ''
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'source_unique_id must be a nonblank string';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'source_system')
       or jsonb_typeof(record.value -> 'source_system') <> 'string'
       or btrim(record.value ->> 'source_system') = ''
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'source_system must be a nonblank string';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where btrim(record.value ->> 'source_system') <> v_source_system
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'record source_system does not match requested source system';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'store_number')
       or jsonb_typeof(record.value -> 'store_number') <> 'string'
       or btrim(record.value ->> 'store_number') = ''
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'store_number must be a nonblank string';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where btrim(record.value ->> 'store_number') <> v_source_store_number
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'record store_number does not match requested source store';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'business_date')
       or jsonb_typeof(record.value -> 'business_date') <> 'string'
       or btrim(record.value ->> 'business_date') = ''
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'business_date must be a nonblank string';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where btrim(record.value ->> 'business_date') <> to_char(p_business_date, 'YYYY-MM-DD')
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'record business_date does not match requested business date';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'transaction_time')
       or jsonb_typeof(record.value -> 'transaction_time') <> 'string'
       or btrim(record.value ->> 'transaction_time') = ''
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'transaction_time must be a nonblank string';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'transaction_type')
       or jsonb_typeof(record.value -> 'transaction_type') <> 'string'
       or btrim(record.value ->> 'transaction_type') = ''
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'transaction_type must be a nonblank string';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'total')
       or jsonb_typeof(record.value -> 'total') = 'null'
       or not (record.value ? 'tax_total')
       or jsonb_typeof(record.value -> 'tax_total') = 'null'
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'total and tax_total are required';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'canonical_record')
       or jsonb_typeof(record.value -> 'canonical_record') <> 'boolean'
       or record.value -> 'canonical_record' <> 'true'::jsonb
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'canonical_record must be true';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'items')
       or jsonb_typeof(record.value -> 'items') <> 'array'
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'items must be an array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where not (record.value ? 'payments')
       or jsonb_typeof(record.value -> 'payments') <> 'array'
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'payments must be an array';
  end if;

  if exists (
    with incoming as (
      select nullif(btrim(record.value ->> 'source_unique_id'), '') as source_unique_id
      from jsonb_array_elements(p_records) as record(value)
    )
    select 1
    from incoming
    group by source_unique_id
    having count(*) > 1
    limit 1
  ) then
    raise exception using errcode = '23505', message = 'records payload contains duplicate source_unique_id values';
  end if;

  select encode(
      extensions.digest(
        coalesce(
          string_agg(
            nullif(btrim(record.value ->> 'source_unique_id'), '') || ':' ||
            encode(extensions.digest(record.value::text, 'sha256'), 'hex'),
            ','
            order by nullif(btrim(record.value ->> 'source_unique_id'), '')
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
    into v_final_source_set_hash
  from jsonb_array_elements(p_records) as record(value);

  return jsonb_build_object(
    'expected_record_count', v_record_count,
    'record_hash_count', v_record_count,
    'final_source_set_hash', v_final_source_set_hash
  );
end;
$$;

revoke all on function public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb) from public;
revoke all on function public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb) from anon;
revoke all on function public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb) from authenticated;
grant execute on function public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb) to service_role;

comment on function public.prepare_pos_business_day_finalization_hash(uuid, uuid, text, text, date, jsonb) is
  'Read-only service-role RPC that computes Phase 1-compatible canonical record hashes and final source-set hash before opening a closed business-day finalization session.';

notify pgrst, 'reload schema';
