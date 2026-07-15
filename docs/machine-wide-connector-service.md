# StorePulse Machine-Wide Connector Service

Phase 3 creates the foundation for a machine-wide Windows connector that can later run as LocalSystem or a dedicated service identity. Checkpoint 5 adds pilot-ready packaging, first-time machine configuration, private Node runtime validation, and end-to-end offline install validation. Repository work still does not install or register the service on any machine.

## Target Architecture

The connector is split into durable machine configuration, encrypted machine secrets, reusable worker scripts, and a preliminary host script.

- Live worker: continues to use the existing provisional/current-shift connector flow.
- Closed-day worker: continues to use the proven closed business-day finalization flow.
- Service host: validates configuration and secrets, locates scripts, writes machine logs, and supports a single-run mode for later service integration.
- Installer scaffold: copies files only when explicitly requested and never registers a service in this checkpoint.

## Layout

Installed binaries belong under Program Files:

```text
C:\Program Files\StorePulse\Connector
```

Machine data belongs under ProgramData:

```text
C:\ProgramData\StorePulse
  config.json
  secrets.json
  logs\
  working\
  archive\
  state\
```

`config.json` contains non-secret operational values only. `secrets.json` contains DPAPI-encrypted values only.

Verifone runtime files, when prepared locally on a store laptop, belong under:

```text
C:\Program Files\StorePulse\VerifoneRuntime
```

The StorePulse ZIP never distributes `SMTCommon.dll` or any other proprietary Verifone binary.

## Machine-Wide Configuration

The machine config stores:

- `source_store_number`
- `commander_ip`
- `commander_install_path`
- `live_endpoint_url`
- `finalization_endpoint_url`
- `live_poll_interval_seconds`
- `closed_day_poll_interval_seconds`
- optional install/data path overrides
- optional one-shot worker enablement flags for future rollout

Configuration must not include connector tokens, Commander usernames, Commander passwords, cookies, or service-role keys.

`configure-storepulse-machine-connector.ps1` is the first-time setup entrypoint. It supports ValidateOnly, interactive setup, and noninteractive installer-friendly setup with secure secret input. It writes config through `storepulse-machine-config.ps1` and encrypted secrets through `storepulse-machine-secrets.ps1`.

## Machine-Owned Verifone Runtime

The StorePulse connector requires Verifone's `SMTCommon.dll` at runtime, but StorePulse does not package or redistribute that file. A target machine must already have a licensed Verifone Site Management Tools installation.

An administrator prepares the machine-owned runtime by running:

```text
prepare-storepulse-verifone-runtime.ps1 -Mode ValidateSource -SourceDllPath "<local Verifone>\SMTCommon.dll"
prepare-storepulse-verifone-runtime.ps1 -Mode Install -SourceDllPath "<local Verifone>\SMTCommon.dll"
prepare-storepulse-verifone-runtime.ps1 -Mode ValidateInstalled
```

The source path is always supplied explicitly at runtime. The helper does not default to any employee profile, does not request an employee Windows password, does not call Commander, and does not create services, scheduled tasks, config, or secrets.

Install mode copies only `SMTCommon.dll` into:

```text
C:\Program Files\StorePulse\VerifoneRuntime
```

It validates the file name, length, SHA-256, version metadata, Authenticode status, and isolated .NET assembly loading. The isolated validator confirms `SMTCommon.clsHTTPConnection` exists and can be instantiated without setting credentials, calling `GetData`, opening Commander, or making any network request.

The helper writes `storepulse-verifone-runtime.json` beside the copied DLL. The manifest contains non-secret runtime metadata such as hashes, file length, destination root, assembly name, validated type, and validation status. It intentionally does not persist the original user-profile source path. The original Verifone installation remains installed and owned by Verifone.

After this preparation succeeds, machine config should set `commander_install_path` to:

```text
C:\Program Files\StorePulse\VerifoneRuntime
```

This keeps LocalSystem service execution independent of an employee profile while leaving the employee profile and Verifone source installation untouched.

Real machine-wide writes require elevated PowerShell. ValidateOnly performs syntactic validation only and makes no network calls.

## Encrypted Secrets

Secrets are stored in:

```text
C:\ProgramData\StorePulse\secrets.json
```

Required secret names:

- `commander_username`
- `commander_password`
- `connector_token`

Values are protected with Windows DPAPI LocalMachine scope so they are not tied to an employee Windows profile. The file ACL is tightened to SYSTEM and Administrators where possible.

Secret rotation should run the configuration tool again with only the secret values being replaced. Config values are preserved unless explicitly supplied. Secrets must not be placed on command lines in production operation.

## LocalSystem Service Model

The Windows Service is named `StorePulseConnector` with display name `StorePulse Connector Service`. It is designed to run as LocalSystem through the native WinSW service wrapper. It must not depend on `%USERPROFILE%`, employee credential stores, or user-specific scheduled tasks. Commander credentials and StorePulse tokens are read from machine secrets at runtime.

The Windows Service ImagePath points to the native wrapper:

```text
C:\Program Files\StorePulse\Connector\service\host\StorePulseConnector.exe
```

The WinSW XML beside the wrapper launches:

```text
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\StorePulse\Connector\service\storepulse-service-entrypoint.ps1"
```

The wrapper XML and command line contain no connector token, Commander password, cookie, or service-role credential. Wrapper logs are written under `C:\ProgramData\StorePulse\logs\service-host`.

Startup is explicit:

- `ManualPilot`: service is installed as Manual and remains stopped. This is the default pilot mode so a reboot cannot start a duplicate connector while the legacy scheduled task is still active.
- `AutomaticDelayed`: service is installed as Automatic delayed-start and is used only during explicit cutover.

Fresh service registration and existing-service reconfiguration are separate operations. WinSW `install` is used only when `StorePulseConnector` is not already registered. Installed-service startup-mode changes update both the WinSW XML and the Service Control Manager registration with `sc.exe config StorePulseConnector start= demand` for `ManualPilot` or `sc.exe config StorePulseConnector start= delayed-auto` for `AutomaticDelayed`.

Startup-mode transitions require the service to be stopped. `SetAutomaticDelayed` also requires valid config, encrypted machine secrets, private Node, WinSW, Verifone runtime, and the legacy `StorePulse-CurrentShift-Sync` scheduled task to be disabled. `SetManualPilot` is the safe rollback mode and can be used whether the legacy scheduled task is enabled or disabled. If XML or SCM update verification fails, the helper restores the previous XML/SCM state and leaves the service stopped.

Service start fails closed when `StorePulse-CurrentShift-Sync` is enabled unless an administrator passes the explicit pilot override. Source code never disables that scheduled task automatically.

This repository checkpoint intentionally does not:

- create a service account
- register a scheduled task
- modify existing scheduled tasks
- request employee Windows passwords

Service registration is available only through the installer/control scripts when an administrator explicitly runs them outside tests.

## Workers

### Live Worker

The live worker uses the existing provisional/current-shift connector in one-shot mode through the bundled private Node runtime:

```text
C:\Program Files\StorePulse\Connector\runtime\node\node.exe storepulse-connector.mjs --once --summary-path <ProgramData>\StorePulse\state\live-once-summary.json
```

The current user-specific prototype still defaults to continuous polling when launched without `--once`. The machine-wide runtime controls repetition by launching one scan cycle per worker interval instead of letting the connector run its own endless loop.

The live connector summary JSON contains:

- `scanned`
- `eligible`
- `uploaded`
- `skipped_duplicate`
- `skipped_unstable`
- `failed`
- `started_at`
- `completed_at`

Exit code `0` means the one-shot cycle completed successfully, including when there were no new files or only duplicates. A non-zero exit means a real configuration, processing, or upload failure occurred.

Secrets are passed to the connector through process environment variables, not command-line arguments. The runtime clears/restores process environment variables after invocation.

Installed service mode never falls back to a globally installed `node` from `PATH`. If the private runtime is missing or invalid, the live worker records a non-secret `runtime_missing` or `runtime_invalid` failure.

### Closed-Day Worker

The closed-day worker remains the existing closed-day finalizer. The host can invoke it in future one-shot mode using machine-configured install, working, archive, endpoint, and store values. Validate mode never archives or finalizes anything.

## Runtime Lifecycle

Checkpoint 2 adds `storepulse-service-runtime.ps1`, a dot-sourceable runtime library that can later be hosted by a Windows Service wrapper. The runtime supports:

- `Validate`: load config/secrets, validate required scripts, write initial status, and perform no upload/finalization.
- `Once`: run each enabled worker once and exit.
- `Run`: loop until a stop file is created or the process is terminated.

The host script delegates to the runtime and prints only non-secret startup information.

## Locking

The runtime uses a machine-wide lock file under ProgramData state:

```text
C:\ProgramData\StorePulse\state\runtime.lock
```

The lock file is opened exclusively while the runtime is active. A second runtime instance fails rather than running duplicate live or closed-day workers.

## Cancellation

The control scaffold can request graceful cancellation by creating:

```text
C:\ProgramData\StorePulse\state\runtime.stop
```

Run mode checks the stop file between worker cycles. Process termination is also supported by the operating system or future service wrapper.

## Heartbeat and Status

The runtime writes a heartbeat/status file:

```text
C:\ProgramData\StorePulse\state\runtime-status.json
```

It contains:

- runtime version
- process ID
- started timestamp
- last heartbeat timestamp
- live worker status
- closed-day worker status
- heartbeat reporter status
- last success/failure timestamps
- bounded non-secret error summaries

Secrets are redacted before status is written.

## Remote Connector Heartbeat

Package version `3.1.0-heartbeat1` adds remote heartbeat reporting for future Online, Ready, Syncing, Delayed, Offline, Error, Setup Required, connector-version, and last-sync monitoring. Heartbeat fields extend the existing `store_pos_connectors` row; StorePulse does not create a competing connector-status table and does not overload the administrative `status = active/disabled` column.

The machine stores a stable non-secret installation UUID at:

```text
C:\ProgramData\StorePulse\state\installation-id.txt
```

The ID is created once, preserved during repair and upgrade, and not included in packages. If the file exists but is malformed, the service fails closed instead of silently regenerating it. The first valid heartbeat may bind the server connector row to this installation ID. A different ID later returns `409 installation_mismatch`; laptop replacement requires a future authorized reset workflow.

Heartbeat config fields are:

- `heartbeat_enabled`
- `heartbeat_endpoint_url`
- `heartbeat_payload_version`
- `heartbeat_timeout_seconds`

When upgrading existing config, `heartbeat_endpoint_url` can be derived from `live_endpoint_url` only when the live URL ends with `ingest-pos-transactions`; the derived URL ends with `report-pos-connector-heartbeat`.

The runtime reports `starting`, `syncing`, `ready`, `degraded`, `error`, and best-effort `stopping`. The laptop never reports `offline`; the future UI derives offline from stale server-side `last_heartbeat_at`.

Heartbeat upload failures are isolated from transaction ingestion. A failed heartbeat updates local `heartbeat_reporter` state and redacted logs, then retries on the next opportunity. It must not fail an otherwise successful Current Shift sync.

Safe error codes include `commander_unreachable`, `commander_authentication_failed`, `commander_response_invalid`, `normalization_failed`, `cloud_unreachable`, `cloud_unauthorized`, `cloud_rejected`, `heartbeat_unreachable`, `heartbeat_unauthorized`, `heartbeat_rejected`, and `unknown_error`.

Backend deployment after isolated validation:

```powershell
supabase db push
supabase functions deploy report-pos-connector-heartbeat --no-verify-jwt
```

## Backoff

Worker failures are isolated per worker. A live worker failure does not stop the closed-day worker, and a closed-day worker failure does not stop the live worker. Each worker tracks consecutive failures and receives bounded exponential backoff up to five minutes.

Run mode repeats one-shot worker cycles according to configured poll intervals. If a worker fails, that worker uses bounded exponential backoff while the other worker may continue on its own cadence.

## Runtime Logging

Runtime logs are JSON lines under:

```text
C:\ProgramData\StorePulse\logs\runtime-YYYYMMDD.jsonl
```

Each event includes a timestamp, level, event name, and sanitized data object. Logs must not contain Commander passwords, connector tokens, session cookies, or service-role keys.

## Local Control Scaffold

`storepulse-service-control.ps1` provides local commands only:

- `InstallStatus`: report whether the Windows Service registration exists.
- `PilotStatus`: report the ManualPilot plan and legacy scheduled-task state.
- `CutoverStatus`: report service, config, secrets, runtime, task, worker-enable, and readiness fields without changing anything.
- `SetManualPilot`: configure an installed stopped service as Manual without invoking WinSW `install`.
- `SetAutomaticDelayed`: configure an installed stopped service as Automatic delayed-start only after cutover prerequisites pass.
- `Status`: print the heartbeat/status JSON.
- `Start`: request Windows Service start.
- `Stop`: create the stop file and, for service control flows, request service stop through the service helper.
- `Restart`: request Windows Service restart.
- `Validate`: run host Validate mode.
- `RunForeground`: run host Run mode in the current console.

It does not expose secrets and combines the Windows Service state with the runtime heartbeat where available.

## Windows Service Wrapper

`storepulse-windows-service.ps1` is safe to dot-source and provides reusable functions for WinSW service install, status, start, stop, restart, removal, and recovery policy configuration. The package pins the official WinSW x64 release in `winsw-manifest.json`; the binary is downloaded only during packaging, hash-verified, and placed at `service\host\StorePulseConnector.exe`. The StorePulse source repository does not commit the WinSW executable.

The recovery policy in the generated WinSW XML is:

- first failure: restart after 1 minute
- second failure: restart after 5 minutes
- subsequent failures: restart after 15 minutes
- reset failure count after 1 day

The helper uses explicit path quoting and rejects service entrypoints or wrapper paths outside the expected install root.

The installer does not install Node globally. Production packaging should bundle a vetted private Node runtime under:

```text
C:\Program Files\StorePulse\Connector\runtime\node
```

## Private Node Runtime Packaging

The package includes `node-runtime-manifest.json` with:

- required Node major version
- expected relative path
- executable name
- architecture
- expected `node.exe` SHA-256
- source/version metadata

Before pilot installation, an administrator must obtain a vetted Windows Node runtime from the approved distribution channel, place `node.exe` under `runtime\node`, compute its SHA-256, and replace the manifest placeholder with the exact 64-character hash. The installer and runtime validate the private runtime and fail closed on:

- missing `node.exe`
- SHA-256 mismatch
- architecture mismatch
- manifest still containing a placeholder hash

The installer never downloads Node and never uses global Node for service execution.

## Install Validation

`test-storepulse-installation.ps1` performs offline validation and writes a JSON report under ProgramData state or a supplied output path. Modes include:

- `ValidateFiles`
- `ValidateConfig`
- `ValidateSecrets`
- `ValidateRuntime`
- `ValidateServicePlan`
- `SmokeTestOnce`
- `All`

`SmokeTestOnce` requires no-production mode in this checkpoint and uses injected/mock workers. It must not call Commander, Supabase, service registration, or scheduled tasks.

## Logging

Machine logs are written under:

```text
C:\ProgramData\StorePulse\logs
```

Logs must not include:

- connector tokens
- Commander passwords
- session cookies
- service-role keys
- raw secrets

## Upgrades

Upgrade requires `StorePulseConnector` to be stopped, backs up the existing Program Files connector tree, replaces binaries, restores the previous binaries on copy or startup-mode failure, regenerates the WinSW XML, reapplies the preserved or explicitly requested SCM startup mode, and leaves the service stopped. ProgramData config, secrets, logs, working data, archives, and state are durable machine state and must survive binary replacement.

Repair and upgrade preserve the existing startup mode when `-StartupMode` is omitted. Passing `-StartupMode ManualPilot` or `-StartupMode AutomaticDelayed` explicitly changes the installed mode after package files are repaired or upgraded. Neither repair nor upgrade invokes WinSW `install` when the service already exists.

Rollback checklist:

1. Stop `StorePulseConnector`.
2. Restore the previous Program Files connector tree from the upgrade backup.
3. Preserve ProgramData unchanged.
4. Run `test-storepulse-installation.ps1 -Mode All -NoProduction`.
5. Start the service only after validation passes.

## Repair

Repair should validate:

- expected scripts exist under Program Files
- `config.json` contains no secrets
- `secrets.json` contains encrypted required values
- logs, working, and archive directories exist or can be created
- `StorePulseConnector` service registration exists and points to the Program Files entrypoint
- the private Node runtime path exists or is prepared by the installer packaging

Repair should not reset secrets unless an administrator explicitly performs secret rotation.

## Uninstall

Uninstall stops and removes `StorePulseConnector`, then removes installed binaries. It preserves ProgramData config, secrets, logs, working data, archives, and state by default. `-PurgeData` is explicit, high-impact, and requires confirmation before ProgramData is removed.

If any removal step fails, the administrator should stop and inspect the printed path/service state before retrying. ProgramData should not be manually deleted unless the store is intentionally decommissioned and audit evidence has been retained elsewhere.

## Security Boundaries

- Secrets stay out of command-line arguments whenever practical.
- Config stays non-secret.
- DPAPI LocalMachine protects secrets for machine service use.
- ProgramData ACLs should restrict `secrets.json` to SYSTEM and Administrators.
- The service host does not perform database schema changes or Edge Function deployments.
- The service installer never requests an employee Windows password.
- The service command line is built only from Program Files paths and never includes store tokens or Commander credentials.
- ProgramData is preserved across upgrades and uninstall unless `-PurgeData` is explicitly confirmed.

## Pilot Installation Checklist

1. Build or copy the connector package with a vetted private Node runtime under `runtime\node`.
2. Replace the Node manifest SHA-256 placeholder with the vetted `node.exe` hash.
3. Prepare the machine-owned Verifone runtime from the local licensed `SMTCommon.dll`.
4. Run installer `-ValidateOnly` and confirm the manifest, service command, Program Files path, ProgramData path, and runtime expectation.
5. Run `configure-storepulse-machine-connector.ps1 -ValidateOnly` with pilot configuration values, including `commander_install_path` set to `C:\Program Files\StorePulse\VerifoneRuntime`.
6. Write machine config and DPAPI LocalMachine secrets through the configuration script.
7. Run `test-storepulse-installation.ps1 -Mode All -NoProduction`.
8. Install on a non-production pilot machine using `-Install` from elevated PowerShell only after validation passes.
9. Run `storepulse-service-control.ps1 -Command Validate`.
10. Run `RunForeground` against test endpoints and synthetic connector data.
11. Start the Windows Service only after Validate/RunForeground results are clean.
12. Monitor `runtime-status.json`, JSONL logs, and the install validation report.
13. Keep the legacy user-specific task disabled only after the service has proven stable for the pilot.

## HUB Migration Sequence

1. Inventory the current prototype task and connector paths without changing them.
2. Prepare the machine-owned Verifone runtime from the local licensed `SMTCommon.dll`.
3. Prepare Program Files and ProgramData package on a non-production machine.
4. Validate config, encrypted secrets, private Node, Verifone runtime, service plan, and no-production smoke test.
5. Run one controlled foreground service cycle against pilot endpoints.
6. Pause the legacy user-specific task only during the approved cutover window.
7. Start `StorePulseConnector`.
8. Verify live status, logs, and StorePulse ingestion.
9. Keep rollback ready by preserving the previous prototype files and task definition until the pilot completes.

## Second-Laptop Clean Install Checklist

1. Copy the same reviewed installer package.
2. Confirm there are no user-profile paths in config.
3. Configure machine-specific store number, Commander host, endpoints, and paths.
4. Write DPAPI LocalMachine secrets on that laptop.
5. Run full install validation in no-production mode.
6. Install/register the service only after validation passes.
7. Start with RunForeground before enabling normal service start.
8. Compare logs/status behavior with the first pilot before fleet rollout.

## Migration From User-Specific Prototype

1. Install binaries under Program Files.
2. Create machine config under ProgramData.
3. Write machine secrets with DPAPI LocalMachine.
4. Run host `-Mode Validate`.
5. Run an isolated `-Mode Once` test with non-production configuration.
6. Disable the user-specific scheduled task only after the machine service is fully validated.
7. Register and start the service in a later phase.

## Phased Rollout

1. Phase 3 foundation: config, secrets, host, installer/uninstaller scaffolds, offline tests.
2. Isolated-machine validation: run Validate and controlled Once with test endpoints.
3. Service registration phase: create service account or LocalSystem service, wire event logs, define recovery policy.
4. Store pilot: migrate one store laptop from user-specific scheduling to machine service.
5. Fleet rollout: repeat using the same Program Files and ProgramData layout.
6. Ongoing operations: repair, upgrade, secret rotation, and uninstall procedures.
