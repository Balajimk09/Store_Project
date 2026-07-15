[CmdletBinding()]
param(
    [ValidateSet("Validate", "Once", "Run")]
    [string]$Mode = "Validate",
    [string]$ConfigPath = "",
    [string]$SecretsPath = "",
    [string]$InstallRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-service-runtime.ps1")
. (Join-Path $PSScriptRoot "storepulse-current-shift-worker.ps1")

$config = Read-StorePulseMachineConfig -Path $ConfigPath
$resolvedInstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { [string]$config.install_root } else { $InstallRoot }

Write-Host "StorePulse machine connector host starting."
Write-Host ("Mode: {0}" -f $Mode)
Write-Host ("Install root: {0}" -f $resolvedInstallRoot)
Write-Host ("Source store: {0}" -f $config.source_store_number)
Write-Host ("Logs root: {0}" -f $config.logs_root)
Write-Host "Secrets will be loaded into memory only."

$result = Invoke-StorePulseServiceRuntime `
    -Mode $Mode `
    -ConfigPath $ConfigPath `
    -SecretsPath $SecretsPath `
    -InstallRoot $resolvedInstallRoot

Write-Host ("Runtime status path: {0}" -f $result.status_path)
if ($Mode -eq "Run") {
    Write-Host "Runtime exited."
}
