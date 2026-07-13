[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$InstallRoot = "")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")

$resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
Write-Host "StorePulse machine connector uninstall scaffold"
Write-Host ("Install root: {0}" -f $resolvedInstallRoot)
Write-Host "ProgramData config, secrets, logs, working data, and archives will be preserved."
Write-Host "No service is unregistered in this checkpoint because service registration is not implemented yet."

if ($PSCmdlet.ShouldProcess($resolvedInstallRoot, "Remove installed connector binaries")) {
    if (Test-Path -LiteralPath $resolvedInstallRoot -PathType Container) {
        Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force
        Write-Host "Installed binaries removed."
    }
    else {
        Write-Host "Install root not found; nothing to remove."
    }
}
