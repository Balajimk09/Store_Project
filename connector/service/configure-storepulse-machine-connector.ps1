[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = "Validate")]
param(
    [Parameter(ParameterSetName = "Interactive")][switch]$Interactive,
    [Parameter(ParameterSetName = "NonInteractive")][switch]$NonInteractive,
    [Parameter(ParameterSetName = "Validate")][switch]$ValidateOnly,
    [string]$ConfigPath = "",
    [string]$SecretsPath = "",
    [string]$ProgramDataRoot = "",
    [string]$InstallRoot = "",
    [string]$SourceStoreNumber = "",
    [string]$CommanderIp = "",
    [string]$CommanderInstallPath = "",
    [string]$FinalizationUrl = "",
    [string]$LiveUploadUrl = "",
    [int]$LivePollSeconds = 0,
    [int]$ClosedDayPollSeconds = 0,
    [string]$LogsRoot = "",
    [string]$WorkingRoot = "",
    [string]$ArchiveRoot = "",
    [string]$StateRoot = "",
    [securestring]$CommanderUsername,
    [securestring]$CommanderPassword,
    [securestring]$ConnectorToken,
    [switch]$UseTestPlaintextSecrets,
    [string]$TestCommanderUsername = "",
    [string]$TestCommanderPassword = "",
    [string]$TestConnectorToken = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
. (Join-Path $PSScriptRoot "storepulse-machine-secrets.ps1")

function Test-StorePulseElevation {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertFrom-StorePulseSecureString {
    param([AllowNull()][securestring]$Value)
    if ($null -eq $Value) { return "" }
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-StorePulseExistingOrDefaultConfig {
    param([string]$Path, [string]$ProgramDataRoot, [string]$InstallRoot)
    if (-not [string]::IsNullOrWhiteSpace($Path) -and (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return Read-StorePulseMachineConfig -Path $Path
    }
    $root = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
    return [PSCustomObject]@{
        source_store_number = ""
        commander_ip = ""
        commander_install_path = ""
        live_endpoint_url = ""
        finalization_endpoint_url = ""
        heartbeat_enabled = $true
        heartbeat_endpoint_url = ""
        heartbeat_payload_version = "1"
        heartbeat_timeout_seconds = 15
        live_poll_interval_seconds = 300
        closed_day_poll_interval_seconds = 3600
        install_root = (Get-StorePulseInstallRoot -Root $InstallRoot)
        logs_root = (Get-StorePulseLogsRoot -ProgramDataRoot $root)
        working_root = (Get-StorePulseWorkingRoot -ProgramDataRoot $root)
        archive_root = (Get-StorePulseArchiveRoot -ProgramDataRoot $root)
        state_root = (Join-Path $root "state")
        live_worker_enabled = $true
        closed_day_worker_enabled = $true
        closed_day_once_enabled = $false
        pos_publish_enabled = $false
        pos_publish_poll_seconds = 60
        pos_publish_child_timeout_seconds = 60
        pos_publish_claim_endpoint_url = ""
        pos_publish_report_endpoint_url = ""
    }
}

function Set-StorePulseConfigValue {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$Name, [AllowNull()]$Value)
    if ($null -ne $Value -and -not [string]::IsNullOrWhiteSpace([string]$Value)) {
        if ($null -eq $Config.PSObject.Properties[$Name]) {
            Add-Member -InputObject $Config -NotePropertyName $Name -NotePropertyValue $Value
        }
        else {
            $Config.$Name = $Value
        }
    }
}

function New-StorePulseSecretInput {
    param(
        [securestring]$CommanderUsername,
        [securestring]$CommanderPassword,
        [securestring]$ConnectorToken
    )
    if ($UseTestPlaintextSecrets) {
        return [PSCustomObject]@{
            commander_username = $TestCommanderUsername
            commander_password = $TestCommanderPassword
            connector_token = $TestConnectorToken
        }
    }
    return [PSCustomObject]@{
        commander_username = ConvertFrom-StorePulseSecureString -Value $CommanderUsername
        commander_password = ConvertFrom-StorePulseSecureString -Value $CommanderPassword
        connector_token = ConvertFrom-StorePulseSecureString -Value $ConnectorToken
    }
}

$resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
$resolvedConfigPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) { Get-StorePulseConfigPath -ProgramDataRoot $resolvedProgramDataRoot } else { $ConfigPath }
$resolvedSecretsPath = if ([string]::IsNullOrWhiteSpace($SecretsPath)) { Get-StorePulseSecretsPath -ProgramDataRoot $resolvedProgramDataRoot } else { $SecretsPath }
$realWrite = -not $ValidateOnly -and -not $WhatIfPreference
$realMachineWrite = $realWrite -and -not $UseTestPlaintextSecrets
if ($realMachineWrite -and -not (Test-StorePulseElevation)) { throw "Real machine-wide configuration writes require elevated PowerShell." }

$config = Get-StorePulseExistingOrDefaultConfig -Path $resolvedConfigPath -ProgramDataRoot $resolvedProgramDataRoot -InstallRoot $InstallRoot
Set-StorePulseConfigValue -Config $config -Name "source_store_number" -Value $SourceStoreNumber
Set-StorePulseConfigValue -Config $config -Name "commander_ip" -Value $CommanderIp
Set-StorePulseConfigValue -Config $config -Name "commander_install_path" -Value $CommanderInstallPath
Set-StorePulseConfigValue -Config $config -Name "finalization_endpoint_url" -Value $FinalizationUrl
Set-StorePulseConfigValue -Config $config -Name "live_endpoint_url" -Value $LiveUploadUrl
if ([string]::IsNullOrWhiteSpace([string]$config.heartbeat_endpoint_url) -and -not [string]::IsNullOrWhiteSpace([string]$config.live_endpoint_url)) {
    $config.heartbeat_endpoint_url = Get-StorePulseDerivedHeartbeatEndpoint -LiveEndpointUrl ([string]$config.live_endpoint_url)
}
if ($LivePollSeconds -gt 0) { $config.live_poll_interval_seconds = $LivePollSeconds }
if ($ClosedDayPollSeconds -gt 0) { $config.closed_day_poll_interval_seconds = $ClosedDayPollSeconds }
Set-StorePulseConfigValue -Config $config -Name "install_root" -Value (Get-StorePulseInstallRoot -Root $InstallRoot)
Set-StorePulseConfigValue -Config $config -Name "logs_root" -Value $LogsRoot
Set-StorePulseConfigValue -Config $config -Name "working_root" -Value $WorkingRoot
Set-StorePulseConfigValue -Config $config -Name "archive_root" -Value $ArchiveRoot
Set-StorePulseConfigValue -Config $config -Name "state_root" -Value $StateRoot

if ($Interactive) {
    if ([string]::IsNullOrWhiteSpace([string]$config.source_store_number)) { $config.source_store_number = Read-Host "Source store number" }
    if ([string]::IsNullOrWhiteSpace([string]$config.commander_ip)) { $config.commander_ip = Read-Host "Commander host or IP" }
    if ([string]::IsNullOrWhiteSpace([string]$config.live_endpoint_url)) { $config.live_endpoint_url = Read-Host "Live upload HTTPS URL" }
    if ([string]::IsNullOrWhiteSpace([string]$config.heartbeat_endpoint_url)) { $config.heartbeat_endpoint_url = Get-StorePulseDerivedHeartbeatEndpoint -LiveEndpointUrl ([string]$config.live_endpoint_url) }
    if ([string]::IsNullOrWhiteSpace([string]$config.finalization_endpoint_url)) { $config.finalization_endpoint_url = Read-Host "Closed-day finalization HTTPS URL" }
    if ($null -eq $CommanderUsername) { $CommanderUsername = Read-Host "Commander username" -AsSecureString }
    if ($null -eq $CommanderPassword) { $CommanderPassword = Read-Host "Commander password" -AsSecureString }
    if ($null -eq $ConnectorToken) { $ConnectorToken = Read-Host "StorePulse connector token" -AsSecureString }
}

# Publishing is deliberately opt-in through a separately reviewed activation path.
# Reconfiguration must never preserve an earlier enabled value.
if ($null -eq $config.PSObject.Properties["pos_publish_enabled"]) {
    Add-Member -InputObject $config -NotePropertyName "pos_publish_enabled" -NotePropertyValue $false
}
else {
    $config.pos_publish_enabled = $false
}

Test-StorePulseMachineConfig -Config $config | Out-Null
$secretInput = New-StorePulseSecretInput -CommanderUsername $CommanderUsername -CommanderPassword $CommanderPassword -ConnectorToken $ConnectorToken
if (-not $ValidateOnly) {
    if ((Test-Path -LiteralPath $resolvedSecretsPath -PathType Leaf) -and ([string]::IsNullOrWhiteSpace($secretInput.commander_username) -or [string]::IsNullOrWhiteSpace($secretInput.commander_password) -or [string]::IsNullOrWhiteSpace($secretInput.connector_token))) {
        $existingSecrets = Read-StorePulseMachineSecrets -Path $resolvedSecretsPath
        if ([string]::IsNullOrWhiteSpace($secretInput.commander_username)) { $secretInput.commander_username = $existingSecrets.commander_username }
        if ([string]::IsNullOrWhiteSpace($secretInput.commander_password)) { $secretInput.commander_password = $existingSecrets.commander_password }
        if ([string]::IsNullOrWhiteSpace($secretInput.connector_token)) { $secretInput.connector_token = $existingSecrets.connector_token }
    }
    Test-StorePulseMachineSecrets -Secrets $secretInput | Out-Null
}

$summary = [ordered]@{
    config_path = $resolvedConfigPath
    secrets_path = $resolvedSecretsPath
    source_store_number = [string]$config.source_store_number
    commander_ip = [string]$config.commander_ip
    commander_install_path = [string]$config.commander_install_path
    live_endpoint_url = [string]$config.live_endpoint_url
    finalization_endpoint_url = [string]$config.finalization_endpoint_url
    heartbeat_endpoint_url = [string]$config.heartbeat_endpoint_url
    live_poll_interval_seconds = [int]$config.live_poll_interval_seconds
    closed_day_poll_interval_seconds = [int]$config.closed_day_poll_interval_seconds
    pos_publish_enabled = [bool]$config.pos_publish_enabled
    pos_publish_poll_seconds = [int]$config.pos_publish_poll_seconds
    pos_publish_child_timeout_seconds = [int]$config.pos_publish_child_timeout_seconds
    logs_root = [string]$config.logs_root
    working_root = [string]$config.working_root
    archive_root = [string]$config.archive_root
    state_root = [string]$config.state_root
    secrets = "encrypted separately"
}

if ($ValidateOnly) {
    Write-Host "ValidateOnly complete. No config or secrets written."
    Write-Host ($summary | ConvertTo-Json -Depth 10)
    return [PSCustomObject]$summary
}

if ($PSCmdlet.ShouldProcess($resolvedConfigPath, "Write StorePulse machine config and encrypted secrets")) {
    Write-StorePulseMachineConfig -Config $config -Path $resolvedConfigPath -CreateDirectories | Out-Null
    Write-StorePulseMachineSecrets -Secrets $secretInput -Path $resolvedSecretsPath -CreateDirectories | Out-Null
}
Write-Host "StorePulse machine configuration complete."
Write-Host ($summary | ConvertTo-Json -Depth 10)
return [PSCustomObject]$summary
