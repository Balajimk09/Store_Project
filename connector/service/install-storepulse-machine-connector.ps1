[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = "Validate")]
param(
    [Parameter(ParameterSetName = "Install")][switch]$Install,
    [Parameter(ParameterSetName = "Repair")][switch]$Repair,
    [Parameter(ParameterSetName = "Upgrade")][switch]$Upgrade,
    [Parameter(ParameterSetName = "Validate")][switch]$ValidateOnly,
    [string]$SourceRoot = "",
    [string]$InstallRoot = "",
    [string]$ProgramDataRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
. (Join-Path $PSScriptRoot "storepulse-windows-service.ps1")

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
        if (-not (Test-Path -LiteralPath $nodeDestination -PathType Container)) {
            New-Item -ItemType Directory -Path $nodeDestination -Force | Out-Null
        }
        Set-Content -LiteralPath (Join-Path $nodeDestination "README.txt") -Encoding UTF8 -Value "Private Node runtime placeholder. Production packaging must place node.exe here before service start."
    }
}

$resolvedSourceRoot = if ([string]::IsNullOrWhiteSpace($SourceRoot)) { Split-Path -Parent $PSScriptRoot } else { $SourceRoot }
$resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
$resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
$manifest = Read-StorePulseInstallManifest -SourceRoot $resolvedSourceRoot
$mode = if ($Install) { "Install" } elseif ($Repair) { "Repair" } elseif ($Upgrade) { "Upgrade" } else { "ValidateOnly" }

if ($mode -ne "ValidateOnly" -and -not (Test-StorePulseElevation)) {
    throw "$mode must be run from an elevated PowerShell session."
}

Write-Host "StorePulse machine connector installer"
Write-Host ("Mode: {0}" -f $mode)
Write-Host ("Source root: {0}" -f $resolvedSourceRoot)
Write-Host ("Install root: {0}" -f $resolvedInstallRoot)
Write-Host ("ProgramData root: {0}" -f $resolvedProgramDataRoot)
Write-Host ("Service: {0}" -f $manifest.service_name)
Write-Host "ProgramData config, secrets, logs, working data, archive, and state are preserved."
Write-Host "No employee Windows password is requested."
Write-Host "A private Node runtime is expected under runtime\\node; this installer never installs Node globally."

foreach ($relative in $manifest.required_files) {
    $source = Join-Path $resolvedSourceRoot ([string]$relative)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source file: $source" }
}

$servicePlan = Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ValidateOnly
Write-Host ("Planned service command: {0}" -f $servicePlan.binary_path)

if ($ValidateOnly -or (-not $Install -and -not $Repair -and -not $Upgrade)) {
    Write-Host "ValidateOnly complete. No files copied and no service registered."
    return
}

if ($PSCmdlet.ShouldProcess($resolvedInstallRoot, "$mode StorePulse connector files and service")) {
    foreach ($dir in @($resolvedInstallRoot, $resolvedProgramDataRoot, (Join-Path $resolvedProgramDataRoot "logs"), (Join-Path $resolvedProgramDataRoot "working"), (Join-Path $resolvedProgramDataRoot "archive"), (Join-Path $resolvedProgramDataRoot "state"))) {
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }

    $backupRoot = $null
    if ($Upgrade -and (Test-Path -LiteralPath $resolvedInstallRoot -PathType Container)) {
        $backupRoot = Join-Path ([IO.Path]::GetTempPath()) ("storepulse-upgrade-backup-" + [guid]::NewGuid().ToString("N"))
        Copy-Item -LiteralPath $resolvedInstallRoot -Destination $backupRoot -Recurse -Force
        Stop-StorePulseWindowsService -ErrorAction SilentlyContinue
    }

    try {
        Copy-StorePulseInstalledFiles -Manifest $manifest -SourceRoot $resolvedSourceRoot -InstallRoot $resolvedInstallRoot
        Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot | Out-Null
        if ($Upgrade) { Start-StorePulseWindowsService -ErrorAction SilentlyContinue }
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
    Write-Host "Install layer complete. Next safe step: verify ProgramData config/secrets, then run service-control Validate."
}
