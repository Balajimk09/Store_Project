# POS Publishing Runtime Wiring

This branch wires the existing offline `update_price` worker into the machine-wide connector runtime. It does not activate publishing: `pos_publish_enabled` defaults to `false` and existing machine configurations continue with publishing disabled.

## Configuration

The machine config supports these non-secret fields:

- `pos_publish_enabled`: `false` by default. The configurator, installer, repair path, and upgrade path forcibly reset it to `false` for every new, existing, upgraded, legacy, or partially populated configuration. A prior `true` value is never preserved by a real write.
- `pos_publish_poll_seconds`: `60` by default; allowed range is 30 through 3600 seconds.
- `pos_publish_child_timeout_seconds`: `60` by default; allowed range is 5 through 300 seconds.
- `pos_publish_claim_endpoint_url` and `pos_publish_report_endpoint_url` remain derived compatibility fields; the runtime does not trust them as an origin source.

Publishing requires a trusted existing HTTPS source endpoint: ingest (`/functions/v1/ingest-pos-transactions`) or heartbeat (`/functions/v1/report-pos-connector-heartbeat`). Allowed URL paths alone do not establish trust. The installed, product-owned `lib/storepulse-origin-policy.json` pins the current approved production origin to exactly `https://kurnxpzcgcvsjmxsqjok.supabase.co`; Node and PowerShell compare the original validated scheme, hostname, port, and path spelling case-sensitively before deriving claim and report URLs. Only the exact lowercase ingest and heartbeat paths are allowed. The canonical policy format requires lowercase `https`, a lowercase hostname, no explicit port (including `:443`), no trailing slash, path, query, fragment, userinfo, wildcard, or percent encoding. Uppercase scheme, hostname, or path variants are rejected. URL normalization must not widen this installed trust policy: an explicit `:443` is rejected because the installed policy omits it. Config, stdin, environment variables, command-line arguments, and runtime callers cannot replace this policy. Missing or malformed policy fails closed before API-client construction or token transmission. Adding staging or another StorePulse project requires an intentional reviewed product release that changes the installed policy.

The installer is fully non-mutating under `-WhatIf`: it reads and validates the pending configuration change in memory, then obtains `ShouldProcess` approval before creating a configuration backup, temporary file, directory, ACL, service, or other installation artifact. Therefore an existing enabled value remains untouched during a dry run. The approved post-`ShouldProcess` workflow is shared with offline installer tests through `storepulse-machine-installer-core.ps1`, preventing production and test workflows from drifting. A real install, repair, or upgrade still writes the safe disabled value. This branch remains disabled for real installations and must not be installed in production.

## Secret Boundary

The service decrypts the existing DPAPI-protected connector token only in memory. For a publishing poll it starts a dedicated Node child with no token, Commander credential, or cookie in command-line arguments, files, or child environment. A bounded JSON payload is passed once through redirected UTF-8 standard input and stdin closes immediately after writing; no payload is written to disk or logged.

Child execution is bounded by `pos_publish_child_timeout_seconds`. The active-child guard enters an immediate `try`/`finally` lifecycle, so initialization failures cannot leave publishing permanently busy. The service checks for shutdown while waiting, kills a timed-out or shutdown child, drains both capped output streams, and disposes the process. Offline tests prove local child termination after timeout and shutdown. Child output is limited to 4 KiB per stream and must be one exact JSON result with only `outcome`, `state`, `last_job_id`, and `last_error_code`; every value is allowlisted before it can reach status or logs. The shared non-secret `lib/pos-publish-result-contract.json` is required during service validation and is validated by both Node and PowerShell, including every contract category. It distinguishes child-result `error_codes` from parent lifecycle `parent_error_codes`, so neither vocabulary can silently drift. The stdin sentinel tests also capture parent stdout, stderr, warning/verbose streams, exception text, logs, status, temporary files, backup files, and child process metadata.

Publishing status contains only `enabled`, `state`, `last_poll_at`, `last_outcome`, `last_job_id`, and `last_error_code`. Runtime status JSON is written to a temporary file in the same directory and atomically replaced, so readers do not observe partial JSON. Replacement retries are limited to Windows sharing and lock violations; all other failures preserve the previous valid status and fail immediately.

## Current Limitation

Commander authentication and the Commander protocol adapter remain intentionally absent. When publishing is enabled on this branch, the child detects the missing adapter and returns a safe configuration error before creating an API client or claiming a job. This branch must not be installed or activated in production. A future activation requires a separately reviewed Commander adapter.
