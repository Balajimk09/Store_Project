-- StorePulse POS catalog pilot staging foundation.
--
-- This migration is additive and POS-independent. It does not alter existing
-- product rows, does not add Commander-specific columns to public.products,
-- and does not enable any StorePulse -> POS publishing path.
--
-- Authenticated store owners receive scoped read access only. Inserts and
-- updates are reserved for trusted server/service-role code.

create unique index if not exists products_id_store_uidx
  on public.products (id, store_id);

create table public.pos_catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null,
  connector_id uuid null references public.store_pos_connectors(id) on delete set null,
  source_system text not null,
  source_store_number text null,
  import_mode text not null,
  status text not null default 'queued',
  catalog_complete boolean not null default false,
  captured_at timestamptz null,
  selection_count integer not null default 0,
  received_product_count integer not null default 0,
  ready_count integer not null default 0,
  matched_count integer not null default 0,
  changed_count integer not null default 0,
  conflict_count integer not null default 0,
  invalid_count integer not null default 0,
  approved_count integer not null default 0,
  rejected_count integer not null default 0,
  catalog_hash text not null,
  selection_hash text null,
  idempotency_key text null,
  request_fingerprint text null,
  normalizer_version text null,
  source_schema_version text null,
  submitted_by_type text not null default 'connector',
  submitted_by_user_id uuid null,
  submitted_by_connector_id uuid null references public.store_pos_connectors(id) on delete set null,
  safe_error_code text null,
  safe_error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz null,
  completed_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_sync_runs_id_store_key unique (id, store_id),
  constraint pos_catalog_sync_runs_source_system_length_check
    check (char_length(source_system) between 1 and 64),
  constraint pos_catalog_sync_runs_source_store_number_length_check
    check (source_store_number is null or char_length(source_store_number) between 1 and 64),
  constraint pos_catalog_sync_runs_import_mode_check
    check (import_mode in ('selected_products', 'full_catalog')),
  constraint pos_catalog_sync_runs_status_check
    check (status in ('queued', 'running', 'previewed', 'completed', 'failed', 'cancelled')),
  constraint pos_catalog_sync_runs_submitted_by_type_check
    check (submitted_by_type in ('connector', 'browser', 'system')),
  constraint pos_catalog_sync_runs_catalog_hash_check
    check (catalog_hash ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_sync_runs_selection_hash_check
    check (selection_hash is null or selection_hash ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_sync_runs_idempotency_key_length_check
    check (idempotency_key is null or char_length(idempotency_key) between 1 and 128),
  constraint pos_catalog_sync_runs_request_fingerprint_length_check
    check (request_fingerprint is null or char_length(request_fingerprint) between 1 and 128),
  constraint pos_catalog_sync_runs_safe_error_code_length_check
    check (safe_error_code is null or char_length(safe_error_code) <= 128),
  constraint pos_catalog_sync_runs_safe_error_message_length_check
    check (safe_error_message is null or char_length(safe_error_message) <= 2000),
  constraint pos_catalog_sync_runs_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint pos_catalog_sync_runs_nonnegative_counts_check
    check (
      selection_count >= 0 and
      received_product_count >= 0 and
      ready_count >= 0 and
      matched_count >= 0 and
      changed_count >= 0 and
      conflict_count >= 0 and
      invalid_count >= 0 and
      approved_count >= 0 and
      rejected_count >= 0
    ),
  constraint pos_catalog_sync_runs_selected_products_bound_check
    check (import_mode <> 'selected_products' or selection_count between 1 and 10),
  constraint pos_catalog_sync_runs_selected_products_incomplete_check
    check (import_mode <> 'selected_products' or catalog_complete = false)
);

create table public.pos_catalog_sync_items (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  record_index integer not null,
  source_system text not null,
  source_product_key text not null,
  source_upc text null,
  source_modifier text null,
  source_payload_hash text not null,
  source_values jsonb not null,
  storepulse_product_id uuid null,
  source_identity_id uuid null,
  reconciliation_status text not null default 'source_only',
  match_method text null,
  proposed_changes jsonb not null default '{}'::jsonb,
  conflict_fields text[] not null default '{}'::text[],
  validation_errors jsonb not null default '[]'::jsonb,
  transaction_evidence jsonb not null default '{}'::jsonb,
  resolution text null,
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pos_catalog_sync_items_id_store_key unique (id, store_id),
  constraint pos_catalog_sync_items_run_store_fkey
    foreign key (sync_run_id, store_id)
    references public.pos_catalog_sync_runs(id, store_id)
    on delete cascade,
  constraint pos_catalog_sync_items_product_store_fkey
    foreign key (storepulse_product_id, store_id)
    references public.products(id, store_id)
    on delete set null (storepulse_product_id),
  constraint pos_catalog_sync_items_run_source_key
    unique (sync_run_id, source_product_key),
  constraint pos_catalog_sync_items_run_record_index_key
    unique (sync_run_id, record_index),
  constraint pos_catalog_sync_items_record_index_check
    check (record_index >= 0),
  constraint pos_catalog_sync_items_source_system_length_check
    check (char_length(source_system) between 1 and 64),
  constraint pos_catalog_sync_items_source_product_key_length_check
    check (char_length(source_product_key) between 1 and 256),
  constraint pos_catalog_sync_items_source_payload_hash_check
    check (source_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint pos_catalog_sync_items_reconciliation_status_check
    check (reconciliation_status in (
      'source_only',
      'in_sync',
      'source_changed',
      'storepulse_changed',
      'conflict',
      'invalid',
      'ready',
      'approved',
      'rejected'
    )),
  constraint pos_catalog_sync_items_source_values_object_check
    check (jsonb_typeof(source_values) = 'object'),
  constraint pos_catalog_sync_items_proposed_changes_object_check
    check (jsonb_typeof(proposed_changes) = 'object'),
  constraint pos_catalog_sync_items_validation_errors_array_check
    check (jsonb_typeof(validation_errors) = 'array'),
  constraint pos_catalog_sync_items_transaction_evidence_object_check
    check (jsonb_typeof(transaction_evidence) = 'object')
);

create table public.product_source_identities (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null,
  source_system text not null,
  source_product_key text not null,
  source_upc text null,
  source_modifier text null,
  first_sync_run_id uuid null,
  last_sync_run_id uuid null,
  last_sync_item_id uuid null,
  source_payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_matched_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_source_identities_id_store_key unique (id, store_id),
  constraint product_source_identities_product_store_fkey
    foreign key (product_id, store_id)
    references public.products(id, store_id)
    on delete cascade,
  constraint product_source_identities_first_run_store_fkey
    foreign key (first_sync_run_id, store_id)
    references public.pos_catalog_sync_runs(id, store_id)
    on delete set null (first_sync_run_id),
  constraint product_source_identities_last_run_store_fkey
    foreign key (last_sync_run_id, store_id)
    references public.pos_catalog_sync_runs(id, store_id)
    on delete set null (last_sync_run_id),
  constraint product_source_identities_last_item_store_fkey
    foreign key (last_sync_item_id, store_id)
    references public.pos_catalog_sync_items(id, store_id)
    on delete set null (last_sync_item_id),
  constraint product_source_identities_store_source_key
    unique (store_id, source_system, source_product_key),
  constraint product_source_identities_source_system_length_check
    check (char_length(source_system) between 1 and 64),
  constraint product_source_identities_source_product_key_length_check
    check (char_length(source_product_key) between 1 and 256),
  constraint product_source_identities_source_payload_hash_check
    check (source_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint product_source_identities_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.pos_catalog_sync_items
  add constraint pos_catalog_sync_items_source_identity_store_fkey
  foreign key (source_identity_id, store_id)
  references public.product_source_identities(id, store_id)
  on delete set null (source_identity_id);

create table public.product_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid null,
  source_identity_id uuid null,
  sync_run_id uuid null,
  sync_item_id uuid null,
  source_system text null,
  event_type text not null,
  actor_id uuid null,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint product_history_product_store_fkey
    foreign key (product_id, store_id)
    references public.products(id, store_id)
    on delete set null (product_id),
  constraint product_history_source_identity_store_fkey
    foreign key (source_identity_id, store_id)
    references public.product_source_identities(id, store_id)
    on delete set null (source_identity_id),
  constraint product_history_sync_run_store_fkey
    foreign key (sync_run_id, store_id)
    references public.pos_catalog_sync_runs(id, store_id)
    on delete set null (sync_run_id),
  constraint product_history_sync_item_store_fkey
    foreign key (sync_item_id, store_id)
    references public.pos_catalog_sync_items(id, store_id)
    on delete set null (sync_item_id),
  constraint product_history_event_type_length_check
    check (char_length(event_type) between 1 and 64),
  constraint product_history_source_system_length_check
    check (source_system is null or char_length(source_system) between 1 and 64),
  constraint product_history_changes_object_check
    check (jsonb_typeof(changes) = 'object'),
  constraint product_history_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index pos_catalog_sync_runs_connector_idempotency_uidx
  on public.pos_catalog_sync_runs (connector_id, idempotency_key)
  where connector_id is not null and idempotency_key is not null;

create index pos_catalog_sync_runs_store_created_idx
  on public.pos_catalog_sync_runs (store_id, created_at desc);

create index pos_catalog_sync_runs_store_status_idx
  on public.pos_catalog_sync_runs (store_id, status, created_at desc);

create index pos_catalog_sync_runs_connector_created_idx
  on public.pos_catalog_sync_runs (connector_id, created_at desc)
  where connector_id is not null;

create index pos_catalog_sync_items_run_status_idx
  on public.pos_catalog_sync_items (sync_run_id, reconciliation_status, record_index);

create index pos_catalog_sync_items_store_status_idx
  on public.pos_catalog_sync_items (store_id, reconciliation_status, created_at desc);

create index pos_catalog_sync_items_store_source_idx
  on public.pos_catalog_sync_items (store_id, source_system, source_product_key);

create index pos_catalog_sync_items_store_upc_modifier_idx
  on public.pos_catalog_sync_items (store_id, source_system, source_upc, source_modifier)
  where source_upc is not null;

create index pos_catalog_sync_items_review_queue_idx
  on public.pos_catalog_sync_items (store_id, reconciliation_status, created_at)
  where reconciliation_status in ('source_only', 'source_changed', 'conflict', 'invalid', 'ready');

create index product_source_identities_product_idx
  on public.product_source_identities (product_id);

create index product_source_identities_upc_modifier_idx
  on public.product_source_identities (store_id, source_system, source_upc, source_modifier)
  where source_upc is not null;

create index product_history_store_created_idx
  on public.product_history (store_id, created_at desc);

create index product_history_product_created_idx
  on public.product_history (product_id, created_at desc)
  where product_id is not null;

create trigger pos_catalog_sync_runs_set_updated_at
before update on public.pos_catalog_sync_runs
for each row execute function public.set_updated_at();

create trigger pos_catalog_sync_items_set_updated_at
before update on public.pos_catalog_sync_items
for each row execute function public.set_updated_at();

create trigger product_source_identities_set_updated_at
before update on public.product_source_identities
for each row execute function public.set_updated_at();

alter table public.pos_catalog_sync_runs enable row level security;
alter table public.pos_catalog_sync_items enable row level security;
alter table public.product_source_identities enable row level security;
alter table public.product_history enable row level security;

drop policy if exists "owners_read_pos_catalog_sync_runs" on public.pos_catalog_sync_runs;
create policy "owners_read_pos_catalog_sync_runs"
on public.pos_catalog_sync_runs
for select
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = pos_catalog_sync_runs.store_id
      and s.owner_id = (select auth.uid())
  )
);

drop policy if exists "owners_read_pos_catalog_sync_items" on public.pos_catalog_sync_items;
create policy "owners_read_pos_catalog_sync_items"
on public.pos_catalog_sync_items
for select
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = pos_catalog_sync_items.store_id
      and s.owner_id = (select auth.uid())
  )
);

drop policy if exists "owners_read_product_source_identities" on public.product_source_identities;
create policy "owners_read_product_source_identities"
on public.product_source_identities
for select
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = product_source_identities.store_id
      and s.owner_id = (select auth.uid())
  )
);

drop policy if exists "owners_read_product_history" on public.product_history;
create policy "owners_read_product_history"
on public.product_history
for select
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = product_history.store_id
      and s.owner_id = (select auth.uid())
  )
);

revoke all on table public.pos_catalog_sync_runs from anon, authenticated;
revoke all on table public.pos_catalog_sync_items from anon, authenticated;
revoke all on table public.product_source_identities from anon, authenticated;
revoke all on table public.product_history from anon, authenticated;

grant select on table public.pos_catalog_sync_runs to authenticated;
grant select on table public.pos_catalog_sync_items to authenticated;
grant select on table public.product_source_identities to authenticated;
grant select on table public.product_history to authenticated;

grant all on table public.pos_catalog_sync_runs to service_role;
grant all on table public.pos_catalog_sync_items to service_role;
grant all on table public.product_source_identities to service_role;
grant all on table public.product_history to service_role;

comment on table public.pos_catalog_sync_runs is
  'POS-independent catalog preview/import runs. No credentials, cookies, raw XML, or raw POS payloads.';
comment on table public.pos_catalog_sync_items is
  'Normalized POS catalog staging records for matching and manual product approval.';
comment on table public.product_source_identities is
  'Stable mapping from StorePulse products to source-system product identities.';
comment on table public.product_history is
  'Append-only product catalog and synchronization audit events.';

notify pgrst, 'reload schema';;
