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
        live_watch_folder = Join-Path (Join-Path $Root "working") "live"
        live_archive_folder = Join-Path (Join-Path $Root "archive") "live"
        closed_day_once_enabled = $false
        live_worker_enabled = $true
        closed_day_worker_enabled = $true
    }
}

function Invoke-ConnectorOnceTest {
    param(
        [string]$Name,
        [string]$UploadResult = "success",
        [scriptblock]$Prepare = $null,
        [int]$StabilityWaitMs = 25,
        [string]$ExistingWatch = "",
        [string]$ExistingState = ""
    )
    $dir = Join-Path $tempRoot ("connector-once-" + $Name + "-" + [guid]::NewGuid().ToString("N"))
    $watch = if ([string]::IsNullOrWhiteSpace($ExistingWatch)) { Join-Path $dir "watch" } else { $ExistingWatch }
    $summary = Join-Path $dir "summary.json"
    $state = if ([string]::IsNullOrWhiteSpace($ExistingState)) { Join-Path $dir "state.json" } else { $ExistingState }
    New-Item -ItemType Directory -Path $watch -Force | Out-Null
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    if ($null -ne $Prepare) {
        & $Prepare $watch $state
    }

    $previous = @{}
    foreach ($nameKey in @("STOREPULSE_API_URL", "STOREPULSE_CONNECTOR_TOKEN", "STOREPULSE_WATCH_FOLDER", "STOREPULSE_ARCHIVE_FOLDER", "STOREPULSE_POLL_SECONDS", "STOREPULSE_DRY_RUN", "STOREPULSE_ONCE", "STOREPULSE_SUMMARY_PATH", "STOREPULSE_STATE_PATH", "STOREPULSE_STABILITY_WAIT_MS", "STOREPULSE_CONNECTOR_TEST_UPLOAD_RESULT")) {
        $previous[$nameKey] = [Environment]::GetEnvironmentVariable($nameKey, "Process")
    }
    try {
        [Environment]::SetEnvironmentVariable("STOREPULSE_API_URL", "https://example.invalid", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "synthetic-token", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_WATCH_FOLDER", $watch, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_ARCHIVE_FOLDER", " ", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_POLL_SECONDS", "60", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_DRY_RUN", "false", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_SUMMARY_PATH", $summary, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_STATE_PATH", $state, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_STABILITY_WAIT_MS", [string]$StabilityWaitMs, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TEST_UPLOAD_RESULT", $UploadResult, "Process")
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $output = & node (Join-Path $repoRoot "connector\storepulse-connector.mjs") --once --summary-path $summary 2>&1
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        [PSCustomObject]@{
            ExitCode = $exitCode
            OutputText = (($output | ForEach-Object { [string]$_ }) -join "`n")
            Summary = if (Test-Path -LiteralPath $summary -PathType Leaf) { Get-Content -LiteralPath $summary -Raw | ConvertFrom-Json } else { $null }
            SummaryText = if (Test-Path -LiteralPath $summary -PathType Leaf) { Get-Content -LiteralPath $summary -Raw } else { "" }
            Directory = $dir
            Watch = $watch
            State = $state
        }
    }
    finally {
        foreach ($nameKey in $previous.Keys) {
            [Environment]::SetEnvironmentVariable($nameKey, $previous[$nameKey], "Process")
        }
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

    $zeroNew = Invoke-ConnectorOnceTest -Name "zero-new"
    Assert-Equal -Actual $zeroNew.ExitCode -Expected 0 -Message "--once zero files exits 0"
    Assert-Equal -Actual $zeroNew.Summary.scanned -Expected 0 -Message "--once zero files scanned count"
    Assert-Equal -Actual $zeroNew.Summary.uploaded -Expected 0 -Message "--once zero files uploaded count"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$zeroNew.Summary.started_at)) -Message "--once summary has started_at"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$zeroNew.Summary.completed_at)) -Message "--once summary has completed_at"

    $uploadedOnce = Invoke-ConnectorOnceTest -Name "upload" -Prepare {
        param($Watch, $State)
        Set-Content -LiteralPath (Join-Path $Watch "report.xml") -Value "<report />" -Encoding UTF8
    }
    Assert-Equal -Actual $uploadedOnce.ExitCode -Expected 0 -Message "--once upload exits 0"
    Assert-Equal -Actual $uploadedOnce.Summary.scanned -Expected 1 -Message "--once scans one eligible file"
    Assert-Equal -Actual $uploadedOnce.Summary.eligible -Expected 1 -Message "--once reports eligible file"
    Assert-Equal -Actual $uploadedOnce.Summary.uploaded -Expected 1 -Message "--once reports uploaded file"

    $duplicateSeed = Invoke-ConnectorOnceTest -Name "duplicate-seed" -Prepare {
        param($Watch, $State)
        Set-Content -LiteralPath (Join-Path $Watch "duplicate.xml") -Value "<report />" -Encoding UTF8
    }
    $duplicate = Invoke-ConnectorOnceTest -Name "duplicate" -ExistingWatch $duplicateSeed.Watch -ExistingState $duplicateSeed.State
    Assert-Equal -Actual $duplicate.ExitCode -Expected 0 -Message "--once duplicate exits 0"
    Assert-Equal -Actual $duplicate.Summary.skipped_duplicate -Expected 1 -Message "--once reports skipped duplicate"

    $unstable = Invoke-ConnectorOnceTest -Name "unstable" -StabilityWaitMs 1000 -Prepare {
        param($Watch, $State)
        $file = Join-Path $Watch "unstable.xml"
        Set-Content -LiteralPath $file -Value "first" -Encoding UTF8
        Start-Job -ScriptBlock {
            param($Path)
            Start-Sleep -Milliseconds 200
            Add-Content -LiteralPath $Path -Value "second"
        } -ArgumentList $file | Out-Null
    }
    Assert-Equal -Actual $unstable.ExitCode -Expected 0 -Message "--once unstable exits 0"
    Assert-Equal -Actual $unstable.Summary.skipped_unstable -Expected 1 -Message "--once reports unstable file"

    $uploadFailure = Invoke-ConnectorOnceTest -Name "upload-failure" -UploadResult "failure" -Prepare {
        param($Watch, $State)
        Set-Content -LiteralPath (Join-Path $Watch "fail.xml") -Value "<report />" -Encoding UTF8
    }
    Assert-True -Condition ($uploadFailure.ExitCode -ne 0) -Message "--once upload failure exits nonzero"
    Assert-Equal -Actual $uploadFailure.Summary.failed -Expected 1 -Message "--once reports upload failure"
    Assert-True -Condition ($uploadFailure.OutputText -notmatch "synthetic-token" -and $uploadFailure.SummaryText -notmatch "synthetic-token") -Message "--once output and summary exclude connector token"

    $connectorSource = Get-Content -LiteralPath (Join-Path $repoRoot "connector\storepulse-connector.mjs") -Raw
    Assert-True -Condition ($connectorSource.Contains("while (!shuttingDown)")) -Message "default continuous polling loop remains present"

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

    $fakeConnectorScript = @'
import { appendFileSync, writeFileSync } from 'node:fs';
const summaryIndex = process.argv.indexOf('--summary-path');
const summaryPath = summaryIndex >= 0 ? process.argv[summaryIndex + 1] : process.env.STOREPULSE_SUMMARY_PATH;
const statePath = process.env.STOREPULSE_STATE_PATH;
appendFileSync(`${statePath}.calls`, `${process.argv.join(' ')}|${process.env.STOREPULSE_WATCH_FOLDER}|${process.env.STOREPULSE_CONNECTOR_TOKEN ? 'token-present' : 'token-missing'}\n`);
writeFileSync(summaryPath, JSON.stringify({
  scanned: 0,
  eligible: 0,
  uploaded: 0,
  skipped_duplicate: 0,
  skipped_unstable: 0,
  failed: 0,
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString()
}, null, 2));
'@
    Set-Content -LiteralPath (Join-Path $installRoot "storepulse-connector.mjs") -Value $fakeConnectorScript -Encoding UTF8
    New-Item -ItemType Directory -Path $config.live_watch_folder -Force | Out-Null
    $defaultLiveConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $defaultLiveConfig.closed_day_worker_enabled = $false
    $defaultLiveConfigPath = Join-Path $programDataRoot "default-live-config.json"
    Write-StorePulseMachineConfig -Config $defaultLiveConfig -Path $defaultLiveConfigPath | Out-Null
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $defaultLiveConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -Sleep { param($Seconds) } | Out-Null
    $defaultLiveStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    $liveStateRoot = Get-StorePulseStateRoot -ProgramDataRoot $programDataRoot
    $liveCallsPath = Join-Path $liveStateRoot "live-upload-state.json.calls"
    $liveCalls = Get-Content -LiteralPath $liveCallsPath -Raw
    Assert-Equal -Actual $defaultLiveStatus.live_worker.status -Expected "succeeded" -Message "runtime default live worker succeeds"
    Assert-True -Condition ($liveCalls -match "--once") -Message "runtime invokes connector with --once"
    Assert-True -Condition ($liveCalls -match "--summary-path") -Message "runtime passes live summary path"
    Assert-True -Condition ($liveCalls -match "token-present") -Message "runtime passes connector token through environment"
    Assert-True -Condition (($defaultLiveStatus.live_worker.last_result | ConvertTo-Json -Depth 10) -notmatch "synthetic-token") -Message "runtime live result excludes token"

    Remove-Item -LiteralPath $liveCallsPath -Force -ErrorAction SilentlyContinue
    $global:RuntimeSleepIntervals = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $defaultLiveConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -Sleep { param($Seconds) $global:RuntimeSleepIntervals += $Seconds } `
        -MaxIterations 2 | Out-Null
    $liveRunCalls = Get-Content -LiteralPath $liveCallsPath -Raw
    Assert-Equal -Actual (($liveRunCalls -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count) -Expected 2 -Message "Run mode repeats one-shot live connector"
    Assert-True -Condition ($global:RuntimeSleepIntervals -contains 300) -Message "Run mode uses configured live polling interval"

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
