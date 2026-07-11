-- Align canonical line types and connector metadata with the verified near-live pipeline.

alter table public.pos_transaction_lines
  alter column selling_unit type numeric(14,4)
  using nullif(btrim(selling_unit), '')::numeric;

alter table public.store_pos_connectors
  add column source_store_number text,
  add column connector_version text,
  add column normalizer_version text,
  add column last_pull_at timestamptz,
  add column last_success_at timestamptz,
  add column last_import_id uuid references public.pos_transaction_imports(id) on delete set null,
  add column consecutive_failure_count integer not null default 0,
  add column metadata jsonb not null default '{}'::jsonb;

alter table public.store_pos_connectors
  add constraint store_pos_connectors_failure_count_check
  check (consecutive_failure_count >= 0);

create index store_pos_connectors_last_import_id_idx
  on public.store_pos_connectors(last_import_id);

create index store_pos_connectors_store_source_number_idx
  on public.store_pos_connectors(store_id, source_system, source_store_number);

comment on column public.store_pos_connectors.source_store_number is
  'Store/site identifier emitted by the POS source, such as AB123.';
comment on column public.store_pos_connectors.last_pull_at is
  'Most recent time the local connector completed a POS pull attempt.';
comment on column public.store_pos_connectors.last_success_at is
  'Most recent time a normalized payload completed ingestion successfully.';
comment on column public.store_pos_connectors.last_import_id is
  'Most recent canonical transaction import associated with this connector.';
comment on column public.store_pos_connectors.metadata is
  'Non-secret connector capabilities and runtime metadata. Credentials must not be stored here.';

update public.store_pos_connectors as connector
set source_system = 'verifone_commander',
    source_store_number = coalesce(connector.source_store_number, 'AB123'),
    updated_at = now()
from public.stores as store
where connector.store_id = store.id
  and connector.connector_name = 'AB123 Verifone Connector'
  and store.store_name = 'Balaji Stores'
  and connector.source_system = 'verifone';

notify pgrst, 'reload schema';;
