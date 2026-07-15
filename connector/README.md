# StorePulse POS Connector

This connector watches a folder on the store's POS computer for exported Verifone Commander report files and uploads them automatically to StorePulse.

It is intended for folders where Commander or Report Navigator writes exported report files such as `.html`, `.htm`, `.xml`, `.csv`, `.xlsx`, `.xls`, or `.zip`.

## What This Does Not Do

This connector only uploads files to StorePulse.

It does not directly update products.
It does not update stock quantities.
It does not write anything back to Commander.
It does not assume an official Verifone API exists.
It does not approve or create new products automatically.

All review and approval of new product data still happens manually in the StorePulse New Products screen.

## Requirements

Node.js 18 or newer must be installed on the store laptop.

No other dependencies are required. There is no install step.

## Generate A Connector Token

From the project root, run:

```powershell
node connector/generate-token.mjs
```

The raw connector token is shown once. Save it immediately into the connector laptop's local `.env` file. Do not paste it into chat, commit it to git, or store it anywhere else.

The script also prints a SHA-256 token hash. Insert that hash into `store_pos_connectors.token_hash` in Supabase for the store that owns this connector.

Placeholder example:

```sql
insert into public.store_pos_connectors (
  store_id,
  connector_name,
  source_system,
  token_hash,
  status
) values (
  '00000000-0000-0000-0000-000000000000',
  'Example Store Laptop Connector',
  'verifone_commander',
  'replace-with-generated-token-hash',
  'active'
);
```

Use a real `store_id` from Supabase and a freshly generated token hash. Do not use the placeholder values above.

## Configure

Copy the example environment file:

```powershell
Copy-Item connector/.env.example connector/.env
```

Fill in real values in `connector/.env`:

```text
STOREPULSE_API_URL=https://your-storepulse-domain.com
STOREPULSE_CONNECTOR_TOKEN=paste-your-generated-token-here
STOREPULSE_WATCH_FOLDER=C:\Verifone\ReportNavigator\cache\AB123
STOREPULSE_ARCHIVE_FOLDER=C:\Verifone\StorePulseArchive
STOREPULSE_POLL_SECONDS=60
STOREPULSE_DRY_RUN=false
STOREPULSE_ONCE=false
```

`STOREPULSE_ARCHIVE_FOLDER` is optional. If it is not set, uploaded files stay in place and the connector uses `connector/.upload-state.json` to avoid re-uploading the same file hash.

`STOREPULSE_ONCE=true` runs one scan, processes any stable files, then exits cleanly. Leave it unset or set it to `false` to keep polling continuously.

## Dry Run

Use dry-run mode first to confirm the watch folder is correct without uploading anything:

```powershell
set STOREPULSE_DRY_RUN=true
node connector/storepulse-connector.mjs
```

Dry-run mode logs which supported files would be uploaded. It does not call StorePulse, write local upload state, or move files.

## Run Continuously

Run the connector:

```powershell
node connector/storepulse-connector.mjs
```

The connector scans the watch folder, waits for each file to stop changing, uploads stable files, then waits for the configured poll interval before scanning again.

Use `Ctrl+C` to stop it cleanly.

For a one-time scan, set `STOREPULSE_ONCE=true` before running the script. This is useful for scheduled runs or quick verification.

For production use on a store laptop, this should eventually run through Windows Task Scheduler or as a background process so it starts automatically and keeps running. That setup is not built in this session; this is a manual run for now.

## Local State

The connector stores best-effort upload markers in:

```text
connector/.upload-state.json
```

This file stores uploaded file hashes and timestamps only. It never stores the raw connector token.

The server remains the source of truth for duplicate detection. If this local file is deleted or corrupted, the connector may upload an old file again, and StorePulse will respond with a duplicate result instead of inserting duplicate POS rows.

## Troubleshooting

### Connector token was rejected

Check that the raw token in `connector/.env` is correct and that the connector row in Supabase is still `active`.

If the raw token was lost, generate a new token and update the connector row with the new token hash.

### Files are not uploading

Confirm `STOREPULSE_WATCH_FOLDER` points to the folder where Commander exports reports.

Confirm the files use supported extensions:

```text
.html .htm .xml .csv .xlsx .xls .zip
```

### Files are stuck and never uploading

The connector waits for files to stabilize before uploading. It checks file size and modification time, waits three seconds, then checks again.

If Commander is still writing the file, the connector skips it for that cycle and checks again on the next poll.

### Upload works once, then old files are skipped

That is expected when `STOREPULSE_ARCHIVE_FOLDER` is not configured. The local state file records uploaded hashes so the connector does not keep making unnecessary network calls for files StorePulse has already seen.

## Windows Launcher

`connector/start-connector.bat` starts the connector from the connector folder and automatically restarts it if the Node process exits.

To run it manually, double-click:

```text
connector/start-connector.bat
```

The console window stays open so recent connector logs are visible for troubleshooting.

To start the connector automatically when Windows boots:

1. Press `Win + R`.
2. Type `shell:startup`.
3. Press `Enter`.
4. Right-click `start-connector.bat`.
5. Choose `Create shortcut`.
6. Move the shortcut into the Startup folder.

Windows Task Scheduler is a more robust future option for production store laptops, but Task Scheduler setup is not built here.

Before using the launcher on a real store laptop, make sure `connector/.env` exists and contains real connector values. Never commit `connector/.env` to git.

## POS business dates for normalized transactions

`connector/storepulse-normalize-transactions.ps1` supports an optional `-BusinessDate YYYY-MM-DD` parameter for closed Verifone periods.

Live/current-shift payloads should omit `-BusinessDate`. When it is omitted, the normalizer does not emit a `business_date` field, and StorePulse derives `business_date` from `transaction_time` using the store timezone.

Closed-period payloads should provide the POS business date explicitly. When `-BusinessDate` is supplied, every emitted canonical transaction includes that exact `business_date`, and the database uses it instead of deriving the date from the transaction timestamp. This is required for closed periods that continue after midnight.
