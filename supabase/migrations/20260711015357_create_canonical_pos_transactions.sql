-- Canonical near-live POS transaction storage for normalized Verifone Commander data.
-- This migration is additive and intentionally leaves public.transactions unchanged.

create extension if not exists pgcrypto;

create table public.pos_transaction_imports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  connector_id uuid references public.store_pos_connectors(id) on delete set null,
  source_system text not null default 'verifone_commander',
  source_store_number text,
  source_file_name text,
  normalized_file_name text,
  source_file_hash text,
  payload_hash text not null,
  status text not null default 'received'
    check (status = any (array[
      'received'::text,
      'processing'::text,
      'completed'::text,
      'completed_with_errors'::text,
      'failed'::text,
      'duplicate'::text
    ])),
  raw_record_count integer not null default 0 check (raw_record_count >= 0),
  sale_like_record_count integer not null default 0 check (sale_like_record_count >= 0),
  canonical_record_count integer not null default 0 check (canonical_record_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  normalizer_version text,
  schema_version text not null default '1',
  raw_storage_path text,
  normalized_storage_path text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_transaction_imports_store_source_payload_key
    unique (store_id, source_system, payload_hash),
  constraint pos_transaction_imports_tenant_key
    unique (id, store_id, owner_id),
  constraint pos_transaction_imports_completed_after_started_check
    check (completed_at is null or completed_at >= started_at)
);

create table public.pos_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  connector_id uuid references public.store_pos_connectors(id) on delete set null,
  first_import_id uuid references public.pos_transaction_imports(id) on delete set null,
  last_import_id uuid references public.pos_transaction_imports(id) on delete set null,
  source_system text not null default 'verifone_commander',
  source_unique_id text not null,
  canonical_record boolean not null default true,
  store_number text,
  transaction_time timestamptz not null,
  business_date date,
  register_number text,
  physical_register_id text,
  transaction_sequence text,
  transaction_serial text,
  terminal_message_serial text,
  cashier text,
  till text,
  duration_seconds numeric(12,3) check (duration_seconds is null or duration_seconds >= 0),
  transaction_type text not null,
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  current_total numeric(14,2) not null default 0,
  cash_back_amount numeric(14,2) not null default 0,
  cash_back_fee numeric(14,2) not null default 0,
  has_cash_back boolean not null default false,
  has_item_voids boolean not null default false,
  item_void_count integer not null default 0 check (item_void_count >= 0),
  has_rounding_adjustment boolean not null default false,
  rounding_adjustment_count integer not null default 0 check (rounding_adjustment_count >= 0),
  was_recalled boolean not null default false,
  recalled_from_ticket text,
  is_fuel_transaction boolean not null default false,
  fuel_transaction_type text,
  original_ticket text,
  original_source_unique_id text,
  shadow_source_unique_ids text[] not null default '{}'::text[],
  item_count integer not null default 0 check (item_count >= 0),
  payment_count integer not null default 0 check (payment_count >= 0),
  canonical_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_transactions_store_source_unique_key
    unique (store_id, source_system, source_unique_id),
  constraint pos_transactions_tenant_key
    unique (id, store_id, owner_id),
  constraint pos_transactions_last_seen_check
    check (last_seen_at >= first_seen_at)
);

create table public.pos_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  store_id uuid not null,
  owner_id uuid not null,
  line_number integer not null check (line_number > 0),
  line_type text not null,
  upc text,
  description text,
  department text,
  network_code text,
  modifier text,
  quantity numeric(14,4),
  sign numeric(14,4),
  signed_quantity numeric(14,4),
  selling_unit text,
  unit_price numeric(14,4),
  line_total numeric(14,2),
  tax_base numeric(14,2),
  tax_rate numeric(9,6),
  void_line_index text,
  is_voided boolean not null default false,
  is_refund boolean not null default false,
  is_fuel boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_transaction_lines_transaction_line_key
    unique (transaction_id, line_number),
  constraint pos_transaction_lines_transaction_tenant_fkey
    foreign key (transaction_id, store_id, owner_id)
    references public.pos_transactions(id, store_id, owner_id)
    on delete cascade
);

create table public.pos_transaction_payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  store_id uuid not null,
  owner_id uuid not null,
  payment_number integer not null check (payment_number > 0),
  payment_code text,
  amount numeric(14,2) not null default 0,
  direction text,
  card_type text,
  card_last_four text,
  entry_method text,
  host text,
  is_change boolean not null default false,
  is_refund boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_transaction_payments_transaction_payment_key
    unique (transaction_id, payment_number),
  constraint pos_transaction_payments_transaction_tenant_fkey
    foreign key (transaction_id, store_id, owner_id)
    references public.pos_transactions(id, store_id, owner_id)
    on delete cascade
);

comment on column public.pos_transaction_payments.card_last_four is
  'Optional last four digits only. Full PAN, track data, PIN data, and payment secrets must never be stored.';

create table public.pos_transaction_relationships (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  store_id uuid not null,
  owner_id uuid not null,
  related_transaction_id uuid references public.pos_transactions(id) on delete set null,
  related_source_unique_id text,
  related_ticket text,
  relationship_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pos_transaction_relationships_transaction_tenant_fkey
    foreign key (transaction_id, store_id, owner_id)
    references public.pos_transactions(id, store_id, owner_id)
    on delete cascade,
  constraint pos_transaction_relationships_target_check
    check (
      related_transaction_id is not null
      or nullif(btrim(related_source_unique_id), '') is not null
      or nullif(btrim(related_ticket), '') is not null
    )
);

create table public.pos_transaction_import_errors (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  store_id uuid not null,
  owner_id uuid not null,
  record_index integer check (record_index is null or record_index >= 0),
  source_unique_id text,
  error_code text not null,
  error_message text not null,
  raw_record jsonb,
  created_at timestamptz not null default now(),
  constraint pos_transaction_import_errors_import_tenant_fkey
    foreign key (import_id, store_id, owner_id)
    references public.pos_transaction_imports(id, store_id, owner_id)
    on delete cascade
);

comment on table public.pos_transaction_imports is
  'Tracks each normalized near-live POS payload and its ingestion outcome.';
comment on table public.pos_transactions is
  'One row per canonical normalized POS transaction.';
comment on table public.pos_transaction_lines is
  'Canonical merchandise, fuel, void, rounding, deposit, and adjustment lines.';
comment on table public.pos_transaction_payments is
  'Canonical tender/payment rows associated with a POS transaction.';
comment on table public.pos_transaction_relationships is
  'Links canonical transactions to refunds, recalls, fuel originals, fuel shadows, voids, and corrections.';
comment on table public.pos_transaction_import_errors is
  'Per-record ingestion errors that do not need to fail the entire payload.';

create index pos_transaction_imports_store_created_idx
  on public.pos_transaction_imports(store_id, created_at desc);
create index pos_transaction_imports_owner_idx
  on public.pos_transaction_imports(owner_id);
create index pos_transaction_imports_connector_idx
  on public.pos_transaction_imports(connector_id);
create index pos_transaction_imports_status_created_idx
  on public.pos_transaction_imports(status, created_at desc);

create index pos_transactions_owner_idx
  on public.pos_transactions(owner_id);
create index pos_transactions_connector_idx
  on public.pos_transactions(connector_id);
create index pos_transactions_first_import_idx
  on public.pos_transactions(first_import_id);
create index pos_transactions_last_import_idx
  on public.pos_transactions(last_import_id);
create index pos_transactions_store_time_idx
  on public.pos_transactions(store_id, transaction_time desc);
create index pos_transactions_store_business_date_idx
  on public.pos_transactions(store_id, business_date desc);
create index pos_transactions_store_register_time_idx
  on public.pos_transactions(store_id, register_number, transaction_time desc);
create index pos_transactions_store_cashier_time_idx
  on public.pos_transactions(store_id, cashier, transaction_time desc);
create index pos_transactions_store_type_time_idx
  on public.pos_transactions(store_id, transaction_type, transaction_time desc);
create index pos_transactions_store_fuel_time_idx
  on public.pos_transactions(store_id, transaction_time desc)
  where is_fuel_transaction;

create index pos_transaction_lines_transaction_tenant_idx
  on public.pos_transaction_lines(transaction_id, store_id, owner_id);
create index pos_transaction_lines_owner_idx
  on public.pos_transaction_lines(owner_id);
create index pos_transaction_lines_store_upc_idx
  on public.pos_transaction_lines(store_id, upc)
  where upc is not null and btrim(upc) <> '';
create index pos_transaction_lines_store_department_idx
  on public.pos_transaction_lines(store_id, department);

create index pos_transaction_payments_transaction_tenant_idx
  on public.pos_transaction_payments(transaction_id, store_id, owner_id);
create index pos_transaction_payments_owner_idx
  on public.pos_transaction_payments(owner_id);
create index pos_transaction_payments_store_code_idx
  on public.pos_transaction_payments(store_id, payment_code);

create index pos_transaction_relationships_transaction_tenant_idx
  on public.pos_transaction_relationships(transaction_id, store_id, owner_id);
create index pos_transaction_relationships_related_transaction_idx
  on public.pos_transaction_relationships(related_transaction_id);
create index pos_transaction_relationships_owner_idx
  on public.pos_transaction_relationships(owner_id);
create unique index pos_transaction_relationships_identity_idx
  on public.pos_transaction_relationships(
    transaction_id,
    relationship_type,
    coalesce(related_transaction_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(related_source_unique_id, ''),
    coalesce(related_ticket, '')
  );

create index pos_transaction_import_errors_import_tenant_idx
  on public.pos_transaction_import_errors(import_id, store_id, owner_id);
create index pos_transaction_import_errors_owner_idx
  on public.pos_transaction_import_errors(owner_id);
create unique index pos_transaction_import_errors_identity_idx
  on public.pos_transaction_import_errors(
    import_id,
    coalesce(record_index, -1),
    coalesce(source_unique_id, ''),
    error_code
  );

alter table public.pos_transaction_imports enable row level security;
alter table public.pos_transactions enable row level security;
alter table public.pos_transaction_lines enable row level security;
alter table public.pos_transaction_payments enable row level security;
alter table public.pos_transaction_relationships enable row level security;
alter table public.pos_transaction_import_errors enable row level security;

create policy "Owners can view pos transaction imports"
  on public.pos_transaction_imports
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can view canonical pos transactions"
  on public.pos_transactions
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can view canonical pos transaction lines"
  on public.pos_transaction_lines
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can view canonical pos transaction payments"
  on public.pos_transaction_payments
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can view canonical pos transaction relationships"
  on public.pos_transaction_relationships
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can view pos transaction import errors"
  on public.pos_transaction_import_errors
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

revoke all on table public.pos_transaction_imports from anon, authenticated;
revoke all on table public.pos_transactions from anon, authenticated;
revoke all on table public.pos_transaction_lines from anon, authenticated;
revoke all on table public.pos_transaction_payments from anon, authenticated;
revoke all on table public.pos_transaction_relationships from anon, authenticated;
revoke all on table public.pos_transaction_import_errors from anon, authenticated;

grant select on table public.pos_transaction_imports to authenticated;
grant select on table public.pos_transactions to authenticated;
grant select on table public.pos_transaction_lines to authenticated;
grant select on table public.pos_transaction_payments to authenticated;
grant select on table public.pos_transaction_relationships to authenticated;
grant select on table public.pos_transaction_import_errors to authenticated;

grant all on table public.pos_transaction_imports to service_role;
grant all on table public.pos_transactions to service_role;
grant all on table public.pos_transaction_lines to service_role;
grant all on table public.pos_transaction_payments to service_role;
grant all on table public.pos_transaction_relationships to service_role;
grant all on table public.pos_transaction_import_errors to service_role;

notify pgrst, 'reload schema';;
