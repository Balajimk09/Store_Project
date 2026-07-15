-- Read-only production schema audit for the local-only legacy migration set.
-- Run with psql against the target database. It performs catalog reads only.

with migration_fingerprint as (
  select
    '20260619010910_create_storepulse_tables.sql'::text as migration,
    case
      when to_regclass('public.stores') is not null
        and to_regclass('public.upload_batches') is not null
        and to_regclass('public.transactions') is not null
        and to_regclass('public.products') is not null
        and exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'transactions' and column_name = 'transaction_time'
        )
        and not exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'transactions' and column_name = 'timestamp'
        )
        then 'superseded by newer schema'
      when to_regclass('public.stores') is not null
        or to_regclass('public.upload_batches') is not null
        or to_regclass('public.transactions') is not null
        or to_regclass('public.products') is not null
        then 'partially represented'
      else 'genuinely missing'
    end as status,
    concat_ws('; ',
      case when to_regclass('public.stores') is not null then 'stores exists' end,
      case when to_regclass('public.upload_batches') is not null then 'upload_batches exists' end,
      case when to_regclass('public.transactions') is not null then 'transactions exists' end,
      case when to_regclass('public.products') is not null then 'products exists' end,
      case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'transaction_time') then 'transaction_time exists' end,
      case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'timestamp') then 'legacy timestamp exists' else 'legacy timestamp absent' end
    ) as evidence

  union all

  select
    '20260619201517_add_batch_id_to_transactions.sql',
    case
      when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'batch_id')
        and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'transactions' and indexname = 'idx_transactions_batch')
        then 'fully represented in production'
      when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'batch_id')
        then 'superseded by newer schema'
      else 'genuinely missing'
    end,
    concat_ws('; ',
      case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'batch_id') then 'batch_id exists' end,
      case when exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'transactions' and indexname = 'idx_transactions_batch') then 'idx_transactions_batch exists' end
    )

  union all

  select
    '20260623010000_platform_plans_store_limits.sql',
    case
      when to_regclass('public.platform_plans') is not null
        and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name in ('plan_name', 'plan_code', 'monthly_price', 'yearly_price', 'setup_fee', 'trial_days', 'max_stores', 'max_users_per_store', 'max_products', 'max_uploads_per_month', 'max_ai_requests_per_month', 'features', 'is_active', 'sort_order')) = 14
        then 'superseded by newer schema'
      when to_regclass('public.platform_plans') is not null then 'partially represented'
      else 'genuinely missing'
    end,
    concat_ws('; ',
      case when to_regclass('public.platform_plans') is not null then 'platform_plans exists' end,
      case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'plan_name') then 'current plan_name exists' end,
      case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'plan_key') then 'legacy plan_key exists' end
    )

  union all

  select '20260623010100_pos_types.sql',
    case when to_regclass('public.pos_types') is not null then 'fully represented in production' else 'genuinely missing' end,
    case when to_regclass('public.pos_types') is not null then 'pos_types exists' else null end

  union all

  select '20260623010200_store_profile_full_schema.sql',
    case
      when to_regclass('public.stores') is not null
        and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name in ('store_code', 'address_line1', 'address_line2', 'country', 'timezone', 'store_type', 'fuel_brand', 'business_legal_name', 'dba_name', 'operating_hours', 'logo_url')) = 11
        then 'fully represented in production'
      when to_regclass('public.stores') is not null then 'partially represented'
      else 'genuinely missing'
    end,
    concat_ws('; ',
      case when to_regclass('public.stores') is not null then 'stores exists' end,
      format('%s/11 profile columns present', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name in ('store_code', 'address_line1', 'address_line2', 'country', 'timezone', 'store_type', 'fuel_brand', 'business_legal_name', 'dba_name', 'operating_hours', 'logo_url')))
    )

  union all

  select '20260629010000_allow_nullable_product_upc.sql',
    case
      when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'upc' and is_nullable = 'YES') then 'fully represented in production'
      when to_regclass('public.products') is not null then 'partially represented'
      else 'genuinely missing'
    end,
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'upc' and is_nullable = 'YES') then 'products.upc is nullable' else null end

  union all

  select '20260630010000_create_store_pos_connectors.sql',
    case
      when to_regclass('public.store_pos_connectors') is not null
        and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'store_pos_connectors' and column_name in ('store_id', 'source_system', 'status', 'last_seen_at', 'last_upload_at', 'last_error')) = 6
        then 'fully represented in production'
      when to_regclass('public.store_pos_connectors') is not null then 'partially represented'
      else 'genuinely missing'
    end,
    case when to_regclass('public.store_pos_connectors') is not null then 'store_pos_connectors exists' else null end

  union all

  select '20260630010100_create_vendor_orders.sql',
    case
      when to_regclass('public.vendor_orders') is not null and to_regclass('public.vendor_order_items') is not null then 'fully represented in production'
      when to_regclass('public.vendor_orders') is not null or to_regclass('public.vendor_order_items') is not null then 'partially represented'
      else 'genuinely missing'
    end,
    concat_ws('; ', case when to_regclass('public.vendor_orders') is not null then 'vendor_orders exists' end, case when to_regclass('public.vendor_order_items') is not null then 'vendor_order_items exists' end)

  union all

  select '20260708010000_create_pos_cashier_summary.sql',
    case when to_regclass('public.pos_cashier_summary') is not null then 'fully represented in production' else 'genuinely missing' end,
    case when to_regclass('public.pos_cashier_summary') is not null then 'pos_cashier_summary exists' else null end

  union all

  select '20260708010100_create_pos_payment_summary.sql',
    case when to_regclass('public.pos_payment_summary') is not null then 'fully represented in production' else 'genuinely missing' end,
    case when to_regclass('public.pos_payment_summary') is not null then 'pos_payment_summary exists' else null end

  union all

  select '20260709010000_allow_transsetz_report_type.sql',
    case
      when exists (select 1 from pg_constraint where conrelid = to_regclass('public.pos_report_files') and pg_get_constraintdef(oid) ilike '%transsetz%') then 'fully represented in production'
      when to_regclass('public.pos_report_files') is not null then 'partially represented'
      else 'genuinely missing'
    end,
    case when to_regclass('public.pos_report_files') is not null then 'pos_report_files exists' else null end
)
select migration, status, coalesce(evidence, 'No matching schema objects found.') as evidence
from migration_fingerprint
order by migration;
