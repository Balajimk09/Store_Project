# StorePulse Machine-Wide Connector Service

Phase 3 creates the foundation for a machine-wide Windows connector that can later run as LocalSystem or a dedicated service identity. This checkpoint does not install or register a Windows service.

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

The future service should run as LocalSystem or a dedicated service identity. It must not depend on `%USERPROFILE%`, employee credential stores, or user-specific scheduled tasks. Commander credentials and StorePulse tokens are read from machine secrets at runtime.

This checkpoint intentionally does not:

- create a service account
- register a service
- register a scheduled task
- modify existing scheduled tasks
- request employee Windows passwords

## Workers

### Live Worker

The live worker remains the existing provisional/current-shift flow. Until a supported one-shot live command is introduced, the Phase 3 host reports a safe no-op placeholder rather than changing the live connector behavior.

### Closed-Day Worker

The closed-day worker remains the existing closed-day finalizer. The host can invoke it in future one-shot mode using machine-configured install, working, archive, endpoint, and store values. Validate mode never archives or finalizes anything.

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

Upgrade should copy new connector binaries into Program Files while preserving ProgramData. Config, secrets, logs, working data, and archives are durable machine state and must survive binary replacement.

## Repair

Repair should validate:

- expected scripts exist under Program Files
- `config.json` contains no secrets
- `secrets.json` contains encrypted required values
- logs, working, and archive directories exist or can be created

Repair should not reset secrets unless an administrator explicitly performs secret rotation.

## Uninstall

This checkpoint's uninstall scaffold removes installed binaries only. It preserves ProgramData config, secrets, logs, working data, and archives. A future purge flag may be added, but it must be explicit and visibly destructive.

## Security Boundaries

- Secrets stay out of command-line arguments whenever practical.
- Config stays non-secret.
- DPAPI LocalMachine protects secrets for machine service use.
- ProgramData ACLs should restrict `secrets.json` to SYSTEM and Administrators.
- The service host does not perform database schema changes or Edge Function deployments.

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
