-- Serialize concurrent upserts for the same canonical transaction key.

alter function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb)
  rename to upsert_pos_transaction_unlocked;

revoke all on function public.upsert_pos_transaction_unlocked(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.upsert_pos_transaction_unlocked(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.upsert_pos_transaction_unlocked(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.upsert_pos_transaction_unlocked(uuid, uuid, uuid, uuid, jsonb) to service_role;

comment on function public.upsert_pos_transaction_unlocked(uuid, uuid, uuid, uuid, jsonb) is
  'Internal backend-only implementation. Call public.upsert_pos_transaction instead.';

create function public.upsert_pos_transaction(
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
  v_source_system text;
  v_source_unique_id text;
  v_lock_key text;
begin
  if p_store_id is null then
    raise exception using errcode = '22023', message = 'store_id is required';
  end if;

  if p_transaction is null or jsonb_typeof(p_transaction) <> 'object' then
    raise exception using errcode = '22023', message = 'transaction payload must be a JSON object';
  end if;

  v_source_system := coalesce(nullif(btrim(p_transaction ->> 'source_system'), ''), 'verifone_commander');
  v_source_unique_id := nullif(btrim(p_transaction ->> 'source_unique_id'), '');

  if v_source_unique_id is null then
    raise exception using errcode = '22023', message = 'source_unique_id is required';
  end if;

  v_lock_key := p_store_id::text || '|' || v_source_system || '|' || v_source_unique_id;
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  return public.upsert_pos_transaction_unlocked(
    p_store_id,
    p_owner_id,
    p_connector_id,
    p_import_id,
    p_transaction
  );
end;
$$;

revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) to service_role;

comment on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) is
  'Backend-only concurrency-safe atomic idempotent upsert for one canonical normalized POS transaction.';

notify pgrst, 'reload schema';;
