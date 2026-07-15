# Connector Heartbeat Verification CI

The workflow at `.github/workflows/connector-heartbeat-verification.yml` is the
isolated deployment gate for the connector heartbeat migration and Edge
Function tests.

## Required Checks

Before deploying the heartbeat migration or Edge Function, require these GitHub
Actions checks:

- `heartbeat-edge-function-tests`
- `heartbeat-database-tests`
- `application-build`
- `windows-connector-regressions`

## Pinned Tooling

- Node.js: `20.20.2`
- Deno: `2.9.2`
- Supabase CLI: `2.109.1`

External actions are pinned to immutable commit SHAs:

- `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5`
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`
- `denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed`
- `supabase/setup-cli@46f7f98c7f948ad727d22c1e67fab04c223a0520`

These are official actions from GitHub, Deno, and Supabase, pinned so CI cannot
silently move to a different implementation.

## What The Gate Verifies

- Heartbeat Edge Function Deno type checks.
- At least 55 executable heartbeat Edge Function tests pass.
- A local Supabase stack starts on the GitHub runner.
- The full migration chain applies on a clean local database.
- `supabase/tests/connector_heartbeat_status.sql` passes against the local
  database.
- The local database reset/reapply path succeeds.
- Local database lint runs where supported by the pinned Supabase CLI.
- `npm run typecheck`, `npm run build`, and `git diff --check` pass.
- Windows connector PowerShell parser and regression suites pass on a Windows
  runner.

The workflow does not use the linked production Supabase project, production
database credentials, connector tokens, Commander credentials, or StorePulse
production endpoints.

## Local Database Fallback

On a development machine with Docker, Supabase CLI `2.109.1`, and `psql`
available:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-heartbeat-database.ps1
```

The script starts local Supabase, resets the isolated local database, runs the
heartbeat SQL regression, and stops local Supabase in `finally`.

The script fails closed if it detects a remote database URL, linked Supabase
project metadata, or production-looking Supabase environment variables.
