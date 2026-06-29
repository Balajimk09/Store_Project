alter table public.products
alter column upc drop not null;

update public.products
set
  upc = nullif(btrim(upc), ''),
  plu = nullif(btrim(plu), ''),
  product_code = nullif(btrim(product_code), '');

drop index if exists public.products_store_upc_unique;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_identifier_required'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
    add constraint products_identifier_required
    check (
      nullif(btrim(coalesce(upc, '')), '') is not null
      or nullif(btrim(coalesce(plu, '')), '') is not null
      or nullif(btrim(coalesce(product_code, '')), '') is not null
    );
  end if;
end $$;

notify pgrst, 'reload schema';
