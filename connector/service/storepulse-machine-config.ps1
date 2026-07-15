[CmdletBinding()]
param()

Set-StrictMode -Version Latest

function Get-StorePulseProgramDataRoot {
    param([string]$Root = "")
    if (-not [string]::IsNullOrWhiteSpace($Root)) { return $Root }
    $override = [Environment]::GetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", "Process")
    if (-not [string]::IsNullOrWhiteSpace($override)) { return $override }
    return "C:\ProgramData\StorePulse"
}

function Get-StorePulseInstallRoot {
    param([string]$Root = "")
    if (-not [string]::IsNullOrWhiteSpace($Root)) { return $Root }
    $override = [Environment]::GetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", "Process")
    if (-not [string]::IsNullOrWhiteSpace($override)) { return $override }
    return "C:\Program Files\StorePulse\Connector"
}

function Get-StorePulseConfigPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "config.json")
}

function Get-StorePulseSecretsPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "secrets.json")
}

function Get-StorePulseLogsRoot {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "logs")
}

function Get-StorePulseWorkingRoot {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "working")
}

function Get-StorePulseArchiveRoot {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "archive")
}

function Read-StorePulseMachineConfig {
    param([string]$Path = "")
    $configPath = if ([string]::IsNullOrWhiteSpace($Path)) { Get-StorePulseConfigPath } else { $Path }
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "StorePulse machine config not found: $configPath"
    }
    return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

function Test-StorePulseUrl {
    param([AllowNull()][string]$Value, [Parameter(Mandatory)][string]$Name)
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name is required." }
    $uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri)) { throw "$Name must be an absolute URL." }
    if ($uri.Scheme -ne "https") { throw "$Name must use HTTPS." }
}

function Get-StorePulseDerivedHeartbeatEndpoint {
    param([Parameter(Mandatory)][string]$LiveEndpointUrl)
    if ([string]::IsNullOrWhiteSpace($LiveEndpointUrl)) { throw "live_endpoint_url is required to derive heartbeat endpoint." }
    if ($LiveEndpointUrl -notmatch '/ingest-pos-transactions/?$') {
        throw "heartbeat_endpoint_url cannot be safely derived because live_endpoint_url does not end with ingest-pos-transactions."
    }
    return ($LiveEndpointUrl -replace '/ingest-pos-transactions/?$', '/report-pos-connector-heartbeat')
}

function Add-StorePulseHeartbeatConfigDefaults {
    param([Parameter(Mandatory)]$Config)
    if (-not $Config.PSObject.Properties["heartbeat_enabled"]) {
        Add-Member -InputObject $Config -NotePropertyName "heartbeat_enabled" -NotePropertyValue $true
    }
    if (-not $Config.PSObject.Properties["heartbeat_payload_version"]) {
        Add-Member -InputObject $Config -NotePropertyName "heartbeat_payload_version" -NotePropertyValue "1"
    }
    if (-not $Config.PSObject.Properties["heartbeat_timeout_seconds"]) {
        Add-Member -InputObject $Config -NotePropertyName "heartbeat_timeout_seconds" -NotePropertyValue 15
    }
    if (-not $Config.PSObject.Properties["heartbeat_endpoint_url"] -or [string]::IsNullOrWhiteSpace([string]$Config.heartbeat_endpoint_url)) {
        Add-Member -InputObject $Config -NotePropertyName "heartbeat_endpoint_url" -NotePropertyValue (Get-StorePulseDerivedHeartbeatEndpoint -LiveEndpointUrl ([string]$Config.live_endpoint_url)) -Force
    }
    return $Config
}

function Test-StorePulsePathValue {
    param([AllowNull()][string]$Value, [Parameter(Mandatory)][string]$Name)
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name is required." }
    if ($Value.IndexOfAny([IO.Path]::GetInvalidPathChars()) -ge 0) { throw "$Name contains invalid path characters." }
}

function Test-StorePulseMachineConfig {
    param([Parameter(Mandatory)]$Config)
    $json = $Config | ConvertTo-Json -Depth 20 -Compress
    foreach ($secretName in @("commander_username", "commander_password", "connector_token", "password", "token", "cookie")) {
        if ($json -match ('(?i)"[^"]*' + [regex]::Escape($secretName) + '[^"]*"\s*:')) {
            throw "Machine config must not contain secret field '$secretName'."
        }
    }
    if ([string]::IsNullOrWhiteSpace([string]$Config.source_store_number)) { throw "source_store_number is required." }
    if ([string]$Config.source_store_number -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') { throw "source_store_number contains unsupported characters." }
    if ([string]::IsNullOrWhiteSpace([string]$Config.commander_ip)) { throw "commander_ip is required." }
    if ([string]$Config.commander_ip -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$') { throw "commander_ip must be a hostname or IP address." }
    Test-StorePulsePathValue -Value ([string]$Config.commander_install_path) -Name "commander_install_path"
    Test-StorePulseUrl -Value ([string]$Config.live_endpoint_url) -Name "live_endpoint_url"
    Test-StorePulseUrl -Value ([string]$Config.finalization_endpoint_url) -Name "finalization_endpoint_url"
    if ($Config.PSObject.Properties["heartbeat_enabled"] -and [bool]$Config.heartbeat_enabled) {
        if (-not $Config.PSObject.Properties["heartbeat_endpoint_url"] -or [string]::IsNullOrWhiteSpace([string]$Config.heartbeat_endpoint_url)) {
            throw "heartbeat_endpoint_url is required when heartbeat_enabled is true."
        }
        Test-StorePulseUrl -Value ([string]$Config.heartbeat_endpoint_url) -Name "heartbeat_endpoint_url"
    }
    if ($Config.PSObject.Properties["heartbeat_payload_version"] -and [string]$Config.heartbeat_payload_version -ne "1") { throw "heartbeat_payload_version must be 1." }
    if ($Config.PSObject.Properties["heartbeat_timeout_seconds"]) {
        $timeout = [int]$Config.heartbeat_timeout_seconds
        if ($timeout -lt 1 -or $timeout -gt 120) { throw "heartbeat_timeout_seconds must be between 1 and 120." }
    }
    $livePoll = [int]$Config.live_poll_interval_seconds
    $closedPoll = [int]$Config.closed_day_poll_interval_seconds
    if ($livePoll -lt 60 -or $livePoll -gt 86400) { throw "live_poll_interval_seconds must be between 60 and 86400." }
    if ($closedPoll -lt 300 -or $closedPoll -gt 604800) { throw "closed_day_poll_interval_seconds must be between 300 and 604800." }
    Test-StorePulsePathValue -Value ([string]$Config.install_root) -Name "install_root"
    Test-StorePulsePathValue -Value ([string]$Config.logs_root) -Name "logs_root"
    Test-StorePulsePathValue -Value ([string]$Config.working_root) -Name "working_root"
    Test-StorePulsePathValue -Value ([string]$Config.archive_root) -Name "archive_root"
    return $true
}

function Write-StorePulseMachineConfig {
    param(
        [Parameter(Mandatory)]$Config,
        [string]$Path = "",
        [switch]$CreateDirectories
    )
    Add-StorePulseHeartbeatConfigDefaults -Config $Config | Out-Null
    Test-StorePulseMachineConfig -Config $Config | Out-Null
    $configPath = if ([string]::IsNullOrWhiteSpace($Path)) { Get-StorePulseConfigPath } else { $Path }
    $parent = Split-Path -Parent $configPath
    if ($CreateDirectories -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "Config directory does not exist: $parent"
    }
    $Config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding UTF8
    return $configPath
}
