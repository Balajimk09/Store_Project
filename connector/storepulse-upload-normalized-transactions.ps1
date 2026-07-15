[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$NormalizedPath,
    [string]$ReconciliationPath = "",
    [Parameter(Mandatory)][string]$SourceXmlPath,
    [Parameter(Mandatory)][string]$Endpoint,
    [Parameter(Mandatory)][string]$SourceStoreNumber,
    [string]$SummaryPath = "",
    [ValidateRange(1, 1000)][int]$BatchSize = 500,
    [scriptblock]$Transport = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RequiredEnvironmentValue {
    param([Parameter(Mandatory)][string]$Name)
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ([string]::IsNullOrWhiteSpace([string]$value)) {
        throw "Required process environment value is missing: $Name"
    }
    return [string]$value
}

function Get-OptionalJsonFile {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Read-StorePulseNormalizedTransactionArray {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Normalized JSON file was not found: $Path"
    }

    $json = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($json)) {
        throw "Normalized JSON shape is invalid: root must be an array."
    }

    $trimmed = $json.TrimStart()
    if (-not $trimmed.StartsWith("[")) {
        throw "Normalized JSON shape is invalid: root must be an array."
    }
    $afterOpen = $trimmed.Substring(1).TrimStart()
    if ($afterOpen.StartsWith("[")) {
        throw "Normalized JSON shape is invalid: transaction entries must be objects, not nested arrays."
    }
    if ($trimmed -match '^\[\s*\]\s*$') {
        Write-Output -NoEnumerate (New-Object System.Collections.ArrayList)
        return
    }

    $parsed = ConvertFrom-Json -InputObject $json
    $items = New-Object System.Collections.ArrayList

    if ($null -eq $parsed) {
        throw "Normalized JSON shape is invalid: array elements must be transaction objects."
    }

    if ($parsed -is [System.Array]) {
        foreach ($item in $parsed) { [void]$items.Add($item) }
    }
    else {
        [void]$items.Add($parsed)
    }

    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items[$i]
        if ($null -eq $item) {
            throw "Normalized JSON shape is invalid: transaction at index $i is null."
        }
        if ($item -is [System.Array]) {
            throw "Normalized JSON shape is invalid: transaction at index $i is a nested array."
        }
        if ($item -is [string] -or $item -is [ValueType]) {
            throw "Normalized JSON shape is invalid: transaction at index $i must be an object."
        }
        if ($null -eq $item.PSObject -or @($item.PSObject.Properties).Count -eq 0) {
            throw "Normalized JSON shape is invalid: transaction at index $i must be an object."
        }
        if ($item.PSObject.Properties["Count"] -and $item.PSObject.Properties["Length"] -and $item.PSObject.Properties["Rank"]) {
            throw "Normalized JSON shape is invalid: transaction at index $i was parsed as an array wrapper."
        }
    }

    Write-Output -NoEnumerate $items
}

function Get-ResponseCount {
    param(
        [Parameter(Mandatory)]$Response,
        [Parameter(Mandatory)][string]$Name
    )
    if ($null -eq $Response) { return 0 }
    $property = $Response.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return 0 }
    return [int]$property.Value
}

function Invoke-StorePulseNormalizedUploadRequest {
    param(
        [Parameter(Mandatory)][string]$Endpoint,
        [Parameter(Mandatory)][string]$ConnectorToken,
        [Parameter(Mandatory)]$Body,
        [scriptblock]$Transport = $null
    )

    $bodyJson = $Body | ConvertTo-Json -Depth 100 -Compress
    if ($null -ne $Transport) {
        return & $Transport ([PSCustomObject]@{
            endpoint = $Endpoint
            headers = @{ "x-storepulse-connector-token" = $ConnectorToken }
            content_type = "application/json; charset=utf-8"
            body = $Body
            body_json = $bodyJson
        })
    }

    return Invoke-RestMethod `
        -Method Post `
        -Uri $Endpoint `
        -Headers @{ "x-storepulse-connector-token" = $ConnectorToken } `
        -ContentType "application/json; charset=utf-8" `
        -Body $bodyJson `
        -TimeoutSec 120
}

foreach ($requiredPath in @($NormalizedPath, $SourceXmlPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required input file was not found: $requiredPath"
    }
}

$uri = $null
if (-not [Uri]::TryCreate($Endpoint, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne "https") {
    throw "Endpoint must be an absolute HTTPS URL."
}
if ($SourceStoreNumber -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') {
    throw "SourceStoreNumber contains unsupported characters."
}

$connectorToken = Get-RequiredEnvironmentValue -Name "STOREPULSE_CONNECTOR_TOKEN"
$transactions = Read-StorePulseNormalizedTransactionArray -Path $NormalizedPath
$reconciliation = Get-OptionalJsonFile -Path $ReconciliationPath
$sourceHash = (Get-FileHash -LiteralPath $SourceXmlPath -Algorithm SHA256).Hash.ToLowerInvariant()

$batchCount = if ($transactions.Count -eq 0) { 0 } else { [int][Math]::Ceiling($transactions.Count / [double]$BatchSize) }
$summary = [ordered]@{
    status = "completed"
    endpoint = $Endpoint
    source_store_number = $SourceStoreNumber
    canonical_record_count = $transactions.Count
    batch_count = $batchCount
    inserted_count = 0
    updated_count = 0
    unchanged_count = 0
    failed_count = 0
    server_canonical_record_count = 0
    duplicate_payload_count = 0
    request_ids = @()
    started_at = (Get-Date).ToUniversalTime().ToString("o")
    completed_at = $null
}

try {
    for ($batchIndex = 0; $batchIndex -lt $batchCount; $batchIndex++) {
        $start = $batchIndex * $BatchSize
        $end = [Math]::Min($start + $BatchSize - 1, $transactions.Count - 1)
        $batch = @($transactions[$start..$end])

        $metadata = [ordered]@{
            period_type = "shift"
            period_number = "current"
            source_period_label = "Current Shift"
            batch_index = $batchIndex + 1
            batch_count = $batchCount
        }
        if ($null -ne $reconciliation) {
            $metadata["raw_transaction_count"] = if ($reconciliation.PSObject.Properties["raw_transaction_count"]) { [int]$reconciliation.raw_transaction_count } else { 0 }
            $metadata["normalizable_transaction_count"] = if ($reconciliation.PSObject.Properties["normalizable_transaction_count"]) { [int]$reconciliation.normalizable_transaction_count } else { 0 }
        }

        $body = [ordered]@{
            source_store_number = $SourceStoreNumber
            source_file_name = Split-Path -Leaf $SourceXmlPath
            normalized_file_name = Split-Path -Leaf $NormalizedPath
            source_file_hash = $sourceHash
            raw_record_count = if ($null -ne $reconciliation -and $reconciliation.PSObject.Properties["raw_transaction_count"]) { [int]$reconciliation.raw_transaction_count } else { 0 }
            sale_like_record_count = if ($null -ne $reconciliation -and $reconciliation.PSObject.Properties["normalizable_transaction_count"]) { [int]$reconciliation.normalizable_transaction_count } else { 0 }
            normalizer_version = "storepulse-normalize-transactions.ps1"
            schema_version = "1"
            metadata = $metadata
            transactions = $batch
        }

        $response = Invoke-StorePulseNormalizedUploadRequest `
            -Endpoint $Endpoint `
            -ConnectorToken $connectorToken `
            -Body $body `
            -Transport $Transport

        $batchCanonicalCount = Get-ResponseCount -Response $response -Name "canonical_record_count"
        $batchInserted = Get-ResponseCount -Response $response -Name "inserted_count"
        $batchUpdated = Get-ResponseCount -Response $response -Name "updated_count"
        $batchUnchanged = Get-ResponseCount -Response $response -Name "unchanged_count"
        $batchFailed = Get-ResponseCount -Response $response -Name "failed_count"
        $batchAccounted = $batchInserted + $batchUpdated + $batchUnchanged + $batchFailed
        if ($batchCanonicalCount -ne $batch.Count -or $batchAccounted -ne $batch.Count) {
            throw "StorePulse ingestion response did not account for every transaction in batch $($batchIndex + 1)."
        }

        $summary.server_canonical_record_count += $batchCanonicalCount
        $summary.inserted_count += $batchInserted
        $summary.updated_count += $batchUpdated
        $summary.unchanged_count += $batchUnchanged
        $summary.failed_count += $batchFailed
        if ($response.PSObject.Properties["duplicate_payload"] -and [bool]$response.duplicate_payload) {
            $summary.duplicate_payload_count++
        }
        if ($response.PSObject.Properties["request_id"] -and -not [string]::IsNullOrWhiteSpace([string]$response.request_id)) {
            $summary.request_ids += [string]$response.request_id
        }
    }

    if ($summary.failed_count -gt 0) {
        $summary.status = "completed_with_errors"
    }
}
catch {
    $summary.status = "failed"
    throw
}
finally {
    $summary.completed_at = (Get-Date).ToUniversalTime().ToString("o")
    if (-not [string]::IsNullOrWhiteSpace($SummaryPath)) {
        $parent = Split-Path -Parent $SummaryPath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $SummaryPath -Encoding UTF8
    }
    $connectorToken = $null
}

Write-Host ("Canonical records: {0}" -f $summary.canonical_record_count)
Write-Host ("Inserted: {0}" -f $summary.inserted_count)
Write-Host ("Updated: {0}" -f $summary.updated_count)
Write-Host ("Unchanged: {0}" -f $summary.unchanged_count)
Write-Host ("Failed: {0}" -f $summary.failed_count)
if ($summary.failed_count -gt 0) {
    $requestIdText = if ($summary.request_ids.Count -gt 0) { $summary.request_ids -join "," } else { "none" }
    throw ("StorePulse rejected normalized transactions. canonical_record_count={0}; inserted_count={1}; updated_count={2}; unchanged_count={3}; failed_count={4}; request_ids={5}" -f `
        $summary.canonical_record_count,
        $summary.inserted_count,
        $summary.updated_count,
        $summary.unchanged_count,
        $summary.failed_count,
        $requestIdText)
}
Write-Host "PASS: all normalized transactions were accepted by StorePulse."
