[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$connectorRoot = Join-Path $repoRoot "connector"
$serviceRoot = Join-Path $connectorRoot "service"
$workerPath = Join-Path $serviceRoot "storepulse-current-shift-worker.ps1"
$runtimePath = Join-Path $serviceRoot "storepulse-service-runtime.ps1"
$normalizerPath = Join-Path $connectorRoot "storepulse-normalize-transactions.ps1"
$uploaderPath = Join-Path $connectorRoot "storepulse-upload-normalized-transactions.ps1"
$closedWrapperPath = Join-Path $connectorRoot "storepulse-finalize-closed-day-machine.ps1"
$script:CurrentShiftAssertionCount = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
    $script:CurrentShiftAssertionCount += 1
    Write-Host "PASS: $Message"
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    Assert-True -Condition ($Actual -eq $Expected) -Message "$Message Expected=[$Expected] Actual=[$Actual]"
}

function Assert-Throws {
    param([scriptblock]$ScriptBlock, [string]$Message)
    $threw = $false
    try { & $ScriptBlock } catch { $threw = $true }
    Assert-True -Condition $threw -Message $Message
}

function New-SyntheticTransaction {
    param([int]$Index)
    return [PSCustomObject]@{
        source_system = "verifone_commander"
        source_unique_id = "synthetic-$Index"
        store_number = "TST001"
        business_date = "2030-01-01"
        canonical_record = $true
        transaction_type = "completed_sale"
        total = [decimal]($Index + 0.01)
        items = @()
        payments = @()
    }
}

function Write-NormalizedFixture {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Value
    )
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    ConvertTo-Json -InputObject $Value -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Invoke-UploaderFixture {
    param(
        [Parameter(Mandatory)][string]$NormalizedPath,
        [Parameter(Mandatory)][string]$SourceXmlPath,
        [Parameter(Mandatory)][string]$SummaryPath,
        [int]$BatchSize = 500,
        [scriptblock]$Responder = $null
    )

    $requests = New-Object System.Collections.ArrayList
    if ($null -eq $Responder) {
        $Responder = {
            param($request)
            [PSCustomObject]@{
                canonical_record_count = [int]$request.body.transactions.Count
                inserted_count = [int]$request.body.transactions.Count
                updated_count = 0
                unchanged_count = 0
                failed_count = 0
                duplicate_payload = $false
                request_id = "test-request-$($request.body.metadata.batch_index)"
            }
        }
    }
    $transport = {
        param($request)
        [void]$requests.Add($request)
        return & $Responder $request
    }.GetNewClosure()

    $previousToken = [Environment]::GetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "Process")
    $output = @()
    try {
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "synthetic-connector-token-value-that-must-not-leak", "Process")
        $output = & {
            . $uploaderPath `
                -NormalizedPath $NormalizedPath `
                -SourceXmlPath $SourceXmlPath `
                -Endpoint "https://example.test/functions/v1/ingest-pos-transactions" `
                -SourceStoreNumber "TST001" `
                -SummaryPath $SummaryPath `
                -BatchSize $BatchSize `
                -Transport $transport
        } 2>&1
        return [PSCustomObject]@{
            requests = @($requests)
            output_text = (@($output) -join "`n")
            summary = if (Test-Path -LiteralPath $SummaryPath -PathType Leaf) { Get-Content -LiteralPath $SummaryPath -Raw | ConvertFrom-Json } else { $null }
            summary_text = if (Test-Path -LiteralPath $SummaryPath -PathType Leaf) { Get-Content -LiteralPath $SummaryPath -Raw } else { "" }
            error = $null
        }
    }
    catch {
        return [PSCustomObject]@{
            requests = @($requests)
            output_text = (@($output) -join "`n")
            summary = if (Test-Path -LiteralPath $SummaryPath -PathType Leaf) { Get-Content -LiteralPath $SummaryPath -Raw | ConvertFrom-Json } else { $null }
            summary_text = if (Test-Path -LiteralPath $SummaryPath -PathType Leaf) { Get-Content -LiteralPath $SummaryPath -Raw } else { "" }
            error = $_.Exception.Message
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", $previousToken, "Process")
    }
}

foreach ($path in @($workerPath, $runtimePath, $normalizerPath, $uploaderPath, $closedWrapperPath)) {
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
    $capture.normalizer_normalized_path = $normalizedPathValue
    $capture.normalizer_reconciliation_path = $reconciliationPathValue
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
    Assert-True -Condition ($capture.normalizer_xml_path -eq $capture.output_path) -Message "Current Shift passes explicit XML path to normalizer"
    Assert-True -Condition ($capture.normalizer_normalized_path.StartsWith((Join-Path $config.working_root "live"), [StringComparison]::OrdinalIgnoreCase)) -Message "Current Shift passes explicit normalized JSON path under ProgramData"
    Assert-True -Condition ($capture.normalizer_reconciliation_path.StartsWith((Join-Path $config.working_root "live"), [StringComparison]::OrdinalIgnoreCase)) -Message "Current Shift passes explicit reconciliation path under ProgramData"
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

    $normalizerSource = Get-Content -LiteralPath $normalizerPath -Raw
    Assert-True -Condition ($normalizerSource -notmatch '\$env:USERPROFILE') -Message "normalizer contains no USERPROFILE default"
    Assert-True -Condition ($normalizerSource -notmatch '(?i)OneDrive') -Message "normalizer contains no OneDrive path"
    Assert-True -Condition ($normalizerSource -notmatch '\\Desktop\\') -Message "normalizer contains no Desktop path"
    Assert-True -Condition ($normalizerSource -notmatch 'C:\\Users') -Message "normalizer contains no hard-coded C:\\Users path"
    Assert-True -Condition ($normalizerSource -notmatch 'C:\\StorePulse\\connector') -Message "normalizer contains no legacy C:\\StorePulse\\connector reconciliation default"
    Assert-True -Condition ($normalizerSource -match '\[string\]\$XmlPath\s*=\s*""') -Message "normalizer XmlPath defaults to blank"
    Assert-True -Condition ($normalizerSource -match '\[string\]\$OutputPath\s*=\s*""') -Message "normalizer OutputPath defaults to blank"
    Assert-True -Condition ($normalizerSource -match '\[string\]\$ReconciliationPath\s*=\s*""') -Message "normalizer ReconciliationPath defaults to blank"
    Assert-True -Condition ($normalizerSource -match 'throw "XmlPath is required\."' -and $normalizerSource -match 'throw "OutputPath is required\."' -and $normalizerSource -match 'throw "ReconciliationPath is required\."') -Message "normalizer fails fast when explicit paths are omitted"

    $arrayTestRoot = Join-Path $testRoot "array-loader"
    New-Item -ItemType Directory -Path $arrayTestRoot -Force | Out-Null
    $sourceXmlPath = Join-Path $arrayTestRoot "current.xml"
    Set-Content -LiteralPath $sourceXmlPath -Value "<transSet/>" -Encoding UTF8

    $records291 = @(for ($i = 1; $i -le 291; $i++) { New-SyntheticTransaction -Index $i })
    $normalized291Path = Join-Path $arrayTestRoot "normalized-291.json"
    $summary291Path = Join-Path $arrayTestRoot "summary-291.json"
    Write-NormalizedFixture -Path $normalized291Path -Value $records291
    $loaded291 = Read-StorePulseNormalizedTransactionArray -Path $normalized291Path
    Assert-Equal -Actual $loaded291.Count -Expected 291 -Message "291-record fixture parses as 291 transactions"

    $mockInstallRoot = Join-Path $arrayTestRoot "mock-install"
    New-Item -ItemType Directory -Path $mockInstallRoot -Force | Out-Null
    $mockNormalizerPath = Join-Path $mockInstallRoot "storepulse-normalize-transactions.ps1"
    $fixtureLiteral = $normalized291Path.Replace("'", "''")
    Set-Content -LiteralPath $mockNormalizerPath -Encoding UTF8 -Value @"
param(
    [string]`$XmlPath,
    [string]`$OutputPath,
    [string]`$ReconciliationPath,
    [string]`$PeriodType,
    [string]`$PeriodNumber,
    [string]`$SourcePeriodLabel
)
Copy-Item -LiteralPath '$fixtureLiteral' -Destination `$OutputPath -Force
[PSCustomObject]@{ raw_transaction_count = 1865; normalizable_transaction_count = 361; normalized_record_count = 291 } |
    ConvertTo-Json | Set-Content -LiteralPath `$ReconciliationPath -Encoding UTF8
"@
    $workerNormalization = Invoke-StorePulseCurrentShiftNormalizer `
        -InstallRoot $mockInstallRoot `
        -XmlPath $sourceXmlPath `
        -NormalizedPath (Join-Path $arrayTestRoot "worker-normalized-291.json") `
        -ReconciliationPath (Join-Path $arrayTestRoot "worker-reconciliation-291.json")
    Assert-Equal -Actual $workerNormalization.canonical_record_count -Expected 291 -Message "worker canonical_record_count is 291 for 291-object normalized JSON"

    $uploader291 = Invoke-UploaderFixture -NormalizedPath $normalized291Path -SourceXmlPath $sourceXmlPath -SummaryPath $summary291Path
    Assert-True -Condition ($null -eq $uploader291.error) -Message "291-record uploader fixture succeeds"
    Assert-Equal -Actual $uploader291.summary.canonical_record_count -Expected 291 -Message "uploader canonical_record_count is 291"
    Assert-Equal -Actual $uploader291.summary.server_canonical_record_count -Expected 291 -Message "uploader server_canonical_record_count is 291"
    Assert-Equal -Actual $uploader291.requests.Count -Expected 1 -Message "default BatchSize 500 produces one batch for 291 records"
    Assert-Equal -Actual $uploader291.requests[0].body.transactions.Count -Expected 291 -Message "uploader request contains 291 transaction objects"
    Assert-Equal -Actual $uploader291.requests[0].body.transactions[0].source_unique_id -Expected "synthetic-1" -Message "first request transaction has source_unique_id"
    Assert-True -Condition (-not ($uploader291.requests[0].body.transactions[0] -is [System.Array])) -Message "first request transaction is not System.Array"

    $singlePath = Join-Path $arrayTestRoot "normalized-single.json"
    $singleSummaryPath = Join-Path $arrayTestRoot "summary-single.json"
    Write-NormalizedFixture -Path $singlePath -Value @((New-SyntheticTransaction -Index 1))
    $singleLoaded = Read-StorePulseNormalizedTransactionArray -Path $singlePath
    Assert-Equal -Actual $singleLoaded.Count -Expected 1 -Message "one-record JSON array parses as one transaction"
    $singleResult = Invoke-UploaderFixture -NormalizedPath $singlePath -SourceXmlPath $sourceXmlPath -SummaryPath $singleSummaryPath
    Assert-Equal -Actual $singleResult.requests.Count -Expected 1 -Message "one-record upload produces one request"
    $singleBody = $singleResult.requests[0].body_json | ConvertFrom-Json
    Assert-True -Condition ($singleResult.requests[0].body_json -match '"transactions":\[') -Message "one-record request serializes transactions as JSON array"
    Assert-Equal -Actual @($singleBody.transactions).Count -Expected 1 -Message "one-record request does not serialize transactions as scalar object"

    $emptyPath = Join-Path $arrayTestRoot "normalized-empty.json"
    $emptySummaryPath = Join-Path $arrayTestRoot "summary-empty.json"
    Set-Content -LiteralPath $emptyPath -Value "[]" -Encoding UTF8
    $emptyLoaded = Read-StorePulseNormalizedTransactionArray -Path $emptyPath
    Assert-Equal -Actual $emptyLoaded.Count -Expected 0 -Message "empty JSON array parses as zero transactions"
    $emptyResult = Invoke-UploaderFixture -NormalizedPath $emptyPath -SourceXmlPath $sourceXmlPath -SummaryPath $emptySummaryPath
    Assert-True -Condition ($null -eq $emptyResult.error) -Message "empty array uploader succeeds without network requests"
    Assert-Equal -Actual $emptyResult.requests.Count -Expected 0 -Message "empty array produces zero batches"
    Assert-Equal -Actual $emptyResult.summary.canonical_record_count -Expected 0 -Message "empty array summary records zero canonical records"

    $objectPath = Join-Path $arrayTestRoot "normalized-object.json"
    Set-Content -LiteralPath $objectPath -Value '{"source_unique_id":"bad"}' -Encoding UTF8
    Assert-Throws -ScriptBlock { Read-StorePulseNormalizedTransactionArray -Path $objectPath | Out-Null } -Message "root JSON object is rejected"
    $nestedPath = Join-Path $arrayTestRoot "normalized-nested.json"
    $nestedRecordJson = ConvertTo-Json -InputObject (New-SyntheticTransaction -Index 1) -Depth 20 -Compress
    Set-Content -LiteralPath $nestedPath -Value "[$nestedRecordJson]" -Encoding UTF8
    $nestedText = Get-Content -LiteralPath $nestedPath -Raw
    Set-Content -LiteralPath $nestedPath -Value "[$nestedText]" -Encoding UTF8
    Assert-Throws -ScriptBlock { Read-StorePulseNormalizedTransactionArray -Path $nestedPath | Out-Null } -Message "nested transaction array is rejected before upload"
    $nullElementPath = Join-Path $arrayTestRoot "normalized-null.json"
    Set-Content -LiteralPath $nullElementPath -Value '[null]' -Encoding UTF8
    Assert-Throws -ScriptBlock { Read-StorePulseNormalizedTransactionArray -Path $nullElementPath | Out-Null } -Message "null transaction element is rejected before upload"
    $primitivePath = Join-Path $arrayTestRoot "normalized-primitive.json"
    Set-Content -LiteralPath $primitivePath -Value '["bad"]' -Encoding UTF8
    Assert-Throws -ScriptBlock { Read-StorePulseNormalizedTransactionArray -Path $primitivePath | Out-Null } -Message "primitive transaction element is rejected before upload"

    $multiRecords = @(for ($i = 1; $i -le 1001; $i++) { New-SyntheticTransaction -Index $i })
    $multiPath = Join-Path $arrayTestRoot "normalized-1001.json"
    $multiSummaryPath = Join-Path $arrayTestRoot "summary-1001.json"
    Write-NormalizedFixture -Path $multiPath -Value $multiRecords
    $multiResult = Invoke-UploaderFixture -NormalizedPath $multiPath -SourceXmlPath $sourceXmlPath -SummaryPath $multiSummaryPath -BatchSize 500
    Assert-Equal -Actual $multiResult.requests.Count -Expected 3 -Message "multi-batch fixture produces exact batch count"
    Assert-Equal -Actual $multiResult.requests[0].body.transactions.Count -Expected 500 -Message "first multi-batch contains 500 records"
    Assert-Equal -Actual $multiResult.requests[1].body.transactions.Count -Expected 500 -Message "second multi-batch contains 500 records"
    Assert-Equal -Actual $multiResult.requests[2].body.transactions.Count -Expected 1 -Message "final multi-batch contains one record"
    Assert-True -Condition ($multiResult.requests[2].body_json -match '"transactions":\[') -Message "final one-record batch remains a JSON array"
    $seenIds = @($multiResult.requests | ForEach-Object { $_.body.transactions } | ForEach-Object { $_.source_unique_id })
    Assert-Equal -Actual $seenIds.Count -Expected 1001 -Message "multi-batch fixture accounts for every record once"
    Assert-Equal -Actual (@($seenIds | Select-Object -Unique).Count) -Expected 1001 -Message "multi-batch fixture does not duplicate records"

    $failedSummaryPath = Join-Path $arrayTestRoot "summary-failed.json"
    $failedResult = Invoke-UploaderFixture `
        -NormalizedPath $singlePath `
        -SourceXmlPath $sourceXmlPath `
        -SummaryPath $failedSummaryPath `
        -Responder {
            param($request)
            [PSCustomObject]@{
                canonical_record_count = [int]$request.body.transactions.Count
                inserted_count = 0
                updated_count = 0
                unchanged_count = 0
                failed_count = [int]$request.body.transactions.Count
                duplicate_payload = $false
                request_id = "failed-count-request"
            }
        }
    Assert-True -Condition ($null -ne $failedResult.error) -Message "failed-count response causes uploader failure"
    Assert-True -Condition (Test-Path -LiteralPath $failedSummaryPath -PathType Leaf) -Message "failed-count response writes uploader summary"
    Assert-True -Condition ($failedResult.error -match 'canonical_record_count=1' -and $failedResult.error -match 'failed_count=1' -and $failedResult.error -match 'failed-count-request') -Message "failed-count diagnostic includes counts and request ID"
    Assert-True -Condition (-not ($failedResult.error.Contains("synthetic-connector-token-value-that-must-not-leak")) -and -not ($failedResult.summary_text.Contains("synthetic-connector-token-value-that-must-not-leak"))) -Message "failed-count diagnostics do not include connector token"

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

    Write-Host "PASS: machine-wide Current Shift worker tests completed ($script:CurrentShiftAssertionCount assertions)."
}
finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
