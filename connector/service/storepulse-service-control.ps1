[CmdletBinding()]
param(
    [ValidateSet("InstallStatus", "PilotStatus", "CutoverStatus", "SetAutomaticDelayed", "SetManualPilot", "Start", "Stop", "Restart", "Status", "Validate", "RunForeground")]
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
$script:cutoverConfig = $null
$script:cutoverSecrets = $null

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

function Test-StorePulsePrerequisite {
    param([scriptblock]$Check)
    try {
        & $Check | Out-Null
        return [PSCustomObject]@{ ok = $true; message = "ok" }
    }
    catch {
        return [PSCustomObject]@{ ok = $false; message = $_.Exception.Message }
    }
}

function Get-StorePulseCutoverStatus {
    $installed = Test-StorePulseServiceInstalled
    $serviceConfig = $null
    if ($installed) {
        try { $serviceConfig = Get-StorePulseServiceConfiguration } catch { $serviceConfig = $null }
    }
    $scheduledTaskEnabled = Test-StorePulseLegacyCurrentShiftTaskEnabled
    $configCheck = Test-StorePulsePrerequisite { $script:cutoverConfig = Read-StorePulseMachineConfig -Path $resolvedConfigPath; Test-StorePulseMachineConfig -Config $script:cutoverConfig }
    $secretsCheck = Test-StorePulsePrerequisite { $script:cutoverSecrets = Read-StorePulseMachineSecrets -Path $resolvedSecretsPath; Test-StorePulseMachineSecrets -Secrets $script:cutoverSecrets }
    $nodeCheck = Test-StorePulseNodeRuntime -InstallRoot $resolvedInstallRoot -ManifestPath (Join-Path (Join-Path $resolvedInstallRoot "service") "node-runtime-manifest.json") -PassThru
    $winswCheck = Test-StorePulseWinSWBinary -InstallRoot $resolvedInstallRoot -ManifestPath (Join-Path (Join-Path $resolvedInstallRoot "service") "winsw-manifest.json") -PassThru
    $verifoneCheck = Test-StorePulsePrerequisite {
        if ($null -eq $script:cutoverConfig) { $script:cutoverConfig = Read-StorePulseMachineConfig -Path $resolvedConfigPath }
        $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-storepulse-verifone-runtime.ps1") -Mode ValidateInstalled -DestinationRoot ([string]$script:cutoverConfig.commander_install_path) 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Verifone runtime validation failed. $($result -join ' ')" }
    }
    $configForWorkers = if ($null -ne $script:cutoverConfig) { $script:cutoverConfig } else { $null }
    $ready = $installed `
        -and $null -ne $serviceConfig `
        -and [string]$serviceConfig.status -eq "Stopped" `
        -and [string]$serviceConfig.account -match "LocalSystem" `
        -and [string]$serviceConfig.image_path -match "StorePulseConnector\.exe" `
        -and (-not $scheduledTaskEnabled) `
        -and [bool]$configCheck.ok `
        -and [bool]$secretsCheck.ok `
        -and [bool]$nodeCheck.ok `
        -and [bool]$winswCheck.ok `
        -and [bool]$verifoneCheck.ok
    return [PSCustomObject]@{
        service_installed = $installed
        service_status = if ($serviceConfig) { [string]$serviceConfig.status } else { $null }
        service_startup_mode = if ($serviceConfig) { [string]$serviceConfig.startup_mode } else { $null }
        delayed_auto_start = if ($serviceConfig) { [bool]$serviceConfig.delayed_auto_start } else { $false }
        account = if ($serviceConfig) { [string]$serviceConfig.account } else { $null }
        image_path = if ($serviceConfig) { [string]$serviceConfig.image_path } else { $null }
        scheduled_task_enabled = $scheduledTaskEnabled
        config_valid = [bool]$configCheck.ok
        secrets_valid = [bool]$secretsCheck.ok
        node_valid = [bool]$nodeCheck.ok
        winsw_valid = [bool]$winswCheck.ok
        verifone_valid = [bool]$verifoneCheck.ok
        live_worker_enabled = if ($configForWorkers -and $configForWorkers.PSObject.Properties["live_worker_enabled"]) { [bool]$configForWorkers.live_worker_enabled } else { $null }
        closed_day_worker_enabled = if ($configForWorkers -and $configForWorkers.PSObject.Properties["closed_day_worker_enabled"]) { [bool]$configForWorkers.closed_day_worker_enabled } else { $null }
        closed_day_once_enabled = if ($configForWorkers -and $configForWorkers.PSObject.Properties["closed_day_once_enabled"]) { [bool]$configForWorkers.closed_day_once_enabled } else { $null }
        permanent_cutover_ready = $ready
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
    "CutoverStatus" {
        Get-StorePulseCutoverStatus | ConvertTo-Json -Depth 8
        return
    }
    "SetAutomaticDelayed" {
        Assert-StorePulseServiceStartPrerequisites -InstallRoot $resolvedInstallRoot -ConfigPath $resolvedConfigPath -SecretsPath $resolvedSecretsPath
        $serviceConfig = Get-StorePulseServiceConfiguration
        Assert-StorePulseInstalledServiceStopped -Configuration $serviceConfig -Operation "AutomaticDelayed cutover"
        Set-StorePulseServiceStartupMode -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode AutomaticDelayed | Out-Null
        Write-Host "Service configured for AutomaticDelayed startup."
        return
    }
    "SetManualPilot" {
        $serviceConfig = Get-StorePulseServiceConfiguration
        Assert-StorePulseInstalledServiceStopped -Configuration $serviceConfig -Operation "ManualPilot rollback"
        Set-StorePulseServiceStartupMode -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode ManualPilot | Out-Null
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
