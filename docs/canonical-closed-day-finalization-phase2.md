# Canonical Closed Business-Day Finalization Phase 2

Phase 2 adds a separate closed-period pipeline for authoritative Verifone Commander Day periods. It does not replace or route through the existing current-shift/provisional pipeline.

## Pipeline Separation

Current provisional flow:

1. Current-shift XML is normalized by `connector/storepulse-normalize-transactions.ps1`.
2. The existing provisional uploader sends JSON to `ingest-pos-transactions`.
3. `ingest-pos-transactions` calls `ingest_pos_transaction_batch`.
4. Records remain active provisional rows until a later closed-day finalization supersedes or promotes them.

Closed authoritative flow:

1. `connector/storepulse-finalize-closed-day.ps1` authenticates to Commander using Windows Credential Manager.
2. It fetches a fresh `vperiodlist` response.
3. It selects one closed Day period.
4. It fetches the exact closed Day transaction set with `cmd=vtranssetz`, `period=2`, and the selected filename.
5. It validates the returned `transSet`.
6. It derives `business_date` from the local calendar date represented by `openedTime`.
7. It runs `connector/storepulse-normalize-transactions.ps1` with explicit business-date and period metadata.
8. `connector/storepulse-upload-finalized-business-day.ps1` validates the normalized payload and computes a deterministic payload hash.
9. The uploader calls `finalize-pos-business-day` action `prepare`, which uses PostgreSQL to compute the authoritative Phase 1-compatible final source-set hash without writing finalization state.
10. The uploader calls `begin` with that authoritative hash, stages batches, and then calls `finalize`.
10. Files are archived only after finalization succeeds or an already-finalized identical payload is verified.

The closed flow does not use `app/api/connectors/pos-import`, `ingest-pos-transactions`, or the aggregate `pos_*` report parsers.

## Commander Access

The runner uses:

- `SMTCommon.dll`
- `SMTCommon.clsHTTPConnection`
- `cmd=validate`
- the returned session cookie
- `cmd=vperiodlist`
- `cmd=vtranssetz`

Credentials are read from Windows Credential Manager by target name. Passwords and session cookies must never be printed, written to disk, committed, or passed on the command line.

## Closed Day Selection

A valid closed Day candidate must:

- have period `2`
- have a filename matching `YYYY-MM-DD.<period-number>`
- not be marked current
- not be Shift period `1`

By default the runner chooses the latest closed Day filename. Use `-PeriodFilename` for controlled backfills or tests.

## Business Date

Closed Day `business_date` is derived from `openedTime`:

- use the local calendar date represented by `openedTime`
- do not use the filename date
- do not use `closedTime`
- do not use current computer date
- do not subtract one day from the filename

This handles periods that close after midnight while still belonging to the previous POS business day.

## Validation

The runner fails closed unless:

- the root local name is `transSet`
- `periodID` is `2`
- `periodname` is `Day`
- `site` matches configured source store number
- `shortId` matches the selected filename suffix
- exactly one `openedTime` and one `closedTime` exist
- both timestamps parse as `DateTimeOffset`
- `openedTime < closedTime`
- transaction/header content exists
- no Commander `fault` node exists

The uploader then validates the normalized JSON:

- root is a non-empty array
- every record has a nonblank `source_unique_id`
- source IDs are unique
- every record has explicit `source_system = verifone_commander`
- every record matches the configured source store number
- every record has the derived `business_date`
- required canonical fields are present

`expected_record_count` is the unique normalized canonical record count, not the raw XML transaction count.

## Hashes

`source_file_hash` is SHA-256 of the exact closed XML file used for normalization.

`payload_hash` is SHA-256 of the complete normalized payload using stable JSON serialization.

`final_source_set_hash` is SHA-256 of sorted `source_unique_id:canonical_hash` pairs. The uploader may compute a local diagnostic preview, but it is not finalization authority. The authoritative value is produced by `public.prepare_pos_business_day_finalization_hash`, which uses the same PostgreSQL `jsonb::text` canonical hash expression as Phase 1 staging. `begin_pos_business_day_finalization` receives this authoritative hash before any finalization session is opened. The finalization hash is not silently replaced after begin.

## Edge Function

New function:

`supabase/functions/finalize-pos-business-day/index.ts`

Authentication:

- header: `x-storepulse-connector-token`
- token is hashed server-side and matched to `store_pos_connectors`
- store, owner, connector, and source system are resolved server-side
- client-supplied tenant IDs are not trusted

Actions:

- `prepare`: validates ownership and records, then calls the read-only hash preparation RPC
- `begin`: creates/reuses a `pos_transaction_imports` row and calls `begin_pos_business_day_finalization` with the authoritative hash
- `stage`: validates ownership, payload identity, source-set hash identity, and stages one bounded batch
- `finalize`: validates ownership and optional identity fields, calls `finalize_pos_business_day`, and updates the import row
- `fail`: marks a known unfinished finalization failed only for deterministic non-retryable failures

The function does not expose raw database errors, stack traces, tokens, cookies, or service-role keys.

## Retry And Resume

Retryable conditions include:

- network loss
- timeout
- HTTP 408
- HTTP 425
- HTTP 429
- HTTP 5xx
- interrupted client process

The uploader can safely restart from the beginning:

- `prepare` is read-only and can be repeated
- `begin` is idempotent for the same payload
- stage batches are idempotent by `finalization_id + source_unique_id`
- finalization is idempotent after successful completion
- an identical already-finalized begin response skips stage/finalize and can be archived as verified
- an identical already-finalized begin response marks or reuses the matching import as completed before returning success

Do not mark finalization failed for retryable failures.

## Archive Behavior

Archive layout:

```text
<ArchiveRoot>\
  <store>\
    day\
      <business-date>\
        <period-number>\
          <source-file-hash>\
```

Archive only after:

- `finalized = true`, or
- a verified identical `already_finalized` response

Existing archives are accepted only when every file already present matches the current copied file hash. A non-identical archive collision fails closed and leaves the working files untouched. On retryable or validation failure, retain source XML, normalized JSON, reconciliation JSON, manifest, and result JSON in the working folder.

Working directories are unique for every run:

```text
<WorkingRoot>\
  <safe-store>\
    day\
      <period-number>\
        runs\
          <utc-timestamp>-<guid>\
```

Store, date, period, and hash path segments are strictly validated before they are used as directory names. Archives include an `archive-verification.json` manifest listing filenames, byte sizes, and SHA-256 hashes. Incomplete or conflicting archives fail closed.

## Dry Run

`-DryRun` allows:

- Commander read-only fetch
- closed transSet validation
- normalization
- hash calculation
- local manifest/result creation

It does not:

- call StorePulse HTTP endpoints
- write to Supabase
- archive files
- deploy anything

## Fetch Only

`-FetchOnly` allows:

- Commander authentication
- period-list retrieval
- closed Day selection
- closed transSet retrieval
- local source XML save

It does not normalize, upload, finalize, or archive.

## Configuration

Recommended environment values in the local connector `.env` or process environment:

```text
STOREPULSE_COMMANDER_INSTALL_PATH=<Transaction Manager install path>
STOREPULSE_COMMANDER_IP=<Commander host or IP>
STOREPULSE_SOURCE_STORE_NUMBER=<Commander source store number>
STOREPULSE_CLOSED_DAY_WORKING_ROOT=<local working root>
STOREPULSE_CLOSED_DAY_ARCHIVE_ROOT=<local archive root>
STOREPULSE_FINALIZATION_URL=https://<project>.supabase.co/functions/v1/finalize-pos-business-day
```

Set `STOREPULSE_CONNECTOR_TOKEN` in the same environment using the connector token from the isolated or approved target setup. Do not write the token value in documentation, logs, manifests, or command history.

Never commit `.env`, credentials, tokens, source XML, normalized JSON, result files, or production output.

## Controlled Test Procedure

1. Apply Phase 1 finalization migration:
   `supabase/migrations/20260712093000_create_pos_business_day_finalization.sql`
2. Apply Phase 1 FK index migration:
   `supabase/migrations/20260712100000_add_pos_finalization_fk_indexes.sql`
3. Apply Phase 2 authoritative hash-preparation migration:
   `supabase/migrations/20260712210000_prepare_pos_business_day_finalization_hash.sql`
4. Run:
   `supabase/tests/canonical_business_day_finalization.sql`
5. Run:
   `supabase/tests/canonical_business_day_hash_preparation.sql`
6. Deploy only `finalize-pos-business-day` to the isolated project.
7. Run synthetic HTTP prepare/begin/stage/finalize tests.
8. Configure a non-production connector token for the isolated store.
9. Run the Phase 2 test script:

```powershell
powershell -ExecutionPolicy Bypass -File .\connector\tests\test-finalized-business-day-phase2.ps1
```

10. Run the runner with `-FetchOnly`.
11. Run the runner with `-DryRun`.
12. Only then run a controlled finalization against the isolated project.

## Rollback

The current-shift pipeline is isolated and can continue using `ingest-pos-transactions`.

If the closed-day runner or Edge Function must be rolled back:

- stop using `storepulse-finalize-closed-day.ps1`
- remove or undeploy only `finalize-pos-business-day`
- leave Phase 1 lifecycle/audit tables intact
- do not delete superseded records
- do not modify the Reports Phase 1B stash as part of this rollback

## Future Scheduling

Phase 2 intentionally does not create or modify Windows scheduled tasks. Scheduling should be added only after isolated testing and a controlled production smoke test prove the one-shot workflow.
