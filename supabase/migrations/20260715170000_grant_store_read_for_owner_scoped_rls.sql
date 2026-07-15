-- Allow authenticated owner-scoped child-table RLS policies to inspect parent stores.
-- Row visibility remains constrained by the existing stores RLS policies.
grant select on table public.stores to authenticated;

notify pgrst, 'reload schema';
