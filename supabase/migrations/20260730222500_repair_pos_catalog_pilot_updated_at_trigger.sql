-- Repair the catalog pilot updated_at triggers on databases where the
-- original staging migration was already applied.
--
-- This migration is additive. It does not read or modify catalog rows,
-- product rows, Commander state, connector state, or publishing settings.

create or replace function public.set_pos_catalog_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$function$;

revoke all on function public.set_pos_catalog_updated_at()
  from public, anon, authenticated;

grant execute on function public.set_pos_catalog_updated_at()
  to service_role;

drop trigger if exists pos_catalog_sync_runs_set_updated_at
  on public.pos_catalog_sync_runs;

create trigger pos_catalog_sync_runs_set_updated_at
before update on public.pos_catalog_sync_runs
for each row execute function public.set_pos_catalog_updated_at();

drop trigger if exists pos_catalog_sync_items_set_updated_at
  on public.pos_catalog_sync_items;

create trigger pos_catalog_sync_items_set_updated_at
before update on public.pos_catalog_sync_items
for each row execute function public.set_pos_catalog_updated_at();

drop trigger if exists product_source_identities_set_updated_at
  on public.product_source_identities;

create trigger product_source_identities_set_updated_at
before update on public.product_source_identities
for each row execute function public.set_pos_catalog_updated_at();
