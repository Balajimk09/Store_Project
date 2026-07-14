[CmdletBinding()]
param(
    [ValidateSet("InstallStatus", "PilotStatus", "SetAutomaticDelayed", "SetManualPilot", "Start", "Stop", "Restart", "Status", "Validate", "RunForeground")]
    [string]$Command = "Status",
    [string]$ConfigPath = "",
    [string]$ProgramDataRoot = "",
    [string]$InstallRoot = "",
    [string]$SecretsPath = "",
    [switch]$AllowPilotWithScheduledTask
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-service-runtime.ps1")
. (Join-Path $PSScriptRoot "storepulse-windows-service.ps1")
. (Join-Path $PSScriptRoot "storepulse-node-runtime.ps1")

$resolvedProgramDataRoot = if ([string]::IsNullOrWhiteSpace($ProgramDataRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($ConfigPath) -and (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        $config = Read-StorePulseMachineConfig -Path $ConfigPath
        Split-Path -Parent (Split-Path -Parent ([string]$config.logs_root))
    }
    else {
        Get-StorePulseProgramDataRoot
    }
}

$resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
$resolvedConfigPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) { Get-StorePulseConfigPath -ProgramDataRoot $resolvedProgramDataRoot } else { $ConfigPath }
$resolvedSecretsPath = if ([string]::IsNullOrWhiteSpace($SecretsPath)) { Get-StorePulseSecretsPath -ProgramDataRoot $resolvedProgramDataRoot } else { $SecretsPath }

function Test-StorePulseLegacyCurrentShiftTaskEnabled {
    $task = Get-ScheduledTask -TaskName "StorePulse-CurrentShift-Sync" -ErrorAction SilentlyContinue
    if ($null -eq $task) { return $false }
    return ([string]$task.State -ne "Disabled")
}

function Assert-StorePulseServiceStartPrerequisites {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][string]$ConfigPath,
        [Parameter(Mandatory)][string]$SecretsPath,
        [switch]$AllowScheduledTask
    )
    $config = Read-StorePulseMachineConfig -Path $ConfigPath
    Test-StorePulseMachineConfig -Config $config | Out-Null
    $secrets = Read-StorePulseMachineSecrets -Path $SecretsPath
    Test-StorePulseMachineSecrets -Secrets $secrets | Out-Null
    Test-StorePulseNodeRuntime -InstallRoot $InstallRoot -ManifestPath (Join-Path (Join-Path $InstallRoot "service") "node-runtime-manifest.json") | Out-Null
    Test-StorePulseWinSWBinary -InstallRoot $InstallRoot -ManifestPath (Join-Path (Join-Path $InstallRoot "service") "winsw-manifest.json") | Out-Null
    $verifoneValidation = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-storepulse-verifone-runtime.ps1") -Mode ValidateInstalled -DestinationRoot ([string]$config.commander_install_path) 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Verifone runtime validation failed. $($verifoneValidation -join ' ')"
    }
    if (-not $AllowScheduledTask -and (Test-StorePulseLegacyCurrentShiftTaskEnabled)) {
        throw "StorePulse-CurrentShift-Sync scheduled task is enabled. Disable it manually or pass -AllowPilotWithScheduledTask for a controlled pilot override."
    }
}

switch ($Command) {
    "InstallStatus" {
        $installed = Test-StorePulseServiceInstalled
        Write-Host ("Service installed: {0}" -f $installed)
        if ($installed) {
            $service = Get-StorePulseServiceStatus
            Write-Host ("Service status: {0}" -f $service.Status)
            Write-Host ("Service ImagePath: {0}" -f (Get-StorePulseServiceWrapperPath -InstallRoot $resolvedInstallRoot))
        }
        return
    }
    "PilotStatus" {
        $plan = Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode ManualPilot -ValidateOnly
        Write-Host ("ManualPilot ImagePath: {0}" -f $plan.image_path)
        Write-Host ("ManualPilot startup: {0}" -f $plan.startup_type)
        Write-Host ("Legacy scheduled task enabled: {0}" -f (Test-StorePulseLegacyCurrentShiftTaskEnabled))
        return
    }
    "SetAutomaticDelayed" {
        Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode AutomaticDelayed | Out-Null
        Write-Host "Service configured for AutomaticDelayed startup."
        return
    }
    "SetManualPilot" {
        Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode ManualPilot | Out-Null
        Write-Host "Service configured for ManualPilot startup."
        return
    }
    "Start" {
        Assert-StorePulseServiceStartPrerequisites -InstallRoot $resolvedInstallRoot -ConfigPath $resolvedConfigPath -SecretsPath $resolvedSecretsPath -AllowScheduledTask:$AllowPilotWithScheduledTask
        $stopPath = Get-StorePulseRuntimeStopPath -ProgramDataRoot $resolvedProgramDataRoot
        Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
        Start-StorePulseWindowsService -InstallRoot $resolvedInstallRoot
        Write-Host "Service start requested."
        return
    }
    "Restart" {
        Assert-StorePulseServiceStartPrerequisites -InstallRoot $resolvedInstallRoot -ConfigPath $resolvedConfigPath -SecretsPath $resolvedSecretsPath -AllowScheduledTask:$AllowPilotWithScheduledTask
        Remove-Item -LiteralPath (Get-StorePulseRuntimeStopPath -ProgramDataRoot $resolvedProgramDataRoot) -Force -ErrorAction SilentlyContinue
        Restart-StorePulseWindowsService -InstallRoot $resolvedInstallRoot
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
            Stop-StorePulseWindowsService -InstallRoot $resolvedInstallRoot
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
