-- Reconcile schemas created by legacy local-only migrations without changing
-- application-facing production data. This migration deliberately does not
-- create the obsolete public.transactions.timestamp column.

do $$
declare
  has_legacy_timestamp boolean;
  has_transaction_time boolean;
begin
  if to_regclass('public.transactions') is null then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'timestamp'
  ) into has_legacy_timestamp;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'transaction_time'
  ) into has_transaction_time;

  if not has_transaction_time then
    alter table public.transactions add column transaction_time timestamptz;
    has_transaction_time := true;
  end if;

  if has_legacy_timestamp then
    update public.transactions
    set transaction_time = timestamp
    where transaction_time is null;
  end if;

  alter table public.transactions
    alter column transaction_time set default now();

  if not exists (
    select 1 from public.transactions where transaction_time is null
  ) then
    alter table public.transactions
      alter column transaction_time set not null;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'batch_id'
  ) then
    alter table public.transactions add column batch_id uuid;
  end if;

  if to_regclass('public.upload_batches') is not null
    and not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.transactions'::regclass
        and conname = 'transactions_batch_id_fkey'
    ) then
    alter table public.transactions
      add constraint transactions_batch_id_fkey
      foreign key (batch_id)
      references public.upload_batches(id)
      on delete set null;
  end if;
end $$;

-- The legacy index name may reference the obsolete timestamp column. Dropping
-- it is safe: the correct transaction_time index is recreated immediately.
drop index if exists public.idx_transactions_store_time;

do $$
begin
  if to_regclass('public.transactions') is null then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'transaction_time'
  ) then
    execute 'create index if not exists idx_transactions_store_time on public.transactions (store_id, transaction_time desc)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'batch_id'
  ) then
    execute 'create index if not exists idx_transactions_batch on public.transactions (batch_id)';
  end if;
end $$;

do $$
declare
  legacy_plan_name text;
  legacy_plan_code text;
  legacy_yearly_price text;
  legacy_max_stores text;
  legacy_max_users text;
  legacy_max_uploads text;
  legacy_max_ai_requests text;
  legacy_features text;
begin
  if to_regclass('public.platform_plans') is null then
    return;
  end if;

  alter table public.platform_plans
    add column if not exists plan_name text,
    add column if not exists plan_code text,
    add column if not exists yearly_price numeric(10, 2),
    add column if not exists setup_fee numeric(10, 2),
    add column if not exists trial_days integer,
    add column if not exists max_stores integer,
    add column if not exists max_users_per_store integer,
    add column if not exists max_uploads_per_month integer,
    add column if not exists max_ai_requests_per_month integer,
    add column if not exists features jsonb;

  legacy_plan_name := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'name'
  ) then 'nullif(btrim(name), '''')' else 'null' end;
  legacy_plan_code := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'plan_key'
  ) then 'nullif(btrim(plan_key), '''')' else 'null' end;
  legacy_yearly_price := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'annual_price'
  ) then 'annual_price' else 'null' end;
  legacy_max_stores := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'included_store_count'
  ) then 'included_store_count' else 'null' end;
  legacy_max_users := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'included_user_count'
  ) then 'included_user_count' else 'null' end;
  legacy_max_uploads := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'max_monthly_uploads'
  ) then 'max_monthly_uploads' else 'null' end;
  legacy_max_ai_requests := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'max_ai_requests'
  ) then 'max_ai_requests' else 'null' end;
  legacy_features := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'metadata'
  ) then 'coalesce(metadata, ''{}''::jsonb)' else '''{}''::jsonb' end;

  if exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_plans' and column_name = 'allow_csv_upload'
  ) then
    legacy_features := format(
      'jsonb_strip_nulls(jsonb_build_object(
        ''csv_upload'', allow_csv_upload,
        ''ai_assistant'', allow_ai_assistant,
        ''reports_export'', allow_reports_export,
        ''multi_store'', allow_multi_store,
        ''vendor_management'', allow_vendor_management,
        ''product_management'', allow_product_management,
        ''cashier_management'', allow_cashier_management
      )) || %s',
      legacy_features
    );
  end if;

  execute format(
    'update public.platform_plans
     set plan_name = coalesce(nullif(btrim(plan_name), ''''), %1$s, %2$s),
         plan_code = coalesce(nullif(btrim(plan_code), ''''), %2$s),
         yearly_price = coalesce(yearly_price, %3$s),
         max_stores = coalesce(max_stores, %4$s),
         max_users_per_store = coalesce(max_users_per_store, %5$s),
         max_uploads_per_month = coalesce(max_uploads_per_month, %6$s),
         max_ai_requests_per_month = coalesce(max_ai_requests_per_month, %7$s),
         features = coalesce(features, %8$s)
     where plan_name is null
        or btrim(plan_name) = ''''
        or plan_code is null
        or btrim(plan_code) = ''''
        or yearly_price is null
        or max_stores is null
        or max_users_per_store is null
        or max_uploads_per_month is null
        or max_ai_requests_per_month is null
        or features is null',
    legacy_plan_name,
    legacy_plan_code,
    legacy_yearly_price,
    legacy_max_stores,
    legacy_max_users,
    legacy_max_uploads,
    legacy_max_ai_requests,
    legacy_features
  );

  alter table public.platform_plans
    alter column features set default '[]'::jsonb;
end $$;

-- The old plan-limit view/function are not used by the current application.
-- Remove only the obsolete derived objects; rows and custom plan fields remain.
drop function if exists public.can_store_add_member(uuid, text);
drop view if exists public.store_plan_limit_summary;

notify pgrst, 'reload schema';
