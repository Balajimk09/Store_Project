create or replace function public.read_store_canonical_product_catalog(
  p_store_id uuid,
  p_search text,
  p_department text,
  p_vendor text,
  p_stock_status text,
  p_min_price numeric,
  p_max_price numeric,
  p_ebt_only boolean,
  p_age_restricted_only boolean,
  p_taxable_only boolean,
  p_active_status text,
  p_offset integer,
  p_limit integer
)
returns table (
  id uuid,
  upc text,
  item_name text,
  category text,
  department text,
  sku text,
  plu text,
  product_code text,
  brand text,
  cost_price numeric,
  selling_price numeric,
  stock numeric,
  reorder_level numeric,
  vendor text,
  tax_rate numeric,
  tax_category text,
  taxable boolean,
  ebt_eligible boolean,
  age_verification boolean,
  minimum_age integer,
  age_restriction_type text,
  is_active boolean,
  notes text,
  units_per_case numeric,
  cases_on_hand numeric,
  loose_units numeric,
  commander_linked boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with request_bounds as (
    select
      case
        when p_limit is null or p_limit < 1 then 50
        when p_limit > 100 then 100
        else p_limit
      end as effective_limit,
      greatest(coalesce(p_offset, 0), 0) as effective_offset
  ),
  filtered as (
    select
      product.*,
      exists (
        select 1
        from public.product_source_identities identity_row
        where identity_row.store_id = product.store_id
          and identity_row.product_id = product.id
          and identity_row.source_system = 'commander'
      ) as commander_linked
    from public.products product
    where product.store_id = p_store_id
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', product.item_name, product.upc, product.plu, product.product_code, product.sku)
          ilike '%' || replace(replace(replace(btrim(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
      )
      and (
        nullif(btrim(p_department), '') is null
        or coalesce(nullif(btrim(product.department), ''), nullif(btrim(product.category), ''), 'Uncategorized') = btrim(p_department)
      )
      and (nullif(btrim(p_vendor), '') is null or product.vendor = btrim(p_vendor))
      and (
        p_stock_status = 'all'
        or (p_stock_status = 'reorder' and coalesce(product.stock, 0) <= coalesce(product.reorder_level, 0))
        or (p_stock_status = 'in_stock' and coalesce(product.stock, 0) > coalesce(product.reorder_level, 0))
      )
      and (p_min_price is null or product.selling_price >= p_min_price)
      and (p_max_price is null or product.selling_price <= p_max_price)
      and (not p_ebt_only or product.ebt_eligible is true)
      and (
        not p_age_restricted_only
        or product.age_verification is true
        or product.minimum_age is not null
        or nullif(btrim(product.age_restriction_type), '') is not null
      )
      and (not p_taxable_only or product.taxable is true)
      and (
        p_active_status = 'all'
        or (p_active_status = 'active' and product.is_active is true)
        or (p_active_status = 'inactive' and product.is_active is false)
        or (p_active_status = 'unknown' and product.is_active is null)
      )
  )
  select
    filtered.id,
    filtered.upc,
    filtered.item_name,
    filtered.category,
    filtered.department,
    filtered.sku,
    filtered.plu,
    filtered.product_code,
    filtered.brand,
    filtered.cost_price,
    filtered.selling_price,
    filtered.stock,
    filtered.reorder_level,
    filtered.vendor,
    filtered.tax_rate,
    filtered.tax_category,
    filtered.taxable,
    filtered.ebt_eligible,
    filtered.age_verification,
    filtered.minimum_age,
    filtered.age_restriction_type,
    filtered.is_active,
    filtered.notes,
    filtered.units_per_case,
    filtered.cases_on_hand,
    filtered.loose_units,
    filtered.commander_linked,
    count(*) over () as total_count
  from filtered
  order by lower(coalesce(filtered.item_name, '')), filtered.id
  offset (select effective_offset from request_bounds)
  limit (select effective_limit from request_bounds);
$function$;

create or replace function public.count_store_canonical_product_catalog(
  p_store_id uuid,
  p_search text,
  p_department text,
  p_vendor text,
  p_stock_status text,
  p_min_price numeric,
  p_max_price numeric,
  p_ebt_only boolean,
  p_age_restricted_only boolean,
  p_taxable_only boolean,
  p_active_status text
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $function$
  select count(*)
  from public.products product
  where product.store_id = p_store_id
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ', product.item_name, product.upc, product.plu, product.product_code, product.sku)
        ilike '%' || replace(replace(replace(btrim(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
    )
    and (
      nullif(btrim(p_department), '') is null
      or coalesce(nullif(btrim(product.department), ''), nullif(btrim(product.category), ''), 'Uncategorized') = btrim(p_department)
    )
    and (nullif(btrim(p_vendor), '') is null or product.vendor = btrim(p_vendor))
    and (
      p_stock_status = 'all'
      or (p_stock_status = 'reorder' and coalesce(product.stock, 0) <= coalesce(product.reorder_level, 0))
      or (p_stock_status = 'in_stock' and coalesce(product.stock, 0) > coalesce(product.reorder_level, 0))
    )
    and (p_min_price is null or product.selling_price >= p_min_price)
    and (p_max_price is null or product.selling_price <= p_max_price)
    and (not p_ebt_only or product.ebt_eligible is true)
    and (
      not p_age_restricted_only
      or product.age_verification is true
      or product.minimum_age is not null
      or nullif(btrim(product.age_restriction_type), '') is not null
    )
    and (not p_taxable_only or product.taxable is true)
    and (
      p_active_status = 'all'
      or (p_active_status = 'active' and product.is_active is true)
      or (p_active_status = 'inactive' and product.is_active is false)
      or (p_active_status = 'unknown' and product.is_active is null)
    );
$function$;

create or replace function public.read_store_canonical_product_catalog_metrics(p_store_id uuid)
returns table (
  total_products bigint,
  commander_linked bigint,
  active_products bigint,
  inactive_products bigint,
  unknown_products bigint,
  low_stock_products bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    count(*) as total_products,
    count(*) filter (
      where exists (
        select 1
        from public.product_source_identities identity_row
        where identity_row.store_id = product.store_id
          and identity_row.product_id = product.id
          and identity_row.source_system = 'commander'
      )
    ) as commander_linked,
    count(*) filter (where product.is_active is true) as active_products,
    count(*) filter (where product.is_active is false) as inactive_products,
    count(*) filter (where product.is_active is null) as unknown_products,
    count(*) filter (where coalesce(product.stock, 0) <= coalesce(product.reorder_level, 0)) as low_stock_products
  from public.products product
  where product.store_id = p_store_id;
$function$;

create or replace function public.read_store_canonical_product_catalog_facets(p_store_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(value order by value)
      from (
        select distinct coalesce(nullif(btrim(product.department), ''), nullif(btrim(product.category), ''), 'Uncategorized') as value
        from public.products product
        where product.store_id = p_store_id
        order by value
        limit 500
      ) departments
    ), '[]'::jsonb),
    'vendors', coalesce((
      select jsonb_agg(value order by value)
      from (
        select distinct btrim(product.vendor) as value
        from public.products product
        where product.store_id = p_store_id
          and nullif(btrim(product.vendor), '') is not null
        order by value
        limit 500
      ) vendors
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.read_store_canonical_product_catalog(uuid, text, text, text, text, numeric, numeric, boolean, boolean, boolean, text, integer, integer) from public;
revoke all on function public.count_store_canonical_product_catalog(uuid, text, text, text, text, numeric, numeric, boolean, boolean, boolean, text) from public;
revoke all on function public.read_store_canonical_product_catalog_metrics(uuid) from public;
revoke all on function public.read_store_canonical_product_catalog_facets(uuid) from public;

grant execute on function public.read_store_canonical_product_catalog(uuid, text, text, text, text, numeric, numeric, boolean, boolean, boolean, text, integer, integer) to authenticated;
grant execute on function public.count_store_canonical_product_catalog(uuid, text, text, text, text, numeric, numeric, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.read_store_canonical_product_catalog_metrics(uuid) to authenticated;
grant execute on function public.read_store_canonical_product_catalog_facets(uuid) to authenticated;
