-- Covering indexes for Canonical POS business-day finalization foreign keys.
--
-- These indexes support finalization audit lookups, tenant-safe child
-- relationships, and Supabase/Postgres foreign-key checks introduced by the
-- Phase 1 business-day finalization migration.

create index if not exists pos_business_day_finalization_records_finalization_tenant_idx
  on public.pos_business_day_finalization_records(finalization_id, store_id, owner_id);

create index if not exists pos_business_day_finalization_records_applied_transaction_tenant_idx
  on public.pos_business_day_finalization_records(applied_transaction_id, store_id, owner_id);

create index if not exists pos_business_day_finalizations_owner_idx
  on public.pos_business_day_finalizations(owner_id);

create index if not exists pos_business_day_finalizations_connector_idx
  on public.pos_business_day_finalizations(connector_id);

create index if not exists pos_transaction_cash_events_payment_tenant_idx
  on public.pos_transaction_cash_events(payment_id, transaction_id, store_id, owner_id);

create index if not exists pos_transactions_finalization_tenant_idx
  on public.pos_transactions(finalization_id, store_id, owner_id);

create index if not exists pos_transactions_superseded_by_finalization_tenant_idx
  on public.pos_transactions(superseded_by_finalization_id, store_id, owner_id);

create index if not exists pos_transactions_final_import_idx
  on public.pos_transactions(final_import_id);

comment on index public.pos_business_day_finalization_records_finalization_tenant_idx is
  'Covers the tenant-safe finalization_records(finalization_id, store_id, owner_id) foreign key.';
comment on index public.pos_business_day_finalization_records_applied_transaction_tenant_idx is
  'Covers the tenant-safe finalization_records(applied_transaction_id, store_id, owner_id) audit foreign key.';
comment on index public.pos_business_day_finalizations_owner_idx is
  'Covers the pos_business_day_finalizations(owner_id) ownership foreign key.';
comment on index public.pos_business_day_finalizations_connector_idx is
  'Covers the nullable pos_business_day_finalizations(connector_id) connector foreign key.';
comment on index public.pos_transaction_cash_events_payment_tenant_idx is
  'Covers the tenant-safe cash_events(payment_id, transaction_id, store_id, owner_id) payment foreign key.';
comment on index public.pos_transactions_finalization_tenant_idx is
  'Covers the tenant-safe pos_transactions(finalization_id, store_id, owner_id) finalization audit foreign key.';
comment on index public.pos_transactions_superseded_by_finalization_tenant_idx is
  'Covers the tenant-safe pos_transactions(superseded_by_finalization_id, store_id, owner_id) supersession foreign key.';
comment on index public.pos_transactions_final_import_idx is
  'Covers the pos_transactions(final_import_id) final import audit foreign key.';
