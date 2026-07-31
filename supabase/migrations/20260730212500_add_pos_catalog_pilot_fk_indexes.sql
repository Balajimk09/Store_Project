-- Cover the composite foreign keys introduced by the POS catalog pilot staging schema.
-- Additive indexes only; no rows are modified.

create index if not exists pos_catalog_sync_runs_submitted_connector_idx
  on public.pos_catalog_sync_runs (submitted_by_connector_id)
  where submitted_by_connector_id is not null;

create index if not exists pos_catalog_sync_items_run_store_idx
  on public.pos_catalog_sync_items (sync_run_id, store_id);

create index if not exists pos_catalog_sync_items_product_store_idx
  on public.pos_catalog_sync_items (storepulse_product_id, store_id)
  where storepulse_product_id is not null;

create index if not exists pos_catalog_sync_items_source_identity_store_idx
  on public.pos_catalog_sync_items (source_identity_id, store_id)
  where source_identity_id is not null;

create index if not exists product_source_identities_product_store_idx
  on public.product_source_identities (product_id, store_id);

create index if not exists product_source_identities_first_run_store_idx
  on public.product_source_identities (first_sync_run_id, store_id)
  where first_sync_run_id is not null;

create index if not exists product_source_identities_last_run_store_idx
  on public.product_source_identities (last_sync_run_id, store_id)
  where last_sync_run_id is not null;

create index if not exists product_source_identities_last_item_store_idx
  on public.product_source_identities (last_sync_item_id, store_id)
  where last_sync_item_id is not null;

create index if not exists product_history_product_store_idx
  on public.product_history (product_id, store_id)
  where product_id is not null;

create index if not exists product_history_source_identity_store_idx
  on public.product_history (source_identity_id, store_id)
  where source_identity_id is not null;

create index if not exists product_history_sync_run_store_idx
  on public.product_history (sync_run_id, store_id)
  where sync_run_id is not null;

create index if not exists product_history_sync_item_store_idx
  on public.product_history (sync_item_id, store_id)
  where sync_item_id is not null;
