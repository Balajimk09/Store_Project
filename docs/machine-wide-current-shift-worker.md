# Machine-Wide Current Shift Worker

This checkpoint replaces the service's watch-folder-only live cycle with a complete Current Shift pipeline that can run under the `StorePulseConnector` LocalSystem service.

## Runtime flow

1. Read `commander_username`, `commander_password`, and `connector_token` from the DPAPI LocalMachine secrets file already loaded by the service runtime.
2. Load `SMTCommon.dll` and its companion assemblies from `config.commander_install_path`.
3. connect to `config.commander_ip`, validate the Commander session, and request `vtranssetz` with `period=1` and `filename=current`.
4. Save the raw response atomically to `C:\ProgramData\StorePulse\working\live\current-shift.xml`.
5. Normalize the source XML to canonical transactions under the same ProgramData working folder.
6. Upload canonical transaction batches to the configured `ingest-pos-transactions` HTTPS endpoint using the connector token in a process environment variable.
7. Write upload and pipeline summaries under `C:\ProgramData\StorePulse\state` and copy run artifacts under `C:\ProgramData\StorePulse\archive\live`.

The worker does not use Windows Credential Manager, `%USERPROFILE%`, OneDrive Desktop, an interactive token, or a globally installed Node runtime.

## Closed-day correction

The service closed-day worker now launches a machine-secret wrapper and passes `config.commander_install_path` as the finalizer's `-InstallPath`. The wrapper exposes the already-decrypted machine secrets to the existing finalizer only inside the service process, so the proven closed-day logic can remain unchanged without reading a user's Credential Manager.

## Safety and cutover

The production scheduled task `StorePulse-CurrentShift-Sync` must stay enabled until all of the following pass on the ABC laptop:

- full package validation;
- foreground Current Shift retrieval against Commander;
- canonical ingestion count verification;
- service install and start verification;
- repeated five-minute cycles with clean logs and status;
- an approved rollback test.

Do not delete the legacy connector, task definition, or backups during the pilot.
