[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseInstallRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}

$script:StorePulseServiceName = "StorePulseConnector"
$script:StorePulseServiceDisplayName = "StorePulse Connector Service"

function Invoke-StorePulseServiceCommand {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [scriptblock]$Executor = $null
    )
    if ($null -ne $Executor) {
        return & $Executor $Arguments
    }
    $output = & sc.exe @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Service control command failed: sc.exe $($Arguments -join ' ') $($output -join ' ')"
    }
    return $output
}

function ConvertTo-StorePulseQuotedArgument {
    param([Parameter(Mandatory)][string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Assert-StorePulsePathUnderRoot {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Name
    )
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Name must be under the StorePulse install root."
    }
    return $fullPath
}

function Get-StorePulseServiceEntrypointPath {
    param([string]$InstallRoot = "")
    return (Join-Path (Join-Path (Get-StorePulseInstallRoot -Root $InstallRoot) "service") "storepulse-service-entrypoint.ps1")
}

function Get-StorePulseServiceBinaryPath {
    param(
        [string]$InstallRoot = "",
        [string]$PowerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $entrypoint = Assert-StorePulsePathUnderRoot -Path (Get-StorePulseServiceEntrypointPath -InstallRoot $resolvedInstallRoot) -Root $resolvedInstallRoot -Name "Service entrypoint"
    $quotedPowerShell = ConvertTo-StorePulseQuotedArgument -Value $PowerShellPath
    $quotedEntrypoint = ConvertTo-StorePulseQuotedArgument -Value $entrypoint
    return "$quotedPowerShell -NoProfile -ExecutionPolicy Bypass -File $quotedEntrypoint"
}

function Test-StorePulseServiceInstalled {
    param(
        [string]$Name = $script:StorePulseServiceName,
        [scriptblock]$GetService = $null
    )
    try {
        if ($null -ne $GetService) {
            return [bool](& $GetService $Name)
        }
        return [bool](Get-Service -Name $Name -ErrorAction Stop)
    }
    catch {
        return $false
    }
}

function Get-StorePulseServiceStatus {
    param(
        [string]$Name = $script:StorePulseServiceName,
        [scriptblock]$GetService = $null
    )
    if ($null -ne $GetService) {
        return & $GetService $Name
    }
    return Get-Service -Name $Name -ErrorAction Stop
}

function Install-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string]$InstallRoot = "",
        [switch]$ValidateOnly,
        [scriptblock]$Executor = $null
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $entrypoint = Get-StorePulseServiceEntrypointPath -InstallRoot $resolvedInstallRoot
    Assert-StorePulsePathUnderRoot -Path $entrypoint -Root $resolvedInstallRoot -Name "Service entrypoint" | Out-Null
    $binaryPath = Get-StorePulseServiceBinaryPath -InstallRoot $resolvedInstallRoot
    $plan = [PSCustomObject]@{
        service_name = $script:StorePulseServiceName
        display_name = $script:StorePulseServiceDisplayName
        account = "LocalSystem"
        startup_type = "Automatic"
        delayed_auto_start = $true
        binary_path = $binaryPath
    }
    if ($ValidateOnly) { return $plan }
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Install StorePulse Windows service")) {
        Invoke-StorePulseServiceCommand -Arguments @("create", $script:StorePulseServiceName, "binPath=", $binaryPath, "DisplayName=", $script:StorePulseServiceDisplayName, "start=", "auto", "obj=", "LocalSystem") -Executor $Executor | Out-Null
        Invoke-StorePulseServiceCommand -Arguments @("description", $script:StorePulseServiceName, "Runs the StorePulse machine-wide POS connector runtime.") -Executor $Executor | Out-Null
        Invoke-StorePulseServiceCommand -Arguments @("config", $script:StorePulseServiceName, "start=", "delayed-auto") -Executor $Executor | Out-Null
        Set-StorePulseServiceRecovery -Executor $Executor | Out-Null
    }
    return $plan
}

function Start-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([scriptblock]$Executor = $null)
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Start service")) {
        Invoke-StorePulseServiceCommand -Arguments @("start", $script:StorePulseServiceName) -Executor $Executor | Out-Null
    }
}

function Stop-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([scriptblock]$Executor = $null)
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Stop service")) {
        Invoke-StorePulseServiceCommand -Arguments @("stop", $script:StorePulseServiceName) -Executor $Executor | Out-Null
    }
}

function Restart-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([scriptblock]$Executor = $null)
    Stop-StorePulseWindowsService -Executor $Executor
    Start-StorePulseWindowsService -Executor $Executor
}

function Remove-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([scriptblock]$Executor = $null)
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Remove service")) {
        Invoke-StorePulseServiceCommand -Arguments @("delete", $script:StorePulseServiceName) -Executor $Executor | Out-Null
    }
}

function Set-StorePulseServiceRecovery {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([scriptblock]$Executor = $null)
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Configure restart recovery policy")) {
        Invoke-StorePulseServiceCommand -Arguments @("failure", $script:StorePulseServiceName, "reset=", "86400", "actions=", "restart/60000/restart/300000/restart/900000") -Executor $Executor | Out-Null
        Invoke-StorePulseServiceCommand -Arguments @("failureflag", $script:StorePulseServiceName, "1") -Executor $Executor | Out-Null
    }
}
