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

function Get-StorePulseOriginPolicyPath {
    return (Join-Path (Split-Path -Parent $PSScriptRoot) "lib\storepulse-origin-policy.json")
}

function Get-StorePulseOriginPolicy {
    param([string]$Path = "")
    $policyPath = if ([string]::IsNullOrWhiteSpace($Path)) { Get-StorePulseOriginPolicyPath } else { $Path }
    try { $policy = Get-Content -LiteralPath $policyPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { throw "storepulse_origin_policy_invalid" }
    $required = @("version", "allowed_https_origins")
    if ($null -eq $policy -or @($policy.PSObject.Properties.Name).Count -ne $required.Count -or @($required | Where-Object { $null -eq $policy.PSObject.Properties[$_] }).Count -gt 0 -or $policy.version -isnot [int] -or [int]$policy.version -ne 1) {
        throw "storepulse_origin_policy_invalid"
    }
    if ($policy.allowed_https_origins -isnot [array]) { throw "storepulse_origin_policy_invalid" }
    $origins = @($policy.allowed_https_origins)
    if ($origins.Count -eq 0) { throw "storepulse_origin_policy_invalid" }
    $validated = New-Object System.Collections.Generic.List[string]
    foreach ($origin in $origins) {
        if ($origin -isnot [string] -or [string]::IsNullOrWhiteSpace($origin) -or $origin.Contains([string][char]92) -or $origin.Contains("%")) { throw "storepulse_origin_policy_invalid" }
        $uri = $null
        if (-not [Uri]::TryCreate($origin, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment) -or $uri.AbsolutePath -notin @("", "/")) { throw "storepulse_origin_policy_invalid" }
        if ($origin -cnotmatch '^https://[a-z0-9.-]+$' -or $origin.Contains("*")) { throw "storepulse_origin_policy_invalid" }
        $canonical = "https://" + $uri.DnsSafeHost.ToLowerInvariant()
        if ($origin -cne $canonical -or $validated.Contains($origin)) { throw "storepulse_origin_policy_invalid" }
        $validated.Add($origin)
    }
    return @($validated)
}

function Get-StorePulseDerivedPosPublishEndpoints {
    param([string]$LiveEndpointUrl = "", [string]$HeartbeatEndpointUrl = "", [string]$OriginPolicyPath = "")
    $allowedOrigins = Get-StorePulseOriginPolicy -Path $OriginPolicyPath
    foreach ($source in @($LiveEndpointUrl, $HeartbeatEndpointUrl)) {
        if ([string]::IsNullOrWhiteSpace($source)) { continue }
        if ($source -cnotmatch '^https://') { continue }
        if ($source.Contains([string][char]92) -or $source.Contains("%")) { continue }
        $uri = $null
        if (-not [Uri]::TryCreate($source, [UriKind]::Absolute, [ref]$uri)) { continue }
        $allowedPaths = @("/functions/v1/ingest-pos-transactions", "/functions/v1/report-pos-connector-heartbeat")
        if ($uri.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment) -or -not ($allowedPaths -ccontains $uri.AbsolutePath)) { continue }
        # Uri.GetLeftPart canonicalizes an explicit :443 away. Preserve the validated
        # authority spelling so the PowerShell and Node publishing paths stay identical.
        $authorityMatch = [regex]::Match($source, '^https://([^/?#]+)(?:/|$)')
        if (-not $authorityMatch.Success) { continue }
        $authority = $authorityMatch.Groups[1].Value
        $portMatch = if ($authority.StartsWith("[")) {
            [regex]::Match($authority, '^\[[0-9a-f:.]+\](?::([0-9]{1,5}))?$', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        }
        else {
            [regex]::Match($authority, '^(?:[^:\s]+)(?::([0-9]{1,5}))?$')
        }
        if (-not $portMatch.Success) { continue }
        if ($portMatch.Groups[1].Success) {
            $port = [int]$portMatch.Groups[1].Value
            if ($port -lt 1 -or $port -gt 65535) { continue }
        }
        $origin = "https://$authority"
        if (-not ($allowedOrigins -ccontains $origin)) { continue }
        return [PSCustomObject]@{
            claim_endpoint_url = "$origin/functions/v1/claim-pos-publish-job"
            report_endpoint_url = "$origin/functions/v1/report-pos-publish-job-status"
        }
    }
    throw "POS publishing endpoints must use an approved StorePulse origin and exact ingest or heartbeat path."
}

function Add-StorePulsePosPublishConfigDefaults {
    param([Parameter(Mandatory)]$Config)
    if (-not $Config.PSObject.Properties["pos_publish_enabled"]) {
        Add-Member -InputObject $Config -NotePropertyName "pos_publish_enabled" -NotePropertyValue $false
    }
    else {
        # Publishing has no production adapter on this branch. Every writer, repair,
        # and upgrade path must reset a previously enabled value before validation.
        $Config.pos_publish_enabled = $false
    }
    if (-not $Config.PSObject.Properties["pos_publish_poll_seconds"]) {
        Add-Member -InputObject $Config -NotePropertyName "pos_publish_poll_seconds" -NotePropertyValue 60
    }
    if (-not $Config.PSObject.Properties["pos_publish_child_timeout_seconds"]) {
        Add-Member -InputObject $Config -NotePropertyName "pos_publish_child_timeout_seconds" -NotePropertyValue 60
    }
    $derived = $null
    try { $derived = Get-StorePulseDerivedPosPublishEndpoints -LiveEndpointUrl ([string]$Config.live_endpoint_url) -HeartbeatEndpointUrl ([string]$Config.heartbeat_endpoint_url) } catch { }
    foreach ($field in @("pos_publish_claim_endpoint_url", "pos_publish_report_endpoint_url")) {
        if (-not $Config.PSObject.Properties[$field] -or [string]::IsNullOrWhiteSpace([string]$Config.$field)) {
            $value = if ($null -eq $derived) { "" } elseif ($field -eq "pos_publish_claim_endpoint_url") { [string]$derived.claim_endpoint_url } else { [string]$derived.report_endpoint_url }
            Add-Member -InputObject $Config -NotePropertyName $field -NotePropertyValue $value -Force
        }
    }
    return $Config
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
    Add-StorePulsePosPublishConfigDefaults -Config $Config | Out-Null
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
    $livePublishEndpoints = Get-StorePulseDerivedPosPublishEndpoints -LiveEndpointUrl ([string]$Config.live_endpoint_url)
    $heartbeatPublishEndpoints = $null
    if ($Config.PSObject.Properties["heartbeat_endpoint_url"] -and -not [string]::IsNullOrWhiteSpace([string]$Config.heartbeat_endpoint_url)) {
        $heartbeatPublishEndpoints = Get-StorePulseDerivedPosPublishEndpoints -HeartbeatEndpointUrl ([string]$Config.heartbeat_endpoint_url)
        if ($heartbeatPublishEndpoints.claim_endpoint_url -ne $livePublishEndpoints.claim_endpoint_url -or $heartbeatPublishEndpoints.report_endpoint_url -ne $livePublishEndpoints.report_endpoint_url) {
            throw "live_endpoint_url and heartbeat_endpoint_url must use the same approved StorePulse origin."
        }
    }
    if ($Config.PSObject.Properties["heartbeat_payload_version"] -and [string]$Config.heartbeat_payload_version -ne "1") { throw "heartbeat_payload_version must be 1." }
    if ($Config.PSObject.Properties["heartbeat_timeout_seconds"]) {
        $timeout = [int]$Config.heartbeat_timeout_seconds
        if ($timeout -lt 1 -or $timeout -gt 120) { throw "heartbeat_timeout_seconds must be between 1 and 120." }
    }
    if ($Config.PSObject.Properties["pos_publish_enabled"] -and $Config.pos_publish_enabled -isnot [bool]) { throw "pos_publish_enabled must be a boolean." }
    $posPublishEnabled = if ($Config.PSObject.Properties["pos_publish_enabled"]) { [bool]$Config.pos_publish_enabled } else { $false }
    if ($Config.PSObject.Properties["pos_publish_poll_seconds"]) {
        $pollText = [string]$Config.pos_publish_poll_seconds
        if ($pollText -notmatch '^[0-9]+$') { throw "pos_publish_poll_seconds must be a whole number." }
        $posPublishPoll = [int]$pollText
        if ($posPublishPoll -lt 30 -or $posPublishPoll -gt 3600) { throw "pos_publish_poll_seconds must be between 30 and 3600." }
    }
    if ($Config.PSObject.Properties["pos_publish_child_timeout_seconds"]) {
        $timeoutText = [string]$Config.pos_publish_child_timeout_seconds
        if ($timeoutText -notmatch '^[0-9]+$') { throw "pos_publish_child_timeout_seconds must be a whole number." }
        $posPublishChildTimeout = [int]$timeoutText
        if ($posPublishChildTimeout -lt 5 -or $posPublishChildTimeout -gt 300) { throw "pos_publish_child_timeout_seconds must be between 5 and 300." }
    }
    $hasPublishEndpoint = ($Config.PSObject.Properties["pos_publish_claim_endpoint_url"] -and -not [string]::IsNullOrWhiteSpace([string]$Config.pos_publish_claim_endpoint_url)) -or ($Config.PSObject.Properties["pos_publish_report_endpoint_url"] -and -not [string]::IsNullOrWhiteSpace([string]$Config.pos_publish_report_endpoint_url))
    if ($posPublishEnabled -or $hasPublishEndpoint) {
        $derived = $livePublishEndpoints
        if ([string]$Config.pos_publish_claim_endpoint_url -ne [string]$derived.claim_endpoint_url -or [string]$Config.pos_publish_report_endpoint_url -ne [string]$derived.report_endpoint_url) {
            throw "POS publishing endpoints must exactly match the endpoints safely derived from live_endpoint_url."
        }
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

function Get-StorePulseMachineConfigForHeartbeatUpdate {
    param(
        [string]$Path = ""
    )
    $configPath = if ([string]::IsNullOrWhiteSpace($Path)) { Get-StorePulseConfigPath } else { $Path }
    $beforeText = Get-Content -LiteralPath $configPath -Raw
    $config = $beforeText | ConvertFrom-Json
    Add-StorePulseHeartbeatConfigDefaults -Config $config | Out-Null
    Test-StorePulseMachineConfig -Config $config | Out-Null
    $afterText = ($config | ConvertTo-Json -Depth 20)
    return [PSCustomObject]@{
        changed = ($beforeText.Trim() -ne $afterText.Trim())
        path = $configPath
        before_text = $beforeText
        after_text = $afterText
        config = $config
    }
}

function Update-StorePulseMachineConfigForHeartbeat {
    param(
        [string]$Path = "",
        [switch]$CreateBackup
    )
    $preview = Get-StorePulseMachineConfigForHeartbeatUpdate -Path $Path
    $configPath = $preview.path
    $config = $preview.config
    $changed = $preview.changed
    $backupPath = $null
    if ($changed) {
        if ($CreateBackup) {
            $backupPath = $configPath + ".pre-heartbeat-" + (Get-Date -Format "yyyyMMddHHmmss") + ".bak"
            Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
        }
        $tempPath = $configPath + ".tmp-" + [guid]::NewGuid().ToString("N")
        try {
            Set-Content -LiteralPath $tempPath -Value $preview.after_text -Encoding UTF8
            Move-Item -LiteralPath $tempPath -Destination $configPath -Force
        }
        catch {
            Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
            throw
        }
    }
    return [PSCustomObject]@{
        changed = $changed
        path = $configPath
        backup_path = $backupPath
        config = $config
    }
}

function Restore-StorePulseMachineConfigBackup {
    param(
        [Parameter(Mandatory)][string]$Path,
        [AllowNull()][string]$BackupPath
    )
    if ([string]::IsNullOrWhiteSpace($BackupPath)) { return $false }
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw "Config backup is missing: $BackupPath" }
    Copy-Item -LiteralPath $BackupPath -Destination $Path -Force
    return $true
}
