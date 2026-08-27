-- Restore legacy product columns that already exist in the deployed
-- StorePulse schema but are required for clean migration-history replay.

alter table public.products
  add column if not exists sku text,
  add column if not exists plu text,
  add column if not exists product_code text,
  add column if not exists brand text,
  add column if not exists cost_price numeric,
  add column if not exists stock numeric,
  add column if not exists reorder_level numeric,
  add column if not exists vendor text,
  add column if not exists tax_rate numeric,
  add column if not exists tax_category text,
  add column if not exists taxable boolean,
  add column if not exists ebt_eligible boolean,
  add column if not exists age_verification boolean,
  add column if not exists minimum_age integer,
  add column if not exists age_restriction_type text,
  add column if not exists is_active boolean,
  add column if not exists notes text,
  add column if not exists units_per_case numeric,
  add column if not exists cases_on_hand numeric,
  add column if not exists loose_units numeric;