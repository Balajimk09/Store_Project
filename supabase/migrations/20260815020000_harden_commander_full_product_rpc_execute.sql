-- Harden execute privileges for the full Commander product RPC surface.
-- This migration intentionally changes grants only; function bodies remain intact.

revoke all on function public.request_commander_product_update(
  uuid, uuid,
  text, text,
  text, text,
  numeric, numeric,
  text, text,
  text, text,
  text, text,
  text, text,
  text[], text[],
  text[], text[],
  text
) from public, anon;

grant execute on function public.request_commander_product_update(
  uuid, uuid,
  text, text,
  text, text,
  numeric, numeric,
  text, text,
  text, text,
  text, text,
  text, text,
  text[], text[],
  text[], text[],
  text
) to authenticated, service_role;

revoke all on function public.commander_effective_full_product_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.commander_effective_full_product_state(uuid, uuid)
  to service_role;

revoke all on function public.get_commander_full_product_context(uuid, uuid)
  from public, anon;
grant execute on function public.get_commander_full_product_context(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
