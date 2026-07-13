[CmdletBinding()]
param(
    [ValidateSet("InstallStatus", "Start", "Stop", "Restart", "Status", "Validate", "RunForeground")]
    [string]$Command = "Status",
    [string]$ConfigPath = "",
    [string]$ProgramDataRoot = "",
    [string]$InstallRoot = "",
    [string]$SecretsPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-service-runtime.ps1")
. (Join-Path $PSScriptRoot "storepulse-windows-service.ps1")

$resolvedProgramDataRoot = if ([string]::IsNullOrWhiteSpace($ProgramDataRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($ConfigPath) -and (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        $config = Read-StorePulseMachineConfig -Path $ConfigPath
        Split-Path -Parent (Split-Path -Parent ([string]$config.logs_root))
    }
    else {
        Get-StorePulseProgramDataRoot
    }
}
else {
    $ProgramDataRoot
}

switch ($Command) {
    "InstallStatus" {
        $installed = Test-StorePulseServiceInstalled
        Write-Host ("Service installed: {0}" -f $installed)
        if ($installed) {
            $service = Get-StorePulseServiceStatus
            Write-Host ("Service status: {0}" -f $service.Status)
        }
        return
    }
    "Start" {
        Start-StorePulseWindowsService
        Write-Host "Service start requested."
        return
    }
    "Restart" {
        Restart-StorePulseWindowsService
        Write-Host "Service restart requested."
        return
    }
    "Status" {
        $installed = Test-StorePulseServiceInstalled
        Write-Host ("Service installed: {0}" -f $installed)
        if ($installed) {
            $service = Get-StorePulseServiceStatus
            Write-Host ("Service status: {0}" -f $service.Status)
        }
        $statusPath = Get-StorePulseRuntimeStatusPath -ProgramDataRoot $resolvedProgramDataRoot
        if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
            Write-Host "StorePulse runtime status not found."
            return
        }
        Get-Content -LiteralPath $statusPath -Raw
        return
    }
    "Stop" {
        $stopPath = Get-StorePulseRuntimeStopPath -ProgramDataRoot $resolvedProgramDataRoot
        $parent = Split-Path -Parent $stopPath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        Set-Content -LiteralPath $stopPath -Encoding UTF8 -Value ((Get-Date).ToString("o"))
        if (Test-StorePulseServiceInstalled) {
            Stop-StorePulseWindowsService
        }
        Write-Host ("Stop requested: {0}" -f $stopPath)
        return
    }
    "RunForeground" {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "storepulse-service-host.ps1") -Mode Run -ConfigPath $ConfigPath -SecretsPath $SecretsPath -InstallRoot $InstallRoot
        exit $LASTEXITCODE
    }
    "Validate" {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "storepulse-service-host.ps1") -Mode Validate -ConfigPath $ConfigPath -SecretsPath $SecretsPath -InstallRoot $InstallRoot
        exit $LASTEXITCODE
    }
}
