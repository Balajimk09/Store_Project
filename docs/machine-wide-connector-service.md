# StorePulse Machine-Wide Connector Service

Phase 3 creates the foundation for a machine-wide Windows connector that can later run as LocalSystem or a dedicated service identity. Checkpoint 4 adds the offline/testable Windows Service installation layer, but the repository task does not install or register the service on any machine.

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
```

`config.json` contains non-secret operational values only. `secrets.json` contains DPAPI-encrypted values only.

## Machine-Wide Configuration

The machine config stores:

- `source_store_number`
- `commander_ip`
- `live_endpoint_url`
- `finalization_endpoint_url`
- `live_poll_interval_seconds`
- `closed_day_poll_interval_seconds`
- optional install/data path overrides
- optional one-shot worker enablement flags for future rollout

Configuration must not include connector tokens, Commander usernames, Commander passwords, cookies, or service-role keys.

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

## LocalSystem Service Model

The Windows Service is named `StorePulseConnector` with display name `StorePulse Connector Service`. It is designed to run as LocalSystem, start automatically, and use delayed automatic start where Windows supports it. It must not depend on `%USERPROFILE%`, employee credential stores, or user-specific scheduled tasks. Commander credentials and StorePulse tokens are read from machine secrets at runtime.

The configured service command launches:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\StorePulse\Connector\service\storepulse-service-entrypoint.ps1"
```

The command line contains no connector token, Commander password, cookie, or service-role credential.

This repository checkpoint intentionally does not:

- create a service account
- register a scheduled task
- modify existing scheduled tasks
- request employee Windows passwords

Service registration is available only through the installer/control scripts when an administrator explicitly runs them outside tests.

## Workers

### Live Worker

The live worker uses the existing provisional/current-shift connector in one-shot mode:

```text
node storepulse-connector.mjs --once --summary-path <ProgramData>\StorePulse\state\live-once-summary.json
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
- last success/failure timestamps
- bounded non-secret error summaries

Secrets are redacted before status is written.

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
- `Status`: print the heartbeat/status JSON.
- `Start`: request Windows Service start.
- `Stop`: create the stop file and, for service control flows, request service stop through the service helper.
- `Restart`: request Windows Service restart.
- `Validate`: run host Validate mode.
- `RunForeground`: run host Run mode in the current console.

It does not expose secrets and combines the Windows Service state with the runtime heartbeat where available.

## Windows Service Wrapper

`storepulse-windows-service.ps1` is safe to dot-source and provides reusable functions for service install, status, start, stop, restart, removal, and recovery policy configuration. The recovery policy is:

- first failure: restart after 1 minute
- second failure: restart after 5 minutes
- subsequent failures: restart after 15 minutes
- reset failure count after 1 day

The helper uses explicit path quoting and rejects service entrypoints outside the expected install root.

The installer does not install Node globally. Production packaging should bundle a vetted private Node runtime under:

```text
C:\Program Files\StorePulse\Connector\runtime\node
```

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

Upgrade stops `StorePulseConnector`, backs up the existing Program Files connector tree, replaces binaries, restores the previous binaries on copy/registration failure, and restarts the service after a successful upgrade. ProgramData config, secrets, logs, working data, archives, and state are durable machine state and must survive binary replacement.

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

1. Build or copy the connector package with a private Node runtime under `runtime\node`.
2. Run installer `-ValidateOnly` and confirm the manifest, service command, Program Files path, and ProgramData path.
3. Install on a non-production pilot machine using `-Install` from elevated PowerShell.
4. Create `config.json` under ProgramData without secrets.
5. Write DPAPI LocalMachine `secrets.json`.
6. Run `storepulse-service-control.ps1 -Command Validate`.
7. Run `RunForeground` against test endpoints and synthetic connector data.
8. Start the Windows Service only after Validate/RunForeground results are clean.
9. Monitor `runtime-status.json` and JSONL logs.
10. Keep the legacy user-specific task disabled only after the service has proven stable for the pilot.

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
