-- The live predecessor contains promote_commander_master_data_mappings with
-- min(uuid) aggregate calls. PostgreSQL does not provide min(uuid), so replace
-- only those two first-value expressions while preserving its ambiguity checks.
do $do$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.promote_commander_master_data_mappings(uuid,uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  if position('min(m.canonical_tax_category_id)' in v_definition) = 0
    or position('min(m.canonical_age_restriction_id)' in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'master_data_mapping_uuid_aggregate_predecessor_invalid';
  end if;

  v_definition := replace(
    v_definition,
    'min(m.canonical_tax_category_id)',
    '(array_agg(m.canonical_tax_category_id order by m.canonical_tax_category_id))[1]'
  );
  v_definition := replace(
    v_definition,
    'min(m.canonical_age_restriction_id)',
    '(array_agg(m.canonical_age_restriction_id order by m.canonical_age_restriction_id))[1]'
  );

  execute v_definition;
end;
$do$;
