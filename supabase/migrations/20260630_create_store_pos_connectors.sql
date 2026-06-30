-- StorePulse AI POS connector auth records

create extension if not exists pgcrypto;

create table if not exists public.store_pos_connectors (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  connector_name text not null,
  source_system text not null default 'verifone_commander',
  token_hash text not null,
  status text not null default 'active',
  last_seen_at timestamptz,
  last_upload_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_pos_connectors_status_check check (status in ('active', 'disabled')),
  constraint store_pos_connectors_token_hash_unique unique (token_hash)
);

create index if not exists store_pos_connectors_store_id_idx
on public.store_pos_connectors(store_id);

create index if not exists store_pos_connectors_status_idx
on public.store_pos_connectors(status);

create index if not exists store_pos_connectors_source_system_idx
on public.store_pos_connectors(source_system);

create index if not exists store_pos_connectors_last_seen_at_idx
on public.store_pos_connectors(last_seen_at desc);

alter table public.store_pos_connectors enable row level security;

drop policy if exists "select_own_store_pos_connectors" on public.store_pos_connectors;
create policy "select_own_store_pos_connectors"
on public.store_pos_connectors
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = store_pos_connectors.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "insert_own_store_pos_connectors" on public.store_pos_connectors;
create policy "insert_own_store_pos_connectors"
on public.store_pos_connectors
for insert
to authenticated
with check (
  exists (
    select 1
    from public.stores
    where stores.id = store_pos_connectors.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "update_own_store_pos_connectors" on public.store_pos_connectors;
create policy "update_own_store_pos_connectors"
on public.store_pos_connectors
for update
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = store_pos_connectors.store_id
      and stores.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores
    where stores.id = store_pos_connectors.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "delete_own_store_pos_connectors" on public.store_pos_connectors;
create policy "delete_own_store_pos_connectors"
on public.store_pos_connectors
for delete
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = store_pos_connectors.store_id
      and stores.owner_id = auth.uid()
  )
);

revoke all on public.store_pos_connectors from authenticated;

grant select (
  id,
  store_id,
  connector_name,
  source_system,
  status,
  last_seen_at,
  last_upload_at,
  last_error,
  created_by,
  created_at,
  updated_at
) on public.store_pos_connectors to authenticated;

grant insert, update, delete on public.store_pos_connectors to authenticated;

notify pgrst, 'reload schema';
