-- Restore the legacy updated_at trigger helper required by the initial
-- POS catalog staging migration when rebuilding StorePulse from migration history.
--
-- This matches the helper present in the existing StorePulse database.
-- It does not modify product data or enable POS publishing.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;