[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$serviceRoot = Join-Path $repoRoot "connector\service"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("storepulse-machine-service-tests-" + [guid]::NewGuid().ToString("N"))
$global:MachineServiceFailures = New-Object System.Collections.Generic.List[string]
$global:MachineServicePassCount = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { $global:MachineServicePassCount += 1 } else { $global:MachineServiceFailures.Add($Message) }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -eq $Expected) { $global:MachineServicePassCount += 1 } else { $global:MachineServiceFailures.Add("$Message Expected=[$Expected] Actual=[$Actual]") }
}

function Assert-Throws {
    param([scriptblock]$ScriptBlock, [string]$Message)
    try {
        & $ScriptBlock
        $global:MachineServiceFailures.Add("$Message Expected exception.")
    }
    catch {
        $global:MachineServicePassCount += 1
    }
}

function New-TestConfig {
    param([string]$Root, [string]$InstallRoot)
    [PSCustomObject]@{
        source_store_number = "SYNTH"
        commander_ip = "commander.local"
        live_endpoint_url = "https://example.invalid/functions/v1/ingest-pos-transactions"
        finalization_endpoint_url = "https://example.invalid/functions/v1/finalize-pos-business-day"
        live_poll_interval_seconds = 300
        closed_day_poll_interval_seconds = 3600
        install_root = $InstallRoot
        logs_root = Join-Path $Root "logs"
        working_root = Join-Path $Root "working"
        archive_root = Join-Path $Root "archive"
        closed_day_once_enabled = $false
        live_worker_enabled = $true
        closed_day_worker_enabled = $true
    }
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$previousProgramData = [Environment]::GetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", "Process")
$previousInstall = [Environment]::GetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", "Process")

try {
    . (Join-Path $serviceRoot "storepulse-machine-config.ps1")
    . (Join-Path $serviceRoot "storepulse-machine-secrets.ps1")
    . (Join-Path $serviceRoot "storepulse-service-runtime.ps1")

    [Environment]::SetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", (Join-Path $tempRoot "ProgramData"), "Process")
    [Environment]::SetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", (Join-Path $tempRoot "ProgramFiles\StorePulse\Connector"), "Process")

    Assert-Equal -Actual (Get-StorePulseProgramDataRoot -Root "") -Expected (Join-Path $tempRoot "ProgramData") -Message "program data root override honored"
    Assert-Equal -Actual (Get-StorePulseInstallRoot -Root "") -Expected (Join-Path $tempRoot "ProgramFiles\StorePulse\Connector") -Message "install root override honored"
    Assert-Equal -Actual (Get-StorePulseConfigPath) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "config.json") -Message "config path default"
    Assert-Equal -Actual (Get-StorePulseSecretsPath) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "secrets.json") -Message "secrets path default"
    Assert-Equal -Actual (Get-StorePulseLogsRoot) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "logs") -Message "logs path default"
    Assert-Equal -Actual (Get-StorePulseWorkingRoot) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "working") -Message "working path default"
    Assert-Equal -Actual (Get-StorePulseArchiveRoot) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "archive") -Message "archive path default"

    $programDataRoot = Get-StorePulseProgramDataRoot
    $installRoot = Get-StorePulseInstallRoot
    New-Item -ItemType Directory -Path $programDataRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

    foreach ($name in @("storepulse-connector.mjs", "storepulse-finalize-closed-day.ps1", "storepulse-normalize-transactions.ps1", "storepulse-upload-finalized-business-day.ps1")) {
        Set-Content -LiteralPath (Join-Path $installRoot $name) -Value "placeholder" -Encoding UTF8
    }

    $config = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    Assert-True -Condition (Test-StorePulseMachineConfig -Config $config) -Message "valid config accepted"
    $configPath = Write-StorePulseMachineConfig -Config $config -CreateDirectories
    Assert-True -Condition (Test-Path -LiteralPath $configPath -PathType Leaf) -Message "config written"
    $configText = Get-Content -LiteralPath $configPath -Raw
    Assert-True -Condition ($configText -notmatch "commander_password|connector_token|commander_username") -Message "config excludes secret names"

    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.live_endpoint_url = "http://example.invalid"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "non-HTTPS URL rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.source_store_number = "bad/store"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "invalid store number rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; Add-Member -InputObject $bad -NotePropertyName "connector_token" -NotePropertyValue "plain"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "secret in config rejected"

    $secretsObject = [PSCustomObject]@{
        commander_username = "synthetic-user"
        commander_password = "synthetic-password"
        connector_token = "synthetic-token"
    }
    if ($env:OS -eq "Windows_NT") {
        $secretsPath = Write-StorePulseMachineSecrets -Secrets $secretsObject -CreateDirectories
        $secretsText = Get-Content -LiteralPath $secretsPath -Raw
        Assert-True -Condition ($secretsText -notmatch "synthetic-user|synthetic-password|synthetic-token") -Message "secrets file contains encrypted content only"
        $roundTrip = Read-StorePulseMachineSecrets -Path $secretsPath
        Assert-Equal -Actual $roundTrip.commander_username -Expected "synthetic-user" -Message "DPAPI username round trip"
        Assert-Equal -Actual $roundTrip.commander_password -Expected "synthetic-password" -Message "DPAPI password round trip"
        Assert-Equal -Actual $roundTrip.connector_token -Expected "synthetic-token" -Message "DPAPI token round trip"
    }
    else {
        Assert-Throws -ScriptBlock { Protect-StorePulseMachineSecret -PlainText "x" | Out-Null } -Message "DPAPI fails clearly outside Windows"
    }

    $hostOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "storepulse-service-host.ps1") -Mode Validate -ConfigPath $configPath -SecretsPath (Get-StorePulseSecretsPath) -InstallRoot $installRoot
    Assert-True -Condition (($hostOutput -join "`n") -match "Runtime status path") -Message "host Validate mode succeeds"
    Assert-True -Condition (($hostOutput -join "`n") -notmatch "synthetic-password|synthetic-token") -Message "host Validate does not print secrets"

    $secretsPathForRuntime = Get-StorePulseSecretsPath
    $global:MachineLiveCount = 0
    $global:MachineClosedCount = 0
    $onceResult = Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:MachineLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:MachineClosedCount += 1 } `
        -Sleep { param($Seconds) }
    Assert-Equal -Actual $onceResult.iterations -Expected 1 -Message "Once mode runs one iteration"
    Assert-Equal -Actual $global:MachineLiveCount -Expected 1 -Message "Once mode invokes live worker once"
    Assert-Equal -Actual $global:MachineClosedCount -Expected 1 -Message "Once mode invokes closed worker once"

    $statusPath = Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot
    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $status.live_worker.status -Expected "succeeded" -Message "heartbeat records live worker success"
    Assert-Equal -Actual $status.closed_day_worker.status -Expected "succeeded" -Message "heartbeat records closed worker success"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$status.last_heartbeat_at)) -Message "heartbeat timestamp written"
    Assert-True -Condition (($status | ConvertTo-Json -Depth 20) -notmatch "synthetic-password|synthetic-token") -Message "status excludes secrets"

    $logFile = Get-ChildItem -LiteralPath ([string]$config.logs_root) -Filter "runtime-*.jsonl" | Select-Object -First 1
    Assert-True -Condition ($null -ne $logFile) -Message "JSONL runtime log written"
    $logText = Get-Content -LiteralPath $logFile.FullName -Raw
    Assert-True -Condition ($logText -match '"event"') -Message "runtime log is JSON lines"
    Assert-True -Condition ($logText -notmatch "synthetic-password|synthetic-token") -Message "runtime logs exclude secrets"

    $global:MachineClosedAfterLiveFailure = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) throw "live failed with synthetic-token" } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:MachineClosedAfterLiveFailure += 1 } `
        -Sleep { param($Seconds) } | Out-Null
    $failureIsolationStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $global:MachineClosedAfterLiveFailure -Expected 1 -Message "closed worker runs when live worker fails"
    Assert-Equal -Actual $failureIsolationStatus.live_worker.status -Expected "failed" -Message "live worker failure recorded"
    Assert-Equal -Actual $failureIsolationStatus.closed_day_worker.status -Expected "succeeded" -Message "closed worker isolated from live failure"
    Assert-True -Condition (($failureIsolationStatus | ConvertTo-Json -Depth 20) -notmatch "synthetic-token") -Message "failure status redacts token"

    $disabledConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $disabledConfig.live_worker_enabled = $false
    $disabledConfigPath = Join-Path $programDataRoot "disabled-config.json"
    Write-StorePulseMachineConfig -Config $disabledConfig -Path $disabledConfigPath | Out-Null
    $global:DisabledLiveCount = 0
    $global:DisabledClosedCount = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $disabledConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:DisabledLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:DisabledClosedCount += 1 } `
        -Sleep { param($Seconds) } | Out-Null
    Assert-Equal -Actual $global:DisabledLiveCount -Expected 0 -Message "disabled live worker skipped"
    Assert-Equal -Actual $global:DisabledClosedCount -Expected 1 -Message "enabled closed worker still runs"

    $backoffConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $backoffConfig.closed_day_worker_enabled = $false
    $backoffConfig.live_poll_interval_seconds = 60
    $backoffConfigPath = Join-Path $programDataRoot "backoff-config.json"
    Write-StorePulseMachineConfig -Config $backoffConfig -Path $backoffConfigPath | Out-Null
    $global:BackoffSleeps = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $backoffConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) throw "repeat failure" } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -Sleep { param($Seconds) $global:BackoffSleeps += $Seconds } `
        -MaxIterations 2 | Out-Null
    $backoffStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $backoffStatus.live_worker.consecutive_failures -Expected 2 -Message "backoff tracks consecutive failures"
    Assert-Equal -Actual $backoffStatus.live_worker.next_delay_seconds -Expected 10 -Message "backoff doubles after repeated failure"
    Assert-True -Condition ($global:BackoffSleeps.Count -ge 2) -Message "Run mode uses sleep callback"

    $lockPath = Get-StorePulseRuntimeLockPath -ProgramDataRoot $programDataRoot
    $lockParent = Split-Path -Parent $lockPath
    if (-not (Test-Path -LiteralPath $lockParent -PathType Container)) { New-Item -ItemType Directory -Path $lockParent -Force | Out-Null }
    $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        Assert-Throws -ScriptBlock {
            Invoke-StorePulseServiceRuntime -Mode Once -ConfigPath $configPath -SecretsPath $secretsPathForRuntime -InstallRoot $installRoot -LiveWorker { param($Config,$Secrets,$Root) } -ClosedDayWorker { param($Config,$Secrets,$Root) } -Sleep { param($Seconds) } | Out-Null
        } -Message "single-instance lock prevents second runtime"
    }
    finally {
        $lockStream.Dispose()
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }

    $stopPath = Get-StorePulseRuntimeStopPath -ProgramDataRoot $programDataRoot
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
    $global:RunCancelCount = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:RunCancelCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -Sleep { param($Seconds) Set-Content -LiteralPath $stopPath -Value "stop" -Encoding UTF8 } `
        -MaxIterations 5 | Out-Null
    Assert-True -Condition (Test-Path -LiteralPath $stopPath -PathType Leaf) -Message "stop file created for cancellation"
    Assert-Equal -Actual $global:RunCancelCount -Expected 1 -Message "Run mode cancels after stop file"

    $statusOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "storepulse-service-control.ps1") -Command Status -ProgramDataRoot $programDataRoot
    Assert-True -Condition (($statusOutput -join "`n") -match "runtime_version") -Message "control Status reads heartbeat"
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
    $stopOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "storepulse-service-control.ps1") -Command Stop -ProgramDataRoot $programDataRoot
    Assert-True -Condition (Test-Path -LiteralPath $stopPath -PathType Leaf) -Message "control Stop writes stop file"
    Assert-True -Condition (($stopOutput -join "`n") -match "Stop requested") -Message "control Stop reports stop request"

    try {
        $installOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "install-storepulse-machine-connector.ps1") -ValidateOnly -WhatIf -SourceRoot (Join-Path $repoRoot "connector") -InstallRoot $installRoot -ProgramDataRoot $programDataRoot
        Assert-True -Condition (($installOutput -join "`n") -match "ValidateOnly complete") -Message "installer WhatIf ValidateOnly succeeds when elevated"
    }
    catch {
        Assert-True -Condition ($_.Exception.Message -match "elevated PowerShell") -Message "installer requires elevation when not elevated"
    }
    $uninstallOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "uninstall-storepulse-machine-connector.ps1") -WhatIf -InstallRoot $installRoot
    Assert-True -Condition (($uninstallOutput -join "`n") -match "preserved") -Message "uninstall WhatIf preserves ProgramData"

    foreach ($file in Get-ChildItem -LiteralPath $serviceRoot -Filter "*.ps1") {
        $content = Get-Content -LiteralPath $file.FullName -Raw
        Assert-True -Condition ($content -notmatch "Deepika|AB123|C:\\Users\\|Register-ScheduledTask|New-Service|sc.exe|192\.168\.|ABC") -Message "$($file.Name) has no user/store/service hardcoding"
        Assert-True -Condition ($content -notmatch "Invoke-RestMethod|Invoke-WebRequest") -Message "$($file.Name) performs no network calls"
    }

    Write-Host ("PASS: machine-wide connector service tests passed ({0} assertions)." -f $global:MachineServicePassCount)
}
finally {
    [Environment]::SetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", $previousProgramData, "Process")
    [Environment]::SetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", $previousInstall, "Process")
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($global:MachineServiceFailures.Count -gt 0) {
    Write-Host "FAIL: machine-wide connector service tests failed."
    foreach ($failure in $global:MachineServiceFailures) { Write-Host " - $failure" }
    exit 1
}
