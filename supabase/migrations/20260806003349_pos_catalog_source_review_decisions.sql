-- Store-scoped, durable Commander review decisions. Observation ingestion remains
-- independent so an owner decision survives a replacement observation.

create table public.pos_catalog_source_review_decisions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  source_product_key text not null,
  is_ignored boolean not null default false,
  ignore_reason text null,
  ignored_by uuid null references auth.users(id) on delete set null,
  ignored_at timestamptz null,
  restored_by uuid null references auth.users(id) on delete set null,
  restored_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_review_decisions_store_source_key
    unique (store_id, source_system, source_product_key),
  constraint pos_catalog_source_review_decisions_commander_source_check
    check (source_system = 'commander'),
  constraint pos_catalog_source_review_decisions_commander_key_check
    check (source_product_key ~ '^[0-9]{14}/[0-9]{3}$'),
  constraint pos_catalog_source_review_decisions_ignore_reason_length_check
    check (ignore_reason is null or char_length(btrim(ignore_reason)) between 1 and 256),
  constraint pos_catalog_source_review_decisions_ignored_state_check
    check ((is_ignored = false) or (ignored_by is not null and ignored_at is not null))
);

create index pos_catalog_source_review_decisions_store_ignored_idx
  on public.pos_catalog_source_review_decisions (
    store_id,
    source_system,
    is_ignored,
    updated_at desc
  );

create trigger pos_catalog_source_review_decisions_set_updated_at
before update on public.pos_catalog_source_review_decisions
for each row execute function public.set_pos_catalog_updated_at();

alter table public.pos_catalog_source_review_decisions enable row level security;

drop policy if exists "owners_read_pos_catalog_source_review_decisions"
  on public.pos_catalog_source_review_decisions;
create policy "owners_read_pos_catalog_source_review_decisions"
on public.pos_catalog_source_review_decisions
for select
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = pos_catalog_source_review_decisions.store_id
      and s.owner_id = (select auth.uid())
  )
);

revoke all on table public.pos_catalog_source_review_decisions
  from anon, authenticated;
grant select on table public.pos_catalog_source_review_decisions
  to authenticated;
grant select, insert, update on table public.pos_catalog_source_review_decisions
  to service_role;

-- SECURITY INVOKER functions retain RLS/permission semantics. The route uses
-- the server-only service role after authenticating the actor, so grant only
-- the table operations required by the bounded review read and mutations.
grant select (id, owner_id) on table public.stores
  to service_role;
grant select on table public.pos_catalog_source_observations,
  public.products,
  public.product_source_identities,
  public.product_history
  to service_role;
grant insert, update on table public.products
  to service_role;
grant insert on table public.product_source_identities,
  public.product_history
  to service_role;

-- All owner mutations call this one locked state calculation. Locking the
-- observation first serializes competing review actions for one source identity.
create or replace function public.commander_source_review_state(
  p_store_id uuid,
  p_source_system text,
  p_source_product_key text
)
returns table (
  review_state text,
  mapped_product_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_observation public.pos_catalog_source_observations%rowtype;
  v_identity public.product_source_identities%rowtype;
  v_product public.products%rowtype;
  v_is_ignored boolean;
  v_has_candidate boolean;
  v_is_matched boolean;
begin
  if p_store_id is null or p_source_system is distinct from 'commander'
    or p_source_product_key is null or p_source_product_key !~ '^[0-9]{14}/[0-9]{3}$' then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  select observation.* into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = p_store_id
    and observation.source_system = p_source_system
    and observation.source_product_key = p_source_product_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'observation_not_found';
  end if;
  if not coalesce(
    v_observation.source_upc ~ '^[0-9]{14}$'
    and v_observation.source_modifier ~ '^[0-9]{3}$'
    and v_observation.source_product_key = v_observation.source_upc || '/' || v_observation.source_modifier,
    false
  ) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  select decision.is_ignored into v_is_ignored
  from public.pos_catalog_source_review_decisions decision
  where decision.store_id = p_store_id
    and decision.source_system = p_source_system
    and decision.source_product_key = p_source_product_key
  for update;
  if coalesce(v_is_ignored, false) then
    return query select 'ignored'::text, null::uuid;
    return;
  end if;

  select identity.* into v_identity
  from public.product_source_identities identity
  where identity.store_id = p_store_id
    and identity.source_system = p_source_system
    and identity.source_product_key = p_source_product_key
  for share;
  if found then
    select product.* into v_product
    from public.products product
    where product.id = v_identity.product_id
      and product.store_id = p_store_id
    for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'mapping_invalid';
    end if;

    v_is_matched := lower(nullif(btrim(v_product.item_name), ''))
      is not distinct from lower(nullif(btrim(v_observation.source_description), ''))
      and round(v_product.selling_price::numeric, 2)
        is not distinct from round(v_observation.source_price::numeric, 2)
      and lower(nullif(btrim(v_product.department), ''))
        is not distinct from lower(nullif(btrim(v_observation.source_department), ''));
    return query select case when v_is_matched then 'matched' else 'conflict' end, v_identity.product_id;
    return;
  end if;

  select exists (
    select 1
    from public.products candidate
    where candidate.store_id = p_store_id
      and nullif(btrim(candidate.upc), '') = v_observation.source_upc
  ) into v_has_candidate;
  return query select case when v_has_candidate then 'unmapped' else 'new' end, null::uuid;
end;
$function$;

-- The API calls this service-role-only read helper so its candidate lookup
-- matches the mutation rule: btrim(products.upc) = source_upc.
create or replace function public.list_commander_product_candidates(
  p_store_id uuid,
  p_source_upcs text[]
)
returns table (
  id uuid,
  store_id uuid,
  upc text,
  item_name text,
  selling_price numeric,
  department text
)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_store_id is null
    or p_source_upcs is null
    or cardinality(p_source_upcs) not between 1 and 100
    or exists (
      select 1 from unnest(p_source_upcs) source_upc
      where source_upc !~ '^[0-9]{14}$'
    ) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  return query
  with requested as (
    select distinct source_upc from unnest(p_source_upcs) source_upc
  ), ranked as (
    select product.id, product.store_id, product.upc, product.item_name,
      product.selling_price, product.department, btrim(product.upc) as normalized_upc,
      row_number() over (partition by btrim(product.upc) order by product.id) as candidate_rank
    from public.products product
    join requested on btrim(product.upc) = requested.source_upc
    where product.store_id = p_store_id
  )
  select ranked.id, ranked.store_id, ranked.upc, ranked.item_name, ranked.selling_price, ranked.department
  from ranked
  where candidate_rank <= 5
  order by normalized_upc asc, id asc
  limit 500;
end;
$function$;

create or replace function public.set_commander_source_review_decision(
  p_store_id uuid,
  p_source_system text,
  p_source_product_key text,
  p_is_ignored boolean,
  p_ignore_reason text,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_observation public.pos_catalog_source_observations%rowtype;
  v_identity_id uuid;
  v_is_ignored boolean;
  v_review_state text;
  v_state record;
begin
  if p_store_id is null or p_actor_id is null or p_is_ignored is null or p_source_system is distinct from 'commander'
    or p_source_product_key is null or p_source_product_key !~ '^[0-9]{14}/[0-9]{3}$'
    or (p_ignore_reason is not null and char_length(btrim(p_ignore_reason)) not between 1 and 256) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.owner_id = p_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select observation.* into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = p_store_id
    and observation.source_system = p_source_system
    and observation.source_product_key = p_source_product_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'observation_not_found';
  end if;
  if not coalesce(
    v_observation.source_upc ~ '^[0-9]{14}$'
    and v_observation.source_modifier ~ '^[0-9]{3}$'
    and v_observation.source_product_key = v_observation.source_upc || '/' || v_observation.source_modifier,
    false
  ) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  select * into v_state
  from public.commander_source_review_state(p_store_id, p_source_system, p_source_product_key);
  select decision.is_ignored into v_is_ignored
  from public.pos_catalog_source_review_decisions decision
  where decision.store_id = p_store_id
    and decision.source_system = p_source_system
    and decision.source_product_key = p_source_product_key
  for update;
  select identity.id into v_identity_id
  from public.product_source_identities identity
  where identity.store_id = p_store_id
    and identity.source_system = p_source_system
    and identity.source_product_key = p_source_product_key
  for key share;
  v_review_state := v_state.review_state;

  if p_is_ignored and v_review_state = 'ignored' then
    raise exception using errcode = 'P0001', message = 'review_state_invalid';
  end if;
  if not p_is_ignored and v_review_state <> 'ignored' then
    raise exception using errcode = 'P0001', message = 'review_state_invalid';
  end if;

  if p_is_ignored then
    insert into public.pos_catalog_source_review_decisions (
      store_id, source_system, source_product_key, is_ignored, ignore_reason,
      ignored_by, ignored_at, restored_by, restored_at
    ) values (
      p_store_id, p_source_system, p_source_product_key, true, p_ignore_reason,
      p_actor_id, statement_timestamp(), null, null
    )
    on conflict (store_id, source_system, source_product_key)
    do update set
      is_ignored = true,
      ignore_reason = excluded.ignore_reason,
      ignored_by = excluded.ignored_by,
      ignored_at = excluded.ignored_at,
      restored_by = null,
      restored_at = null,
      updated_at = statement_timestamp();
  else
    update public.pos_catalog_source_review_decisions decision
    set
      is_ignored = false,
      restored_by = p_actor_id,
      restored_at = statement_timestamp(),
      updated_at = statement_timestamp()
    where decision.store_id = p_store_id
      and decision.source_system = p_source_system
      and decision.source_product_key = p_source_product_key
      and decision.is_ignored = true;
    if not found then
      raise exception using errcode = 'P0001', message = 'review_state_invalid';
    end if;
  end if;

  insert into public.product_history (
    store_id, source_identity_id, source_system, event_type, actor_id, changes, metadata
  ) values (
    p_store_id, v_identity_id, p_source_system,
    case when p_is_ignored then 'commander_observation_ignored' else 'commander_observation_restored' end,
    p_actor_id, '{}'::jsonb,
    jsonb_build_object('source_product_key', p_source_product_key,
      'ignore_reason', case when p_is_ignored then p_ignore_reason else null end)
  );
end;
$function$;

create or replace function public.map_commander_source_observation(
  p_store_id uuid,
  p_source_system text,
  p_source_product_key text,
  p_product_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_observation public.pos_catalog_source_observations%rowtype;
  v_product public.products%rowtype;
  v_identity_id uuid;
  v_is_ignored boolean;
  v_has_identity boolean;
  v_has_candidate boolean;
  v_review_state text;
  v_state record;
begin
  if p_store_id is null or p_product_id is null or p_actor_id is null
    or p_source_system is distinct from 'commander'
    or p_source_product_key is null or p_source_product_key !~ '^[0-9]{14}/[0-9]{3}$' then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.owner_id = p_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select observation.* into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = p_store_id
    and observation.source_system = p_source_system
    and observation.source_product_key = p_source_product_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'observation_not_found';
  end if;
  if not coalesce(
    v_observation.source_upc ~ '^[0-9]{14}$'
    and v_observation.source_modifier ~ '^[0-9]{3}$'
    and v_observation.source_product_key = v_observation.source_upc || '/' || v_observation.source_modifier,
    false
  ) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  select * into v_state
  from public.commander_source_review_state(p_store_id, p_source_system, p_source_product_key);
  v_review_state := v_state.review_state;
  if v_review_state <> 'unmapped' then
    raise exception using errcode = 'P0001', message = 'review_state_invalid';
  end if;

  select product.* into v_product
  from public.products product
  where product.id = p_product_id and product.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'product_not_found';
  end if;
  if nullif(btrim(v_product.upc), '') <> v_observation.source_upc then
    raise exception using errcode = 'P0001', message = 'mapping_conflict';
  end if;

  insert into public.product_source_identities (
    store_id, product_id, source_system, source_product_key, source_upc, source_modifier,
    source_payload_hash, metadata, first_seen_at, last_seen_at, last_matched_at
  ) values (
    p_store_id, p_product_id, p_source_system, p_source_product_key,
    v_observation.source_upc, v_observation.source_modifier, v_observation.last_snapshot_hash,
    jsonb_build_object('commander_review_mapping', true), statement_timestamp(),
    statement_timestamp(), statement_timestamp()
  ) returning id into v_identity_id;

  insert into public.product_history (
    store_id, product_id, source_identity_id, source_system, event_type, actor_id, changes, metadata
  ) values (
    p_store_id, p_product_id, v_identity_id, p_source_system,
    'commander_source_identity_mapped', p_actor_id,
    jsonb_build_object('old_product_id', null, 'new_product_id', p_product_id),
    jsonb_build_object('source_product_key', p_source_product_key)
  );
end;
$function$;

create or replace function public.create_commander_product_mapping(
  p_store_id uuid,
  p_source_system text,
  p_source_product_key text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_observation public.pos_catalog_source_observations%rowtype;
  v_owner_id uuid;
  v_product_id uuid;
  v_identity_id uuid;
  v_is_ignored boolean;
  v_has_identity boolean;
  v_has_candidate boolean;
  v_review_state text;
  v_state record;
begin
  if p_store_id is null or p_actor_id is null or p_source_system is distinct from 'commander'
    or p_source_product_key is null or p_source_product_key !~ '^[0-9]{14}/[0-9]{3}$' then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;
  select store.owner_id into v_owner_id
  from public.stores store
  where store.id = p_store_id and store.owner_id = p_actor_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select observation.* into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = p_store_id
    and observation.source_system = p_source_system
    and observation.source_product_key = p_source_product_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'observation_not_found';
  end if;
  if not coalesce(
    v_observation.source_upc ~ '^[0-9]{14}$'
    and v_observation.source_modifier ~ '^[0-9]{3}$'
    and v_observation.source_product_key = v_observation.source_upc || '/' || v_observation.source_modifier,
    false
  ) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  select * into v_state
  from public.commander_source_review_state(p_store_id, p_source_system, p_source_product_key);
  v_review_state := v_state.review_state;
  if v_review_state <> 'new' then
    raise exception using errcode = 'P0001', message = 'review_state_invalid';
  end if;

  insert into public.products (
    store_id, owner_id, upc, item_name, selling_price, department, is_active
  ) values (
    p_store_id, v_owner_id, v_observation.source_upc, v_observation.source_description,
    v_observation.source_price, v_observation.source_department, true
  ) returning id into v_product_id;

  insert into public.product_source_identities (
    store_id, product_id, source_system, source_product_key, source_upc, source_modifier,
    source_payload_hash, metadata, first_seen_at, last_seen_at, last_matched_at
  ) values (
    p_store_id, v_product_id, p_source_system, p_source_product_key,
    v_observation.source_upc, v_observation.source_modifier, v_observation.last_snapshot_hash,
    jsonb_build_object('commander_review_mapping', true), statement_timestamp(),
    statement_timestamp(), statement_timestamp()
  ) returning id into v_identity_id;

  insert into public.product_history (
    store_id, product_id, source_identity_id, source_system, event_type, actor_id, changes, metadata
  ) values (
    p_store_id, v_product_id, v_identity_id, p_source_system,
    'commander_product_created_and_mapped', p_actor_id,
    jsonb_build_object('item_name', v_observation.source_description,
      'selling_price', v_observation.source_price, 'department', v_observation.source_department),
    jsonb_build_object('source_product_key', p_source_product_key)
  );
  return v_product_id;
end;
$function$;

create or replace function public.resolve_commander_source_conflict(
  p_store_id uuid,
  p_source_system text,
  p_source_product_key text,
  p_selected_fields text[],
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_observation public.pos_catalog_source_observations%rowtype;
  v_identity public.product_source_identities%rowtype;
  v_product public.products%rowtype;
  v_is_ignored boolean;
  v_distinct_count integer;
  v_review_state text;
  v_before jsonb;
  v_after jsonb;
  v_state record;
begin
  if p_store_id is null or p_actor_id is null or p_source_system is distinct from 'commander'
    or p_source_product_key is null or p_source_product_key !~ '^[0-9]{14}/[0-9]{3}$'
    or p_selected_fields is null or cardinality(p_selected_fields) = 0
    or array_position(p_selected_fields, null) is not null
    or not (p_selected_fields <@ array['item_name', 'selling_price', 'department']::text[]) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;
  select count(distinct selected_field) into v_distinct_count
  from unnest(p_selected_fields) as selected_field;
  if v_distinct_count <> cardinality(p_selected_fields) then
    raise exception using errcode = 'P0001', message = 'review_state_invalid';
  end if;
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.owner_id = p_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select observation.* into v_observation
  from public.pos_catalog_source_observations observation
  where observation.store_id = p_store_id
    and observation.source_system = p_source_system
    and observation.source_product_key = p_source_product_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'observation_not_found';
  end if;
  if not coalesce(
    v_observation.source_upc ~ '^[0-9]{14}$'
    and v_observation.source_modifier ~ '^[0-9]{3}$'
    and v_observation.source_product_key = v_observation.source_upc || '/' || v_observation.source_modifier,
    false
  ) then
    raise exception using errcode = 'P0001', message = 'commander_identity_invalid';
  end if;

  select * into v_state
  from public.commander_source_review_state(p_store_id, p_source_system, p_source_product_key);

  select decision.is_ignored into v_is_ignored
  from public.pos_catalog_source_review_decisions decision
  where decision.store_id = p_store_id and decision.source_system = p_source_system
    and decision.source_product_key = p_source_product_key
  for update;
  select identity.* into v_identity
  from public.product_source_identities identity
  where identity.store_id = p_store_id and identity.source_system = p_source_system
    and identity.source_product_key = p_source_product_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'review_state_invalid';
  end if;
  select product.* into v_product
  from public.products product
  where product.id = v_identity.product_id and product.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'mapping_conflict';
  end if;
  v_review_state := v_state.review_state;
  if v_review_state <> 'conflict' then
    raise exception using errcode = 'P0001', message = 'review_state_invalid';
  end if;

  v_before := jsonb_build_object(
    'item_name', v_product.item_name,
    'selling_price', v_product.selling_price,
    'department', v_product.department
  );
  update public.products product
  set
    item_name = case when 'item_name' = any(p_selected_fields) then v_observation.source_description else product.item_name end,
    selling_price = case when 'selling_price' = any(p_selected_fields) then v_observation.source_price else product.selling_price end,
    department = case when 'department' = any(p_selected_fields) then v_observation.source_department else product.department end,
    updated_at = statement_timestamp()
  where product.id = v_product.id and product.store_id = p_store_id
  returning jsonb_build_object('item_name', item_name, 'selling_price', selling_price, 'department', department)
  into v_after;

  insert into public.product_history (
    store_id, product_id, source_identity_id, source_system, event_type, actor_id, changes, metadata
  ) values (
    p_store_id, v_product.id, v_identity.id, p_source_system,
    'commander_source_conflict_resolved', p_actor_id,
    jsonb_build_object('before', v_before, 'after', v_after),
    jsonb_build_object('source_product_key', p_source_product_key,
      'selected_fields', to_jsonb(p_selected_fields))
  );
end;
$function$;

revoke all on function public.commander_source_review_state(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.list_commander_product_candidates(uuid, text[])
  from public, anon, authenticated;
revoke all on function public.set_commander_source_review_decision(uuid, text, text, boolean, text, uuid)
  from public, anon, authenticated;
revoke all on function public.map_commander_source_observation(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_commander_product_mapping(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_commander_source_conflict(uuid, text, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.commander_source_review_state(uuid, text, text)
  to service_role;
grant execute on function public.list_commander_product_candidates(uuid, text[])
  to service_role;
grant execute on function public.set_commander_source_review_decision(uuid, text, text, boolean, text, uuid)
  to service_role;
grant execute on function public.map_commander_source_observation(uuid, text, text, uuid, uuid)
  to service_role;
grant execute on function public.create_commander_product_mapping(uuid, text, text, uuid)
  to service_role;
grant execute on function public.resolve_commander_source_conflict(uuid, text, text, text[], uuid)
  to service_role;
