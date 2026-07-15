-- StorePulse AI platform plans, subscriptions, memberships, and limits foundation

create extension if not exists pgcrypto;

create table if not exists public.platform_plans (
  id uuid primary key default gen_random_uuid(),

  plan_key text not null unique,
  name text not null,
  description text,

  monthly_price numeric(10, 2) not null default 0,
  annual_price numeric(10, 2) not null default 0,

  included_store_count integer not null default 1,
  included_user_count integer not null default 1,
  included_owner_count integer not null default 1,
  included_manager_count integer not null default 0,
  included_cashier_count integer not null default 1,

  extra_user_price numeric(10, 2) not null default 0,
  extra_cashier_price numeric(10, 2) not null default 0,

  max_products integer,
  max_monthly_uploads integer,
  max_ai_requests integer,

  allow_csv_upload boolean not null default true,
  allow_ai_assistant boolean not null default false,
  allow_reports_export boolean not null default false,
  allow_multi_store boolean not null default false,
  allow_vendor_management boolean not null default true,
  allow_product_management boolean not null default true,
  allow_cashier_management boolean not null default true,

  is_active boolean not null default true,
  is_system boolean not null default false,
  sort_order integer not null default 100,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_subscriptions (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  plan_id uuid references public.platform_plans(id),

  subscription_status text not null default 'trial',
  billing_status text not null default 'not_connected',

  billing_provider text,
  billing_customer_id text,
  billing_subscription_id text,

  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at timestamptz,

  notes text,
  created_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_subscriptions_store_unique unique (store_id)
);

create table if not exists public.store_plan_overrides (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,

  included_user_count_override integer,
  included_owner_count_override integer,
  included_manager_count_override integer,
  included_cashier_count_override integer,

  max_products_override integer,
  max_monthly_uploads_override integer,
  max_ai_requests_override integer,

  allow_csv_upload_override boolean,
  allow_ai_assistant_override boolean,
  allow_reports_export_override boolean,
  allow_multi_store_override boolean,
  allow_vendor_management_override boolean,
  allow_product_management_override boolean,
  allow_cashier_management_override boolean,

  reason text,
  created_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_plan_overrides_store_unique unique (store_id)
);

create table if not exists public.store_memberships (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  role_key text not null default 'cashier',
  status text not null default 'active',

  is_billable boolean not null default true,
  billing_note text,

  created_by uuid references auth.users(id),
  deactivated_by uuid references auth.users(id),
  deactivated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_memberships_store_user_unique unique (store_id, user_id),
  constraint store_memberships_role_check check (
    role_key in ('owner', 'manager', 'cashier', 'staff')
  ),
  constraint store_memberships_status_check check (
    status in ('active', 'inactive', 'invited')
  )
);

create table if not exists public.store_invitations (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,

  email text not null,
  role_key text not null default 'cashier',
  status text not null default 'pending',

  invited_by uuid references auth.users(id),
  accepted_by uuid references auth.users(id),

  expires_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_invitations_role_check check (
    role_key in ('owner', 'manager', 'cashier', 'staff')
  ),
  constraint store_invitations_status_check check (
    status in ('pending', 'accepted', 'cancelled', 'expired')
  )
);

create index if not exists platform_plans_plan_key_idx on public.platform_plans(plan_key);
create index if not exists platform_plans_is_active_idx on public.platform_plans(is_active);

create index if not exists store_subscriptions_store_id_idx on public.store_subscriptions(store_id);
create index if not exists store_subscriptions_plan_id_idx on public.store_subscriptions(plan_id);
create index if not exists store_subscriptions_status_idx on public.store_subscriptions(subscription_status);

create index if not exists store_plan_overrides_store_id_idx on public.store_plan_overrides(store_id);

create index if not exists store_memberships_store_id_idx on public.store_memberships(store_id);
create index if not exists store_memberships_user_id_idx on public.store_memberships(user_id);
create index if not exists store_memberships_role_key_idx on public.store_memberships(role_key);
create index if not exists store_memberships_status_idx on public.store_memberships(status);

create index if not exists store_invitations_store_id_idx on public.store_invitations(store_id);
create index if not exists store_invitations_email_idx on public.store_invitations(email);
create index if not exists store_invitations_status_idx on public.store_invitations(status);

insert into public.platform_plans (
  plan_key,
  name,
  description,
  monthly_price,
  annual_price,
  included_store_count,
  included_user_count,
  included_owner_count,
  included_manager_count,
  included_cashier_count,
  extra_user_price,
  extra_cashier_price,
  max_products,
  max_monthly_uploads,
  max_ai_requests,
  allow_csv_upload,
  allow_ai_assistant,
  allow_reports_export,
  allow_multi_store,
  allow_vendor_management,
  allow_product_management,
  allow_cashier_management,
  is_active,
  is_system,
  sort_order
)
values
  (
    'starter',
    'Starter',
    'Basic plan for one store with limited employee access.',
    29.00,
    290.00,
    1,
    2,
    1,
    0,
    1,
    10.00,
    10.00,
    1000,
    10,
    100,
    true,
    false,
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    10
  ),
  (
    'growth',
    'Growth',
    'Growth plan for stores with more cashiers and reporting needs.',
    79.00,
    790.00,
    1,
    6,
    1,
    1,
    4,
    12.00,
    12.00,
    10000,
    100,
    1000,
    true,
    true,
    true,
    false,
    true,
    true,
    true,
    true,
    true,
    20
  ),
  (
    'multi_store',
    'Multi Store',
    'Plan for owners operating multiple stores.',
    149.00,
    1490.00,
    5,
    25,
    5,
    5,
    15,
    10.00,
    10.00,
    100000,
    500,
    5000,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    30
  )
on conflict (plan_key) do update set
  name = excluded.name,
  description = excluded.description,
  monthly_price = excluded.monthly_price,
  annual_price = excluded.annual_price,
  included_store_count = excluded.included_store_count,
  included_user_count = excluded.included_user_count,
  included_owner_count = excluded.included_owner_count,
  included_manager_count = excluded.included_manager_count,
  included_cashier_count = excluded.included_cashier_count,
  extra_user_price = excluded.extra_user_price,
  extra_cashier_price = excluded.extra_cashier_price,
  max_products = excluded.max_products,
  max_monthly_uploads = excluded.max_monthly_uploads,
  max_ai_requests = excluded.max_ai_requests,
  allow_csv_upload = excluded.allow_csv_upload,
  allow_ai_assistant = excluded.allow_ai_assistant,
  allow_reports_export = excluded.allow_reports_export,
  allow_multi_store = excluded.allow_multi_store,
  allow_vendor_management = excluded.allow_vendor_management,
  allow_product_management = excluded.allow_product_management,
  allow_cashier_management = excluded.allow_cashier_management,
  is_active = excluded.is_active,
  is_system = excluded.is_system,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace view public.store_plan_limit_summary as
select
  s.id as store_id,
  s.store_name,

  p.id as plan_id,
  p.plan_key,
  p.name as plan_name,

  ss.subscription_status,
  ss.billing_status,

  coalesce(o.included_user_count_override, p.included_user_count, 0) as included_user_count,
  coalesce(o.included_owner_count_override, p.included_owner_count, 0) as included_owner_count,
  coalesce(o.included_manager_count_override, p.included_manager_count, 0) as included_manager_count,
  coalesce(o.included_cashier_count_override, p.included_cashier_count, 0) as included_cashier_count,

  coalesce(o.max_products_override, p.max_products) as max_products,
  coalesce(o.max_monthly_uploads_override, p.max_monthly_uploads) as max_monthly_uploads,
  coalesce(o.max_ai_requests_override, p.max_ai_requests) as max_ai_requests,

  coalesce(o.allow_csv_upload_override, p.allow_csv_upload, false) as allow_csv_upload,
  coalesce(o.allow_ai_assistant_override, p.allow_ai_assistant, false) as allow_ai_assistant,
  coalesce(o.allow_reports_export_override, p.allow_reports_export, false) as allow_reports_export,
  coalesce(o.allow_multi_store_override, p.allow_multi_store, false) as allow_multi_store,
  coalesce(o.allow_vendor_management_override, p.allow_vendor_management, false) as allow_vendor_management,
  coalesce(o.allow_product_management_override, p.allow_product_management, false) as allow_product_management,
  coalesce(o.allow_cashier_management_override, p.allow_cashier_management, false) as allow_cashier_management,

  (
    select count(*)
    from public.store_memberships sm
    where sm.store_id = s.id
      and sm.status = 'active'
  ) as current_active_users,

  (
    select count(*)
    from public.store_memberships sm
    where sm.store_id = s.id
      and sm.status = 'active'
      and sm.role_key = 'cashier'
  ) as current_active_cashiers,

  (
    select count(*)
    from public.store_memberships sm
    where sm.store_id = s.id
      and sm.status = 'active'
      and sm.role_key = 'manager'
  ) as current_active_managers,

  (
    select count(*)
    from public.store_memberships sm
    where sm.store_id = s.id
      and sm.status = 'active'
      and sm.role_key = 'owner'
  ) as current_active_owners

from public.stores s
left join public.store_subscriptions ss on ss.store_id = s.id
left join public.platform_plans p on p.id = ss.plan_id
left join public.store_plan_overrides o on o.store_id = s.id;

create or replace function public.can_store_add_member(
  target_store_id uuid,
  target_role_key text
)
returns table (
  allowed boolean,
  reason text,
  current_count integer,
  allowed_count integer,
  is_billable_extra boolean
)
language plpgsql
security definer
as $$
declare
  limits record;
  current_role_count integer;
  role_limit integer;
begin
  select *
  into limits
  from public.store_plan_limit_summary
  where store_id = target_store_id;

  if limits.store_id is null then
    return query select false, 'Store plan or subscription was not found.', 0, 0, false;
    return;
  end if;

  if target_role_key = 'cashier' then
    current_role_count := limits.current_active_cashiers;
    role_limit := limits.included_cashier_count;
  elsif target_role_key = 'manager' then
    current_role_count := limits.current_active_managers;
    role_limit := limits.included_manager_count;
  elsif target_role_key = 'owner' then
    current_role_count := limits.current_active_owners;
    role_limit := limits.included_owner_count;
  else
    current_role_count := limits.current_active_users;
    role_limit := limits.included_user_count;
  end if;

  if limits.current_active_users >= limits.included_user_count then
    return query select false, 'Store has reached the included user limit.', limits.current_active_users::integer, limits.included_user_count::integer, true;
    return;
  end if;

  if current_role_count >= role_limit then
    return query select false, 'Store has reached the included role limit.', current_role_count::integer, role_limit::integer, true;
    return;
  end if;

  return query select true, 'Allowed under current plan.', current_role_count::integer, role_limit::integer, false;
end;
$$;