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
    }
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$previousProgramData = [Environment]::GetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", "Process")
$previousInstall = [Environment]::GetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", "Process")

try {
    . (Join-Path $serviceRoot "storepulse-machine-config.ps1")
    . (Join-Path $serviceRoot "storepulse-machine-secrets.ps1")

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
    Assert-True -Condition (($hostOutput -join "`n") -match "validation succeeded") -Message "host Validate mode succeeds"
    Assert-True -Condition (($hostOutput -join "`n") -notmatch "synthetic-password|synthetic-token") -Message "host Validate does not print secrets"

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
