[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$JsonPath,
    [Parameter(Mandatory)][string]$XmlPath,
    [Parameter(Mandatory)][string]$SourceStoreNumber,
    [Parameter(Mandatory)][string]$BusinessDate,
    [Parameter(Mandatory)][string]$PeriodNumber,
    [Parameter(Mandatory)][string]$SourcePeriodLabel,
    [Parameter(Mandatory)][string]$PeriodOpen,
    [Parameter(Mandatory)][string]$PeriodClose,
    [string]$PeriodType = "day",
    [string]$EnvPath = "",
    [string]$Endpoint = "",
    [string]$ResultPath = "",
    [string]$NormalizerVersion = "verified-baseline-2026-07-10",
    [string]$SchemaVersion = "1",
    [ValidateRange(1, 1000)][int]$BatchSize = 500,
    [ValidateRange(1, 5)][int]$MaxAttempts = 3,
    [ValidateRange(10, 600)][int]$TimeoutSeconds = 120,
    [switch]$DryRun,
    [scriptblock]$Transport = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptVersion = "2.0.1"
$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($EnvPath)) {
    $EnvPath = Join-Path $ScriptDirectory ".env"
}

if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $resultDirectory = Split-Path -Parent $JsonPath
    $resultName = [IO.Path]::GetFileNameWithoutExtension($JsonPath) + "-finalization-result.json"
    $ResultPath = Join-Path $resultDirectory $resultName
}

function Import-DotEnv {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) { continue }
        $separatorIndex = $trimmed.IndexOf("=")
        if ($separatorIndex -lt 1) { continue }
        $name = $trimmed.Substring(0, $separatorIndex).Trim()
        $value = $trimmed.Substring($separatorIndex + 1).Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if (-not [string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Assert-BusinessDate {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^\d{4}-\d{2}-\d{2}$') {
        throw "BusinessDate must use YYYY-MM-DD format."
    }
    $parsed = [datetime]::MinValue
    $ok = [datetime]::TryParseExact(
        $Value,
        "yyyy-MM-dd",
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::None,
        [ref]$parsed
    )
    if (-not $ok -or $parsed.ToString("yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture) -ne $Value) {
        throw "BusinessDate must be a real calendar date."
    }
}

function ConvertTo-StableJson {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return "null" }
    if ($Value -is [string]) { return ConvertTo-Json -InputObject $Value -Compress }
    if ($Value -is [bool]) { if ($Value) { return "true" } else { return "false" } }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int] -or $Value -is [long] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) {
        return ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $Value))
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $parts = @()
        foreach ($key in @($Value.Keys | Sort-Object)) {
            $parts += ((ConvertTo-Json -InputObject ([string]$key) -Compress) + ":" + (ConvertTo-StableJson -Value $Value[$key]))
        }
        return "{" + ($parts -join ",") + "}"
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string]) -and -not ($Value -is [System.Xml.XmlNode])) {
        $parts = @()
        foreach ($item in @($Value)) {
            $parts += ConvertTo-StableJson -Value $item
        }
        return "[" + ($parts -join ",") + "]"
    }
    $properties = @($Value.PSObject.Properties | Where-Object { $_.MemberType -in @("NoteProperty", "Property") } | Sort-Object Name)
    $objectParts = @()
    foreach ($property in $properties) {
        $objectParts += ((ConvertTo-Json -InputObject $property.Name -Compress) + ":" + (ConvertTo-StableJson -Value $property.Value))
    }
    return "{" + ($objectParts -join ",") + "}"
}

function Get-Sha256HexFromString {
    param([Parameter(Mandatory)][string]$Value)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)
        return (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
    }
    finally {
        $sha.Dispose()
    }
}

function Get-Sha256HexFromFile {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-PropertyValue {
    param(
        [AllowNull()]$Object,
        [Parameter(Mandatory)][string]$Name,
        $DefaultValue = $null
    )
    if ($null -eq $Object) { return $DefaultValue }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $DefaultValue }
    return ,$property.Value
}

function Assert-FinalizedBusinessDayRecords {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][array]$Records,
        [Parameter(Mandatory)][string]$SourceStoreNumber,
        [Parameter(Mandatory)][string]$BusinessDate
    )
    if ($Records.Count -eq 0) { throw "Validation failed: normalized JSON contains no transactions." }
    $seenIds = @{}
    foreach ($record in $Records) {
        $sourceUniqueId = [string](Get-PropertyValue -Object $record -Name "source_unique_id")
        if ([string]::IsNullOrWhiteSpace($sourceUniqueId)) { throw "Validation failed: every record requires source_unique_id." }
        if ($seenIds.ContainsKey($sourceUniqueId)) { throw "Validation failed: duplicate source_unique_id '$sourceUniqueId'." }
        $seenIds[$sourceUniqueId] = $true
        if ([string](Get-PropertyValue -Object $record -Name "source_system") -ne "verifone_commander") {
            throw "Validation failed: every record must have source_system=verifone_commander."
        }
        if ([string](Get-PropertyValue -Object $record -Name "store_number") -ne $SourceStoreNumber) {
            throw "Validation failed: every record must match SourceStoreNumber."
        }
        if ([string](Get-PropertyValue -Object $record -Name "business_date") -ne $BusinessDate) {
            throw "Validation failed: every record must match BusinessDate."
        }
        foreach ($required in @("transaction_time", "transaction_type", "total", "tax_total")) {
            if ($null -eq (Get-PropertyValue -Object $record -Name $required -DefaultValue $null)) {
                throw "Validation failed: record '$sourceUniqueId' is missing required field '$required'."
            }
        }
        $canonicalRecord = Get-PropertyValue -Object $record -Name "canonical_record" -DefaultValue $null
        if ($canonicalRecord -isnot [bool] -or $canonicalRecord -ne $true) {
            throw "Validation failed: record '$sourceUniqueId' requires canonical_record=true."
        }
        $items = Get-PropertyValue -Object $record -Name "items" -DefaultValue $null
        if ($null -eq $items -or $items -isnot [array]) {
            throw "Validation failed: record '$sourceUniqueId' requires items array."
        }
        $payments = Get-PropertyValue -Object $record -Name "payments" -DefaultValue $null
        if ($null -eq $payments -or $payments -isnot [array]) {
            throw "Validation failed: record '$sourceUniqueId' requires payments array."
        }
    }
}

function Get-CanonicalHash {
    param([Parameter(Mandatory)]$Record)
    return Get-Sha256HexFromString -Value (ConvertTo-StableJson -Value $Record)
}

function Get-FinalSourceSetHash {
    param([Parameter(Mandatory)][array]$Records)
    $pairs = @()
    foreach ($record in $Records) {
        $sourceUniqueId = [string](Get-PropertyValue -Object $record -Name "source_unique_id")
        if ([string]::IsNullOrWhiteSpace($sourceUniqueId)) {
            throw "Validation failed: every record requires source_unique_id."
        }
        $pairs += ("{0}:{1}" -f $sourceUniqueId.Trim(), (Get-CanonicalHash -Record $record))
    }
    return Get-Sha256HexFromString -Value (($pairs | Sort-Object) -join ",")
}

function Get-PayloadHash {
    param([Parameter(Mandatory)][array]$Records)
    return Get-Sha256HexFromString -Value (ConvertTo-StableJson -Value $Records)
}

function Test-RetryableStatus {
    param([AllowNull()]$StatusCode)
    if ($null -eq $StatusCode) { return $true }
    $code = [int]$StatusCode
    return ($code -eq 408 -or $code -eq 425 -or $code -eq 429 -or $code -ge 500)
}

function Get-HttpStatusCode {
    param([Parameter(Mandatory)]$ErrorRecord)
    try {
        $response = $ErrorRecord.Exception.Response
        if ($null -eq $response) { return $null }
        $status = $response.StatusCode
        $valueProperty = $status.PSObject.Properties["value__"]
        if ($null -ne $valueProperty) { return [int]$valueProperty.Value }
        return [int]$status
    }
    catch {
        return $null
    }
}

function Invoke-FinalizationRequest {
    param(
        [Parameter(Mandatory)][string]$Endpoint,
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)]$Body,
        [Parameter(Mandatory)][int]$MaxAttempts,
        [Parameter(Mandatory)][int]$TimeoutSeconds,
        [scriptblock]$Transport = $null
    )
    $json = $Body | ConvertTo-Json -Depth 30 -Compress
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            if ($null -ne $Transport) {
                return & $Transport $Body $attempt $json
            }
            return Invoke-RestMethod -Method Post -Uri $Endpoint -ContentType "application/json" -TimeoutSec $TimeoutSeconds -Headers @{
                "x-storepulse-connector-token" = $Token
            } -Body $json
        }
        catch {
            $statusCode = Get-HttpStatusCode -ErrorRecord $_
            if ($attempt -lt $MaxAttempts -and (Test-RetryableStatus -StatusCode $statusCode)) {
                Start-Sleep -Seconds ([math]::Min(30, 2 * $attempt))
                continue
            }
            throw
        }
    }
}

function Write-ResultFile {
    param(
        [Parameter(Mandatory)]$Result,
        [Parameter(Mandatory)][string]$Path
    )
    $directory = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $Result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Assert-ResponseOk {
    param(
        [Parameter(Mandatory)]$Response,
        [Parameter(Mandatory)][string]$Action
    )
    if ($null -eq $Response -or $Response.ok -ne $true) {
        throw "$Action response did not report ok=true."
    }
    if ($Response.PSObject.Properties["skipped"] -and $Response.skipped) {
        throw "$Action response reported skipped processing."
    }
    if ($Response.PSObject.Properties["ignored"] -and $Response.ignored) {
        throw "$Action response reported ignored processing."
    }
}

function Assert-FinalizationId {
    param(
        [Parameter(Mandatory)]$Response,
        [Parameter(Mandatory)][string]$Expected,
        [Parameter(Mandatory)][string]$Action
    )
    $actual = [string]$Response.finalization_id
    if ([string]::IsNullOrWhiteSpace($actual) -or $actual -ne $Expected) {
        throw "$Action response finalization_id mismatch."
    }
}

if ([Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_DOT_SOURCE_ONLY", "Process") -eq "1") {
    return
}

Import-DotEnv -Path $EnvPath
Assert-BusinessDate -Value $BusinessDate

if ($PeriodType.Trim().ToLowerInvariant() -ne "day") {
    throw "Only closed Day periods are supported by this uploader."
}
if (-not (Test-Path -LiteralPath $JsonPath -PathType Leaf)) { throw "Normalized JSON file was not found: $JsonPath" }
if (-not (Test-Path -LiteralPath $XmlPath -PathType Leaf)) { throw "Source XML file was not found: $XmlPath" }

$parsedRecords = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $JsonPath -Raw)
if ($parsedRecords -is [System.Array]) {
    $records = $parsedRecords
}
else {
    $records = @($parsedRecords)
}
Assert-FinalizedBusinessDayRecords -Records $records -SourceStoreNumber $SourceStoreNumber -BusinessDate $BusinessDate

$sourceFileHash = Get-Sha256HexFromFile -Path $XmlPath
$payloadHash = Get-PayloadHash -Records $records
$diagnosticFinalSourceSetHash = Get-FinalSourceSetHash -Records $records

if ([string]::IsNullOrWhiteSpace($Endpoint)) {
    $Endpoint = [Environment]::GetEnvironmentVariable("STOREPULSE_FINALIZATION_URL", "Process")
}
if (-not [string]::IsNullOrWhiteSpace($Endpoint) -and -not $Endpoint.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)) {
    throw "The finalization endpoint must use HTTPS."
}

$manifest = [ordered]@{
    script_version = $ScriptVersion
    source_system = "verifone_commander"
    source_store_number = $SourceStoreNumber
    source_file_name = [IO.Path]::GetFileName($XmlPath)
    source_file_hash = $sourceFileHash
    normalized_file_name = [IO.Path]::GetFileName($JsonPath)
    payload_hash = $payloadHash
    diagnostic_final_source_set_hash = $diagnosticFinalSourceSetHash
    business_date = $BusinessDate
    period_type = "day"
    period_number = $PeriodNumber
    source_period_label = $SourcePeriodLabel
    period_open = $PeriodOpen
    period_close = $PeriodClose
    expected_record_count = $records.Count
    normalizer_version = $NormalizerVersion
    schema_version = $SchemaVersion
    generated_at = (Get-Date).ToString("o")
}

if ($DryRun) {
    $result = [ordered]@{
        ok = $true
        dry_run = $true
        finalized = $false
        manifest = $manifest
        message = "Dry run completed. No HTTP request was sent. Authoritative final_source_set_hash requires Edge prepare."
    }
    Write-ResultFile -Result $result -Path $ResultPath
    Write-Host "Dry run finalization validation completed."
    Write-Host ("Expected records: {0}" -f $records.Count)
    Write-Host ("Payload hash: {0}" -f $payloadHash)
    Write-Host ("Diagnostic source-set hash: {0}" -f $diagnosticFinalSourceSetHash)
    return
}

if ([string]::IsNullOrWhiteSpace($Endpoint)) {
    throw "STOREPULSE_FINALIZATION_URL or -Endpoint is required."
}

$connectorToken = [Environment]::GetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "Process")
if ([string]::IsNullOrWhiteSpace($connectorToken)) {
    throw "STOREPULSE_CONNECTOR_TOKEN is missing. Add it to $EnvPath."
}

$finalizationId = $null
try {
    $prepareBody = @{
        action = "prepare"
        source_store_number = $SourceStoreNumber
        business_date = $BusinessDate
        payload_hash = $payloadHash
        period_number = $PeriodNumber
        source_period_label = $SourcePeriodLabel
        records = $records
    }
    $prepareResult = Invoke-FinalizationRequest -Endpoint $Endpoint -Token $connectorToken -Body $prepareBody -MaxAttempts $MaxAttempts -TimeoutSeconds $TimeoutSeconds -Transport $Transport
    Assert-ResponseOk -Response $prepareResult -Action "prepare"
    $authoritativeFinalSourceSetHash = [string]$prepareResult.final_source_set_hash
    if ($authoritativeFinalSourceSetHash -notmatch '^[a-fA-F0-9]{64}$') {
        throw "Prepare response did not include a valid authoritative final_source_set_hash."
    }
    if ([int]$prepareResult.expected_record_count -ne $records.Count) {
        throw "Prepare expected_record_count did not match local unique record count."
    }

    $beginBody = @{
        action = "begin"
        source_system = "verifone_commander"
        source_store_number = $SourceStoreNumber
        source_file_name = [IO.Path]::GetFileName($XmlPath)
        source_file_hash = $sourceFileHash
        payload_hash = $payloadHash
        final_source_set_hash = $authoritativeFinalSourceSetHash
        business_date = $BusinessDate
        period_type = "day"
        period_number = $PeriodNumber
        source_period_label = $SourcePeriodLabel
        period_open = $PeriodOpen
        period_close = $PeriodClose
        expected_record_count = $records.Count
        normalizer_version = $NormalizerVersion
        schema_version = $SchemaVersion
        reconciliation_metadata = $manifest
    }

    $beginResult = Invoke-FinalizationRequest -Endpoint $Endpoint -Token $connectorToken -Body $beginBody -MaxAttempts $MaxAttempts -TimeoutSeconds $TimeoutSeconds -Transport $Transport
    Assert-ResponseOk -Response $beginResult -Action "begin"
    $finalizationId = [string]$beginResult.finalization_id
    if ([string]::IsNullOrWhiteSpace($finalizationId)) { throw "Begin response did not include finalization_id." }

    if ($beginResult.already_finalized -eq $true) {
        if ([string]$beginResult.status -ne "already_finalized") {
            throw "Begin response reported already_finalized without status=already_finalized."
        }
        if ([string]$beginResult.final_source_set_hash -ne $authoritativeFinalSourceSetHash) {
            throw "Begin already_finalized response final_source_set_hash mismatch."
        }
        $result = [ordered]@{
            ok = $true
            dry_run = $false
            finalized = $false
            already_finalized = $true
            status = "already_finalized"
            finalization_id = $finalizationId
            prepare = @{
                expected_record_count = [int]$prepareResult.expected_record_count
                final_source_set_hash = $authoritativeFinalSourceSetHash
            }
            begin = $beginResult
            manifest = $manifest
            completed_at = (Get-Date).ToString("o")
        }
        Write-ResultFile -Result $result -Path $ResultPath
        Write-Host "Closed business day was already finalized with the same payload."
        return
    }

    $batchCount = [int][math]::Ceiling($records.Count / [double]$BatchSize)
    for ($batchIndex = 0; $batchIndex -lt $batchCount; $batchIndex++) {
        $batchRecords = @($records | Select-Object -Skip ($batchIndex * $BatchSize) -First $BatchSize)
        $stageBody = @{
            action = "stage"
            finalization_id = $finalizationId
            payload_hash = $payloadHash
            final_source_set_hash = $authoritativeFinalSourceSetHash
            batch_number = ($batchIndex + 1)
            batch_count = $batchCount
            records = $batchRecords
        }
        $stageResult = Invoke-FinalizationRequest -Endpoint $Endpoint -Token $connectorToken -Body $stageBody -MaxAttempts $MaxAttempts -TimeoutSeconds $TimeoutSeconds -Transport $Transport
        Assert-ResponseOk -Response $stageResult -Action "stage"
        Assert-FinalizationId -Response $stageResult -Expected $finalizationId -Action "stage"
        if ([int]$stageResult.batch_number -ne ($batchIndex + 1)) { throw "Stage response batch_number mismatch." }
    }

    $finalizeResult = Invoke-FinalizationRequest -Endpoint $Endpoint -Token $connectorToken -Body @{
        action = "finalize"
        finalization_id = $finalizationId
        payload_hash = $payloadHash
        final_source_set_hash = $authoritativeFinalSourceSetHash
    } -MaxAttempts $MaxAttempts -TimeoutSeconds $TimeoutSeconds -Transport $Transport
    Assert-ResponseOk -Response $finalizeResult -Action "finalize"
    Assert-FinalizationId -Response $finalizeResult -Expected $finalizationId -Action "finalize"
    if ($finalizeResult.finalized -ne $true -and $finalizeResult.already_finalized -ne $true) {
        throw "Finalize response did not report finalized or already_finalized."
    }

    $result = [ordered]@{
        ok = $true
        dry_run = $false
        finalized = ($finalizeResult.finalized -eq $true)
        already_finalized = ($finalizeResult.already_finalized -eq $true)
        status = if ($finalizeResult.already_finalized -eq $true) { "already_finalized" } else { "finalized" }
        finalization_id = $finalizationId
        prepare = @{
            expected_record_count = [int]$prepareResult.expected_record_count
            final_source_set_hash = $authoritativeFinalSourceSetHash
        }
        begin = $beginResult
        finalize = $finalizeResult
        manifest = $manifest
        completed_at = (Get-Date).ToString("o")
    }
    Write-ResultFile -Result $result -Path $ResultPath
    Write-Host "Closed business day finalization completed."
}
catch {
    $statusCode = Get-HttpStatusCode -ErrorRecord $_
    $retryable = Test-RetryableStatus -StatusCode $statusCode
    $failure = [ordered]@{
        ok = $false
        dry_run = $false
        finalized = $false
        retryable = $retryable
        finalization_id = $finalizationId
        status_code = $statusCode
        error_message = $_.Exception.Message
        manifest = $manifest
        failed_at = (Get-Date).ToString("o")
    }
    Write-ResultFile -Result $failure -Path $ResultPath
    throw
}
