-- Production-safe equivalent of the merged compatibility migration.
-- Existing StorePulse production uses item_name directly and has no legacy name column.

alter table public.products
  add column if not exists item_name text,
  add column if not exists department text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'name'
  ) then
    execute $sql$
      update public.products
      set item_name = nullif(btrim(name), '')
      where item_name is null
        and name is not null
    $sql$;
  end if;
end;
$$;

notify pgrst, 'reload schema';;
