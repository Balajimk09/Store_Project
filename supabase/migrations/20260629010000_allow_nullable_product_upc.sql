alter table public.products
alter column upc drop not null;

do $$
declare
  cleanup_assignments text[] := array['upc = nullif(btrim(upc), '''')'];
  identifier_checks text[] := array['nullif(btrim(coalesce(upc, '''')), '''') is not null'];
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'plu'
  ) then
    cleanup_assignments := cleanup_assignments || 'plu = nullif(btrim(plu), '''')';
    identifier_checks := identifier_checks || 'nullif(btrim(coalesce(plu, '''')), '''') is not null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'product_code'
  ) then
    cleanup_assignments := cleanup_assignments || 'product_code = nullif(btrim(product_code), '''')';
    identifier_checks := identifier_checks || 'nullif(btrim(coalesce(product_code, '''')), '''') is not null';
  end if;

  execute format(
    'update public.products set %s',
    array_to_string(cleanup_assignments, ', ')
  );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_identifier_required'
      and conrelid = 'public.products'::regclass
  ) then
    execute format(
      'alter table public.products add constraint products_identifier_required check (%s)',
      array_to_string(identifier_checks, ' or ')
    );
  end if;
end $$;

drop index if exists public.products_store_upc_unique;

notify pgrst, 'reload schema';
