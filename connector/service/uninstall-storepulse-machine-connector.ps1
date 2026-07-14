[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [string]$InstallRoot = "",
    [string]$ProgramDataRoot = "",
    [switch]$PurgeData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
. (Join-Path $PSScriptRoot "storepulse-windows-service.ps1")

$resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
$resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
$lockPath = Join-Path (Join-Path $resolvedProgramDataRoot "state") "runtime.lock"

Write-Host "StorePulse machine connector uninstall"
Write-Host ("Install root: {0}" -f $resolvedInstallRoot)
Write-Host ("ProgramData root: {0}" -f $resolvedProgramDataRoot)
if ($PurgeData) {
    Write-Host "PurgeData requested: ProgramData config, secrets, logs, working data, and archives will be removed only after confirmation."
}
else {
    Write-Host "ProgramData config, secrets, logs, working data, and archives will be preserved."
}

if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
    throw "StorePulse runtime appears active. Stop it before uninstalling."
}

if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Stop and remove StorePulseConnector service")) {
    Stop-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ErrorAction SilentlyContinue
    Remove-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ErrorAction SilentlyContinue
}

if ($PSCmdlet.ShouldProcess($resolvedInstallRoot, "Remove installed connector binaries")) {
    if (Test-Path -LiteralPath $resolvedInstallRoot -PathType Container) {
        Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force
        Write-Host "Installed binaries removed."
    }
}

if ($PurgeData) {
    if ($PSCmdlet.ShouldProcess($resolvedProgramDataRoot, "Purge StorePulse ProgramData")) {
        if (Test-Path -LiteralPath $resolvedProgramDataRoot -PathType Container) {
            Remove-Item -LiteralPath $resolvedProgramDataRoot -Recurse -Force
            Write-Host "ProgramData removed."
        }
    }
}
else {
    Write-Host "ProgramData preserved."
}
