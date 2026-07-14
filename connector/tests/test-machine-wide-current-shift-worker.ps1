[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$connectorRoot = Join-Path $repoRoot "connector"
$serviceRoot = Join-Path $connectorRoot "service"
$workerPath = Join-Path $serviceRoot "storepulse-current-shift-worker.ps1"
$runtimePath = Join-Path $serviceRoot "storepulse-service-runtime.ps1"
$uploaderPath = Join-Path $connectorRoot "storepulse-upload-normalized-transactions.ps1"
$closedWrapperPath = Join-Path $connectorRoot "storepulse-finalize-closed-day-machine.ps1"

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
    Write-Host "PASS: $Message"
}

foreach ($path in @($workerPath, $runtimePath, $uploaderPath, $closedWrapperPath)) {
    Assert-True -Condition (Test-Path -LiteralPath $path -PathType Leaf) -Message "required machine-wide worker file exists: $(Split-Path -Leaf $path)"
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    Assert-True -Condition ($errors.Count -eq 0) -Message "PowerShell syntax is valid: $(Split-Path -Leaf $path)"
}

. $runtimePath
. $workerPath

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("storepulse-current-shift-worker-" + [guid]::NewGuid().ToString("N"))
$programDataRoot = Join-Path $testRoot "ProgramData\StorePulse"
$installRoot = Join-Path $testRoot "Program Files\StorePulse\Connector"
$config = [PSCustomObject]@{
    source_store_number = "AB123"
    commander_ip = "192.168.31.11"
    commander_install_path = "C:\Verifone\Transaction Manager"
    live_endpoint_url = "https://example.test/functions/v1/ingest-pos-transactions"
    finalization_endpoint_url = "https://example.test/functions/v1/finalize-pos-business-day"
    live_poll_interval_seconds = 300
    closed_day_poll_interval_seconds = 3600
    install_root = $installRoot
    logs_root = Join-Path $programDataRoot "logs"
    working_root = Join-Path $programDataRoot "working"
    archive_root = Join-Path $programDataRoot "archive"
    state_root = Join-Path $programDataRoot "state"
    live_worker_enabled = $true
    closed_day_worker_enabled = $true
    closed_day_once_enabled = $true
}
Assert-True -Condition (Test-StorePulseMachineConfig -Config $config) -Message "machine config accepts commander_install_path"
$invalidConfig = $config.PSObject.Copy()
$invalidConfig.commander_install_path = ""
$configPathRejected = $false
try { Test-StorePulseMachineConfig -Config $invalidConfig | Out-Null } catch { $configPathRejected = $true }
Assert-True -Condition $configPathRejected -Message "machine config rejects missing commander_install_path"
$secrets = [PSCustomObject]@{
    commander_username = "machine-user-secret"
    commander_password = "machine-password-secret"
    connector_token = "machine-connector-token-secret-value-123456"
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$capture = [ordered]@{}

$commanderRetriever = {
    param($configValue, $secretsValue, $outputPathValue)
    $capture.commander_install_path = [string]$configValue.commander_install_path
    $capture.commander_ip = [string]$configValue.commander_ip
    $capture.commander_username = [string]$secretsValue.commander_username
    $capture.commander_password = [string]$secretsValue.commander_password
    $capture.output_path = $outputPathValue
    $parent = Split-Path -Parent $outputPathValue
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Set-Content -LiteralPath $outputPathValue -Encoding UTF8 -Value "<transSet><trans/></transSet>"
    return [PSCustomObject]@{ output_path = $outputPathValue; period = "1"; filename = "current"; command = "vtranssetz" }
}

$normalizerInvoker = {
    param($installRootValue, $xmlPathValue, $normalizedPathValue, $reconciliationPathValue)
    $capture.normalizer_install_root = $installRootValue
    $capture.normalizer_xml_path = $xmlPathValue
    @([PSCustomObject]@{
        source_system = "verifone_commander"
        source_unique_id = "test-1"
        store_number = "AB123"
        transaction_type = "completed_sale"
        total = 1.23
    }) | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $normalizedPathValue -Encoding UTF8
    [PSCustomObject]@{ raw_transaction_count = 1; normalizable_transaction_count = 1 } |
        ConvertTo-Json | Set-Content -LiteralPath $reconciliationPathValue -Encoding UTF8
    return [PSCustomObject]@{
        normalized_path = $normalizedPathValue
        reconciliation_path = $reconciliationPathValue
        canonical_record_count = 1
    }
}

$uploaderInvoker = {
    param($configValue, $secretsValue, $installRootValue, $xmlPathValue, $normalizedPathValue, $reconciliationPathValue, $summaryPathValue)
    $capture.connector_token = [string]$secretsValue.connector_token
    $capture.live_endpoint_url = [string]$configValue.live_endpoint_url
    $capture.upload_normalized_path = $normalizedPathValue
    [PSCustomObject]@{
        canonical_record_count = 1
        inserted_count = 1
        updated_count = 0
        unchanged_count = 0
        failed_count = 0
    } | ConvertTo-Json | Set-Content -LiteralPath $summaryPathValue -Encoding UTF8
    return Get-Content -LiteralPath $summaryPathValue -Raw | ConvertFrom-Json
}

$archiveInvoker = {
    param($archiveRootValue, $pathsValue)
    $capture.archive_root = $archiveRootValue
    $capture.archive_paths = @($pathsValue)
    return (Join-Path $archiveRootValue "live\test-run")
}

try {
    $result = Invoke-StorePulseCurrentShiftPipeline `
        -Config $config `
        -Secrets $secrets `
        -InstallRoot $installRoot `
        -CommanderRetriever $commanderRetriever `
        -NormalizerInvoker $normalizerInvoker `
        -UploaderInvoker $uploaderInvoker `
        -ArchiveInvoker $archiveInvoker

    Assert-True -Condition ($capture.commander_username -eq $secrets.commander_username) -Message "live worker receives machine commander_username secret"
    Assert-True -Condition ($capture.commander_password -eq $secrets.commander_password) -Message "live worker receives machine commander_password secret"
    Assert-True -Condition ($capture.connector_token -eq $secrets.connector_token) -Message "live worker receives machine connector_token secret"
    Assert-True -Condition ($capture.commander_install_path -eq $config.commander_install_path) -Message "live worker uses config.commander_install_path"
    Assert-True -Condition ($capture.commander_ip -eq $config.commander_ip) -Message "live worker uses configured Commander IP"
    Assert-True -Condition ($capture.output_path.StartsWith((Join-Path $config.working_root "live"), [StringComparison]::OrdinalIgnoreCase)) -Message "Current Shift XML is written under ProgramData working live folder"
    Assert-True -Condition ($capture.upload_normalized_path.StartsWith((Join-Path $config.working_root "live"), [StringComparison]::OrdinalIgnoreCase)) -Message "normalized Current Shift JSON is written under ProgramData working live folder"
    Assert-True -Condition ($capture.live_endpoint_url -eq $config.live_endpoint_url) -Message "canonical uploader uses configured live ingestion endpoint"
    Assert-True -Condition ($result.canonical_record_count -eq 1 -and $result.inserted_count -eq 1 -and $result.failed_count -eq 0) -Message "live pipeline returns canonical ingestion counts"

    $plan = New-StorePulseClosedDayInvocationPlan -Config $config -InstallRoot $installRoot
    $argumentText = @($plan.arguments) -join "|"
    $installPathIndex = [Array]::IndexOf([object[]]$plan.arguments, "-InstallPath")
    Assert-True -Condition ($installPathIndex -ge 0 -and [string]$plan.arguments[$installPathIndex + 1] -eq $config.commander_install_path) -Message "closed-day worker uses config.commander_install_path"
    Assert-True -Condition ([string]$plan.arguments[$installPathIndex + 1] -ne $installRoot) -Message "closed-day Commander path is not replaced by StorePulse install root"
    Assert-True -Condition ((Split-Path -Leaf $plan.script_path) -eq "storepulse-finalize-closed-day-machine.ps1") -Message "closed-day worker uses machine-secret wrapper"

    $workerSource = Get-Content -LiteralPath $workerPath -Raw
    Assert-True -Condition ($workerSource -match 'Command\s+"vtranssetz"') -Message "live retrieval requests vtranssetz"
    Assert-True -Condition ($workerSource -match 'period\s*=\s*"1"') -Message "live retrieval requests period 1"
    Assert-True -Condition ($workerSource -match 'filename\s*=\s*"current"') -Message "live retrieval requests filename current"
    Assert-True -Condition ($workerSource -notmatch '(?i)OneDrive|\$env:USERPROFILE|C:\\Users\\ABC') -Message "machine-wide live worker contains no user-profile paths"

    $wrapperSource = Get-Content -LiteralPath $closedWrapperPath -Raw
    Assert-True -Condition ($wrapperSource -match 'STOREPULSE_COMMANDER_USERNAME' -and $wrapperSource -match 'STOREPULSE_COMMANDER_PASSWORD') -Message "closed-day wrapper reads Commander credentials from service process environment"
    Assert-True -Condition ($wrapperSource -notmatch '(?i)CredReadW|Credential Manager|C:\\Users\\ABC|OneDrive') -Message "closed-day wrapper has no user Credential Manager or profile dependency"

    $allText = @(
        Get-ChildItem -LiteralPath $programDataRoot -File -Recurse -ErrorAction SilentlyContinue |
            ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
    ) -join "`n"
    foreach ($secretValue in @($secrets.commander_username, $secrets.commander_password, $secrets.connector_token)) {
        Assert-True -Condition (-not $allText.Contains($secretValue)) -Message "machine secret is absent from live summaries and artifacts"
    }

    Write-Host "PASS: machine-wide Current Shift worker tests completed."
}
finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
