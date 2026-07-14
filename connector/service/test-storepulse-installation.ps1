[CmdletBinding()]
param(
    [ValidateSet("ValidateFiles", "ValidateConfig", "ValidateSecrets", "ValidateRuntime", "ValidateServicePlan", "SmokeTestOnce", "All")]
    [string]$Mode = "All",
    [string]$ConfigPath = "",
    [string]$SecretsPath = "",
    [string]$InstallRoot = "",
    [string]$ProgramDataRoot = "",
    [string]$OutputPath = "",
    [switch]$NoProduction,
    [scriptblock]$LiveWorker = $null,
    [scriptblock]$ClosedDayWorker = $null,
    [string]$NodeManifestPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
. (Join-Path $PSScriptRoot "storepulse-machine-secrets.ps1")
. (Join-Path $PSScriptRoot "storepulse-service-runtime.ps1")
. (Join-Path $PSScriptRoot "storepulse-windows-service.ps1")
. (Join-Path $PSScriptRoot "storepulse-node-runtime.ps1")

function Add-StorePulseCheckResult {
    param([Parameter(Mandatory)][System.Collections.IList]$Checks, [string]$Name, [bool]$Ok, [string]$Message)
    [void]$Checks.Add([ordered]@{ name = $Name; ok = $Ok; message = $Message })
}

$programData = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
$resolvedConfigPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) { Get-StorePulseConfigPath -ProgramDataRoot $programData } else { $ConfigPath }
$resolvedSecretsPath = if ([string]::IsNullOrWhiteSpace($SecretsPath)) { Get-StorePulseSecretsPath -ProgramDataRoot $programData } else { $SecretsPath }
$resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
$resolvedNodeManifestPath = if ([string]::IsNullOrWhiteSpace($NodeManifestPath)) { Join-Path (Join-Path $resolvedInstallRoot "service") "node-runtime-manifest.json" } else { $NodeManifestPath }
$stateRoot = Join-Path $programData "state"
$resolvedOutputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) { Join-Path $stateRoot "installation-validation-report.json" } else { $OutputPath }
$checks = New-Object System.Collections.ArrayList

if ($Mode -in @("ValidateFiles", "All")) {
    try { Test-StorePulseServiceScripts -Root $resolvedInstallRoot | Out-Null; Add-StorePulseCheckResult $checks "files" $true "Required connector files are present." }
    catch { Add-StorePulseCheckResult $checks "files" $false $_.Exception.Message }
}
if ($Mode -in @("ValidateConfig", "All")) {
    try { $config = Read-StorePulseMachineConfig -Path $resolvedConfigPath; Test-StorePulseMachineConfig -Config $config | Out-Null; Add-StorePulseCheckResult $checks "config" $true "Machine config is valid." }
    catch { Add-StorePulseCheckResult $checks "config" $false $_.Exception.Message }
}
if ($Mode -in @("ValidateSecrets", "All")) {
    try { $secrets = Read-StorePulseMachineSecrets -Path $resolvedSecretsPath; Test-StorePulseMachineSecrets -Secrets $secrets | Out-Null; Add-StorePulseCheckResult $checks "secrets" $true "Machine secrets are present and decryptable." }
    catch { Add-StorePulseCheckResult $checks "secrets" $false $_.Exception.Message }
}
if ($Mode -in @("ValidateRuntime", "All")) {
    $runtime = Test-StorePulseNodeRuntime -InstallRoot $resolvedInstallRoot -ManifestPath $resolvedNodeManifestPath -PassThru
    Add-StorePulseCheckResult $checks "node_runtime" ([bool]$runtime.ok) ([string]$runtime.message)
    $winsw = Test-StorePulseWinSWBinary -InstallRoot $resolvedInstallRoot -ManifestPath (Join-Path (Join-Path $resolvedInstallRoot "service") "winsw-manifest.json") -PassThru
    Add-StorePulseCheckResult $checks "winsw_runtime" ([bool]$winsw.ok) ([string]$winsw.message)
}
if ($Mode -in @("ValidateServicePlan", "All")) {
    try {
        $plan = Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ProgramDataRoot $programData -StartupMode ManualPilot -ValidateOnly
        if ($plan.image_path -notlike "*StorePulseConnector.exe") { throw "Service ImagePath does not point to native wrapper." }
        if ($plan.image_path -match "powershell.exe") { throw "Service ImagePath points directly to PowerShell." }
        Add-StorePulseCheckResult $checks "service_plan" $true ("Service plan valid for " + $plan.service_name + " using " + $plan.startup_mode)
    }
    catch { Add-StorePulseCheckResult $checks "service_plan" $false $_.Exception.Message }
}
if ($Mode -in @("SmokeTestOnce", "All")) {
    try {
        if (-not $NoProduction) { throw "SmokeTestOnce requires -NoProduction in this checkpoint." }
        if ($null -eq $LiveWorker) { $LiveWorker = { param($Config,$Secrets,$Root) [PSCustomObject]@{ smoke = "live" } } }
        if ($null -eq $ClosedDayWorker) { $ClosedDayWorker = { param($Config,$Secrets,$Root) [PSCustomObject]@{ smoke = "closed" } } }
        Invoke-StorePulseServiceRuntime -Mode Once -ConfigPath $resolvedConfigPath -SecretsPath $resolvedSecretsPath -InstallRoot $resolvedInstallRoot -LiveWorker $LiveWorker -ClosedDayWorker $ClosedDayWorker -Sleep { param($Seconds) } | Out-Null
        Add-StorePulseCheckResult $checks "smoke_once" $true "No-production smoke test completed."
    }
    catch { Add-StorePulseCheckResult $checks "smoke_once" $false $_.Exception.Message }
}

$ok = -not ($checks | Where-Object { -not $_.ok })
$report = [ordered]@{
    ok = $ok
    generated_at = (Get-Date).ToString("o")
    mode = $Mode
    install_root = $resolvedInstallRoot
    config_path = $resolvedConfigPath
    secrets_path = $resolvedSecretsPath
    checks = $checks
}
$parent = Split-Path -Parent $resolvedOutputPath
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resolvedOutputPath -Encoding UTF8
Write-Host ("Validation report: {0}" -f $resolvedOutputPath)
if (-not $ok) { exit 1 }
