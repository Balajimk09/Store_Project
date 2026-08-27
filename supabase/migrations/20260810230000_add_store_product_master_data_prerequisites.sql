-- Reconstruct the Store Settings master-data tables required by the
-- subsequently applied Commander canonical-mapping migration. These tables
-- already exist in production; IF NOT EXISTS keeps this source-history repair
-- compatible with databases where the legacy schema was created out of band.

create table if not exists public.tax_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  rate numeric not null default 0,
  description text null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists public.store_age_restriction_presets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  minimum_age integer not null,
  restriction_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists public.store_departments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  description text null,
  default_tax_rate numeric not null default 0,
  ebt_eligible boolean not null default false,
  is_active boolean not null default true,
  tax_category_id uuid null,
  age_restriction_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists public.store_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  department_id uuid null,
  ebt_eligible boolean not null default false,
  is_active boolean not null default true,
  tax_category_id uuid null,
  age_restriction_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);
