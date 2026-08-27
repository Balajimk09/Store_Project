-- Store-scoped, native-simple Commander product creation. This migration stores
-- normalized data only: no XML, endpoint, cookie, credential, or session data.

create or replace function public.pos_commander_sysid_json_array_is_valid(p_values jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p_values) = 'array'
    and jsonb_array_length(p_values) between 1 and 16
    and not exists (select 1 from jsonb_array_elements_text(p_values) value where value !~ '^[0-9]{1,16}$')
    and (select count(*) from (select distinct value from jsonb_array_elements_text(p_values) value) unique_values) = jsonb_array_length(p_values);
$$;

create table if not exists public.pos_source_create_profiles (
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null,
  create_profile_version text not null,
  default_flag_sysids jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, source_system),
  constraint pos_source_create_profiles_source_system_check check (source_system ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_source_create_profiles_version_check check (create_profile_version ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint pos_source_create_profiles_flags_check check (
    public.pos_commander_sysid_json_array_is_valid(default_flag_sysids)
  )
);

create trigger pos_source_create_profiles_set_updated_at
before update on public.pos_source_create_profiles
for each row execute function public.set_updated_at();

alter table public.pos_source_create_profiles enable row level security;
revoke all on table public.pos_source_create_profiles from public, anon, authenticated;
grant all on table public.pos_source_create_profiles to service_role;

insert into public.pos_source_create_profiles (store_id, source_system, create_profile_version, default_flag_sysids)
values ('ec192877-0156-42ab-8fbf-31105f3e2ea3', 'commander', 'native_simple_create_v1', '["1", "5"]'::jsonb)
on conflict (store_id, source_system) do nothing;

alter table public.pos_publish_jobs drop constraint if exists pos_publish_jobs_operation_check;
alter table public.pos_publish_jobs add constraint pos_publish_jobs_operation_check
  check (operation::text in ('update_price', 'update_product', 'create_product'));

alter table public.pos_publish_jobs drop constraint if exists pos_publish_jobs_full_product_contract_check;
alter table public.pos_publish_jobs add constraint pos_publish_jobs_full_product_contract_check check (
  (
    operation::text in ('update_price', 'create_product')
    and expected_payment_product_code is null
    and requested_payment_product_code is null
    and expected_selling_unit is null
    and requested_selling_unit is null
    and expected_max_qty_per_trans is null
    and requested_max_qty_per_trans is null
    and expected_taxable_rebate is null
    and requested_taxable_rebate is null
    and expected_tax_rate_ids is null
    and requested_tax_rate_ids is null
    and expected_id_check_ids is null
    and requested_id_check_ids is null
  )
  or
  (
    operation::text = 'update_product'
    and (
      (
        expected_payment_product_code is null
        and requested_payment_product_code is null
        and expected_selling_unit is null
        and requested_selling_unit is null
        and expected_max_qty_per_trans is null
        and requested_max_qty_per_trans is null
        and expected_taxable_rebate is null
        and requested_taxable_rebate is null
        and expected_tax_rate_ids is null
        and requested_tax_rate_ids is null
        and expected_id_check_ids is null
        and requested_id_check_ids is null
      )
      or
      (
        expected_payment_product_code ~ '^[0-9]{1,16}$'
        and requested_payment_product_code ~ '^[0-9]{1,16}$'
        and expected_selling_unit ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'
        and requested_selling_unit ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'
        and expected_max_qty_per_trans ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
        and requested_max_qty_per_trans ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
        and expected_taxable_rebate ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
        and requested_taxable_rebate ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
        and public.pos_publish_commander_sysid_array_is_valid(expected_tax_rate_ids)
        and public.pos_publish_commander_sysid_array_is_valid(requested_tax_rate_ids)
        and public.pos_publish_commander_sysid_array_is_valid(expected_id_check_ids)
        and public.pos_publish_commander_sysid_array_is_valid(requested_id_check_ids)
      )
    )
  )
);

create or replace function public.pos_publish_payload_is_valid(
  p_operation public.pos_publish_job_operation, p_payload jsonb, p_expected_price numeric, p_requested_price numeric
) returns boolean language sql immutable set search_path = pg_catalog as $$
  select case
    when p_operation::text = 'create_product' then
      jsonb_typeof(p_payload) = 'object'
      and p_payload ?& array['create_profile_version','upc','modifier','description','department','price','payment_product_code','selling_unit','max_qty_per_trans','taxable_rebate','tax_rate_ids','id_check_ids','flag_ids']
      and (
        select count(*)
        from pg_catalog.jsonb_object_keys(
          case
            when pg_catalog.jsonb_typeof(p_payload) = 'object' then p_payload
            else '{}'::jsonb
          end
        )
      ) = 13
      and jsonb_typeof(p_payload->'create_profile_version') = 'string'
      and p_payload->>'upc' ~ '^[0-9]{14}$'
      and p_payload->>'modifier' ~ '^[0-9]{3}$'
      and char_length(p_payload->>'description') between 1 and 512 and p_payload->>'description' !~ '[[:cntrl:]]'
      and p_payload->>'department' ~ '^[0-9]{1,16}$'
      and p_payload->>'payment_product_code' ~ '^[0-9]{1,16}$'
      and p_payload->>'selling_unit' ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$'
      and p_payload->>'max_qty_per_trans' ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
      and p_payload->>'taxable_rebate' ~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$'
      and public.pos_publish_commander_sysid_array_is_valid(array(select jsonb_array_elements_text(p_payload->'tax_rate_ids')))
      and public.pos_publish_commander_sysid_array_is_valid(array(select jsonb_array_elements_text(p_payload->'id_check_ids')))
      and public.pos_publish_commander_sysid_array_is_valid(array(select jsonb_array_elements_text(p_payload->'flag_ids')))
      and jsonb_array_length(p_payload->'tax_rate_ids') > 0 and jsonb_array_length(p_payload->'id_check_ids') > 0 and jsonb_array_length(p_payload->'flag_ids') > 0
      and p_expected_price = p_requested_price and p_requested_price > 0
    when p_operation::text = 'update_price' then
      jsonb_typeof(p_payload) = 'object'
      and p_payload = jsonb_build_object('price', p_requested_price)
    when p_operation::text = 'update_product' then
      jsonb_typeof(p_payload) = 'object'
      and jsonb_typeof(p_payload -> 'expected') = 'object'
      and jsonb_typeof(p_payload -> 'requested') = 'object'
      and jsonb_typeof(p_payload #> '{expected,description}') = 'string'
      and char_length(p_payload #>> '{expected,description}') between 1 and 512
      and (p_payload #>> '{expected,description}') !~ '[[:cntrl:]]'
      and jsonb_typeof(p_payload #> '{expected,department}') = 'string'
      and (p_payload #>> '{expected,department}') ~ '^[0-9]{1,16}$'
      and jsonb_typeof(p_payload #> '{requested,description}') = 'string'
      and char_length(p_payload #>> '{requested,description}') between 1 and 512
      and (p_payload #>> '{requested,description}') !~ '[[:cntrl:]]'
      and jsonb_typeof(p_payload #> '{requested,department}') = 'string'
      and (p_payload #>> '{requested,department}') ~ '^[0-9]{1,16}$'
      and jsonb_typeof(p_payload #> '{requested,department_name}') = 'string'
      and char_length(p_payload #>> '{requested,department_name}') between 1 and 256
      and (p_payload #>> '{requested,department_name}') !~ '[[:cntrl:]]'
      and p_payload = jsonb_build_object(
        'expected', jsonb_build_object(
          'description', p_payload #>> '{expected,description}',
          'department', p_payload #>> '{expected,department}',
          'price', p_expected_price
        ),
        'requested', jsonb_build_object(
          'description', p_payload #>> '{requested,description}',
          'department', p_payload #>> '{requested,department}',
          'department_name', p_payload #>> '{requested,department_name}',
          'price', p_requested_price
        )
      )
    else false end;
$$;

alter table public.pos_publish_jobs drop constraint if exists pos_publish_jobs_payload_check;
alter table public.pos_publish_jobs add constraint pos_publish_jobs_payload_check check (public.pos_publish_payload_is_valid(operation, payload, expected_price, requested_price));

drop index if exists public.pos_publish_jobs_one_active_commander_mutation_per_store_uidx;
create unique index pos_publish_jobs_one_active_commander_mutation_per_store_uidx on public.pos_publish_jobs (store_id)
where operation in ('update_price'::public.pos_publish_job_operation, 'update_product'::public.pos_publish_job_operation, 'create_product'::public.pos_publish_job_operation)
  and status in ('pending'::public.pos_publish_job_status, 'claimed'::public.pos_publish_job_status, 'sending'::public.pos_publish_job_status, 'verifying'::public.pos_publish_job_status);

-- Keep the existing lease behavior aligned with the new queue operation. A
-- stale create is terminally failed, never retried, because its write may have
-- reached Commander before the connector became unavailable.
create or replace function public.expire_stale_commander_publish_jobs_internal(
  p_store_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if p_store_id is null then
    raise exception using errcode = '22023', message = 'store id is required';
  end if;

  update public.pos_publish_jobs job
  set
    status = 'failed',
    failed_at = v_now,
    audit_metadata = jsonb_build_object('failure_code', 'job_expired')
  where job.store_id = p_store_id
    and job.operation::text in ('update_price', 'update_product', 'create_product')
    and (
      (job.status::text = 'pending' and job.updated_at < v_now - interval '60 minutes')
      or
      (job.status::text in ('claimed', 'sending', 'verifying') and job.updated_at < v_now - interval '30 minutes')
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.request_commander_product_create(
  p_store_id uuid, p_requested_by uuid, p_product_id uuid, p_upc text, p_modifier text, p_description text, p_price numeric,
  p_department_name text, p_payment_product_code text, p_selling_unit text, p_max_qty_per_trans text,
  p_taxable_rebate text, p_tax_rate_ids text[], p_id_check_ids text[], p_idempotency_key text
) returns table (job_id uuid, status text, expected_price text, requested_price text, created_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_connector_id uuid; v_count integer; v_department_count integer; v_department text; v_profile public.pos_source_create_profiles%rowtype; v_flags text[]; v_payload jsonb; v_job public.pos_publish_jobs%rowtype;
begin
  if p_requested_by is null or not exists (select 1 from public.stores where id=p_store_id and owner_id=p_requested_by) then raise exception using errcode='42501', message='store access denied'; end if;
  if p_upc !~ '^[0-9]{14}$' or p_modifier !~ '^[0-9]{3}$' or p_description is null or char_length(p_description) not between 1 and 512 or p_description ~ '[[:cntrl:]]' or p_price is null or p_price <= 0 or p_price > 999999.99 or p_price <> round(p_price,2) or p_payment_product_code !~ '^[0-9]{1,16}$' or p_selling_unit !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{3}$' or p_max_qty_per_trans !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or p_taxable_rebate !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or not public.pos_publish_commander_sysid_array_is_valid(p_tax_rate_ids) or not public.pos_publish_commander_sysid_array_is_valid(p_id_check_ids) or cardinality(p_tax_rate_ids)=0 or cardinality(p_id_check_ids)=0 or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' then raise exception using errcode='22023', message='commander_create_payload_invalid'; end if;
  if not exists (select 1 from public.products where id=p_product_id and store_id=p_store_id and upc=p_upc) then raise exception using errcode='22023', message='commander_create_payload_invalid'; end if;
  if exists (select 1 from public.product_source_identities where store_id=p_store_id and product_id=p_product_id and source_system='commander') then raise exception using errcode='23514', message='commander_create_payload_invalid'; end if;
  select count(*), min(mapping.source_key) into v_department_count, v_department from public.pos_catalog_source_master_data_mappings mapping join public.store_departments department on department.id=mapping.canonical_department_id and department.store_id=mapping.store_id where mapping.store_id=p_store_id and mapping.source_system='commander' and mapping.entity_type='department' and mapping.source_context_key='' and mapping.status='mapped' and department.name=p_department_name;
  if v_department_count = 0 then raise exception using errcode='23514', message='commander_department_mapping_missing'; end if;
  if v_department_count <> 1 then raise exception using errcode='23514', message='commander_department_mapping_ambiguous'; end if;
  select * into v_profile from public.pos_source_create_profiles where store_id=p_store_id and source_system='commander';
  if not found then raise exception using errcode='23514', message='commander_create_profile_missing'; end if;
  select array_agg(value order by value) into v_flags from (select distinct value from jsonb_array_elements_text(v_profile.default_flag_sysids) value) flags;
  if not public.pos_publish_commander_sysid_array_is_valid(v_flags) or cardinality(v_flags)=0 then raise exception using errcode='23514', message='commander_create_profile_invalid'; end if;
  select count(*), min(id) into v_count, v_connector_id from public.store_pos_connectors where store_id=p_store_id and status='active' and commander_status='connected';
  if v_count <> 1 then raise exception using errcode='23514', message='commander_create_payload_invalid'; end if;
  v_payload := jsonb_build_object('create_profile_version',v_profile.create_profile_version,'upc',p_upc,'modifier',p_modifier,'description',p_description,'department',v_department,'price',p_price,'payment_product_code',p_payment_product_code,'selling_unit',p_selling_unit,'max_qty_per_trans',p_max_qty_per_trans,'taxable_rebate',p_taxable_rebate,'tax_rate_ids',to_jsonb(p_tax_rate_ids),'id_check_ids',to_jsonb(p_id_check_ids),'flag_ids',to_jsonb(v_flags));
  insert into public.pos_publish_jobs(store_id,product_id,requested_by,assigned_connector_id,operation,status,payload,expected_price,requested_price,idempotency_key) values(p_store_id,p_product_id,p_requested_by,v_connector_id,'create_product','pending',v_payload,p_price,p_price,p_idempotency_key) on conflict (idempotency_key) do update set id=public.pos_publish_jobs.id returning * into v_job;
  return query select v_job.id, v_job.status::text, to_char(v_job.expected_price,'FM9999999999990.00'), to_char(v_job.requested_price,'FM9999999999990.00'), v_job.created_at;
end; $$;

create function public.claim_commander_product_create_job(p_connector_id uuid)
returns table(job_id uuid, operation text, product_id uuid, upc text, modifier text, description text, department text, price text, payment_product_code text, selling_unit text, max_qty_per_trans text, taxable_rebate text, tax_rate_ids text[], id_check_ids text[], flag_ids text[], attempt integer, claimed_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.pos_publish_jobs%rowtype; v_store_id uuid; v_now timestamptz:=now();
begin
 select store_id into v_store_id from public.store_pos_connectors where id=p_connector_id and status='active'; if not found then raise exception using errcode='42501',message='connector is not authorized'; end if;
 select * into v_job from public.pos_publish_jobs where assigned_connector_id=p_connector_id and store_id=v_store_id and operation='create_product' and status='pending' order by created_at,id for update skip locked limit 1; if not found then return; end if;
 update public.pos_publish_jobs set status='claimed',claimed_by_connector_id=p_connector_id,claimed_at=v_now,attempt_count=attempt_count+1 where id=v_job.id;
 return query select v_job.id,'create_product',v_job.product_id,v_job.payload->>'upc',v_job.payload->>'modifier',v_job.payload->>'description',v_job.payload->>'department',to_char(v_job.requested_price,'FM9999999999990.00'),v_job.payload->>'payment_product_code',v_job.payload->>'selling_unit',v_job.payload->>'max_qty_per_trans',v_job.payload->>'taxable_rebate',array(select jsonb_array_elements_text(v_job.payload->'tax_rate_ids')),array(select jsonb_array_elements_text(v_job.payload->'id_check_ids')),array(select jsonb_array_elements_text(v_job.payload->'flag_ids')),v_job.attempt_count+1,v_now;
end; $$;

create function public.report_commander_product_create_status(p_connector_id uuid,p_job_id uuid,p_status text,p_verification_upc text,p_verification_modifier text,p_verification_description text,p_verification_department text,p_verification_price numeric,p_verification_payment_product_code text,p_verification_selling_unit text,p_verification_max_qty_per_trans text,p_verification_taxable_rebate text,p_verification_tax_rate_ids text[],p_verification_id_check_ids text[],p_verification_flag_ids text[],p_failure_code text,p_failure_message text)
returns table(job_id uuid,status text) language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.pos_publish_jobs%rowtype; v_store_id uuid; v_now timestamptz:=now(); v_hash text; v_identity public.product_source_identities%rowtype;
begin
 select store_id into v_store_id from public.store_pos_connectors where id=p_connector_id and status='active'; if not found then raise exception using errcode='42501',message='connector is not authorized'; end if;
 select * into v_job from public.pos_publish_jobs where id=p_job_id for update; if not found or v_job.store_id<>v_store_id or v_job.assigned_connector_id<>p_connector_id or v_job.claimed_by_connector_id<>p_connector_id or v_job.operation<>'create_product' then raise exception using errcode='42501',message='connector is not authorized'; end if;
 if p_status='sending' and v_job.status='claimed' then update public.pos_publish_jobs set status='sending' where id=v_job.id;
 elsif p_status='verifying' and v_job.status='sending' then update public.pos_publish_jobs set status='verifying' where id=v_job.id;
 elsif p_status='failed' and v_job.status in ('claimed','sending','verifying') then update public.pos_publish_jobs set status='failed',failed_at=v_now,audit_metadata=jsonb_strip_nulls(jsonb_build_object('failure_code',p_failure_code,'completion_note',nullif(p_failure_message,''))) where id=v_job.id;
 elsif p_status='completed' and v_job.status='verifying' and p_verification_upc=v_job.payload->>'upc' and p_verification_modifier=v_job.payload->>'modifier' and p_verification_description=v_job.payload->>'description' and p_verification_department=v_job.payload->>'department' and p_verification_price=v_job.requested_price and p_verification_payment_product_code=v_job.payload->>'payment_product_code' and p_verification_selling_unit=v_job.payload->>'selling_unit' and p_verification_max_qty_per_trans=v_job.payload->>'max_qty_per_trans' and p_verification_taxable_rebate=v_job.payload->>'taxable_rebate' and (select array_agg(value order by value) from jsonb_array_elements_text(v_job.payload->'tax_rate_ids') value) is not distinct from (select array_agg(value order by value) from unnest(p_verification_tax_rate_ids) value) and (select array_agg(value order by value) from jsonb_array_elements_text(v_job.payload->'id_check_ids') value) is not distinct from (select array_agg(value order by value) from unnest(p_verification_id_check_ids) value) and (select array_agg(value order by value) from jsonb_array_elements_text(v_job.payload->'flag_ids') value) is not distinct from (select array_agg(value order by value) from unnest(p_verification_flag_ids) value) then
   select * into v_identity from public.product_source_identities where store_id=v_job.store_id and source_system='commander' and source_product_key=p_verification_upc||'/'||p_verification_modifier for update;
   if found and v_identity.product_id<>v_job.product_id then raise exception using errcode='23514',message='source_identity_conflict'; end if;
   v_hash:=encode(extensions.digest(v_job.payload::text,'sha256'),'hex');
   insert into public.product_source_identities(store_id,product_id,source_system,source_product_key,source_upc,source_modifier,source_payload_hash,metadata,last_matched_at) values(v_job.store_id,v_job.product_id,'commander',p_verification_upc||'/'||p_verification_modifier,p_verification_upc,p_verification_modifier,v_hash,jsonb_build_object('origin','verified_create_product'),v_now) on conflict(store_id,source_system,source_product_key) do update set last_seen_at=v_now,last_matched_at=v_now,updated_at=v_now where public.product_source_identities.product_id=excluded.product_id;
   if not found then null; end if;
   update public.pos_publish_jobs set status='completed',completed_at=v_now,audit_metadata=jsonb_build_object('verification_upc',p_verification_upc,'verification_modifier',p_verification_modifier,'verification_description',p_verification_description,'verification_department',p_verification_department,'verification_price',p_verification_price) where id=v_job.id;
 else raise exception using errcode='23514',message='publishing job completion verification is invalid'; end if;
 return query select v_job.id,p_status;
end; $$;

revoke all on function public.request_commander_product_create(uuid,uuid,uuid,text,text,text,numeric,text,text,text,text,text,text[],text[],text) from public,anon,authenticated;
grant execute on function public.request_commander_product_create(uuid,uuid,uuid,text,text,text,numeric,text,text,text,text,text,text[],text[],text) to service_role;
revoke all on function public.claim_commander_product_create_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_commander_product_create_job(uuid) to service_role;
revoke all on function public.report_commander_product_create_status(uuid,uuid,text,text,text,text,text,numeric,text,text,text,text,text[],text[],text[],text,text) from public,anon,authenticated;
grant execute on function public.report_commander_product_create_status(uuid,uuid,text,text,text,text,text,numeric,text,text,text,text,text[],text[],text[],text,text) to service_role;
