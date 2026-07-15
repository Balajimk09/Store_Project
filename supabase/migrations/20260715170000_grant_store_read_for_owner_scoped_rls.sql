-- Allow authenticated owner-scoped child-table RLS policies to inspect parent stores.
-- Row visibility remains constrained by the existing stores RLS policies.
grant select on table public.stores to authenticated;

-- Allow backend service-role heartbeat writers to update connector status.
grant select, update on table public.store_pos_connectors to service_role;

notify pgrst, 'reload schema';
