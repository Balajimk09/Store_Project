alter table public.stores
add column if not exists store_code text;

alter table public.stores
add column if not exists manager_name text;

alter table public.stores
add column if not exists manager_phone text;

alter table public.stores
add column if not exists manager_email text;

alter table public.stores
add column if not exists address_line1 text;

alter table public.stores
add column if not exists address_line2 text;

alter table public.stores
add column if not exists country text not null default 'United States';

alter table public.stores
add column if not exists timezone text not null default 'America/Chicago';

alter table public.stores
add column if not exists store_type text;

alter table public.stores
add column if not exists has_fuel boolean not null default false;

alter table public.stores
add column if not exists fuel_brand text;

alter table public.stores
add column if not exists notes text;

alter table public.stores
add column if not exists business_legal_name text;

alter table public.stores
add column if not exists dba_name text;

alter table public.stores
add column if not exists ein_tax_id text;

alter table public.stores
add column if not exists sales_tax_permit text;

alter table public.stores
add column if not exists tobacco_license text;

alter table public.stores
add column if not exists alcohol_license text;

alter table public.stores
add column if not exists lottery_enabled boolean not null default false;

alter table public.stores
add column if not exists atm_enabled boolean not null default false;

alter table public.stores
add column if not exists money_order_enabled boolean not null default false;

alter table public.stores
add column if not exists ebt_accepted boolean not null default false;

alter table public.stores
add column if not exists operating_hours jsonb not null default '{}'::jsonb;

alter table public.stores
add column if not exists latitude numeric(10, 7);

alter table public.stores
add column if not exists longitude numeric(10, 7);

alter table public.stores
add column if not exists logo_url text;

alter table public.stores
add column if not exists vendor_accounts jsonb not null default '[]'::jsonb;

create index if not exists stores_store_code_idx on public.stores(store_code);
create index if not exists stores_store_type_idx on public.stores(store_type);
create index if not exists stores_has_fuel_idx on public.stores(has_fuel);
create index if not exists stores_business_legal_name_idx on public.stores(business_legal_name);
create index if not exists stores_dba_name_idx on public.stores(dba_name);

update public.stores
set
  address_line1 = coalesce(address_line1, address),
  country = coalesce(country, 'United States'),
  timezone = coalesce(timezone, 'America/Chicago'),
  updated_at = now()
where address is not null
  and address_line1 is null;