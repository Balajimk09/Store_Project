# Canonical POS Business-Day Finalization

StorePulse imports Verifone current-shift transactions while a POS period is still open. Those records are useful for live verification, but they are provisional because the final closed period can later complete, void, recall, correct, replace, or omit records that appeared during the live shift.

## Live/Open Business Day

- Live/current-shift records are stored as active provisional transactions.
- Active provisional records are reportable as live, partial POS data.
- If no explicit `business_date` is supplied, the database derives it from `transaction_time` in the store timezone.
- Live import must not overwrite a business day that has already been finalized from a closed-period source set.
- If a live/current-shift upload later targets an already-finalized business date, the database returns a compatible no-op result and leaves final, superseded, child, cash-event, and finalization records unchanged.

## Closed Business Day

- A closed-period import represents the complete authoritative source set for one POS business date.
- The normalized closed-period payload must include the explicit POS `business_date`.
- Finalization stages every authoritative closed record first, then applies all records atomically.
- Shared source IDs become final active records.
- Changed shared source IDs are updated and become final active records.
- Final-only source IDs are inserted as final active records.
- Active provisional source IDs absent from the final closed set are marked superseded and inactive.
- Superseded rows remain stored for audit but are excluded from active reporting.
- Re-running the same closed payload is idempotent.
- A different payload for an already-finalized source period must use a future reopen/correction workflow rather than silently replacing the day.

## Accounting Concepts

Gross sales, tender collected, and drawer cash movement are separate concepts.

- Gross sales comes from authoritative transaction headers for sale transaction types.
- Tender collected comes from payment/tender records.
- Drawer cash movement comes from normalized cash events.
- Cashback principal is not sales revenue.
- Cashback fees remain separate from cashback principal. Future business rules may classify cashback fees as service-fee revenue, but Phase 1 does not add them to product or fuel gross sales.
- Paid out is not sales revenue.
- Safe drop is not sales revenue.
- Lottery payout is not sales revenue and must remain distinct from generic paid out.
- Unknown cash events require review and do not affect sales.
- Generated cash events are synchronized from transaction headers/payments and may be replaced on future transaction upserts.
- Manual/reviewed cash events are preserved across transaction upserts so reviewed lottery payouts or other drawer adjustments are not overwritten by generic synchronization.

Example reconciliation shape:

```text
7210.19 gross sales
+ 50.00 cashback
+ 6.00 cashback fees
= 7266.19 tender gross
```

The example explains accounting categories only. Production code must not hardcode these amounts.

## Reporting Rules

- Finalized business date: use active final records.
- Open/live business date: use active provisional records.
- Superseded records: never included in active totals.
- Mixed finalized/live ranges aggregate active records per business date.
- Cash-management and cashier-exception events remain visible in operational reporting but do not increase sales.

## Operational Notes

- Finalization is database-atomic and protected by a store/source/business-date advisory lock.
- Begin/resume finalization also uses the same transaction-level advisory lock before looking up or creating mutable sessions. Repeated begin calls for the same source scope and payload resume the same session; true concurrent validation should be included in isolated database execution because the SQL regression script runs in one session.
- Current-shift ingestion remains backward compatible for open days.
- Staged closed-period normalized payloads are backend-only because they contain raw transaction headers, child rows, relationships, payments, and metadata.
- The connector workflow that uploads and finalizes real closed days is intentionally deferred to Phase 2.
- The TypeScript transaction data layer now filters canonical transaction queries with `is_active = true`; apply the database migration before deploying application code that depends on that column.
- Existing-row lifecycle backfill is verified by migration ordering and static inspection: existing rows receive `record_lifecycle = 'provisional'`, `is_active = true`, and no finalization or supersession audit fields before strict lifecycle constraints are added. A true pre/post backfill test requires a migration harness or a database snapshot created before applying the migration.
- During isolated execution, verify the backfill with a direct post-migration query that confirms all pre-existing canonical rows are active provisional rows with null finalization and supersession fields.
- The follow-up FK index migration adds covering indexes for finalization audit, staging, transaction lifecycle, and tenant-safe cash-event payment foreign keys. It should be applied after the Phase 1 schema migration.

## Production Rollout

1. Pause the `StorePulse-CurrentShift-Sync` scheduled task while applying the migration.
2. Apply the migration and verify the lifecycle backfill, grants, RLS, report RPCs, and current live-ingestion compatibility.
3. Deploy TypeScript code that queries `is_active` only after the migration is present.
4. Resume `StorePulse-CurrentShift-Sync` after migration verification.
5. Do not enable real closed-day begin/stage/finalize connector wiring until Phase 2 is reviewed and deployed.

This Phase 1 migration contains `ALTER TABLE`, deterministic backfill, and normal non-concurrent indexes. Current data volume is small enough for that shape, but future large installations may need split migrations and `CREATE INDEX CONCURRENTLY` outside a transaction-wrapped migration.

Same closed payload finalization is idempotent. A conflicting payload for an already-finalized source period is rejected and requires a future explicit correction/reopen workflow. Superseded transactions remain audit records and must not be deleted.

If report behavior must be rolled back, restore the prior report RPC definitions while retaining lifecycle and finalization audit data. Do not drop lifecycle columns or delete finalization rows as an operational rollback.

## Rollback Boundary

Phase 1 adds schema, SQL contracts, and typed vocabulary. It does not deploy the connector workflow that finalizes real closed days.

If Phase 2 rollout finds an issue before finalizing any production day, stop using the new finalization RPCs and continue live ingestion with active provisional records. If a day has already been finalized, do not delete finalization rows or superseded transactions manually; use a reviewed reopen/correction migration or RPC so the audit trail remains intact.
