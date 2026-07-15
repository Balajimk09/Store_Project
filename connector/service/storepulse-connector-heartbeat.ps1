[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseInstallationId -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-identity.ps1")
}

function ConvertTo-StorePulseHeartbeatSafeText {
    param([AllowNull()][string]$Value, [AllowNull()]$Secrets)
    if ($null -eq $Value) { return $null }
    $text = [string]$Value
    if ($null -ne $Secrets) {
        foreach ($name in @("commander_username", "commander_password", "connector_token")) {
            $property = $Secrets.PSObject.Properties[$name]
            if ($null -ne $property -and -not [string]::IsNullOrEmpty([string]$property.Value)) {
                $text = $text.Replace([string]$property.Value, "[REDACTED]")
            }
        }
    }
    if ($text.Length -gt 1000) { return $text.Substring(0, 1000) }
    return $text
}

function Get-StorePulseErrorCode {
    param([AllowNull()][string]$Message)
    $text = if ($null -eq $Message) { "" } else { [string]$Message }
    if ($text -match '(?i)unauthorized|401|403') { return "cloud_unauthorized" }
    if ($text -match '(?i)timeout|timed out|connection|dns|unreachable') { return "cloud_unreachable" }
    if ($text -match '(?i)commander.*auth|authentication') { return "commander_authentication_failed" }
    if ($text -match '(?i)commander|SMTCommon') { return "commander_unreachable" }
    if ($text -match '(?i)normaliz') { return "normalization_failed" }
    if ($text -match '(?i)reject|400|409|422') { return "cloud_rejected" }
    return "unknown_error"
}

function New-StorePulseHeartbeatPayload {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$RuntimeStatus,
        [Parameter(Mandatory)][string]$InstallationId,
        [Parameter(Mandatory)][ValidateSet("starting", "syncing", "ready", "degraded", "error", "stopping")][string]$ReportedState,
        [AllowNull()][string]$ErrorCode = $null,
        [AllowNull()][string]$ErrorMessage = $null,
        [AllowNull()]$Secrets = $null
    )
    $live = $RuntimeStatus.live_worker
    $result = if ($null -ne $live -and $null -ne $live.last_result) { $live.last_result } else { $null }
    $lastRequestId = $null
    if ($null -ne $result -and $result.PSObject.Properties["request_id"]) { $lastRequestId = [string]$result.request_id }
    elseif ($null -ne $result -and $result.PSObject.Properties["last_request_id"]) { $lastRequestId = [string]$result.last_request_id }
    $failed = if ($null -ne $result -and $result.PSObject.Properties["failed_count"]) { [int]$result.failed_count } elseif ($null -ne $result -and $result.PSObject.Properties["failed"]) { [int]$result.failed } else { 0 }
    $canonical = if ($null -ne $result -and $result.PSObject.Properties["canonical_record_count"]) { [int]$result.canonical_record_count } elseif ($null -ne $result -and $result.PSObject.Properties["server_canonical_record_count"]) { [int]$result.server_canonical_record_count } else { 0 }
    return [ordered]@{
        payload_version = if ($Config.PSObject.Properties["heartbeat_payload_version"]) { [string]$Config.heartbeat_payload_version } else { "1" }
        installation_id = $InstallationId
        source_store_number = [string]$Config.source_store_number
        service_version = [string]$RuntimeStatus.runtime_version
        runtime_mode = [string]$RuntimeStatus.mode
        reported_state = $ReportedState
        runtime_started_at = [string]$RuntimeStatus.started_at
        heartbeat_at = (Get-Date).ToUniversalTime().ToString("o")
        last_sync_started_at = if ($null -ne $live) { $live.last_started_at } else { $null }
        last_sync_completed_at = if ($null -ne $live) { $live.last_success_at } else { $null }
        last_success_at = if ($null -ne $live) { $live.last_success_at } else { $null }
        last_failure_at = if ($null -ne $live) { $live.last_failure_at } else { $null }
        last_error_code = $ErrorCode
        last_error_message = ConvertTo-StorePulseHeartbeatSafeText -Value $ErrorMessage -Secrets $Secrets
        consecutive_failure_count = if ($null -ne $live) { [int]$live.consecutive_failures } else { 0 }
        commander_status = if ($ReportedState -in @("ready", "syncing")) { "connected" } elseif ($ErrorCode -like "commander_*") { "error" } else { "unknown" }
        cloud_status = if ($ReportedState -in @("ready", "syncing")) { "connected" } elseif ($ErrorCode -like "cloud_*") { "error" } else { "unknown" }
        live_poll_interval_seconds = [int]$Config.live_poll_interval_seconds
        canonical_record_count = $canonical
        inserted_count = if ($null -ne $result -and $result.PSObject.Properties["inserted_count"]) { [int]$result.inserted_count } else { 0 }
        updated_count = if ($null -ne $result -and $result.PSObject.Properties["updated_count"]) { [int]$result.updated_count } else { 0 }
        unchanged_count = if ($null -ne $result -and $result.PSObject.Properties["unchanged_count"]) { [int]$result.unchanged_count } else { 0 }
        failed_count = $failed
        last_request_id = $lastRequestId
    }
}

function Invoke-StorePulseHeartbeatHttp {
    param(
        [Parameter(Mandatory)][string]$Endpoint,
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)]$Payload,
        [int]$TimeoutSeconds = 15,
        [scriptblock]$HttpExecutor = $null
    )
    $json = $Payload | ConvertTo-Json -Depth 20 -Compress
    if ($null -ne $HttpExecutor) {
        return & $HttpExecutor $Endpoint @{ "x-storepulse-connector-token" = $Token } $json $TimeoutSeconds
    }
    $response = Invoke-WebRequest -Uri $Endpoint -Method Post -ContentType "application/json; charset=utf-8" -Headers @{ "x-storepulse-connector-token" = $Token } -Body $json -TimeoutSec $TimeoutSeconds -UseBasicParsing
    return ([string]$response.Content | ConvertFrom-Json)
}

function Invoke-StorePulseConnectorHeartbeat {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)]$RuntimeStatus,
        [Parameter(Mandatory)][ValidateSet("starting", "syncing", "ready", "degraded", "error", "stopping")][string]$ReportedState,
        [AllowNull()][string]$ErrorCode = $null,
        [AllowNull()][string]$ErrorMessage = $null,
        [scriptblock]$HttpExecutor = $null
    )
    $enabled = if ($Config.PSObject.Properties["heartbeat_enabled"]) { [bool]$Config.heartbeat_enabled } else { $false }
    if (-not $enabled) { return [PSCustomObject]@{ enabled = $false; status = "disabled" } }
    $endpoint = [string]$Config.heartbeat_endpoint_url
    if ([string]::IsNullOrWhiteSpace($endpoint)) { throw "heartbeat_endpoint_url is required when heartbeat_enabled is true." }
    if (-not $Config.PSObject.Properties["heartbeat_timeout_seconds"]) {
        Add-Member -InputObject $Config -NotePropertyName "heartbeat_timeout_seconds" -NotePropertyValue 15
    }
    $programDataRoot = Split-Path -Parent ([string]$Config.logs_root)
    $installationId = Get-StorePulseInstallationId -ProgramDataRoot $programDataRoot
    $payload = New-StorePulseHeartbeatPayload -Config $Config -RuntimeStatus $RuntimeStatus -InstallationId $installationId -ReportedState $ReportedState -ErrorCode $ErrorCode -ErrorMessage $ErrorMessage -Secrets $Secrets
    try {
        $response = Invoke-StorePulseHeartbeatHttp -Endpoint $endpoint -Token ([string]$Secrets.connector_token) -Payload $payload -TimeoutSeconds ([int]$Config.heartbeat_timeout_seconds) -HttpExecutor $HttpExecutor
        if ($null -eq $response -or $response.ok -ne $true) { throw "Heartbeat response was not successful." }
        return [PSCustomObject]@{
            enabled = $true
            status = "succeeded"
            request_id = [string]$response.request_id
            connector_id = [string]$response.connector_id
            server_received_at = [string]$response.server_received_at
            installation_bound = [bool]$response.installation_bound
            payload = $payload
        }
    }
    catch {
        $safe = ConvertTo-StorePulseHeartbeatSafeText -Value $_.Exception.Message -Secrets $Secrets
        return [PSCustomObject]@{
            enabled = $true
            status = "failed"
            error_code = if ($ErrorCode) { $ErrorCode } else { Get-StorePulseErrorCode -Message $safe }
            error_message = $safe
            payload = $payload
        }
    }
}
