-- Repair only the live create RPC implementation defects. The Aug-19 create
-- contract, payload, lifecycle, and service-role boundary remain unchanged.

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
  select count(*) into v_count from public.store_pos_connectors connector where connector.store_id=p_store_id and connector.status='active' and connector.commander_status='connected';
  if v_count <> 1 then raise exception using errcode='23514', message='commander_create_payload_invalid'; end if;
  select connector.id into v_connector_id from public.store_pos_connectors connector where connector.store_id=p_store_id and connector.status='active' and connector.commander_status='connected' order by connector.id limit 1;
  v_payload := jsonb_build_object('create_profile_version',v_profile.create_profile_version,'upc',p_upc,'modifier',p_modifier,'description',p_description,'department',v_department,'price',p_price,'payment_product_code',p_payment_product_code,'selling_unit',p_selling_unit,'max_qty_per_trans',p_max_qty_per_trans,'taxable_rebate',p_taxable_rebate,'tax_rate_ids',to_jsonb(p_tax_rate_ids),'id_check_ids',to_jsonb(p_id_check_ids),'flag_ids',to_jsonb(v_flags));
  insert into public.pos_publish_jobs(store_id,product_id,requested_by,assigned_connector_id,operation,status,payload,expected_price,requested_price,idempotency_key) values(p_store_id,p_product_id,p_requested_by,v_connector_id,'create_product','pending',v_payload,p_price,p_price,p_idempotency_key) on conflict (idempotency_key) do update set id=public.pos_publish_jobs.id returning * into v_job;
  return query select v_job.id, v_job.status::text, to_char(v_job.expected_price,'FM9999999999990.00'), to_char(v_job.requested_price,'FM9999999999990.00'), v_job.created_at;
end; $$;

create or replace function public.claim_commander_product_create_job(p_connector_id uuid)
returns table(job_id uuid, operation text, product_id uuid, upc text, modifier text, description text, department text, price text, payment_product_code text, selling_unit text, max_qty_per_trans text, taxable_rebate text, tax_rate_ids text[], id_check_ids text[], flag_ids text[], attempt integer, claimed_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.pos_publish_jobs%rowtype; v_store_id uuid; v_now timestamptz:=now();
begin
 select connector.store_id into v_store_id from public.store_pos_connectors connector where connector.id=p_connector_id and connector.status='active'; if not found then raise exception using errcode='42501',message='connector is not authorized'; end if;
 select jobs.* into v_job from public.pos_publish_jobs jobs where jobs.assigned_connector_id=p_connector_id and jobs.store_id=v_store_id and jobs.operation='create_product' and jobs.status='pending' order by jobs.created_at,jobs.id for update skip locked limit 1; if not found then return; end if;
 update public.pos_publish_jobs set status='claimed',claimed_by_connector_id=p_connector_id,claimed_at=v_now,attempt_count=attempt_count+1 where id=v_job.id;
 return query select v_job.id,'create_product',v_job.product_id,v_job.payload->>'upc',v_job.payload->>'modifier',v_job.payload->>'description',v_job.payload->>'department',to_char(v_job.requested_price,'FM9999999999990.00'),v_job.payload->>'payment_product_code',v_job.payload->>'selling_unit',v_job.payload->>'max_qty_per_trans',v_job.payload->>'taxable_rebate',array(select jsonb_array_elements_text(v_job.payload->'tax_rate_ids')),array(select jsonb_array_elements_text(v_job.payload->'id_check_ids')),array(select jsonb_array_elements_text(v_job.payload->'flag_ids')),v_job.attempt_count+1,v_now;
end; $$;

revoke all on function public.request_commander_product_create(uuid,uuid,uuid,text,text,text,numeric,text,text,text,text,text,text[],text[],text) from public,anon,authenticated;
grant execute on function public.request_commander_product_create(uuid,uuid,uuid,text,text,text,numeric,text,text,text,text,text,text[],text[],text) to service_role;
revoke all on function public.claim_commander_product_create_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_commander_product_create_job(uuid) to service_role;
