-- StorePulse AI POS payment summary rows
-- Captures columns currently written by POS import routes.
-- Live schema parity should be verified separately before applying to a fresh environment.

create extension if not exists pgcrypto;

create table if not exists public.pos_payment_summary (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  report_period_id uuid not null,
  report_file_id uuid not null,
  source_system text not null,
  source_store_number text,
  period_open timestamptz,
  period_close timestamptz,

  payment_number text,
  payment_name text,
  payment_type text,
  payment_group text,
  charge_count numeric,
  charge_amount numeric,
  correction_count numeric,
  correction_amount numeric,
  register_number text,

  created_at timestamptz not null default now()
);

create index if not exists pos_payment_summary_store_id_idx
on public.pos_payment_summary(store_id);

create index if not exists pos_payment_summary_report_period_id_idx
on public.pos_payment_summary(report_period_id);

create index if not exists pos_payment_summary_report_file_id_idx
on public.pos_payment_summary(report_file_id);

create index if not exists pos_payment_summary_store_period_idx
on public.pos_payment_summary(store_id, period_open, period_close);

alter table public.pos_payment_summary enable row level security;

drop policy if exists "select_own_pos_payment_summary" on public.pos_payment_summary;
create policy "select_own_pos_payment_summary"
on public.pos_payment_summary
for select
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = pos_payment_summary.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "insert_own_pos_payment_summary" on public.pos_payment_summary;
create policy "insert_own_pos_payment_summary"
on public.pos_payment_summary
for insert
to authenticated
with check (
  exists (
    select 1
    from public.stores
    where stores.id = pos_payment_summary.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "update_own_pos_payment_summary" on public.pos_payment_summary;
create policy "update_own_pos_payment_summary"
on public.pos_payment_summary
for update
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = pos_payment_summary.store_id
      and stores.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores
    where stores.id = pos_payment_summary.store_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists "delete_own_pos_payment_summary" on public.pos_payment_summary;
create policy "delete_own_pos_payment_summary"
on public.pos_payment_summary
for delete
to authenticated
using (
  exists (
    select 1
    from public.stores
    where stores.id = pos_payment_summary.store_id
      and stores.owner_id = auth.uid()
  )
);

grant select, insert, update, delete on public.pos_payment_summary to authenticated;

notify pgrst, 'reload schema';
