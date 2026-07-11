create table if not exists public.pos_connector_activation_codes (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.store_pos_connectors(id) on delete cascade,
  code_hash text not null check (length(code_hash) = 64),
  expires_at timestamptz not null,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (connector_id, code_hash)
);

create index if not exists pos_connector_activation_codes_active_idx
  on public.pos_connector_activation_codes (connector_id, expires_at)
  where used_at is null;

alter table public.pos_connector_activation_codes enable row level security;

revoke all on table public.pos_connector_activation_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.pos_connector_activation_codes to service_role;

create or replace function public.activate_pos_connector(
  p_source_store_number text,
  p_activation_code_hash text,
  p_connector_token_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_activation_id uuid;
  v_connector_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
  v_status text;
begin
  if nullif(btrim(p_source_store_number), '') is null then
    return jsonb_build_object('success', false, 'error', 'store_number_required');
  end if;

  if p_activation_code_hash is null or length(p_activation_code_hash) <> 64 then
    return jsonb_build_object('success', false, 'error', 'invalid_activation_code');
  end if;

  if p_connector_token_hash is null or length(p_connector_token_hash) <> 64 then
    return jsonb_build_object('success', false, 'error', 'invalid_connector_token');
  end if;

  select
    activation.id,
    activation.connector_id,
    activation.expires_at,
    activation.used_at,
    connector.status
  into
    v_activation_id,
    v_connector_id,
    v_expires_at,
    v_used_at,
    v_status
  from public.pos_connector_activation_codes as activation
  join public.store_pos_connectors as connector
    on connector.id = activation.connector_id
  where connector.source_store_number = btrim(p_source_store_number)
    and activation.code_hash = p_activation_code_hash
  order by activation.created_at desc
  limit 1
  for update of activation;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_activation_code');
  end if;

  if v_used_at is not null then
    return jsonb_build_object('success', false, 'error', 'activation_code_used');
  end if;

  if v_expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'activation_code_expired');
  end if;

  if v_status <> 'active' then
    return jsonb_build_object('success', false, 'error', 'connector_inactive');
  end if;

  update public.store_pos_connectors
  set token_hash = p_connector_token_hash,
      consecutive_failure_count = 0,
      last_error = null,
      last_seen_at = now(),
      updated_at = now()
  where id = v_connector_id
    and source_store_number = btrim(p_source_store_number)
    and status = 'active';

  if not found then
    return jsonb_build_object('success', false, 'error', 'connector_update_failed');
  end if;

  update public.pos_connector_activation_codes
  set used_at = now()
  where id = v_activation_id;

  return jsonb_build_object(
    'success', true,
    'connector_id', v_connector_id,
    'source_store_number', btrim(p_source_store_number),
    'activated_at', now()
  );
end;
$function$;

revoke all on function public.activate_pos_connector(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_pos_connector(text, text, text) to service_role;
;
