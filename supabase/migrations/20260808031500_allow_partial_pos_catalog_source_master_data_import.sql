-- Allow the Commander master-data importer to stage the proven core datasets
-- (pos_config + tax_rate_config) without treating unobserved optional age/restriction
-- datasets as empty. Optional datasets remain untouched until they are explicitly supplied.

alter table public.pos_catalog_source_master_data_runs
  add column restrictions_available boolean,
  add column age_validation_available boolean,
  add column age_service_available boolean;

update public.pos_catalog_source_master_data_runs
set restrictions_available = true,
    age_validation_available = true,
    age_service_available = true
where restrictions_available is null
   or age_validation_available is null
   or age_service_available is null;

alter table public.pos_catalog_source_master_data_runs
  alter column restrictions_available set not null,
  alter column restrictions_available set default false,
  alter column age_validation_available set not null,
  alter column age_validation_available set default false,
  alter column age_service_available set not null,
  alter column age_service_available set default false,
  alter column restrictions_normalized_sha256 drop not null,
  alter column age_validation_normalized_sha256 drop not null,
  alter column age_service_normalized_sha256 drop not null,
  alter column age_validation_count drop not null,
  alter column department_age_validation_link_count drop not null,
  alter column restrictions_summary drop not null;

alter table public.pos_catalog_source_master_data_runs
  drop constraint pos_catalog_source_master_data_runs_counts_check,
  drop constraint pos_catalog_source_master_data_runs_restrictions_object_check;

alter table public.pos_catalog_source_master_data_runs
  add constraint pos_catalog_source_master_data_runs_counts_check
    check (
      department_count >= 0
      and category_count >= 0
      and product_code_count >= 0
      and tax_definition_count >= 0
      and department_tax_link_count >= 0
      and (
        (age_validation_available and age_validation_count >= 0 and department_age_validation_link_count >= 0)
        or (not age_validation_available and age_validation_count is null and department_age_validation_link_count is null)
      )
    ),
  add constraint pos_catalog_source_master_data_runs_optional_sources_check
    check (
      (
        restrictions_available
        and restrictions_normalized_sha256 ~ '^[0-9a-f]{64}$'
        and jsonb_typeof(restrictions_summary) = 'object'
      ) or (
        not restrictions_available
        and restrictions_normalized_sha256 is null
        and restrictions_summary is null
      )
    ),
  add constraint pos_catalog_source_master_data_runs_optional_age_check
    check (
      (age_validation_available and age_validation_normalized_sha256 ~ '^[0-9a-f]{64}$')
      or (not age_validation_available and age_validation_normalized_sha256 is null)
    ),
  add constraint pos_catalog_source_master_data_runs_optional_age_service_check
    check (
      (age_service_available and age_service_normalized_sha256 ~ '^[0-9a-f]{64}$')
      or (not age_service_available and age_service_normalized_sha256 is null)
    );

create or replace function public.import_pos_catalog_source_master_data_snapshot(
  p_import_run jsonb,
  p_categories jsonb,
  p_product_codes jsonb,
  p_department_definitions jsonb,
  p_tax_definitions jsonb,
  p_age_validations jsonb,
  p_age_service_setting jsonb,
  p_department_tax_links jsonb,
  p_department_age_validation_links jsonb
)
returns table (
  master_data_run_id uuid,
  master_data_run_reused boolean,
  department_count integer,
  category_count integer,
  product_code_count integer,
  tax_definition_count integer,
  age_validation_count integer,
  department_tax_link_count integer,
  department_age_validation_link_count integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_meta record;
  v_run public.pos_catalog_source_master_data_runs%rowtype;
begin
  if jsonb_typeof(p_import_run) <> 'object'
    or jsonb_typeof(p_categories) <> 'array'
    or jsonb_typeof(p_product_codes) <> 'array'
    or jsonb_typeof(p_department_definitions) <> 'array'
    or jsonb_typeof(p_tax_definitions) <> 'array'
    or jsonb_typeof(p_department_tax_links) <> 'array' then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  select * into v_meta
  from jsonb_to_record(p_import_run) as value(
    store_id uuid,
    source_system text,
    source_site text,
    master_data_payload_sha256 text,
    pos_config_normalized_sha256 text,
    tax_rate_normalized_sha256 text,
    restrictions_available boolean,
    restrictions_normalized_sha256 text,
    age_validation_available boolean,
    age_validation_normalized_sha256 text,
    age_service_available boolean,
    age_service_normalized_sha256 text,
    collected_at timestamptz,
    department_count integer,
    category_count integer,
    product_code_count integer,
    tax_definition_count integer,
    age_validation_count integer,
    department_tax_link_count integer,
    department_age_validation_link_count integer,
    restrictions_summary jsonb
  );

  if v_meta.store_id is null
    or v_meta.source_system is null or v_meta.source_system !~ '^[a-z][a-z0-9_]{0,63}$'
    or v_meta.source_site is null or char_length(v_meta.source_site) not between 1 and 64
    or v_meta.master_data_payload_sha256 is null or v_meta.master_data_payload_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.pos_config_normalized_sha256 is null or v_meta.pos_config_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.tax_rate_normalized_sha256 is null or v_meta.tax_rate_normalized_sha256 !~ '^[0-9a-f]{64}$'
    or v_meta.restrictions_available is null
    or v_meta.age_validation_available is null
    or v_meta.age_service_available is null
    or v_meta.collected_at is null
    or v_meta.department_count < 0 or v_meta.department_count <> jsonb_array_length(p_department_definitions)
    or v_meta.category_count < 0 or v_meta.category_count <> jsonb_array_length(p_categories)
    or v_meta.product_code_count < 0 or v_meta.product_code_count <> jsonb_array_length(p_product_codes)
    or v_meta.tax_definition_count < 0 or v_meta.tax_definition_count <> jsonb_array_length(p_tax_definitions)
    or v_meta.department_tax_link_count < 0 or v_meta.department_tax_link_count <> jsonb_array_length(p_department_tax_links)
    or v_meta.department_count > 50000 or v_meta.category_count > 50000 or v_meta.product_code_count > 50000
    or v_meta.tax_definition_count > 50000 or v_meta.department_tax_link_count > 50000 then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if v_meta.restrictions_available then
    if v_meta.restrictions_normalized_sha256 is null
      or v_meta.restrictions_normalized_sha256 !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(v_meta.restrictions_summary) is distinct from 'object'
      or jsonb_typeof(v_meta.restrictions_summary -> 'age_validation_count') is distinct from 'number'
      or jsonb_typeof(v_meta.restrictions_summary -> 'blue_laws_container_present') is distinct from 'boolean'
      or jsonb_typeof(v_meta.restrictions_summary -> 'plu_promos_container_present') is distinct from 'boolean' then
      raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
    end if;
  elsif v_meta.restrictions_normalized_sha256 is not null or v_meta.restrictions_summary is not null then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if v_meta.age_validation_available then
    if v_meta.age_validation_normalized_sha256 is null
      or v_meta.age_validation_normalized_sha256 !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_age_validations) is distinct from 'array'
      or jsonb_typeof(p_department_age_validation_links) is distinct from 'array'
      or v_meta.age_validation_count < 0
      or v_meta.age_validation_count <> jsonb_array_length(p_age_validations)
      or v_meta.department_age_validation_link_count < 0
      or v_meta.department_age_validation_link_count <> jsonb_array_length(p_department_age_validation_links)
      or v_meta.age_validation_count > 50000
      or v_meta.department_age_validation_link_count > 50000 then
      raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
    end if;
  elsif v_meta.age_validation_normalized_sha256 is not null
    or v_meta.age_validation_count is not null
    or v_meta.department_age_validation_link_count is not null
    or p_age_validations is not null
    or p_department_age_validation_links is not null then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if v_meta.age_service_available then
    if v_meta.age_service_normalized_sha256 is null
      or v_meta.age_service_normalized_sha256 !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_age_service_setting) is distinct from 'object' then
      raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
    end if;
  elsif v_meta.age_service_normalized_sha256 is not null or p_age_service_setting is not null then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  perform 1 from public.stores s where s.id = v_meta.store_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'master_data_import_store_invalid';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_categories) x(source_category_key text)
    group by x.source_category_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_product_codes) x(source_product_code_key text)
    group by x.source_product_code_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_department_definitions) x(source_department_key text)
    group by x.source_department_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tax_definitions) x(source_tax_key text)
    group by x.source_tax_key having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_department_tax_links) x(source_department_key text, source_tax_key text)
    group by x.source_department_key, x.source_tax_key having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if v_meta.age_validation_available and (
    exists (
      select 1 from jsonb_to_recordset(p_age_validations) x(source_age_validation_key text)
      group by x.source_age_validation_key having count(*) > 1
    ) or exists (
      select 1 from jsonb_to_recordset(p_department_age_validation_links) x(source_department_key text, source_age_validation_key text)
      group by x.source_department_key, x.source_age_validation_key having count(*) > 1
    )
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_categories) x(
      source_category_key text, source_name text, source_values jsonb,
      normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_category_key is null or char_length(x.source_category_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) or exists (
    select 1
    from jsonb_to_recordset(p_product_codes) x(
      source_product_code_key text, source_name text, is_not_sold boolean, is_fuel boolean,
      source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_product_code_key is null or char_length(x.source_product_code_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or x.is_not_sold is null or x.is_fuel is null
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) or exists (
    select 1
    from jsonb_to_recordset(p_department_definitions) x(
      source_department_key text, source_name text, source_category_key text,
      source_product_code_key text, source_values jsonb, normalized_observation_hash text,
      observed_at timestamptz, is_present boolean
    )
    where x.source_department_key is null or char_length(x.source_department_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or x.source_category_key is null or char_length(x.source_category_key) not between 1 and 64
      or x.source_product_code_key is null or char_length(x.source_product_code_key) not between 1 and 64
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) or exists (
    select 1
    from jsonb_to_recordset(p_tax_definitions) x(
      source_tax_key text, source_name text, source_indicator text,
      source_price_includes_tax boolean, source_prompt_exemption boolean,
      source_rate text, source_percent_start_amount text, source_values jsonb,
      normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_tax_key is null or char_length(x.source_tax_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or (x.source_indicator is not null and char_length(x.source_indicator) not between 1 and 64)
      or x.source_price_includes_tax is null or x.source_prompt_exemption is null
      or x.source_rate is null or x.source_rate !~ '^[0-9]{1,18}(?:\.[0-9]{1,8})?$'
      or x.source_percent_start_amount is null or x.source_percent_start_amount !~ '^[0-9]{1,18}(?:\.[0-9]{1,8})?$'
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if v_meta.age_validation_available and exists (
    select 1
    from jsonb_to_recordset(p_age_validations) x(
      source_age_validation_key text, source_name text, source_min_age text,
      source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    where x.source_age_validation_key is null or char_length(x.source_age_validation_key) not between 1 and 64
      or x.source_name is null or char_length(x.source_name) not between 1 and 512
      or (x.source_min_age is not null and x.source_min_age !~ '^[0-9]{1,9}$')
      or jsonb_typeof(x.source_values) is distinct from 'object'
      or x.normalized_observation_hash !~ '^[0-9a-f]{64}$'
      or x.observed_at is distinct from v_meta.collected_at or x.is_present is not true
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if v_meta.age_service_available and not exists (
    select 1
    from jsonb_to_record(p_age_service_setting) x(
      enabled boolean, source_values jsonb, normalized_observation_hash text,
      observed_at timestamptz, is_present boolean
    )
    where x.enabled is not null
      and jsonb_typeof(x.source_values) = 'object'
      and x.normalized_observation_hash ~ '^[0-9a-f]{64}$'
      and x.observed_at is not distinct from v_meta.collected_at
      and x.is_present is true
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_department_definitions) d(source_category_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_categories) c(source_category_key text)
      where c.source_category_key = d.source_category_key
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_department_definitions) d(source_product_code_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_product_codes) p(source_product_code_key text)
      where p.source_product_code_key = d.source_product_code_key
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_department_tax_links) l(source_department_key text, source_tax_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_department_definitions) d(source_department_key text)
      where d.source_department_key = l.source_department_key
    ) or not exists (
      select 1 from jsonb_to_recordset(p_tax_definitions) t(source_tax_key text)
      where t.source_tax_key = l.source_tax_key
    )
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_relationship_invalid';
  end if;

  if v_meta.age_validation_available and exists (
    select 1
    from jsonb_to_recordset(p_department_age_validation_links) l(source_department_key text, source_age_validation_key text)
    where not exists (
      select 1 from jsonb_to_recordset(p_department_definitions) d(source_department_key text)
      where d.source_department_key = l.source_department_key
    ) or not exists (
      select 1 from jsonb_to_recordset(p_age_validations) a(source_age_validation_key text)
      where a.source_age_validation_key = l.source_age_validation_key
    )
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_relationship_invalid';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_department_tax_links)
      x(source_department_key text, source_tax_key text, observed_at timestamptz)
    where x.observed_at is distinct from v_meta.collected_at
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  if v_meta.age_validation_available and exists (
    select 1 from jsonb_to_recordset(p_department_age_validation_links)
      x(source_department_key text, source_age_validation_key text, observed_at timestamptz)
    where x.observed_at is distinct from v_meta.collected_at
  ) then
    raise exception using errcode = 'P0001', message = 'master_data_import_invalid';
  end if;

  insert into public.pos_catalog_source_master_data_runs (
    store_id, source_system, source_site, master_data_payload_sha256,
    pos_config_normalized_sha256, tax_rate_normalized_sha256,
    restrictions_available, restrictions_normalized_sha256,
    age_validation_available, age_validation_normalized_sha256,
    age_service_available, age_service_normalized_sha256,
    collected_at, department_count, category_count, product_code_count,
    tax_definition_count, age_validation_count, department_tax_link_count,
    department_age_validation_link_count, restrictions_summary
  ) values (
    v_meta.store_id, v_meta.source_system, v_meta.source_site, v_meta.master_data_payload_sha256,
    v_meta.pos_config_normalized_sha256, v_meta.tax_rate_normalized_sha256,
    v_meta.restrictions_available, v_meta.restrictions_normalized_sha256,
    v_meta.age_validation_available, v_meta.age_validation_normalized_sha256,
    v_meta.age_service_available, v_meta.age_service_normalized_sha256,
    v_meta.collected_at, v_meta.department_count, v_meta.category_count,
    v_meta.product_code_count, v_meta.tax_definition_count, v_meta.age_validation_count,
    v_meta.department_tax_link_count, v_meta.department_age_validation_link_count,
    v_meta.restrictions_summary
  )
  on conflict (store_id, source_system, master_data_payload_sha256, collected_at) do nothing
  returning * into v_run;

  if not found then
    select * into v_run
    from public.pos_catalog_source_master_data_runs r
    where r.store_id = v_meta.store_id
      and r.source_system = v_meta.source_system
      and r.master_data_payload_sha256 = v_meta.master_data_payload_sha256
      and r.collected_at = v_meta.collected_at
    for update;

    if not found
      or v_run.source_site is distinct from v_meta.source_site
      or v_run.pos_config_normalized_sha256 is distinct from v_meta.pos_config_normalized_sha256
      or v_run.tax_rate_normalized_sha256 is distinct from v_meta.tax_rate_normalized_sha256
      or v_run.restrictions_available is distinct from v_meta.restrictions_available
      or v_run.restrictions_normalized_sha256 is distinct from v_meta.restrictions_normalized_sha256
      or v_run.age_validation_available is distinct from v_meta.age_validation_available
      or v_run.age_validation_normalized_sha256 is distinct from v_meta.age_validation_normalized_sha256
      or v_run.age_service_available is distinct from v_meta.age_service_available
      or v_run.age_service_normalized_sha256 is distinct from v_meta.age_service_normalized_sha256
      or v_run.department_count is distinct from v_meta.department_count
      or v_run.category_count is distinct from v_meta.category_count
      or v_run.product_code_count is distinct from v_meta.product_code_count
      or v_run.tax_definition_count is distinct from v_meta.tax_definition_count
      or v_run.age_validation_count is distinct from v_meta.age_validation_count
      or v_run.department_tax_link_count is distinct from v_meta.department_tax_link_count
      or v_run.department_age_validation_link_count is distinct from v_meta.department_age_validation_link_count
      or v_run.restrictions_summary is distinct from v_meta.restrictions_summary then
      raise exception using errcode = 'P0001', message = 'master_data_import_conflict';
    end if;

    return query select
      v_run.id, true, v_run.department_count, v_run.category_count,
      v_run.product_code_count, v_run.tax_definition_count, v_run.age_validation_count,
      v_run.department_tax_link_count, v_run.department_age_validation_link_count;
    return;
  end if;

  insert into public.pos_catalog_source_categories (
    store_id, source_system, source_category_key, source_name, source_values,
    normalized_observation_hash, first_master_data_run_id, last_master_data_run_id,
    first_observed_at, last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_category_key, x.source_name,
    x.source_values, x.normalized_observation_hash, v_run.id, v_run.id,
    x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_categories) x(
    source_category_key text, source_name text, source_values jsonb,
    normalized_observation_hash text, observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_category_key) do update
  set source_name = excluded.source_name,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_categories.last_observed_at;

  update public.pos_catalog_source_categories c
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where c.store_id = v_meta.store_id and c.source_system = v_meta.source_system
    and c.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_categories) x(source_category_key text)
      where x.source_category_key = c.source_category_key
    );

  insert into public.pos_catalog_source_product_codes (
    store_id, source_system, source_product_code_key, source_name, is_not_sold, is_fuel,
    source_values, normalized_observation_hash, first_master_data_run_id, last_master_data_run_id,
    first_observed_at, last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_product_code_key, x.source_name,
    x.is_not_sold, x.is_fuel, x.source_values, x.normalized_observation_hash,
    v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_product_codes) x(
    source_product_code_key text, source_name text, is_not_sold boolean, is_fuel boolean,
    source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_product_code_key) do update
  set source_name = excluded.source_name,
      is_not_sold = excluded.is_not_sold,
      is_fuel = excluded.is_fuel,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_product_codes.last_observed_at;

  update public.pos_catalog_source_product_codes p
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where p.store_id = v_meta.store_id and p.source_system = v_meta.source_system
    and p.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_product_codes) x(source_product_code_key text)
      where x.source_product_code_key = p.source_product_code_key
    );

  insert into public.pos_catalog_source_tax_definitions (
    store_id, source_system, source_tax_key, source_name, source_indicator,
    source_price_includes_tax, source_prompt_exemption, source_rate,
    source_percent_start_amount, source_values, normalized_observation_hash,
    first_master_data_run_id, last_master_data_run_id, first_observed_at,
    last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_tax_key, x.source_name,
    x.source_indicator, x.source_price_includes_tax, x.source_prompt_exemption,
    x.source_rate::numeric, x.source_percent_start_amount::numeric, x.source_values,
    x.normalized_observation_hash, v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_tax_definitions) x(
    source_tax_key text, source_name text, source_indicator text,
    source_price_includes_tax boolean, source_prompt_exemption boolean,
    source_rate text, source_percent_start_amount text, source_values jsonb,
    normalized_observation_hash text, observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_tax_key) do update
  set source_name = excluded.source_name,
      source_indicator = excluded.source_indicator,
      source_price_includes_tax = excluded.source_price_includes_tax,
      source_prompt_exemption = excluded.source_prompt_exemption,
      source_rate = excluded.source_rate,
      source_percent_start_amount = excluded.source_percent_start_amount,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_tax_definitions.last_observed_at;

  update public.pos_catalog_source_tax_definitions t
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where t.store_id = v_meta.store_id and t.source_system = v_meta.source_system
    and t.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_tax_definitions) x(source_tax_key text)
      where x.source_tax_key = t.source_tax_key
    );

  if v_meta.age_validation_available then
    insert into public.pos_catalog_source_age_validations (
      store_id, source_system, source_age_validation_key, source_name, source_min_age,
      source_values, normalized_observation_hash, first_master_data_run_id,
      last_master_data_run_id, first_observed_at, last_observed_at, is_present
    )
    select v_meta.store_id, v_meta.source_system, x.source_age_validation_key, x.source_name,
      case when x.source_min_age is null then null else x.source_min_age::integer end,
      x.source_values, x.normalized_observation_hash, v_run.id, v_run.id,
      x.observed_at, x.observed_at, true
    from jsonb_to_recordset(p_age_validations) x(
      source_age_validation_key text, source_name text, source_min_age text,
      source_values jsonb, normalized_observation_hash text, observed_at timestamptz, is_present boolean
    )
    on conflict (store_id, source_system, source_age_validation_key) do update
    set source_name = excluded.source_name,
        source_min_age = excluded.source_min_age,
        source_values = excluded.source_values,
        normalized_observation_hash = excluded.normalized_observation_hash,
        last_master_data_run_id = excluded.last_master_data_run_id,
        last_observed_at = excluded.last_observed_at,
        is_present = true
    where excluded.last_observed_at >= pos_catalog_source_age_validations.last_observed_at;

    update public.pos_catalog_source_age_validations a
    set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
    where a.store_id = v_meta.store_id and a.source_system = v_meta.source_system
      and a.last_observed_at <= v_meta.collected_at
      and not exists (
        select 1 from jsonb_to_recordset(p_age_validations) x(source_age_validation_key text)
        where x.source_age_validation_key = a.source_age_validation_key
      );
  end if;

  insert into public.pos_catalog_source_department_definitions (
    store_id, source_system, source_department_key, source_name, source_category_key,
    source_product_code_key, source_values, normalized_observation_hash,
    first_master_data_run_id, last_master_data_run_id, first_observed_at,
    last_observed_at, is_present
  )
  select v_meta.store_id, v_meta.source_system, x.source_department_key, x.source_name,
    x.source_category_key, x.source_product_code_key, x.source_values,
    x.normalized_observation_hash, v_run.id, v_run.id, x.observed_at, x.observed_at, true
  from jsonb_to_recordset(p_department_definitions) x(
    source_department_key text, source_name text, source_category_key text,
    source_product_code_key text, source_values jsonb, normalized_observation_hash text,
    observed_at timestamptz, is_present boolean
  )
  on conflict (store_id, source_system, source_department_key) do update
  set source_name = excluded.source_name,
      source_category_key = excluded.source_category_key,
      source_product_code_key = excluded.source_product_code_key,
      source_values = excluded.source_values,
      normalized_observation_hash = excluded.normalized_observation_hash,
      last_master_data_run_id = excluded.last_master_data_run_id,
      last_observed_at = excluded.last_observed_at,
      is_present = true
  where excluded.last_observed_at >= pos_catalog_source_department_definitions.last_observed_at;

  update public.pos_catalog_source_department_definitions d
  set last_master_data_run_id = v_run.id, last_observed_at = v_meta.collected_at, is_present = false
  where d.store_id = v_meta.store_id and d.source_system = v_meta.source_system
    and d.last_observed_at <= v_meta.collected_at
    and not exists (
      select 1 from jsonb_to_recordset(p_department_definitions) x(source_department_key text)
      where x.source_department_key = d.source_department_key
    );

  if v_meta.age_service_available then
    insert into public.pos_catalog_source_age_service_settings (
      store_id, source_system, enabled, source_values, normalized_observation_hash,
      first_master_data_run_id, last_master_data_run_id, first_observed_at,
      last_observed_at, is_present
    )
    select v_meta.store_id, v_meta.source_system, x.enabled, x.source_values,
      x.normalized_observation_hash, v_run.id, v_run.id, x.observed_at, x.observed_at, true
    from jsonb_to_record(p_age_service_setting) x(
      enabled boolean, source_values jsonb, normalized_observation_hash text,
      observed_at timestamptz, is_present boolean
    )
    on conflict (store_id, source_system) do update
    set enabled = excluded.enabled,
        source_values = excluded.source_values,
        normalized_observation_hash = excluded.normalized_observation_hash,
        last_master_data_run_id = excluded.last_master_data_run_id,
        last_observed_at = excluded.last_observed_at,
        is_present = true
    where excluded.last_observed_at >= pos_catalog_source_age_service_settings.last_observed_at;
  end if;

  delete from public.pos_catalog_source_department_tax_links l
  where l.store_id = v_meta.store_id and l.source_system = v_meta.source_system;

  insert into public.pos_catalog_source_department_tax_links (
    store_id, source_system, source_department_key, source_tax_key, master_data_run_id, observed_at
  )
  select v_meta.store_id, v_meta.source_system, x.source_department_key,
    x.source_tax_key, v_run.id, x.observed_at
  from jsonb_to_recordset(p_department_tax_links) x(
    source_department_key text, source_tax_key text, observed_at timestamptz
  );

  if v_meta.age_validation_available then
    delete from public.pos_catalog_source_department_age_validation_links l
    where l.store_id = v_meta.store_id and l.source_system = v_meta.source_system;

    insert into public.pos_catalog_source_department_age_validation_links (
      store_id, source_system, source_department_key, source_age_validation_key,
      master_data_run_id, observed_at
    )
    select v_meta.store_id, v_meta.source_system, x.source_department_key,
      x.source_age_validation_key, v_run.id, x.observed_at
    from jsonb_to_recordset(p_department_age_validation_links) x(
      source_department_key text, source_age_validation_key text, observed_at timestamptz
    );
  end if;

  return query select
    v_run.id, false, v_meta.department_count, v_meta.category_count,
    v_meta.product_code_count, v_meta.tax_definition_count, v_meta.age_validation_count,
    v_meta.department_tax_link_count, v_meta.department_age_validation_link_count;
end;
$function$;

revoke all on function public.import_pos_catalog_source_master_data_snapshot(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.import_pos_catalog_source_master_data_snapshot(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;
