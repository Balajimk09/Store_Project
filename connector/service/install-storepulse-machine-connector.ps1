[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = "Validate")]
param(
    [Parameter(ParameterSetName = "Install")][switch]$Install,
    [Parameter(ParameterSetName = "Repair")][switch]$Repair,
    [Parameter(ParameterSetName = "Upgrade")][switch]$Upgrade,
    [Parameter(ParameterSetName = "Validate")][switch]$ValidateOnly,
    [string]$SourceRoot = "",
    [string]$InstallRoot = "",
    [string]$ProgramDataRoot = "",
    [ValidateSet("", "ManualPilot", "AutomaticDelayed")][string]$StartupMode = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
. (Join-Path $PSScriptRoot "storepulse-machine-secrets.ps1")
. (Join-Path $PSScriptRoot "storepulse-windows-service.ps1")
. (Join-Path $PSScriptRoot "storepulse-node-runtime.ps1")

function Test-StorePulseElevation {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-StorePulseInstallManifest {
    param([Parameter(Mandatory)][string]$SourceRoot)
    $manifestPath = Join-Path (Join-Path $SourceRoot "service") "install-manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Install manifest not found: $manifestPath" }
    return Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}

function Copy-StorePulseInstalledFiles {
    param(
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$InstallRoot
    )
    foreach ($relative in $Manifest.required_files) {
        $source = Join-Path $SourceRoot ([string]$relative)
        $destination = Join-Path $InstallRoot ([string]$relative)
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source file: $source" }
        $parent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $source -Destination $destination
    }
    $nodeSource = Join-Path $SourceRoot ([string]$Manifest.bundled_node_runtime_relative_path)
    $nodeDestination = Join-Path $InstallRoot ([string]$Manifest.bundled_node_runtime_relative_path)
    if (Test-Path -LiteralPath $nodeSource -PathType Container) {
        if (-not (Test-Path -LiteralPath (Split-Path -Parent $nodeDestination) -PathType Container)) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $nodeDestination) -Force | Out-Null
        }
        Copy-Item -LiteralPath $nodeSource -Destination $nodeDestination -Recurse -Force
    }
    else {
        throw "Private Node runtime source is missing: $nodeSource"
    }

    if ($Manifest.PSObject.Properties["winsw_runtime_relative_path"]) {
        $winswSource = Join-Path $SourceRoot ([string]$Manifest.winsw_runtime_relative_path)
        $winswDestination = Join-Path $InstallRoot ([string]$Manifest.winsw_runtime_relative_path)
        if (-not (Test-Path -LiteralPath $winswSource -PathType Leaf)) {
            throw "Native WinSW wrapper source is missing: $winswSource"
        }
        $parent = Split-Path -Parent $winswDestination
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        Copy-Item -LiteralPath $winswSource -Destination $winswDestination -Force
    }
}

function Resolve-StorePulseInstallerStartupMode {
    param(
        [Parameter(Mandatory)][string]$Mode,
        [string]$RequestedStartupMode = "",
        [Parameter(Mandatory)][string]$InstallRoot,
        [bool]$ServiceInstalled
    )
    if (-not [string]::IsNullOrWhiteSpace($RequestedStartupMode)) {
        return $RequestedStartupMode
    }
    if ($Mode -eq "Install") {
        return "ManualPilot"
    }
    if ($ServiceInstalled) {
        return Get-StorePulseInstalledStartupMode -InstallRoot $InstallRoot
    }
    return "ManualPilot"
}

$resolvedSourceRoot = if ([string]::IsNullOrWhiteSpace($SourceRoot)) { Split-Path -Parent $PSScriptRoot } else { $SourceRoot }
$resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
$resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
$manifest = Read-StorePulseInstallManifest -SourceRoot $resolvedSourceRoot
$mode = if ($Install) { "Install" } elseif ($Repair) { "Repair" } elseif ($Upgrade) { "Upgrade" } else { "ValidateOnly" }
$startupModeWasExplicit = $PSBoundParameters.ContainsKey("StartupMode") -and -not [string]::IsNullOrWhiteSpace($StartupMode)
$serviceInstalledBefore = Test-StorePulseServiceInstalled
$effectiveStartupMode = Resolve-StorePulseInstallerStartupMode -Mode $mode -RequestedStartupMode $StartupMode -InstallRoot $resolvedInstallRoot -ServiceInstalled:$serviceInstalledBefore

if ($mode -ne "ValidateOnly" -and -not (Test-StorePulseElevation)) {
    throw "$mode must be run from an elevated PowerShell session."
}
if ($mode -eq "Install" -and $serviceInstalledBefore) {
    throw "StorePulseConnector is already installed. Use -Repair or -Upgrade for an existing service."
}

Write-Host "StorePulse machine connector installer"
Write-Host ("Mode: {0}" -f $mode)
Write-Host ("Source root: {0}" -f $resolvedSourceRoot)
Write-Host ("Install root: {0}" -f $resolvedInstallRoot)
Write-Host ("ProgramData root: {0}" -f $resolvedProgramDataRoot)
Write-Host ("Service: {0}" -f $manifest.service_name)
Write-Host ("Startup mode: {0}" -f $effectiveStartupMode)
Write-Host ("Startup mode source: {0}" -f $(if ($startupModeWasExplicit) { "explicit" } elseif ($serviceInstalledBefore -and $mode -in @("Repair", "Upgrade")) { "preserved" } else { "default" }))
Write-Host "ProgramData config, secrets, logs, working data, archive, and state are preserved."
Write-Host "No employee Windows password is requested."
Write-Host "A private Node runtime is expected under runtime\\node; this installer never installs Node globally."

foreach ($relative in $manifest.required_files) {
    $source = Join-Path $resolvedSourceRoot ([string]$relative)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source file: $source" }
}

$servicePlan = Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $effectiveStartupMode -ValidateOnly
Write-Host ("Planned service executable: {0}" -f $servicePlan.wrapper_path)
Write-Host ("Planned service ImagePath: {0}" -f $servicePlan.image_path)
Write-Host ("Planned service startup mode: {0}" -f $servicePlan.startup_mode)

if ($ValidateOnly -or (-not $Install -and -not $Repair -and -not $Upgrade)) {
    Write-Host "ValidateOnly complete. No files copied and no service registered."
    return
}

$configPath = Get-StorePulseConfigPath -ProgramDataRoot $resolvedProgramDataRoot
$secretsPath = Get-StorePulseSecretsPath -ProgramDataRoot $resolvedProgramDataRoot
$config = Read-StorePulseMachineConfig -Path $configPath
Test-StorePulseMachineConfig -Config $config | Out-Null
$secrets = Read-StorePulseMachineSecrets -Path $secretsPath
Test-StorePulseMachineSecrets -Secrets $secrets | Out-Null
Test-StorePulseNodeRuntime -InstallRoot $resolvedSourceRoot -ManifestPath (Join-Path (Join-Path $resolvedSourceRoot "service") "node-runtime-manifest.json") | Out-Null
if ($manifest.PSObject.Properties["winsw_runtime_relative_path"]) {
    $sourceWinswManifestPath = Join-Path (Join-Path $resolvedSourceRoot "service") "winsw-manifest.json"
    $sourceWinswPath = Join-Path $resolvedSourceRoot ([string]$manifest.winsw_runtime_relative_path)
    if (-not (Test-Path -LiteralPath $sourceWinswPath -PathType Leaf)) { throw "Native WinSW wrapper source is missing: $sourceWinswPath" }
    $winswManifest = Read-StorePulseWinSWManifest -ManifestPath $sourceWinswManifestPath
    $sourceWinswHash = (Get-FileHash -LiteralPath $sourceWinswPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($sourceWinswHash -ne ([string]$winswManifest.sha256).ToUpperInvariant()) { throw "Source WinSW wrapper SHA-256 mismatch." }
}
$verifoneValidation = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-storepulse-verifone-runtime.ps1") -Mode ValidateInstalled -DestinationRoot ([string]$config.commander_install_path) 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Verifone runtime validation failed. $($verifoneValidation -join ' ')"
}

if ($PSCmdlet.ShouldProcess($resolvedInstallRoot, "$mode StorePulse connector files and service")) {
    foreach ($dir in @($resolvedInstallRoot, $resolvedProgramDataRoot, (Join-Path $resolvedProgramDataRoot "logs"), (Join-Path $resolvedProgramDataRoot "working"), (Join-Path $resolvedProgramDataRoot "archive"), (Join-Path $resolvedProgramDataRoot "state"))) {
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }

    $backupRoot = $null
    if ($Upgrade -and (Test-Path -LiteralPath $resolvedInstallRoot -PathType Container)) {
        $backupRoot = Join-Path ([IO.Path]::GetTempPath()) ("storepulse-upgrade-backup-" + [guid]::NewGuid().ToString("N"))
        Copy-Item -LiteralPath $resolvedInstallRoot -Destination $backupRoot -Recurse -Force
        if ($serviceInstalledBefore) {
            $serviceState = Get-StorePulseServiceConfiguration
            if ([string]$serviceState.status -ne "Stopped") {
                throw "Upgrade requires StorePulseConnector to be Stopped."
            }
        }
    }

    try {
        Copy-StorePulseInstalledFiles -Manifest $manifest -SourceRoot $resolvedSourceRoot -InstallRoot $resolvedInstallRoot
        Test-StorePulseNodeRuntime -InstallRoot $resolvedInstallRoot -ManifestPath (Join-Path (Join-Path $resolvedInstallRoot "service") "node-runtime-manifest.json") | Out-Null
        Test-StorePulseWinSWBinary -InstallRoot $resolvedInstallRoot -ManifestPath (Join-Path (Join-Path $resolvedInstallRoot "service") "winsw-manifest.json") | Out-Null
        if ($serviceInstalledBefore) {
            Set-StorePulseServiceStartupMode -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $effectiveStartupMode | Out-Null
        }
        else {
            Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $effectiveStartupMode | Out-Null
        }
    }
    catch {
        if ($null -ne $backupRoot -and (Test-Path -LiteralPath $backupRoot -PathType Container)) {
            Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force -ErrorAction SilentlyContinue
            Copy-Item -LiteralPath $backupRoot -Destination $resolvedInstallRoot -Recurse -Force
        }
        throw
    }
    finally {
        if ($null -ne $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Write-Host ("Install layer complete. Service executable: {0}" -f (Get-StorePulseServiceWrapperPath -InstallRoot $resolvedInstallRoot))
    Write-Host ("Installed startup mode: {0}" -f $effectiveStartupMode)
    Write-Host "Next safe step: verify pilot readiness, then use service-control Start only during controlled cutover."
}
