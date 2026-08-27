-- Trigger helpers are invoked by the table trigger, not by application RPC
-- callers. Remove the default direct function-execute surface.
revoke all on function public.enforce_live_catalog_source_observation_writer()
  from public, anon, authenticated, service_role;
