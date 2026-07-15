-- StorePulse AI vendor order persistence

create extension if not exists pgcrypto;

create table if not exists public.vendor_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  vendor_name text not null,
  order_number text,
  status text not null default 'draft',
  order_date date not null default current_date,
  expected_delivery_date date,
  sent_at timestamptz,
  received_at timestamptz,
  notes text,
  total_items integer not null default 0,
  total_units numeric not null default 0,
  estimated_total numeric not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vendor_orders_status_check check (
    status in (
      'draft',
      'ready',
      'sent',
      'partially_received',
      'received',
      'cancelled'
    )
  ),
  constraint vendor_orders_total_items_check check (total_items >= 0),
  constraint vendor_orders_total_units_check check (total_units >= 0),
  constraint vendor_orders_estimated_total_check check (estimated_total >= 0),
  constraint vendor_orders_id_store_id_unique unique (id, store_id)
);

create table if not exists public.vendor_order_items (
  id uuid primary key default gen_random_uuid(),
  vendor_order_id uuid not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,

  product_name text not null,
  upc text,
  plu text,
  product_code text,
  sku text,
  department text,
  vendor_name text,

  units_per_case numeric not null default 1,
  ordered_cases numeric not null default 0,
  ordered_units numeric not null default 0,
  loose_units numeric not null default 0,

  expected_unit_cost numeric not null default 0,
  expected_case_cost numeric not null default 0,
  estimated_total numeric not null default 0,

  received_units numeric not null default 0,
  invoice_matched boolean not null default false,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vendor_order_items_order_store_fkey
    foreign key (vendor_order_id, store_id)
    references public.vendor_orders(id, store_id)
    on delete cascade,
  constraint vendor_order_items_units_per_case_check check (units_per_case > 0),
  constraint vendor_order_items_ordered_cases_check check (ordered_cases >= 0),
  constraint vendor_order_items_ordered_units_check check (ordered_units >= 0),
  constraint vendor_order_items_loose_units_check check (loose_units >= 0),
  constraint vendor_order_items_expected_unit_cost_check check (expected_unit_cost >= 0),
  constraint vendor_order_items_expected_case_cost_check check (expected_case_cost >= 0),
  constraint vendor_order_items_estimated_total_check check (estimated_total >= 0),
  constraint vendor_order_items_received_units_check check (received_units >= 0)
);

create index if not exists vendor_orders_store_id_idx
on public.vendor_orders(store_id);

create index if not exists vendor_orders_store_status_idx
on public.vendor_orders(store_id, status);

create index if not exists vendor_orders_store_vendor_name_idx
on public.vendor_orders(store_id, vendor_name);

create index if not exists vendor_orders_store_order_date_idx
on public.vendor_orders(store_id, order_date desc);

create index if not exists vendor_order_items_vendor_order_id_idx
on public.vendor_order_items(vendor_order_id);

create index if not exists vendor_order_items_store_id_idx
on public.vendor_order_items(store_id);

create index if not exists vendor_order_items_product_id_idx
on public.vendor_order_items(product_id);

create index if not exists vendor_order_items_store_product_idx
on public.vendor_order_items(store_id, product_id);

create index if not exists vendor_order_items_store_vendor_name_idx
on public.vendor_order_items(store_id, vendor_name);

alter table public.vendor_orders enable row level security;
alter table public.vendor_order_items enable row level security;

drop policy if exists "select_own_vendor_orders" on public.vendor_orders;
create policy "select_own_vendor_orders"
on public.vendor_orders
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_orders.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "insert_own_vendor_orders" on public.vendor_orders;
create policy "insert_own_vendor_orders"
on public.vendor_orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_orders.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "update_own_vendor_orders" on public.vendor_orders;
create policy "update_own_vendor_orders"
on public.vendor_orders
for update
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_orders.store_id
      and stores.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_orders.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "delete_own_vendor_orders" on public.vendor_orders;
create policy "delete_own_vendor_orders"
on public.vendor_orders
for delete
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_orders.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "select_own_vendor_order_items" on public.vendor_order_items;
create policy "select_own_vendor_order_items"
on public.vendor_order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_order_items.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "insert_own_vendor_order_items" on public.vendor_order_items;
create policy "insert_own_vendor_order_items"
on public.vendor_order_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_order_items.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "update_own_vendor_order_items" on public.vendor_order_items;
create policy "update_own_vendor_order_items"
on public.vendor_order_items
for update
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_order_items.store_id
      and stores.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_order_items.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "delete_own_vendor_order_items" on public.vendor_order_items;
create policy "delete_own_vendor_order_items"
on public.vendor_order_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = vendor_order_items.store_id
      and stores.owner_id = auth.uid()
  )
);

grant select, insert, update, delete on public.vendor_orders to authenticated;
grant select, insert, update, delete on public.vendor_order_items to authenticated;

notify pgrst, 'reload schema';

-- Suggested verification queries:
-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
-- and table_name in ('vendor_orders', 'vendor_order_items');
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
-- and table_name in ('vendor_orders', 'vendor_order_items')
-- order by table_name, ordinal_position;
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
-- and tablename in ('vendor_orders', 'vendor_order_items')
-- order by tablename, indexname;
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
-- and tablename in ('vendor_orders', 'vendor_order_items')
-- order by tablename, policyname;
