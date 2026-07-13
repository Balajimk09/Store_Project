[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runnerPath = Join-Path $repoRoot "connector\storepulse-finalize-closed-day.ps1"
$uploaderPath = Join-Path $repoRoot "connector\storepulse-upload-finalized-business-day.ps1"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("storepulse-phase2-tests-" + [guid]::NewGuid().ToString("N"))
$global:StorePulsePhase2Failures = New-Object System.Collections.Generic.List[string]
$global:StorePulsePhase2PassCount = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { $global:StorePulsePhase2Failures.Add($Message) } else { $global:StorePulsePhase2PassCount += 1 }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) { $global:StorePulsePhase2Failures.Add("$Message Expected=[$Expected] Actual=[$Actual]") } else { $global:StorePulsePhase2PassCount += 1 }
}

function Assert-Throws {
    param([scriptblock]$ScriptBlock, [string]$Message)
    try {
        & $ScriptBlock
        $global:StorePulsePhase2Failures.Add("$Message Expected exception.")
    }
    catch {
        $global:StorePulsePhase2PassCount += 1
    }
}

function Write-JsonFile {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string]$Path)
    ConvertTo-Json -InputObject $Value -Depth 30 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function New-TestRecord {
    param(
        [string]$SourceUniqueId,
        [decimal]$Total,
        [string]$StoreNumber = "SYNTH",
        [string]$BusinessDate = "2026-01-05",
        [string]$SourceSystem = "verifone_commander"
    )
    [PSCustomObject]@{
        source_system = $SourceSystem
        source_unique_id = $SourceUniqueId
        source_transaction_type = "sale"
        store_number = $StoreNumber
        canonical_record = $true
        transaction_time = "2026-01-06T00:10:00-05:00"
        business_date = $BusinessDate
        transaction_type = "completed_sale"
        subtotal = $Total
        tax_total = 0.00
        total = $Total
        current_total = $Total
        item_count = 1
        payment_count = 1
        items = [object[]]@(
            [PSCustomObject]@{ line_type = "item"; description = "Synthetic item"; quantity = 1; unit_price = $Total; line_total = $Total },
            [PSCustomObject]@{ line_type = "note"; description = "Synthetic note"; quantity = 0; unit_price = 0; line_total = 0 }
        )
        payments = [object[]]@(
            [PSCustomObject]@{ payment_code = "CASH"; amount = $Total; direction = "received_from_customer" },
            [PSCustomObject]@{ payment_code = "ROUNDING"; amount = 0; direction = "received_from_customer" }
        )
    }
}

function New-TransSet {
    param(
        [string]$Site = "SYNTH",
        [string]$PeriodId = "2",
        [string]$PeriodName = "Day",
        [string]$ShortId = "123",
        [string[]]$OpenedTimes = @("2026-01-05T22:00:00-05:00"),
        [string[]]$ClosedTimes = @("2026-01-06T00:30:00-05:00"),
        [switch]$Fault,
        [switch]$NoTransactions
    )
    $openXml = ($OpenedTimes | ForEach-Object { "<openedTime>$_</openedTime>" }) -join ""
    $closeXml = ($ClosedTimes | ForEach-Object { "<closedTime>$_</closedTime>" }) -join ""
    $body = if ($Fault) { "<fault>bad</fault>" } elseif ($NoTransactions) { "" } else { "<trans><trHeader /></trans>" }
    return [xml]("<transSet site=`"$Site`" periodID=`"$PeriodId`" periodname=`"$PeriodName`" shortId=`"$ShortId`">$openXml$closeXml$body</transSet>")
}

function New-UploaderFiles {
    param([Parameter(Mandatory)][array]$Records, [string]$Name = "payload")
    $dir = Join-Path $tempRoot ("uploader-" + $Name + "-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $xmlPath = Join-Path $dir "$Name.xml"
    $jsonPath = Join-Path $dir "$Name.json"
    $resultPath = Join-Path $dir "$Name.result.json"
    Set-Content -LiteralPath $xmlPath -Encoding UTF8 -Value '<transSet site="SYNTH" periodID="2" periodname="Day" shortId="123"><openedTime>2026-01-05T22:00:00-05:00</openedTime><closedTime>2026-01-06T00:30:00-05:00</closedTime><trans><trHeader /></trans></transSet>'
    Write-JsonFile -Value $Records -Path $jsonPath
    [PSCustomObject]@{ Xml = $xmlPath; Json = $jsonPath; Result = $resultPath; Directory = $dir }
}

function Invoke-UploaderMocked {
    param(
        [Parameter(Mandatory)][array]$Records,
        [Parameter(Mandatory)][scriptblock]$Transport,
        [string]$Name = "mocked",
        [int]$BatchSize = 1,
        [int]$MaxAttempts = 2
    )
    $files = New-UploaderFiles -Records $Records -Name $Name
    $previousToken = [Environment]::GetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "Process")
    [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "test-token-value-that-is-long-enough", "Process")
    try {
        & $uploaderPath -JsonPath $files.Json -XmlPath $files.Xml -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" `
            -PeriodNumber "123" -SourcePeriodLabel "2026-01-06.123" `
            -PeriodOpen "2026-01-05T22:00:00-05:00" -PeriodClose "2026-01-06T00:30:00-05:00" `
            -Endpoint "https://example.invalid/functions/v1/finalize-pos-business-day" -ResultPath $files.Result `
            -BatchSize $BatchSize -MaxAttempts $MaxAttempts -TimeoutSeconds 10 -Transport $Transport *> $null
        $exitCode = 0
        if (Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue) {
            $exitCode = $global:LASTEXITCODE
        }
        [PSCustomObject]@{
            ExitCode = $exitCode
            Result = if (Test-Path -LiteralPath $files.Result) { Get-Content -LiteralPath $files.Result -Raw | ConvertFrom-Json } else { $null }
            ResultText = if (Test-Path -LiteralPath $files.Result) { Get-Content -LiteralPath $files.Result -Raw } else { "" }
            Files = $files
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", $previousToken, "Process")
    }
}

function New-RunnerFixture {
    param([string]$Name)
    $dir = Join-Path $tempRoot ("runner-" + $Name + "-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $periodListPath = Join-Path $dir "period-list.xml"
    $transSetPath = Join-Path $dir "transset.xml"
    $envPath = Join-Path $dir ".env"
    $workingRoot = Join-Path $dir "work"
    $archiveRoot = Join-Path $dir "archive"
    Set-Content -LiteralPath $periodListPath -Encoding UTF8 -Value '<periodList><period period="2" filename="2026-01-06.123" /></periodList>'
    Set-Content -LiteralPath $transSetPath -Encoding UTF8 -Value '<transSet site="SYNTH" periodID="2" periodname="Day" shortId="123"><openedTime>2026-01-05T22:00:00-05:00</openedTime><closedTime>2026-01-06T00:30:00-05:00</closedTime><trans><trHeader /></trans></transSet>'
    Set-Content -LiteralPath $envPath -Encoding UTF8 -Value ''
    [PSCustomObject]@{
        Directory = $dir
        PeriodList = $periodListPath
        TransSet = $transSetPath
        EnvPath = $envPath
        WorkingRoot = $workingRoot
        ArchiveRoot = $archiveRoot
        Marker = (Join-Path $dir "uploader.marker")
        Log = (Join-Path $dir "runner.log")
    }
}

function New-MockNormalizerScript {
    param(
        [string]$Directory,
        [string]$Name,
        [int]$ExitCode = 0
    )
    $path = Join-Path $Directory "$Name.ps1"
    if ($ExitCode -eq 0) {
        $recordJson = (ConvertTo-Json -InputObject @((New-TestRecord -SourceUniqueId "runner-001" -Total 1.23)) -Depth 30 -Compress).Replace("'", "''")
        $content = @"
param(
    [string]`$XmlPath,
    [string]`$OutputPath,
    [string]`$ReconciliationPath,
    [string]`$BusinessDate,
    [string]`$PeriodType,
    [string]`$PeriodNumber,
    [string]`$SourcePeriodLabel,
    [string]`$PeriodOpen,
    [string]`$PeriodClose
)
Set-Content -LiteralPath `$OutputPath -Encoding UTF8 -Value '$recordJson'
Set-Content -LiteralPath `$ReconciliationPath -Encoding UTF8 -Value '{"ok":true}'
exit 0
"@
    }
    else {
        $content = @"
param(
    [string]`$XmlPath,
    [string]`$OutputPath,
    [string]`$ReconciliationPath
)
exit $ExitCode
"@
    }
    Set-Content -LiteralPath $path -Encoding UTF8 -Value $content
    return $path
}

function New-MockUploaderScript {
    param(
        [string]$Directory,
        [string]$Name,
        [int]$ExitCode = 0,
        [string]$Status = "finalized",
        [string]$MarkerPath = ""
    )
    $path = Join-Path $Directory "$Name.ps1"
    $markerLiteral = $MarkerPath.Replace("'", "''")
    $content = @"
param(
    [string]`$JsonPath,
    [string]`$XmlPath,
    [string]`$ResultPath
)
if ('$markerLiteral') { Set-Content -LiteralPath '$markerLiteral' -Encoding UTF8 -Value 'invoked' }
if ($ExitCode -eq 0) {
    Set-Content -LiteralPath `$ResultPath -Encoding UTF8 -Value '{"ok":true,"status":"$Status","finalized":true}'
}
exit $ExitCode
"@
    Set-Content -LiteralPath $path -Encoding UTF8 -Value $content
    return $path
}

function Invoke-RunnerSynthetic {
    param(
        [Parameter(Mandatory)]$Fixture,
        [Parameter(Mandatory)][string]$NormalizerPath,
        [Parameter(Mandatory)][string]$UploaderPath,
        [switch]$DryRun,
        [switch]$FetchOnly
    )
    $previousPeriodList = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_PERIOD_LIST_PATH", "Process")
    $previousTransSet = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_TRANSSET_PATH", "Process")
    $previousNormalizer = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_NORMALIZER_PATH", "Process")
    $previousUploader = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_UPLOADER_PATH", "Process")
    try {
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_PERIOD_LIST_PATH", $Fixture.PeriodList, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_TRANSSET_PATH", $Fixture.TransSet, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_NORMALIZER_PATH", $NormalizerPath, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_UPLOADER_PATH", $UploaderPath, "Process")
        $arguments = @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runnerPath,
            "-InstallPath", "synthetic-install",
            "-CommanderIp", "synthetic-host",
            "-CredentialTarget", "synthetic-credential",
            "-SourceStoreNumber", "SYNTH",
            "-WorkingRoot", $Fixture.WorkingRoot,
            "-ArchiveRoot", $Fixture.ArchiveRoot,
            "-EnvPath", $Fixture.EnvPath,
            "-Endpoint", "https://example.invalid/functions/v1/finalize-pos-business-day"
        )
        if ($DryRun) { $arguments += "-DryRun" }
        if ($FetchOnly) { $arguments += "-FetchOnly" }
        $runnerErrorText = ""
        try {
            & powershell @arguments *> $Fixture.Log
            $runnerExitCode = $LASTEXITCODE
        }
        catch {
            $runnerExitCode = if (Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue) { $global:LASTEXITCODE } else { 1 }
            $runnerErrorText = $_.Exception.Message
        }
        $workFiles = @()
        if (Test-Path -LiteralPath $Fixture.WorkingRoot) {
            $workFiles = @(Get-ChildItem -LiteralPath $Fixture.WorkingRoot -Recurse -File)
        }
        $archiveFiles = @()
        if (Test-Path -LiteralPath $Fixture.ArchiveRoot) {
            $archiveFiles = @(Get-ChildItem -LiteralPath $Fixture.ArchiveRoot -Recurse -File)
        }
        [PSCustomObject]@{
            ExitCode = $runnerExitCode
            Log = if (Test-Path -LiteralPath $Fixture.Log) { Get-Content -LiteralPath $Fixture.Log -Raw } else { "" }
            ErrorText = $runnerErrorText
            WorkFiles = [object[]]$workFiles
            ArchiveFiles = [object[]]$archiveFiles
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_PERIOD_LIST_PATH", $previousPeriodList, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_TRANSSET_PATH", $previousTransSet, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_NORMALIZER_PATH", $previousNormalizer, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_TEST_UPLOADER_PATH", $previousUploader, "Process")
    }
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$previousDotSource = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_DOT_SOURCE_ONLY", "Process")
[Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_DOT_SOURCE_ONLY", "1", "Process")

try {
    . $runnerPath
    $dummyXml = Join-Path $tempRoot "dummy.xml"
    $dummyJson = Join-Path $tempRoot "dummy.json"
    Set-Content -LiteralPath $dummyXml -Value "<x />"
    Write-JsonFile -Value @() -Path $dummyJson
    . $uploaderPath -JsonPath $dummyJson -XmlPath $dummyXml -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" -PeriodNumber "123" -SourcePeriodLabel "2026-01-06.123" -PeriodOpen "2026-01-05T22:00:00-05:00" -PeriodClose "2026-01-06T00:30:00-05:00" -DryRun
    [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_DOT_SOURCE_ONLY", $previousDotSource, "Process")

    $singleArrayHolder = [PSCustomObject]@{
        values = [object[]]@(
            [PSCustomObject]@{
                id = "single"
            }
        )
    }

    $singleArrayValue = Get-PropertyValue `
        -Object $singleArrayHolder `
        -Name "values"

    Assert-True `
        -Condition ($singleArrayValue -is [array]) `
        -Message "single-element property array remains an array"

    Assert-Equal `
        -Actual (@($singleArrayValue).Count) `
        -Expected 1 `
        -Message "single-element property array retains one element"

    $emptyArrayHolder = [PSCustomObject]@{
        values = [object[]]@()
    }

    $emptyArrayValue = Get-PropertyValue `
        -Object $emptyArrayHolder `
        -Name "values"

    Assert-True `
        -Condition ($emptyArrayValue -is [array]) `
        -Message "empty property array remains an array"

    Assert-Equal `
        -Actual (@($emptyArrayValue).Count) `
        -Expected 0 `
        -Message "empty property array retains zero elements"
    $periodList = [xml]'<periodList><period period="1" filename="2026-01-06.1" /><period period="2" filename="current.2" current="true" /><period period="2" filename="bad-name" /><period period="2" filename="2026-01-05.122" /><period period="2" filename="2026-01-06.123" /></periodList>'
    $candidates = Get-ClosedDayCandidates -PeriodListXml $periodList
    Assert-Equal -Actual $candidates.Count -Expected 2 -Message "only closed Day filename candidates accepted"
    Assert-Equal -Actual (Select-ClosedDayPeriod -Candidates $candidates -PeriodFilename "").filename -Expected "2026-01-06.123" -Message "latest closed Day deterministic"
    Assert-Equal -Actual (Select-ClosedDayPeriod -Candidates $candidates -PeriodFilename "2026-01-05.122").filename -Expected "2026-01-05.122" -Message "explicit PeriodFilename accepted"
    Assert-Throws -ScriptBlock { Select-ClosedDayPeriod -Candidates $candidates -PeriodFilename "2026-01-04.121" } -Message "missing explicit period rejected"

    $selected = [PSCustomObject]@{ filename = "2026-01-06.123"; period_number = "123" }
    $periodInfo = Validate-ClosedTransSet -Xml (New-TransSet) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected
    Assert-Equal -Actual $periodInfo.business_date -Expected "2026-01-05" -Message "business date derives from openedTime"
    Assert-Equal -Actual $periodInfo.period_close.Substring(0, 10) -Expected "2026-01-06" -Message "close after midnight retained"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -Site "OTHER") -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "wrong store rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -ShortId "124") -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "mismatched shortId rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -PeriodId "1") -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "wrong periodID rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -Fault) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "fault response rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -NoTransactions) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "missing transaction content rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -OpenedTimes @()) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "missing openedTime rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -OpenedTimes @("2026-01-05T22:00:00-05:00","2026-01-05T22:01:00-05:00")) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "duplicate openedTime rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -ClosedTimes @()) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "missing closedTime rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -ClosedTimes @("2026-01-06T00:30:00-05:00","2026-01-06T00:31:00-05:00")) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "duplicate closedTime rejected"
    Assert-Throws -ScriptBlock { Validate-ClosedTransSet -Xml (New-TransSet -OpenedTimes @("2026-01-06T01:00:00-05:00") -ClosedTimes @("2026-01-06T00:30:00-05:00")) -SourceStoreNumber "SYNTH" -SelectedPeriod $selected } -Message "openedTime >= closedTime rejected"

    Assert-Equal -Actual (Assert-StorePulseSafePathSegment -Value "SYNTH" -Name "store") -Expected "SYNTH" -Message "safe store path segment accepted"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value ".." -Name "store" } -Message "traversal path segment rejected"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value "BAD/STORE" -Name "store" } -Message "slash path segment rejected"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value "BAD\STORE" -Name "store" } -Message "backslash path segment rejected"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value "BAD:STORE" -Name "store" } -Message "colon path segment rejected"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value "BAD." -Name "store" } -Message "trailing dot path segment rejected"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value "BAD " -Name "store" } -Message "trailing space path segment rejected"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value "CON" -Name "store" } -Message "reserved device path segment rejected"
    Assert-Throws -ScriptBlock { Assert-StorePulseSafePathSegment -Value ("S" * 65) -Name "store" } -Message "overlong path segment rejected"

    $recordA = New-TestRecord -SourceUniqueId "synthetic-001" -Total 10.00
    $recordB = New-TestRecord -SourceUniqueId "synthetic-002" -Total 20.00
    Assert-FinalizedBusinessDayRecords -Records @($recordA) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05"
    $global:StorePulsePhase2PassCount += 1
    Assert-Throws -ScriptBlock { Assert-FinalizedBusinessDayRecords -Records @() -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "empty payload rejected"
    Assert-Throws -ScriptBlock { Assert-FinalizedBusinessDayRecords -Records @([PSCustomObject]@{}) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "missing source ID rejected"
    Assert-Throws -ScriptBlock { Assert-FinalizedBusinessDayRecords -Records @($recordA, $recordA) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "duplicate source ID rejected"
    Assert-Throws -ScriptBlock { Assert-FinalizedBusinessDayRecords -Records @((New-TestRecord -SourceUniqueId "wrong-source" -Total 1 -SourceSystem "other")) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "wrong source system rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "missing-source" -Total 1; $bad.PSObject.Properties.Remove("source_system"); Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "missing source system rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "bad-items" -Total 1; $bad.items = [PSCustomObject]@{}; Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "non-array items rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "bad-payments" -Total 1; $bad.payments = [PSCustomObject]@{}; Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "non-array payments rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "missing-canonical" -Total 1; $bad.PSObject.Properties.Remove("canonical_record"); Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "missing canonical record rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "null-canonical" -Total 1; $bad.canonical_record = $null; Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "null canonical record rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "false-canonical" -Total 1; $bad.canonical_record = $false; Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "false canonical record rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "object-canonical" -Total 1; $bad.canonical_record = [PSCustomObject]@{ verified = $true }; Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "object canonical record rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "string-canonical" -Total 1; $bad.canonical_record = "true"; Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "string canonical record rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "number-canonical" -Total 1; $bad.canonical_record = 1; Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "numeric canonical record rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestRecord -SourceUniqueId "array-canonical" -Total 1; $bad.canonical_record = [object[]]@($true, $false); Assert-FinalizedBusinessDayRecords -Records @($bad) -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" } -Message "array canonical record rejected"

    $ordered = Invoke-UploaderMocked -Records @($recordA, $recordB) -Name "ordered" -Transport {
        param($Body, $Attempt, $Json)
        if ($Body.action -eq "prepare") { return [PSCustomObject]@{ ok = $true; expected_record_count = 2; record_hash_count = 2; final_source_set_hash = "a" * 64 } }
        if ($Body.action -eq "begin") { return [PSCustomObject]@{ ok = $true; finalization_id = "11111111-1111-4111-8111-111111111111"; import_id = "22222222-2222-4222-8222-222222222222"; status = "uploading"; already_finalized = $false } }
        if ($Body.action -eq "stage") {
            Assert-Equal -Actual ([string]$Body.payload_hash).Length -Expected 64 -Message "stage includes payload_hash"
            Assert-Equal -Actual $Body.final_source_set_hash -Expected ("a" * 64) -Message "stage includes authoritative final_source_set_hash"
            return [PSCustomObject]@{ ok = $true; finalization_id = "11111111-1111-4111-8111-111111111111"; batch_number = $Body.batch_number; received_record_count = $Body.batch_number }
        }
        if ($Body.action -eq "finalize") { return [PSCustomObject]@{ ok = $true; finalization_id = "11111111-1111-4111-8111-111111111111"; finalized = $true; already_finalized = $false; status = "finalized"; inserted_count = 2; updated_count = 0; unchanged_count = 0; superseded_record_count = 0; final_record_count = 2 } }
        throw "unexpected action"
    } -BatchSize 1
    Assert-Equal -Actual $ordered.ExitCode -Expected 0 -Message "mocked finalized flow exit code"
    Assert-Equal -Actual $ordered.Result.status -Expected "finalized" -Message "mocked finalized flow status"

    $global:StorePulsePhase2Actions = @()
    $already = Invoke-UploaderMocked -Records @($recordA, $recordB) -Name "already" -Transport {
        param($Body, $Attempt, $Json)
        $global:StorePulsePhase2Actions += $Body.action
        if ($Body.action -eq "prepare") { return [PSCustomObject]@{ ok = $true; expected_record_count = 2; record_hash_count = 2; final_source_set_hash = "b" * 64 } }
        if ($Body.action -eq "begin") { return [PSCustomObject]@{ ok = $true; finalization_id = "11111111-1111-4111-8111-111111111111"; import_id = "22222222-2222-4222-8222-222222222222"; status = "already_finalized"; already_finalized = $true; payload_hash = "c" * 64; final_source_set_hash = "b" * 64 } }
        throw "already finalized should not call $($Body.action)"
    } -BatchSize 1
    Assert-Equal -Actual $already.Result.status -Expected "already_finalized" -Message "already_finalized result status"
    Assert-Equal -Actual (($global:StorePulsePhase2Actions -join ",")) -Expected "prepare,begin" -Message "already_finalized skips stage and finalize"

    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "count-mismatch" -Transport { param($Body,$Attempt,$Json) [PSCustomObject]@{ ok = $true; expected_record_count = 2; record_hash_count = 1; final_source_set_hash = "d" * 64 } } | Out-Null } -Message "prepare count mismatch rejected"
    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "missing-hash" -Transport { param($Body,$Attempt,$Json) [PSCustomObject]@{ ok = $true; expected_record_count = 1; record_hash_count = 1 } } | Out-Null } -Message "prepare missing authoritative hash rejected"
    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "skipped" -Transport { param($Body,$Attempt,$Json) [PSCustomObject]@{ ok = $true; skipped = $true } } | Out-Null } -Message "skipped response rejected through uploader"
    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "ignored" -Transport { param($Body,$Attempt,$Json) [PSCustomObject]@{ ok = $true; ignored = $true } } | Out-Null } -Message "ignored response rejected through uploader"
    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "text-response" -Transport { param($Body,$Attempt,$Json) "not-json" } | Out-Null } -Message "non-object response text rejected"
    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "empty-response" -Transport { param($Body,$Attempt,$Json) $null } | Out-Null } -Message "empty response rejected"
    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "missing-fields" -Transport { param($Body,$Attempt,$Json) [PSCustomObject]@{ ok = $true } } | Out-Null } -Message "response missing required fields rejected"
    Assert-Throws -ScriptBlock { Invoke-UploaderMocked -Records @($recordA) -Name "unexpected-status" -Transport {
        param($Body,$Attempt,$Json)
        if ($Body.action -eq "prepare") { return [PSCustomObject]@{ ok = $true; expected_record_count = 1; record_hash_count = 1; final_source_set_hash = "e" * 64 } }
        if ($Body.action -eq "begin") { return [PSCustomObject]@{ ok = $true; finalization_id = "11111111-1111-4111-8111-111111111111"; status = "uploaded"; already_finalized = $true; payload_hash = "f" * 64; final_source_set_hash = "e" * 64 } }
        throw "unexpected action"
    } | Out-Null } -Message "unexpected already_finalized status rejected"

    Assert-True -Condition (Test-RetryableStatus -StatusCode 408) -Message "HTTP 408 retryable"
    Assert-True -Condition (Test-RetryableStatus -StatusCode 429) -Message "HTTP 429 retryable"
    Assert-True -Condition (Test-RetryableStatus -StatusCode 500) -Message "HTTP 5xx retryable"
    Assert-True -Condition (-not (Test-RetryableStatus -StatusCode 409)) -Message "HTTP 409 not retryable"

    Assert-ResponseOk -Response ([PSCustomObject]@{ ok = $true }) -Action "mock"
    $global:StorePulsePhase2PassCount += 1
    Assert-Throws -ScriptBlock { Assert-ResponseOk -Response ([PSCustomObject]@{ ok = $true; skipped = $true }) -Action "mock" } -Message "skipped response helper rejected"
    Assert-Throws -ScriptBlock { Assert-ResponseOk -Response ([PSCustomObject]@{ ok = $true; ignored = $true }) -Action "mock" } -Message "ignored response helper rejected"
    Assert-Throws -ScriptBlock { Assert-FinalizationId -Response ([PSCustomObject]@{ finalization_id = "b" }) -Expected "a" -Action "mock" } -Message "finalization ID mismatch rejected"

    foreach ($status in @("finalized", "already_finalized")) {
        Assert-Equal -Actual (Assert-StorePulseSuccessfulFinalizationResult -Result ([PSCustomObject]@{ status = $status })) -Expected $status -Message "$status accepted for archive"
    }
    foreach ($status in @("skipped", "ignored", "partial", "uploading", "uploaded", "failed", "unknown", "")) {
        Assert-Throws -ScriptBlock { Assert-StorePulseSuccessfulFinalizationResult -Result ([PSCustomObject]@{ status = $status }) | Out-Null } -Message "$status rejected for archive"
    }

    $archiveRoot = Join-Path $tempRoot "archive"
    $archiveFiles = @()
    foreach ($name in @("source.xml", "normalized.json", "manifest.json", "result.json", "reconciliation.json")) {
        $path = Join-Path $tempRoot $name
        Set-Content -LiteralPath $path -Value ("content-" + $name) -Encoding UTF8
        $archiveFiles += $path
    }
    $archiveDestination = Copy-ToArchive -ArchiveRoot $archiveRoot -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" -PeriodNumber "123" -Paths $archiveFiles
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $archiveDestination "archive-verification.json") -PathType Leaf) -Message "archive verification manifest written"
    Assert-Equal -Actual (Copy-ToArchive -ArchiveRoot $archiveRoot -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" -PeriodNumber "123" -Paths $archiveFiles) -Expected $archiveDestination -Message "identical archive collision accepted"
    Set-Content -LiteralPath $archiveFiles[1] -Value "different" -Encoding UTF8
    Assert-Throws -ScriptBlock { Copy-ToArchive -ArchiveRoot $archiveRoot -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" -PeriodNumber "123" -Paths $archiveFiles | Out-Null } -Message "conflicting archive collision rejected"

    $incompleteRoot = Join-Path $tempRoot "incomplete-archive"
    $incompleteDestination = Copy-ToArchive -ArchiveRoot $incompleteRoot -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" -PeriodNumber "123" -Paths $archiveFiles
    Remove-Item -LiteralPath (Join-Path $incompleteDestination "archive-verification.json")
    Assert-Throws -ScriptBlock { Copy-ToArchive -ArchiveRoot $incompleteRoot -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" -PeriodNumber "123" -Paths $archiveFiles | Out-Null } -Message "incomplete archive rejected"

    Assert-Throws -ScriptBlock { Copy-ToArchive -ArchiveRoot $archiveRoot -SourceStoreNumber ".." -BusinessDate "2026-01-05" -PeriodNumber "123" -Paths $archiveFiles | Out-Null } -Message "unsafe archive store rejected"
    Assert-Throws -ScriptBlock { Copy-ToArchive -ArchiveRoot $archiveRoot -SourceStoreNumber "SYNTH" -BusinessDate "2026/01/05" -PeriodNumber "123" -Paths $archiveFiles | Out-Null } -Message "unsafe archive business date rejected"
    Assert-Throws -ScriptBlock { Copy-ToArchive -ArchiveRoot $archiveRoot -SourceStoreNumber "SYNTH" -BusinessDate "2026-01-05" -PeriodNumber "abc" -Paths $archiveFiles | Out-Null } -Message "unsafe archive period rejected"

    Assert-True -Condition ($already.ResultText -notmatch "test-token-value-that-is-long-enough") -Message "result JSON excludes connector token"
    Assert-True -Condition ($already.ResultText -notmatch "Authorization") -Message "result JSON excludes authorization header"

    $normalizerFailure = New-RunnerFixture -Name "normalizer-failure"
    $badNormalizer = New-MockNormalizerScript -Directory $normalizerFailure.Directory -Name "bad-normalizer" -ExitCode 17
    $markerUploader = New-MockUploaderScript -Directory $normalizerFailure.Directory -Name "marker-uploader" -ExitCode 0 -MarkerPath $normalizerFailure.Marker
    $normalizerFailureResult = Invoke-RunnerSynthetic -Fixture $normalizerFailure -NormalizerPath $badNormalizer -UploaderPath $markerUploader
    Assert-True -Condition ($normalizerFailureResult.ExitCode -ne 0) -Message "runner fails when normalizer exits nonzero"
    Assert-True -Condition ((($normalizerFailureResult.Log + $normalizerFailureResult.ErrorText) -match "Normalizer exited with code 17")) -Message "runner reports normalizer exit code"
    Assert-True -Condition (-not (Test-Path -LiteralPath $normalizerFailure.Marker)) -Message "uploader not invoked after normalizer failure"
    Assert-Equal -Actual $normalizerFailureResult.ArchiveFiles.Count -Expected 0 -Message "normalizer failure creates no archive"
    Assert-True -Condition ($normalizerFailureResult.WorkFiles.Count -ge 2) -Message "normalizer failure retains run evidence"

    $uploaderFailure = New-RunnerFixture -Name "uploader-failure"
    $goodNormalizer = New-MockNormalizerScript -Directory $uploaderFailure.Directory -Name "good-normalizer" -ExitCode 0
    $badUploader = New-MockUploaderScript -Directory $uploaderFailure.Directory -Name "bad-uploader" -ExitCode 23 -Status "failed" -MarkerPath $uploaderFailure.Marker
    $uploaderFailureResult = Invoke-RunnerSynthetic -Fixture $uploaderFailure -NormalizerPath $goodNormalizer -UploaderPath $badUploader
    Assert-True -Condition ($uploaderFailureResult.ExitCode -ne 0) -Message "runner fails when uploader exits nonzero"
    Assert-True -Condition ((($uploaderFailureResult.Log + $uploaderFailureResult.ErrorText) -match "Finalization uploader exited with code 23")) -Message "runner reports uploader exit code"
    Assert-True -Condition (Test-Path -LiteralPath $uploaderFailure.Marker) -Message "uploader failure test invoked uploader"
    Assert-Equal -Actual $uploaderFailureResult.ArchiveFiles.Count -Expected 0 -Message "uploader failure creates no archive"
    Assert-True -Condition (@($uploaderFailureResult.WorkFiles | Where-Object { $_.Name -like "*.xml" }).Count -ge 1) -Message "uploader failure retains source XML"
    Assert-True -Condition (@($uploaderFailureResult.WorkFiles | Where-Object { $_.Name -like "*.normalized.json" }).Count -eq 1) -Message "uploader failure retains normalized JSON"
    Assert-True -Condition (@($uploaderFailureResult.WorkFiles | Where-Object { $_.Name -like "*.manifest.json" }).Count -eq 1) -Message "uploader failure retains manifest JSON"

    $dryRunFixture = New-RunnerFixture -Name "dryrun"
    $dryRunNormalizer = New-MockNormalizerScript -Directory $dryRunFixture.Directory -Name "dryrun-normalizer" -ExitCode 0
    $dryRunUploader = $uploaderPath
    $dryRunResult = Invoke-RunnerSynthetic -Fixture $dryRunFixture -NormalizerPath $dryRunNormalizer -UploaderPath $dryRunUploader -DryRun
    Assert-Equal -Actual $dryRunResult.ExitCode -Expected 0 -Message "DryRun runner exits successfully"
    Assert-True -Condition ($dryRunResult.Log -match "DryRun complete") -Message "DryRun main flow reports dry run"
    Assert-Equal -Actual $dryRunResult.ArchiveFiles.Count -Expected 0 -Message "DryRun creates no archive"
    Assert-True -Condition (@($dryRunResult.WorkFiles | Where-Object { $_.Name -like "*.normalized.json" }).Count -eq 1) -Message "DryRun normalizes into run directory"
    Assert-True -Condition (@($dryRunResult.WorkFiles | Where-Object { $_.Name -like "*.finalization-result.json" }).Count -eq 1) -Message "DryRun writes local result"
    $dryRunResultFile = @($dryRunResult.WorkFiles | Where-Object { $_.Name -like "*.finalization-result.json" } | Select-Object -First 1)[0].FullName
    $dryRunResultJson = Get-Content -LiteralPath $dryRunResultFile -Raw | ConvertFrom-Json
    Assert-True -Condition ($dryRunResultJson.dry_run -eq $true) -Message "DryRun result records dry_run=true"

    $fetchOnlyFixture = New-RunnerFixture -Name "fetchonly"
    $fetchOnlyNormalizer = New-MockNormalizerScript -Directory $fetchOnlyFixture.Directory -Name "fetchonly-normalizer" -ExitCode 0
    $fetchOnlyUploader = New-MockUploaderScript -Directory $fetchOnlyFixture.Directory -Name "fetchonly-uploader" -ExitCode 0 -MarkerPath $fetchOnlyFixture.Marker
    $fetchOnlyResult = Invoke-RunnerSynthetic -Fixture $fetchOnlyFixture -NormalizerPath $fetchOnlyNormalizer -UploaderPath $fetchOnlyUploader -FetchOnly
    Assert-Equal -Actual $fetchOnlyResult.ExitCode -Expected 0 -Message "FetchOnly runner exits successfully"
    Assert-True -Condition ($fetchOnlyResult.Log -match "FetchOnly complete") -Message "FetchOnly main flow reports fetch only"
    Assert-True -Condition (@($fetchOnlyResult.WorkFiles | Where-Object { $_.Name -like "*.xml" }).Count -eq 1) -Message "FetchOnly saves source XML"
    Assert-True -Condition (@($fetchOnlyResult.WorkFiles | Where-Object { $_.Name -like "*.normalized.json" }).Count -eq 0) -Message "FetchOnly does not normalize"
    Assert-True -Condition (-not (Test-Path -LiteralPath $fetchOnlyFixture.Marker)) -Message "FetchOnly does not invoke uploader"
    Assert-Equal -Actual $fetchOnlyResult.ArchiveFiles.Count -Expected 0 -Message "FetchOnly creates no archive"

    Write-Host ("PASS: Phase 2 finalized business-day tests passed ({0} assertions)." -f $global:StorePulsePhase2PassCount)
}
finally {
    [Environment]::SetEnvironmentVariable("STOREPULSE_PHASE2_DOT_SOURCE_ONLY", $previousDotSource, "Process")
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($global:StorePulsePhase2Failures.Count -gt 0) {
    Write-Host "FAIL: Phase 2 finalized business-day tests failed."
    foreach ($failure in $global:StorePulsePhase2Failures) { Write-Host (" - {0}" -f $failure) }
    exit 1
}
