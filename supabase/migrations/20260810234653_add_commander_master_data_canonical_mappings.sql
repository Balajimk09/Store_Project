-- Controlled Commander source master-data promotion. Source facts remain staged;
-- canonical Store Settings records change only through the explicit approval RPC.

create unique index if not exists tax_categories_id_store_id_key
  on public.tax_categories (id, store_id);
create unique index if not exists tax_categories_store_id_name_key
  on public.tax_categories (store_id, name);
create unique index if not exists store_age_restriction_presets_id_store_id_key
  on public.store_age_restriction_presets (id, store_id);
create unique index if not exists idx_store_age_restriction_presets_store_lower_name
  on public.store_age_restriction_presets (store_id, lower(name));
create unique index if not exists store_departments_id_store_id_key
  on public.store_departments (id, store_id);
create unique index if not exists store_departments_store_id_name_key
  on public.store_departments (store_id, name);
create unique index if not exists store_categories_id_store_id_key
  on public.store_categories (id, store_id);

-- Store Settings treats categories as children of one department. Allow the
-- same Commander category name to be represented correctly in each department.
alter table public.store_categories
  drop constraint if exists store_categories_store_id_name_key;
drop index if exists public.store_categories_store_id_name_key;
drop index if exists public.idx_store_categories_store_name;
create unique index if not exists idx_store_categories_store_department_lower_name
  on public.store_categories (store_id, department_id, lower(name));

create table public.pos_catalog_source_master_data_mappings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_system text not null default 'commander',
  entity_type text not null,
  source_key text not null,
  -- Commander categories are reusable; StorePulse categories are department-specific.
  source_context_key text not null default '',
  status text not null default 'mapped',
  master_data_run_id uuid not null,
  canonical_tax_category_id uuid null,
  canonical_age_restriction_id uuid null,
  canonical_department_id uuid null,
  canonical_category_id uuid null,
  approved_by uuid null references auth.users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_source_master_data_mappings_source_system_check
    check (source_system = 'commander'),
  constraint pos_catalog_source_master_data_mappings_entity_type_check
    check (entity_type in ('tax', 'age_validation', 'department', 'category')),
  constraint pos_catalog_source_master_data_mappings_key_check
    check (source_key ~ '^[A-Za-z0-9_.-]{1,64}$' and source_context_key ~ '^[A-Za-z0-9_.-]{0,64}$'),
  constraint pos_catalog_source_master_data_mappings_context_check
    check ((entity_type = 'category' and source_context_key <> '') or (entity_type <> 'category' and source_context_key = '')),
  constraint pos_catalog_source_master_data_mappings_status_check
    check (status in ('mapped', 'ignored')),
  constraint pos_catalog_source_master_data_mappings_target_check
    check (
      (status = 'ignored' and canonical_tax_category_id is null and canonical_age_restriction_id is null and canonical_department_id is null and canonical_category_id is null)
      or (status = 'mapped' and (
        (entity_type = 'tax' and canonical_tax_category_id is not null and canonical_age_restriction_id is null and canonical_department_id is null and canonical_category_id is null)
        or (entity_type = 'age_validation' and canonical_tax_category_id is null and canonical_age_restriction_id is not null and canonical_department_id is null and canonical_category_id is null)
        or (entity_type = 'department' and canonical_tax_category_id is null and canonical_age_restriction_id is null and canonical_department_id is not null and canonical_category_id is null)
        or (entity_type = 'category' and canonical_tax_category_id is null and canonical_age_restriction_id is null and canonical_department_id is null and canonical_category_id is not null)
      ))
    ),
  constraint pos_catalog_source_master_data_mappings_unique
    unique (store_id, source_system, entity_type, source_key, source_context_key),
  constraint pos_catalog_source_master_data_mappings_run_store_fkey
    foreign key (master_data_run_id, store_id)
    references public.pos_catalog_source_master_data_runs(id, store_id),
  constraint pos_catalog_source_master_data_mappings_tax_store_fkey
    foreign key (canonical_tax_category_id, store_id)
    references public.tax_categories(id, store_id) on delete restrict,
  constraint pos_catalog_source_master_data_mappings_age_store_fkey
    foreign key (canonical_age_restriction_id, store_id)
    references public.store_age_restriction_presets(id, store_id) on delete restrict,
  constraint pos_catalog_source_master_data_mappings_department_store_fkey
    foreign key (canonical_department_id, store_id)
    references public.store_departments(id, store_id) on delete restrict,
  constraint pos_catalog_source_master_data_mappings_category_store_fkey
    foreign key (canonical_category_id, store_id)
    references public.store_categories(id, store_id) on delete restrict
);

create index pos_catalog_source_master_data_mappings_review_idx
  on public.pos_catalog_source_master_data_mappings (store_id, source_system, entity_type, master_data_run_id);

create trigger pos_catalog_source_master_data_mappings_set_updated_at
before update on public.pos_catalog_source_master_data_mappings
for each row execute function public.set_pos_catalog_updated_at();

alter table public.pos_catalog_source_master_data_mappings enable row level security;

revoke all on table public.pos_catalog_source_master_data_mappings from public, anon, authenticated;
grant select on table public.pos_catalog_source_master_data_mappings to authenticated;
grant select, insert, update, delete on table public.pos_catalog_source_master_data_mappings to service_role;

create policy "store owners read source master-data mappings"
on public.pos_catalog_source_master_data_mappings
for select to authenticated
using (
  exists (
    select 1 from public.stores s
    where s.id = pos_catalog_source_master_data_mappings.store_id
      and s.owner_id = (select auth.uid())
  )
);

create or replace function public.promote_commander_master_data_mappings(
  p_store_id uuid,
  p_master_data_run_id uuid,
  p_actor_id uuid,
  p_requests jsonb
)
returns table (
  created_count integer,
  mapped_count integer,
  ignored_count integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_current_run_id uuid;
  v_request record;
  v_source_name text;
  v_source_rate numeric;
  v_source_minimum_age integer;
  v_target_id uuid;
  v_tax_id uuid;
  v_age_id uuid;
  v_department_id uuid;
  v_existing public.pos_catalog_source_master_data_mappings%rowtype;
  v_link_count integer;
  v_created integer := 0;
  v_mapped integer := 0;
  v_ignored integer := 0;
begin
  if p_store_id is null or p_master_data_run_id is null or p_actor_id is null
    or jsonb_typeof(p_requests) <> 'array' or jsonb_array_length(p_requests) > 100 then
    raise exception using errcode = 'P0001', message = 'master_data_mapping_invalid';
  end if;

  perform 1 from public.stores s where s.id = p_store_id and s.owner_id = p_actor_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'master_data_mapping_forbidden';
  end if;

  select r.id into v_current_run_id
  from public.pos_catalog_source_master_data_runs r
  where r.store_id = p_store_id and r.source_system = 'commander'
  order by r.collected_at desc, r.created_at desc
  limit 1;
  if v_current_run_id is null then
    raise exception using errcode = 'P0001', message = 'master_data_mapping_unavailable';
  end if;
  if v_current_run_id <> p_master_data_run_id then
    raise exception using errcode = 'P0001', message = 'master_data_review_stale';
  end if;

  for v_request in
    select * from jsonb_to_recordset(p_requests) as value(
      entity_type text,
      source_key text,
      source_context_key text,
      action text,
      canonical_id uuid,
      restriction_type text
    )
  loop
    v_target_id := null;
    v_tax_id := null;
    v_age_id := null;
    v_department_id := null;
    v_link_count := 0;
    if v_request.entity_type not in ('tax', 'age_validation', 'department', 'category')
      or v_request.action not in ('create', 'map_existing', 'ignore')
      or v_request.source_key !~ '^[A-Za-z0-9_.-]{1,64}$'
      or coalesce(v_request.source_context_key, '') !~ '^[A-Za-z0-9_.-]{0,64}$'
      or (v_request.entity_type = 'category' and coalesce(v_request.source_context_key, '') = '')
      or (v_request.entity_type <> 'category' and coalesce(v_request.source_context_key, '') <> '')
      or (v_request.action = 'map_existing' and v_request.canonical_id is null)
      or (v_request.action <> 'map_existing' and v_request.canonical_id is not null) then
      raise exception using errcode = 'P0001', message = 'master_data_mapping_invalid';
    end if;

    select * into v_existing
    from public.pos_catalog_source_master_data_mappings m
    where m.store_id = p_store_id and m.source_system = 'commander'
      and m.entity_type = v_request.entity_type and m.source_key = v_request.source_key
      and m.source_context_key = coalesce(v_request.source_context_key, '')
    for update;
    if found then
      if v_existing.status = 'ignored' and v_request.action = 'ignore' then
        v_ignored := v_ignored + 1;
        continue;
      end if;
      if v_existing.status = 'mapped' then
        v_mapped := v_mapped + 1;
        continue;
      end if;
    end if;

    v_source_name := null;
    v_source_rate := null;
    v_source_minimum_age := null;
    if v_request.entity_type = 'tax' then
      select t.source_name, t.source_rate into v_source_name, v_source_rate
      from public.pos_catalog_source_tax_definitions t
      where t.store_id = p_store_id and t.source_system = 'commander'
        and t.last_master_data_run_id = p_master_data_run_id and t.is_present
        and t.source_tax_key = v_request.source_key;
    elsif v_request.entity_type = 'age_validation' then
      select a.source_name, a.source_min_age into v_source_name, v_source_minimum_age
      from public.pos_catalog_source_age_validations a
      where a.store_id = p_store_id and a.source_system = 'commander'
        and a.last_master_data_run_id = p_master_data_run_id and a.is_present
        and a.source_age_validation_key = v_request.source_key;
    elsif v_request.entity_type = 'department' then
      select d.source_name into v_source_name
      from public.pos_catalog_source_department_definitions d
      where d.store_id = p_store_id and d.source_system = 'commander'
        and d.last_master_data_run_id = p_master_data_run_id and d.is_present
        and d.source_department_key = v_request.source_key;
    else
      select c.source_name into v_source_name
      from public.pos_catalog_source_categories c
      join public.pos_catalog_source_department_definitions d
        on d.store_id = c.store_id and d.source_system = c.source_system
       and d.source_category_key = c.source_category_key
      where c.store_id = p_store_id and c.source_system = 'commander'
        and c.last_master_data_run_id = p_master_data_run_id and c.is_present
        and d.last_master_data_run_id = p_master_data_run_id and d.is_present
        and c.source_category_key = v_request.source_key
        and d.source_department_key = v_request.source_context_key;
    end if;
    if v_source_name is null or (v_request.entity_type = 'category' and v_request.source_key = '0') then
      raise exception using errcode = 'P0001', message = 'master_data_mapping_source_invalid';
    end if;

    if v_request.action = 'ignore' then
      insert into public.pos_catalog_source_master_data_mappings (
        store_id, source_system, entity_type, source_key, source_context_key, status,
        master_data_run_id, approved_by, approved_at
      ) values (
        p_store_id, 'commander', v_request.entity_type, v_request.source_key,
        coalesce(v_request.source_context_key, ''), 'ignored', p_master_data_run_id, p_actor_id, now()
      ) on conflict (store_id, source_system, entity_type, source_key, source_context_key)
      do update set status = excluded.status, master_data_run_id = excluded.master_data_run_id,
        approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = now();
      v_ignored := v_ignored + 1;
      continue;
    end if;

    if v_request.action = 'map_existing' then
      v_target_id := v_request.canonical_id;
      if v_request.entity_type = 'tax' then
        perform 1 from public.tax_categories x where x.id = v_target_id and x.store_id = p_store_id;
      elsif v_request.entity_type = 'age_validation' then
        perform 1 from public.store_age_restriction_presets x where x.id = v_target_id and x.store_id = p_store_id;
      elsif v_request.entity_type = 'department' then
        perform 1 from public.store_departments x where x.id = v_target_id and x.store_id = p_store_id;
      else
        select m.canonical_department_id into v_department_id
        from public.pos_catalog_source_master_data_mappings m
        where m.store_id = p_store_id and m.source_system = 'commander' and m.entity_type = 'department'
          and m.source_key = v_request.source_context_key and m.source_context_key = '' and m.status = 'mapped';
        if v_department_id is null then
          raise exception using errcode = 'P0001', message = 'master_data_mapping_dependency_missing';
        end if;
        perform 1 from public.store_categories x
        where x.id = v_target_id and x.store_id = p_store_id and x.department_id = v_department_id;
      end if;
      if not found then
        raise exception using errcode = 'P0001', message = 'master_data_mapping_target_invalid';
      end if;
    elsif v_request.entity_type = 'tax' then
      insert into public.tax_categories (store_id, name, rate, description, is_default, is_active)
      values (p_store_id, v_source_name, v_source_rate, null, false, true)
      on conflict (store_id, name) do nothing
      returning id into v_target_id;
      if v_target_id is null then
        select id into v_target_id from public.tax_categories where store_id = p_store_id and name = v_source_name;
      else
        v_created := v_created + 1;
      end if;
    elsif v_request.entity_type = 'age_validation' then
      if v_source_minimum_age is null
        or v_request.restriction_type not in ('alcohol', 'tobacco', 'vape', 'lottery', 'adult_content', 'cbd', 'energy_drinks') then
        raise exception using errcode = 'P0001', message = 'master_data_mapping_restriction_type_required';
      end if;
      insert into public.store_age_restriction_presets (store_id, name, minimum_age, restriction_type, is_active)
      values (p_store_id, v_source_name, v_source_minimum_age, v_request.restriction_type, true)
      on conflict do nothing
      returning id into v_target_id;
      if v_target_id is null then
        select id into v_target_id from public.store_age_restriction_presets
        where store_id = p_store_id and lower(name) = lower(v_source_name);
      else
        v_created := v_created + 1;
      end if;
    elsif v_request.entity_type = 'department' then
      select count(*), min(m.canonical_tax_category_id) into v_link_count, v_tax_id
      from public.pos_catalog_source_department_tax_links l
      join public.pos_catalog_source_master_data_mappings m
        on m.store_id = l.store_id and m.source_system = l.source_system
       and m.entity_type = 'tax' and m.source_key = l.source_tax_key and m.source_context_key = ''
       and m.status = 'mapped'
      where l.store_id = p_store_id and l.source_system = 'commander'
        and l.master_data_run_id = p_master_data_run_id and l.source_department_key = v_request.source_key;
      if v_link_count > 1 then
        raise exception using errcode = 'P0001', message = 'master_data_mapping_relationship_ambiguous';
      end if;
      if exists (
        select 1 from public.pos_catalog_source_department_tax_links l
        where l.store_id = p_store_id and l.source_system = 'commander'
          and l.master_data_run_id = p_master_data_run_id and l.source_department_key = v_request.source_key
      ) and v_tax_id is null then
        raise exception using errcode = 'P0001', message = 'master_data_mapping_dependency_missing';
      end if;
      select count(*), min(m.canonical_age_restriction_id) into v_link_count, v_age_id
      from public.pos_catalog_source_department_age_validation_links l
      join public.pos_catalog_source_master_data_mappings m
        on m.store_id = l.store_id and m.source_system = l.source_system
       and m.entity_type = 'age_validation' and m.source_key = l.source_age_validation_key and m.source_context_key = ''
       and m.status = 'mapped'
      where l.store_id = p_store_id and l.source_system = 'commander'
        and l.master_data_run_id = p_master_data_run_id and l.source_department_key = v_request.source_key;
      if v_link_count > 1 then
        raise exception using errcode = 'P0001', message = 'master_data_mapping_relationship_ambiguous';
      end if;
      if exists (
        select 1 from public.pos_catalog_source_department_age_validation_links l
        where l.store_id = p_store_id and l.source_system = 'commander'
          and l.master_data_run_id = p_master_data_run_id and l.source_department_key = v_request.source_key
      ) and v_age_id is null then
        raise exception using errcode = 'P0001', message = 'master_data_mapping_dependency_missing';
      end if;
      insert into public.store_departments (store_id, name, description, ebt_eligible, is_active, tax_category_id, age_restriction_id)
      values (p_store_id, v_source_name, null, false, true, v_tax_id, v_age_id)
      on conflict (store_id, name) do nothing
      returning id into v_target_id;
      if v_target_id is null then
        select id into v_target_id from public.store_departments where store_id = p_store_id and name = v_source_name;
      else
        v_created := v_created + 1;
      end if;
    else
      select m.canonical_department_id into v_department_id
      from public.pos_catalog_source_master_data_mappings m
      where m.store_id = p_store_id and m.source_system = 'commander' and m.entity_type = 'department'
        and m.source_key = v_request.source_context_key and m.source_context_key = '' and m.status = 'mapped';
      if v_department_id is null then
        raise exception using errcode = 'P0001', message = 'master_data_mapping_dependency_missing';
      end if;
      insert into public.store_categories (store_id, name, department_id, ebt_eligible, is_active, tax_category_id, age_restriction_id)
      values (p_store_id, v_source_name, v_department_id, false, true, null, null)
      on conflict do nothing
      returning id into v_target_id;
      if v_target_id is null then
        select id into v_target_id from public.store_categories
        where store_id = p_store_id and department_id = v_department_id
          and lower(name) = lower(v_source_name);
      else
        v_created := v_created + 1;
      end if;
    end if;

    insert into public.pos_catalog_source_master_data_mappings (
      store_id, source_system, entity_type, source_key, source_context_key, status,
      master_data_run_id, canonical_tax_category_id, canonical_age_restriction_id,
      canonical_department_id, canonical_category_id, approved_by, approved_at
    ) values (
      p_store_id, 'commander', v_request.entity_type, v_request.source_key,
      coalesce(v_request.source_context_key, ''), 'mapped', p_master_data_run_id,
      case when v_request.entity_type = 'tax' then v_target_id end,
      case when v_request.entity_type = 'age_validation' then v_target_id end,
      case when v_request.entity_type = 'department' then v_target_id end,
      case when v_request.entity_type = 'category' then v_target_id end,
      p_actor_id, now()
    ) on conflict (store_id, source_system, entity_type, source_key, source_context_key)
    do update set status = excluded.status, master_data_run_id = excluded.master_data_run_id,
      canonical_tax_category_id = excluded.canonical_tax_category_id,
      canonical_age_restriction_id = excluded.canonical_age_restriction_id,
      canonical_department_id = excluded.canonical_department_id,
      canonical_category_id = excluded.canonical_category_id,
      approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = now();
    v_mapped := v_mapped + 1;
  end loop;

  return query select v_created, v_mapped, v_ignored;
end;
$function$;

revoke all on function public.promote_commander_master_data_mappings(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.promote_commander_master_data_mappings(uuid, uuid, uuid, jsonb)
  to service_role;
