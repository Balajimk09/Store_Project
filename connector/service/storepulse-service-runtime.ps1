[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseProgramDataRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}
if (-not (Get-Command Read-StorePulseMachineSecrets -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-secrets.ps1")
}

$script:StorePulseRuntimeVersion = "3.0.0-checkpoint2"

function Get-StorePulseStateRoot {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "state")
}

function Get-StorePulseRuntimeStatusPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseStateRoot -ProgramDataRoot $ProgramDataRoot) "runtime-status.json")
}

function Get-StorePulseRuntimeStopPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseStateRoot -ProgramDataRoot $ProgramDataRoot) "runtime.stop")
}

function Get-StorePulseRuntimeLockPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseStateRoot -ProgramDataRoot $ProgramDataRoot) "runtime.lock")
}

function Test-StorePulseServiceScripts {
    param([Parameter(Mandatory)][string]$Root)
    $required = @(
        "storepulse-connector.mjs",
        "storepulse-finalize-closed-day.ps1",
        "storepulse-normalize-transactions.ps1",
        "storepulse-upload-finalized-business-day.ps1"
    )
    foreach ($name in $required) {
        $path = Join-Path $Root $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required connector script missing: $name" }
    }
    return $true
}

function New-StorePulseWorkerStatus {
    param([string]$Name, [bool]$Enabled)
    [ordered]@{
        name = $Name
        enabled = $Enabled
        status = if ($Enabled) { "idle" } else { "disabled" }
        consecutive_failures = 0
        next_delay_seconds = 0
        last_started_at = $null
        last_success_at = $null
        last_failure_at = $null
        last_error = $null
        last_result = $null
    }
}

function ConvertTo-StorePulseSafeText {
    param([AllowNull()][string]$Value, [AllowNull()]$Secrets)
    if ($null -eq $Value) { return $null }
    $result = $Value
    if ($null -ne $Secrets) {
        foreach ($name in @("commander_username", "commander_password", "connector_token")) {
            $property = $Secrets.PSObject.Properties[$name]
            if ($null -ne $property -and -not [string]::IsNullOrEmpty([string]$property.Value)) {
                $result = $result.Replace([string]$property.Value, "[REDACTED]")
            }
        }
    }
    if ($result.Length -gt 500) { return $result.Substring(0, 500) }
    return $result
}

function Redact-StorePulseSecretsFromString {
    param([AllowNull()][string]$Value, [AllowNull()]$Secrets)
    if ($null -eq $Value) { return $null }
    $result = $Value
    if ($null -ne $Secrets) {
        foreach ($name in @("commander_username", "commander_password", "connector_token")) {
            $property = $Secrets.PSObject.Properties[$name]
            if ($null -ne $property -and -not [string]::IsNullOrEmpty([string]$property.Value)) {
                $result = $result.Replace([string]$property.Value, "[REDACTED]")
            }
        }
    }
    return $result
}

function Write-StorePulseJsonLog {
    param(
        [Parameter(Mandatory)][string]$LogsRoot,
        [Parameter(Mandatory)][string]$Level,
        [Parameter(Mandatory)][string]$Event,
        [AllowNull()][hashtable]$Data = $null,
        [AllowNull()]$Secrets = $null
    )
    if (-not (Test-Path -LiteralPath $LogsRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
    }
    $safeData = [ordered]@{}
    if ($null -ne $Data) {
        foreach ($key in $Data.Keys) {
            $value = $Data[$key]
            if ($value -is [string]) { $safeData[$key] = ConvertTo-StorePulseSafeText -Value $value -Secrets $Secrets }
            else { $safeData[$key] = $value }
        }
    }
    $entry = [ordered]@{
        timestamp = (Get-Date).ToString("o")
        level = $Level
        event = $Event
        data = $safeData
    }
    $path = Join-Path $LogsRoot ("runtime-" + (Get-Date -Format "yyyyMMdd") + ".jsonl")
    Add-Content -LiteralPath $path -Encoding UTF8 -Value ($entry | ConvertTo-Json -Depth 20 -Compress)
}

function Write-StorePulseRuntimeStatus {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Status,
        [AllowNull()]$Secrets = $null
    )
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $json = $Status | ConvertTo-Json -Depth 20
    if ($null -ne $Secrets) {
        $json = Redact-StorePulseSecretsFromString -Value $json -Secrets $Secrets
    }
    Set-Content -LiteralPath $Path -Encoding UTF8 -Value $json
}

function Get-StorePulseConfigBool {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$Name, [bool]$Default)
    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $Default }
    return [bool]$property.Value
}

function Get-StorePulseConfigString {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$Name, [string]$Default = "")
    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value -or [string]::IsNullOrWhiteSpace([string]$property.Value)) { return $Default }
    return [string]$property.Value
}

function Get-StorePulseBackoffSeconds {
    param([int]$ConsecutiveFailures, [int]$BaseSeconds, [int]$MaxSeconds)
    if ($ConsecutiveFailures -le 0) { return 0 }
    $power = [math]::Min($ConsecutiveFailures - 1, 8)
    $delay = $BaseSeconds * [math]::Pow(2, $power)
    return [int]([math]::Min($delay, $MaxSeconds))
}

function Invoke-StorePulseWorkerOnce {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)]$WorkerStatus,
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][scriptblock]$Worker,
        [Parameter(Mandatory)][string]$LogsRoot
    )
    $WorkerStatus.status = "running"
    $WorkerStatus.last_started_at = (Get-Date).ToString("o")
    try {
        $workerResult = & $Worker $Config $Secrets $InstallRoot
        $WorkerStatus.status = "succeeded"
        $WorkerStatus.last_success_at = (Get-Date).ToString("o")
        $WorkerStatus.last_error = $null
        $WorkerStatus.last_result = $workerResult
        $WorkerStatus.consecutive_failures = 0
        $WorkerStatus.next_delay_seconds = 0
        Write-StorePulseJsonLog -LogsRoot $LogsRoot -Level "info" -Event "$Name worker succeeded" -Secrets $Secrets
    }
    catch {
        $WorkerStatus.status = "failed"
        $WorkerStatus.last_failure_at = (Get-Date).ToString("o")
        $WorkerStatus.last_error = ConvertTo-StorePulseSafeText -Value $_.Exception.Message -Secrets $Secrets
        $WorkerStatus.consecutive_failures = [int]$WorkerStatus.consecutive_failures + 1
        $WorkerStatus.next_delay_seconds = Get-StorePulseBackoffSeconds -ConsecutiveFailures ([int]$WorkerStatus.consecutive_failures) -BaseSeconds 5 -MaxSeconds 300
        Write-StorePulseJsonLog -LogsRoot $LogsRoot -Level "error" -Event "$Name worker failed" -Data @{ error = $WorkerStatus.last_error } -Secrets $Secrets
    }
}

function New-StorePulseDefaultLiveWorker {
    return {
        param($Config, $Secrets, $InstallRoot)
        $connectorScript = Join-Path $InstallRoot "storepulse-connector.mjs"
        if (-not (Test-Path -LiteralPath $connectorScript -PathType Leaf)) { throw "Live connector script is missing." }

        $programDataRoot = Split-Path -Parent ([string]$Config.logs_root)
        $stateRoot = Get-StorePulseStateRoot -ProgramDataRoot $programDataRoot
        if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
            New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
        }
        $summaryPath = Join-Path $stateRoot "live-once-summary.json"
        $statePath = Join-Path $stateRoot "live-upload-state.json"
        $watchFolder = Get-StorePulseConfigString -Config $Config -Name "live_watch_folder" -Default (Join-Path ([string]$Config.working_root) "live")
        $archiveFolder = Get-StorePulseConfigString -Config $Config -Name "live_archive_folder" -Default ""

        $previous = @{}
        foreach ($name in @("STOREPULSE_API_URL", "STOREPULSE_CONNECTOR_TOKEN", "STOREPULSE_WATCH_FOLDER", "STOREPULSE_ARCHIVE_FOLDER", "STOREPULSE_POLL_SECONDS", "STOREPULSE_ONCE", "STOREPULSE_SUMMARY_PATH", "STOREPULSE_STATE_PATH")) {
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
        }
        try {
            [Environment]::SetEnvironmentVariable("STOREPULSE_API_URL", [string]$Config.live_endpoint_url, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", [string]$Secrets.connector_token, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_WATCH_FOLDER", $watchFolder, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_ARCHIVE_FOLDER", $archiveFolder, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_POLL_SECONDS", [string]$Config.live_poll_interval_seconds, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_ONCE", "true", "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_SUMMARY_PATH", $summaryPath, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_STATE_PATH", $statePath, "Process")

            $output = & node $connectorScript --once --summary-path $summaryPath 2>&1
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) {
                $safeOutput = ConvertTo-StorePulseSafeText -Value (($output | ForEach-Object { [string]$_ }) -join "`n") -Secrets $Secrets
                throw "Live connector one-shot exited with code $exitCode. $safeOutput"
            }
            if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) {
                throw "Live connector one-shot did not write summary JSON."
            }
            $summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
            return [PSCustomObject]@{
                scanned = [int]$summary.scanned
                eligible = [int]$summary.eligible
                uploaded = [int]$summary.uploaded
                skipped_duplicate = [int]$summary.skipped_duplicate
                skipped_unstable = [int]$summary.skipped_unstable
                failed = [int]$summary.failed
                summary_path = $summaryPath
            }
        }
        finally {
            foreach ($name in $previous.Keys) {
                [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
            }
        }
    }.GetNewClosure()
}

function New-StorePulseDefaultClosedDayWorker {
    return {
        param($Config, $Secrets, $InstallRoot)
        $enabled = Get-StorePulseConfigBool -Config $Config -Name "closed_day_once_enabled" -Default $false
        if (-not $enabled) { return }
        $closedScript = Join-Path $InstallRoot "storepulse-finalize-closed-day.ps1"
        if (-not (Test-Path -LiteralPath $closedScript -PathType Leaf)) { throw "Closed-day finalizer script is missing." }
        $previousToken = [Environment]::GetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "Process")
        try {
            [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", [string]$Secrets.connector_token, "Process")
            $arguments = @(
                "-InstallPath", $InstallRoot,
                "-CommanderIp", ([string]$Config.commander_ip),
                "-SourceStoreNumber", ([string]$Config.source_store_number),
                "-WorkingRoot", ([string]$Config.working_root),
                "-ArchiveRoot", ([string]$Config.archive_root),
                "-Endpoint", ([string]$Config.finalization_endpoint_url)
            )
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $closedScript @arguments
            if ($LASTEXITCODE -ne 0) { throw "Closed-day finalizer exited with code $LASTEXITCODE." }
        }
        finally {
            [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", $previousToken, "Process")
        }
    }.GetNewClosure()
}

function Invoke-StorePulseServiceRuntime {
    param(
        [ValidateSet("Validate", "Once", "Run")]
        [string]$Mode = "Validate",
        [string]$ConfigPath = "",
        [string]$SecretsPath = "",
        [string]$InstallRoot = "",
        [scriptblock]$LiveWorker = $null,
        [scriptblock]$ClosedDayWorker = $null,
        [scriptblock]$Sleep = $null,
        [int]$MaxIterations = 0
    )
    $config = Read-StorePulseMachineConfig -Path $ConfigPath
    Test-StorePulseMachineConfig -Config $config | Out-Null
    $secrets = Read-StorePulseMachineSecrets -Path $SecretsPath
    Test-StorePulseMachineSecrets -Secrets $secrets | Out-Null
    $resolvedInstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { [string]$config.install_root } else { $InstallRoot }
    Test-StorePulseServiceScripts -Root $resolvedInstallRoot | Out-Null

    $programDataRoot = Split-Path -Parent ([string]$config.logs_root)
    $stateRoot = Get-StorePulseStateRoot -ProgramDataRoot $programDataRoot
    $statusPath = Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot
    $stopPath = Get-StorePulseRuntimeStopPath -ProgramDataRoot $programDataRoot
    $lockPath = Get-StorePulseRuntimeLockPath -ProgramDataRoot $programDataRoot
    foreach ($path in @([string]$config.logs_root, $stateRoot)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    }

    $liveEnabled = Get-StorePulseConfigBool -Config $config -Name "live_worker_enabled" -Default $true
    $closedEnabled = Get-StorePulseConfigBool -Config $config -Name "closed_day_worker_enabled" -Default $true
    if ($null -eq $LiveWorker) { $LiveWorker = New-StorePulseDefaultLiveWorker }
    if ($null -eq $ClosedDayWorker) { $ClosedDayWorker = New-StorePulseDefaultClosedDayWorker }
    if ($null -eq $Sleep) { $Sleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds } }

    $status = [ordered]@{
        runtime_version = $script:StorePulseRuntimeVersion
        process_id = $PID
        started_at = (Get-Date).ToString("o")
        last_heartbeat_at = (Get-Date).ToString("o")
        mode = $Mode
        live_worker = New-StorePulseWorkerStatus -Name "live" -Enabled $liveEnabled
        closed_day_worker = New-StorePulseWorkerStatus -Name "closed_day" -Enabled $closedEnabled
        stop_file = $stopPath
    }
    Write-StorePulseRuntimeStatus -Path $statusPath -Status $status -Secrets $secrets
    Write-StorePulseJsonLog -LogsRoot ([string]$config.logs_root) -Level "info" -Event "runtime validated" -Data @{ mode = $Mode; process_id = $PID } -Secrets $secrets

    if ($Mode -eq "Validate") {
        return [PSCustomObject]@{ ok = $true; status_path = $statusPath; stop_path = $stopPath; lock_path = $lockPath }
    }

    $lockStream = $null
    try {
        $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $lockBytes = [Text.Encoding]::UTF8.GetBytes("$PID`n")
        $lockStream.SetLength(0)
        $lockStream.Write($lockBytes, 0, $lockBytes.Length)
        $lockStream.Flush()
    }
    catch {
        throw "StorePulse service runtime is already active or lock file cannot be acquired."
    }

    try {
        $iteration = 0
        do {
            $iteration += 1
            $status.last_heartbeat_at = (Get-Date).ToString("o")
            if (Test-Path -LiteralPath $stopPath -PathType Leaf) {
                Write-StorePulseJsonLog -LogsRoot ([string]$config.logs_root) -Level "info" -Event "runtime stop requested" -Secrets $secrets
                break
            }
            if ($liveEnabled) {
                Invoke-StorePulseWorkerOnce -Name "live" -WorkerStatus $status.live_worker -Config $config -Secrets $secrets -InstallRoot $resolvedInstallRoot -Worker $LiveWorker -LogsRoot ([string]$config.logs_root)
            }
            if ($closedEnabled) {
                Invoke-StorePulseWorkerOnce -Name "closed_day" -WorkerStatus $status.closed_day_worker -Config $config -Secrets $secrets -InstallRoot $resolvedInstallRoot -Worker $ClosedDayWorker -LogsRoot ([string]$config.logs_root)
            }
            Write-StorePulseRuntimeStatus -Path $statusPath -Status $status -Secrets $secrets
            if ($Mode -eq "Once") { break }
            $liveDelay = if ($liveEnabled -and [int]$status.live_worker.consecutive_failures -gt 0) { [int]$status.live_worker.next_delay_seconds } else { [int]$config.live_poll_interval_seconds }
            $closedDelay = if ($closedEnabled -and [int]$status.closed_day_worker.consecutive_failures -gt 0) { [int]$status.closed_day_worker.next_delay_seconds } else { [int]$config.closed_day_poll_interval_seconds }
            $delay = [math]::Min($liveDelay, $closedDelay)
            if ($delay -lt 1) { $delay = 1 }
            & $Sleep ([int]$delay)
        } while ($Mode -eq "Run" -and ($MaxIterations -le 0 -or $iteration -lt $MaxIterations))
        $status.last_heartbeat_at = (Get-Date).ToString("o")
        Write-StorePulseRuntimeStatus -Path $statusPath -Status $status -Secrets $secrets
        return [PSCustomObject]@{ ok = $true; iterations = $iteration; status_path = $statusPath; stop_path = $stopPath; lock_path = $lockPath }
    }
    finally {
        if ($null -ne $lockStream) { $lockStream.Dispose() }
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}
