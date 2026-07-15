alter function public.activate_pos_connector(text, text, text) owner to postgres;
revoke all on function public.activate_pos_connector(text, text, text) from public;
revoke all on function public.activate_pos_connector(text, text, text) from anon;
revoke all on function public.activate_pos_connector(text, text, text) from authenticated;
grant execute on function public.activate_pos_connector(text, text, text) to service_role;
;
