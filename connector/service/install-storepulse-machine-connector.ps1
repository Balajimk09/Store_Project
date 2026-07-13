[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$ValidateOnly,
    [string]$SourceRoot = "",
    [string]$InstallRoot = "",
    [string]$ProgramDataRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")

function Test-StorePulseElevation {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$resolvedSourceRoot = if ([string]::IsNullOrWhiteSpace($SourceRoot)) { Split-Path -Parent $PSScriptRoot } else { $SourceRoot }
$resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
$resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot

if (-not (Test-StorePulseElevation)) {
    throw "Install scaffold must be run from an elevated PowerShell session."
}

$requiredFiles = @(
    "storepulse-connector.mjs",
    "storepulse-finalize-closed-day.ps1",
    "storepulse-normalize-transactions.ps1",
    "storepulse-upload-finalized-business-day.ps1"
)
foreach ($file in $requiredFiles) {
    $path = Join-Path $resolvedSourceRoot $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing source file: $path" }
}

Write-Host "StorePulse machine connector install scaffold"
Write-Host ("Source root: {0}" -f $resolvedSourceRoot)
Write-Host ("Install root: {0}" -f $resolvedInstallRoot)
Write-Host ("ProgramData root: {0}" -f $resolvedProgramDataRoot)
Write-Host "This checkpoint does not create users, register services, register scheduled tasks, or write secrets."

if ($ValidateOnly) {
    Write-Host "ValidateOnly complete. No files copied."
    return
}

if ($PSCmdlet.ShouldProcess($resolvedInstallRoot, "Copy StorePulse connector files")) {
    New-Item -ItemType Directory -Path $resolvedInstallRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $resolvedProgramDataRoot -Force | Out-Null
    foreach ($dir in @("logs", "working", "archive", "state")) {
        New-Item -ItemType Directory -Path (Join-Path $resolvedProgramDataRoot $dir) -Force | Out-Null
    }
    foreach ($file in $requiredFiles) {
        Copy-Item -LiteralPath (Join-Path $resolvedSourceRoot $file) -Destination (Join-Path $resolvedInstallRoot $file)
    }
    $serviceSource = Join-Path $resolvedSourceRoot "service"
    if (Test-Path -LiteralPath $serviceSource -PathType Container) {
        $serviceDestination = Join-Path $resolvedInstallRoot "service"
        if (-not (Test-Path -LiteralPath $serviceDestination -PathType Container)) {
            New-Item -ItemType Directory -Path $serviceDestination -Force | Out-Null
        }
        foreach ($serviceFile in Get-ChildItem -LiteralPath $serviceSource -Filter "*.ps1" -File) {
            Copy-Item -LiteralPath $serviceFile.FullName -Destination (Join-Path $serviceDestination $serviceFile.Name)
        }
    }
    Write-Host "Files copied. Next step: create ProgramData config.json and encrypted secrets.json, then run service host -Mode Validate."
}
