[CmdletBinding()]
param(
    [ValidateSet("Validate", "Once")]
    [string]$Mode = "Validate",
    [string]$ConfigPath = "",
    [string]$SecretsPath = "",
    [string]$InstallRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
. (Join-Path $PSScriptRoot "storepulse-machine-secrets.ps1")

function Write-StorePulseHostLog {
    param([Parameter(Mandatory)][string]$LogsRoot, [Parameter(Mandatory)][string]$Message)
    if (-not (Test-Path -LiteralPath $LogsRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
    }
    $path = Join-Path $LogsRoot ("service-host-" + (Get-Date -Format "yyyyMMdd") + ".log")
    Add-Content -LiteralPath $path -Encoding UTF8 -Value ("{0} {1}" -f (Get-Date).ToString("o"), $Message)
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

$config = Read-StorePulseMachineConfig -Path $ConfigPath
Test-StorePulseMachineConfig -Config $config | Out-Null
$secrets = Read-StorePulseMachineSecrets -Path $SecretsPath
Test-StorePulseMachineSecrets -Secrets $secrets | Out-Null

$resolvedInstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { [string]$config.install_root } else { $InstallRoot }
Test-StorePulseServiceScripts -Root $resolvedInstallRoot | Out-Null

Write-Host "StorePulse machine connector validation succeeded."
Write-Host ("Install root: {0}" -f $resolvedInstallRoot)
Write-Host ("Source store: {0}" -f $config.source_store_number)
Write-Host ("Logs root: {0}" -f $config.logs_root)
Write-Host "Secrets loaded: commander_username, commander_password, connector_token"

if ($Mode -eq "Validate") {
    return
}

Write-StorePulseHostLog -LogsRoot ([string]$config.logs_root) -Message "Starting one-shot machine connector host."
$liveExitCode = 0
$closedExitCode = 0

Write-StorePulseHostLog -LogsRoot ([string]$config.logs_root) -Message "Live worker one-shot placeholder completed; existing live connector has no safe one-shot command in this checkpoint."

$closedEnabled = $false
if ($config.PSObject.Properties["closed_day_once_enabled"]) {
    $closedEnabled = [bool]$config.closed_day_once_enabled
}

if ($closedEnabled) {
    $closedScript = Join-Path $resolvedInstallRoot "storepulse-finalize-closed-day.ps1"
    $arguments = @(
        "-InstallPath", $resolvedInstallRoot,
        "-CommanderIp", ([string]$config.commander_ip),
        "-SourceStoreNumber", ([string]$config.source_store_number),
        "-WorkingRoot", ([string]$config.working_root),
        "-ArchiveRoot", ([string]$config.archive_root),
        "-Endpoint", ([string]$config.finalization_endpoint_url)
    )
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $closedScript @arguments
    $closedExitCode = $LASTEXITCODE
    Write-StorePulseHostLog -LogsRoot ([string]$config.logs_root) -Message ("Closed-day worker exited with code {0}." -f $closedExitCode)
}
else {
    Write-StorePulseHostLog -LogsRoot ([string]$config.logs_root) -Message "Closed-day worker disabled for one-shot checkpoint."
}

Write-Host ("Live worker exit code: {0}" -f $liveExitCode)
Write-Host ("Closed-day worker exit code: {0}" -f $closedExitCode)
if ($liveExitCode -ne 0 -or $closedExitCode -ne 0) { exit 1 }
