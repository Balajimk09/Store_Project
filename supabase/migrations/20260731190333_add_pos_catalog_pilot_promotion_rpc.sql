-- Atomic promotion of a reviewed selected-products catalog pilot into StorePulse.
--
-- This function accepts only an existing preview sync-run identifier. Product
-- values come from the already-validated pos_catalog_sync_items source_values;
-- callers cannot supply descriptions, prices, departments, categories, or
-- other product values directly.
--
-- The first supervised pilot is intentionally limited to 1-5 products with
-- modifier 000 because public.products is currently unique by (store_id, upc).
-- Full-catalog import and non-zero modifier promotion remain blocked.

create or replace function public.promote_pos_catalog_pilot_products(
  p_sync_run_id uuid
)
returns table(
  sync_run_id uuid,
  promoted_count integer,
  created_count integer,
  updated_count integer,
  unchanged_count integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_run public.pos_catalog_sync_runs%rowtype;
  v_item public.pos_catalog_sync_items%rowtype;
  v_identity public.product_source_identities%rowtype;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_identity_id uuid;
  v_expected_source_key text;
  v_source_values jsonb;
  v_description text;
  v_department text;
  v_category text;
  v_retail_price numeric;
  v_cost numeric;
  v_active boolean;
  v_active_provided boolean;
  v_retail_price_provided boolean;
  v_cost_provided boolean;
  v_action text;
  v_match_method text;
  v_before jsonb;
  v_after jsonb;
  v_changes jsonb;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_promoted_count integer := 0;
begin
  if p_sync_run_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_promotion_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'catalog-pilot-promotion:' || p_sync_run_id::text,
      0
    )
  );

  select r.*
  into v_run
  from public.pos_catalog_sync_runs r
  where r.id = p_sync_run_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_promotion_not_found';
  end if;

  if
    v_run.status = 'completed'
    and coalesce(
      (v_run.metadata ->> 'catalog_pilot_promoted')::boolean,
      false
    ) = true
  then
    return query
    select
      v_run.id,
      coalesce(
        (v_run.metadata ->> 'promotion_promoted_count')::integer,
        0
      ),
      coalesce(
        (v_run.metadata ->> 'promotion_created_count')::integer,
        0
      ),
      coalesce(
        (v_run.metadata ->> 'promotion_updated_count')::integer,
        0
      ),
      coalesce(
        (v_run.metadata ->> 'promotion_unchanged_count')::integer,
        0
      );
    return;
  end if;

  if
    v_run.source_system <> 'verifone_commander'
    or v_run.import_mode <> 'selected_products'
    or v_run.status <> 'previewed'
    or v_run.catalog_complete <> false
    or v_run.selection_count < 1
    or v_run.selection_count > 5
    or v_run.received_product_count <> v_run.selection_count
    or coalesce(
      (v_run.metadata ->> 'preview_only')::boolean,
      false
    ) <> true
    or coalesce(
      (v_run.metadata ->> 'automatic_product_creation')::boolean,
      true
    ) <> false
    or coalesce(
      (v_run.metadata ->> 'automatic_publishing_enabled')::boolean,
      true
    ) <> false
  then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_promotion_invalid';
  end if;

  if not exists (
    select 1
    from public.stores s
    where s.id = v_run.store_id
      and s.owner_id = v_run.owner_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_store_mismatch';
  end if;

  if not exists (
    select 1
    from public.store_pos_connectors c
    where c.id = v_run.connector_id
      and c.store_id = v_run.store_id
      and c.status = 'active'
      and c.source_system = v_run.source_system
      and (
        c.source_store_number is null
        or c.source_store_number = v_run.source_store_number
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_connector_mismatch';
  end if;

  if (
    select count(*)
    from public.pos_catalog_sync_items i
    where i.sync_run_id = v_run.id
      and i.store_id = v_run.store_id
  ) <> v_run.selection_count
  then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_item_mismatch';
  end if;

  if exists (
    select 1
    from public.pos_catalog_sync_items i
    where i.sync_run_id = v_run.id
      and i.store_id = v_run.store_id
      and (
        i.source_system is distinct from v_run.source_system
        or i.reconciliation_status <> 'ready'
        or i.source_upc is null
        or i.source_upc !~ '^[0-9]{1,32}$'
        or i.source_modifier is null
        or i.source_modifier <> '000'
        or i.source_product_key
          <> 'upc:' || i.source_upc || '|modifier:' || i.source_modifier
        or i.source_payload_hash !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(i.source_values) <> 'object'
        or i.source_values ->> 'sourceSystem'
          is distinct from v_run.source_system
        or (i.source_values ->> 'sourceStoreNumber')
          is distinct from v_run.source_store_number
        or i.source_values ->> 'sourceProductKey'
          is distinct from i.source_product_key
        or i.source_values ->> 'upc'
          is distinct from i.source_upc
        or i.source_values ->> 'modifier'
          is distinct from i.source_modifier
        or i.source_values ->> 'payloadHash'
          is distinct from i.source_payload_hash
        or coalesce(
          jsonb_typeof(i.source_values -> 'description'),
          ''
        ) <> 'string'
        or coalesce(
          char_length(i.source_values ->> 'description'),
          0
        ) not between 1 and 512
        or (
          i.source_values -> 'retailPrice' is not null
          and jsonb_typeof(i.source_values -> 'retailPrice')
            not in ('number', 'null')
        )
        or (
          i.source_values -> 'cost' is not null
          and jsonb_typeof(i.source_values -> 'cost')
            not in ('number', 'null')
        )
        or (
          i.source_values -> 'active' is not null
          and jsonb_typeof(i.source_values -> 'active')
            not in ('boolean', 'null')
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_item_invalid';
  end if;

  for v_item in
    select i.*
    from public.pos_catalog_sync_items i
    where i.sync_run_id = v_run.id
      and i.store_id = v_run.store_id
    order by i.record_index
    for update
  loop
    v_source_values := v_item.source_values;
    v_expected_source_key :=
      'upc:' || v_item.source_upc
      || '|modifier:' || v_item.source_modifier;
    v_description := v_source_values ->> 'description';

    v_department := coalesce(
      nullif(v_source_values ->> 'departmentName', ''),
      nullif(v_source_values ->> 'departmentNumber', '')
    );

    v_category := coalesce(
      nullif(v_source_values ->> 'categoryName', ''),
      nullif(v_source_values ->> 'categoryNumber', '')
    );

    v_retail_price_provided :=
      jsonb_typeof(v_source_values -> 'retailPrice') = 'number';
    v_cost_provided :=
      jsonb_typeof(v_source_values -> 'cost') = 'number';
    v_active_provided :=
      jsonb_typeof(v_source_values -> 'active') = 'boolean';

    begin
      v_retail_price := case
        when v_retail_price_provided
          then (v_source_values ->> 'retailPrice')::numeric
        else null
      end;

      v_cost := case
        when v_cost_provided
          then (v_source_values ->> 'cost')::numeric
        else null
      end;

      v_active := case
        when v_active_provided
          then (v_source_values ->> 'active')::boolean
        else null
      end;
    exception when others then
      raise exception using
        errcode = 'P0001',
        message = 'catalog_pilot_item_invalid';
    end;

    if
      (
        v_retail_price_provided
        and (
          v_retail_price < 0
          or v_retail_price > 999999.99
          or pg_catalog.round(v_retail_price, 2)
            is distinct from v_retail_price
        )
      )
      or (
        v_cost_provided
        and (
          v_cost < 0
          or v_cost > 999999.99
          or pg_catalog.round(v_cost, 2)
            is distinct from v_cost
        )
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'catalog_pilot_item_invalid';
    end if;

    select psi.*
    into v_identity
    from public.product_source_identities psi
    where psi.store_id = v_run.store_id
      and psi.source_system = v_run.source_system
      and psi.source_product_key = v_expected_source_key
    for update;

    if found then
      select p.*
      into v_product
      from public.products p
      where p.id = v_identity.product_id
        and p.store_id = v_run.store_id
      for update;

      if
        not found
        or v_product.upc is distinct from v_item.source_upc
        or v_identity.source_upc is distinct from v_item.source_upc
        or v_identity.source_modifier is distinct from v_item.source_modifier
      then
        raise exception using
          errcode = 'P0001',
          message = 'catalog_pilot_product_identity_conflict';
      end if;

      v_match_method := 'source_identity';
    else
      select p.*
      into v_product
      from public.products p
      where p.store_id = v_run.store_id
        and p.upc = v_item.source_upc
      for update;

      if found then
        if exists (
          select 1
          from public.product_source_identities psi
          where psi.store_id = v_run.store_id
            and psi.product_id = v_product.id
            and psi.source_system = v_run.source_system
            and psi.source_product_key <> v_expected_source_key
        ) then
          raise exception using
            errcode = 'P0001',
            message = 'catalog_pilot_product_identity_conflict';
        end if;

        v_match_method := 'store_upc';
      else
        v_match_method := 'new_product';
      end if;
    end if;

    if v_match_method = 'new_product' then
      insert into public.products (
        store_id,
        upc,
        item_name,
        category,
        brand,
        cost_price,
        selling_price,
        department,
        is_active
      ) values (
        v_run.store_id,
        v_item.source_upc,
        v_description,
        v_category,
        null,
        v_cost,
        v_retail_price,
        v_department,
        v_active
      )
      returning * into v_product;

      v_action := 'create_product';
      v_created_count := v_created_count + 1;
      v_before := '{}'::jsonb;
    else
      v_before := jsonb_build_object(
        'upc', v_product.upc,
        'item_name', v_product.item_name,
        'selling_price', v_product.selling_price,
        'cost_price', v_product.cost_price,
        'department', v_product.department,
        'category', v_product.category,
        'is_active', v_product.is_active
      );

      v_after := jsonb_build_object(
        'upc', v_product.upc,
        'item_name', v_description,
        'selling_price', case
          when v_retail_price_provided then v_retail_price
          else v_product.selling_price
        end,
        'cost_price', case
          when v_cost_provided then v_cost
          else v_product.cost_price
        end,
        'department', case
          when v_department is not null then v_department
          else v_product.department
        end,
        'category', case
          when v_category is not null then v_category
          else v_product.category
        end,
        'is_active', case
          when v_active_provided then v_active
          else v_product.is_active
        end
      );

      if v_before is distinct from v_after then
        update public.products p
        set
          item_name = v_description,
          selling_price = case
            when v_retail_price_provided then v_retail_price
            else p.selling_price
          end,
          cost_price = case
            when v_cost_provided then v_cost
            else p.cost_price
          end,
          department = case
            when v_department is not null then v_department
            else p.department
          end,
          category = case
            when v_category is not null then v_category
            else p.category
          end,
          is_active = case
            when v_active_provided then v_active
            else p.is_active
          end,
          updated_at = statement_timestamp()
        where p.id = v_product.id
          and p.store_id = v_run.store_id
        returning * into v_product;

        v_action := 'update_product';
        v_updated_count := v_updated_count + 1;
      else
        v_action := 'refresh_identity';
        v_unchanged_count := v_unchanged_count + 1;
      end if;
    end if;

    v_product_id := v_product.id;

    v_after := jsonb_build_object(
      'upc', v_product.upc,
      'item_name', v_product.item_name,
      'selling_price', v_product.selling_price,
      'cost_price', v_product.cost_price,
      'department', v_product.department,
      'category', v_product.category,
      'is_active', v_product.is_active
    );

    v_changes := jsonb_build_object(
      'before', v_before,
      'after', v_after
    );

    insert into public.product_source_identities (
      store_id,
      product_id,
      source_system,
      source_product_key,
      source_upc,
      source_modifier,
      first_sync_run_id,
      last_sync_run_id,
      last_sync_item_id,
      source_payload_hash,
      metadata,
      first_seen_at,
      last_seen_at,
      last_matched_at
    ) values (
      v_run.store_id,
      v_product_id,
      v_run.source_system,
      v_expected_source_key,
      v_item.source_upc,
      v_item.source_modifier,
      v_run.id,
      v_run.id,
      v_item.id,
      v_item.source_payload_hash,
      jsonb_build_object(
        'source_store_number', v_run.source_store_number,
        'last_source_values', v_source_values,
        'pilot_selected_product', true
      ),
      statement_timestamp(),
      statement_timestamp(),
      statement_timestamp()
    )
    on conflict (
      store_id,
      source_system,
      source_product_key
    )
    do update set
      product_id = excluded.product_id,
      source_upc = excluded.source_upc,
      source_modifier = excluded.source_modifier,
      last_sync_run_id = excluded.last_sync_run_id,
      last_sync_item_id = excluded.last_sync_item_id,
      source_payload_hash = excluded.source_payload_hash,
      metadata =
        public.product_source_identities.metadata
        || excluded.metadata,
      last_seen_at = statement_timestamp(),
      last_matched_at = statement_timestamp(),
      updated_at = statement_timestamp()
    returning id into v_identity_id;

    update public.pos_catalog_sync_items i
    set
      storepulse_product_id = v_product_id,
      source_identity_id = v_identity_id,
      reconciliation_status = 'in_sync',
      match_method = v_match_method,
      proposed_changes = v_changes,
      conflict_fields = '{}'::text[],
      validation_errors = '[]'::jsonb,
      resolution = 'promoted',
      reviewed_at = statement_timestamp(),
      updated_at = statement_timestamp()
    where i.id = v_item.id
      and i.sync_run_id = v_run.id
      and i.store_id = v_run.store_id;

    insert into public.product_history (
      store_id,
      product_id,
      source_identity_id,
      sync_run_id,
      sync_item_id,
      source_system,
      event_type,
      changes,
      metadata
    ) values (
      v_run.store_id,
      v_product_id,
      v_identity_id,
      v_run.id,
      v_item.id,
      v_run.source_system,
      case v_action
        when 'create_product' then 'pos_catalog_product_created'
        when 'update_product' then 'pos_catalog_product_updated'
        else 'pos_catalog_product_observed'
      end,
      v_changes,
      jsonb_build_object(
        'source_product_key', v_expected_source_key,
        'source_payload_hash', v_item.source_payload_hash,
        'match_method', v_match_method,
        'selected_products_pilot', true
      )
    );

    v_promoted_count := v_promoted_count + 1;
  end loop;

  if v_promoted_count <> v_run.selection_count then
    raise exception using
      errcode = 'P0001',
      message = 'catalog_pilot_item_mismatch';
  end if;

  update public.pos_catalog_sync_runs r
  set
    status = 'completed',
    ready_count = 0,
    matched_count = v_unchanged_count,
    changed_count = v_created_count + v_updated_count,
    approved_count = v_promoted_count,
    completed_at = statement_timestamp(),
    metadata =
      r.metadata
      || jsonb_build_object(
        'catalog_pilot_promoted', true,
        'promotion_promoted_count', v_promoted_count,
        'promotion_created_count', v_created_count,
        'promotion_updated_count', v_updated_count,
        'promotion_unchanged_count', v_unchanged_count,
        'promotion_completed_at', statement_timestamp()
      ),
    updated_at = statement_timestamp()
  where r.id = v_run.id;

  return query
  select
    v_run.id,
    v_promoted_count,
    v_created_count,
    v_updated_count,
    v_unchanged_count;
end;
$function$;

revoke all on function public.promote_pos_catalog_pilot_products(uuid)
  from public;
revoke all on function public.promote_pos_catalog_pilot_products(uuid)
  from anon, authenticated;
grant execute on function public.promote_pos_catalog_pilot_products(uuid)
  to service_role;

comment on function public.promote_pos_catalog_pilot_products(uuid) is
  'Atomically promotes one reviewed 1-5 item selected-products preview into products, source identities, sync links, and history. Modifier 000 only; no POS publishing.';

notify pgrst, 'reload schema';;
