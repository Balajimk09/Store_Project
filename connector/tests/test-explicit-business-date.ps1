[CmdletBinding()]
param(
    [string]$FixtureRoot = "$env:USERPROFILE\StorePulse-Fixtures\business-date"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$normalizerPath = Join-Path $repoRoot "connector\storepulse-normalize-transactions.ps1"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("storepulse-business-date-test-{0}" -f ([guid]::NewGuid().ToString("N")))

$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure {
    param([string]$Message)
    $script:failures.Add($Message) | Out-Null
    Write-Host ("FAIL: {0}" -f $Message) -ForegroundColor Red
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        Add-Failure -Message $Message
    }
}

function Assert-Equal {
    param(
        [AllowNull()]$Actual,
        [AllowNull()]$Expected,
        [string]$Message
    )

    if ($Actual -ne $Expected) {
        Add-Failure -Message ("{0} Expected '{1}', got '{2}'." -f $Message, $Expected, $Actual)
    }
}

function Assert-MoneyEqual {
    param(
        [AllowNull()]$Actual,
        [decimal]$Expected,
        [string]$Message
    )

    $actualMoney = [math]::Round([decimal]$Actual, 2, [System.MidpointRounding]::AwayFromZero)
    if ($actualMoney -ne $Expected) {
        Add-Failure -Message ("{0} Expected '{1}', got '{2}'." -f $Message, $Expected, $actualMoney)
    }
}

function Read-JsonArray {
    param([string]$Path)

    $raw = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    return ($raw | ConvertFrom-Json)
}

function Read-JsonObject {
    param([string]$Path)

    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Invoke-Normalizer {
    param(
        [string]$XmlPath,
        [string]$OutputPath,
        [string]$ReconciliationPath,
        [string]$BusinessDate = ""
    )

    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $normalizerPath,
        "-XmlPath", $XmlPath,
        "-OutputPath", $OutputPath,
        "-ReconciliationPath", $ReconciliationPath
    )

    if (-not [string]::IsNullOrWhiteSpace($BusinessDate)) {
        $arguments += @("-BusinessDate", $BusinessDate)
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & powershell.exe @arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Test-DayFixture {
    param(
        [string]$DayName,
        [string]$SourceFile,
        [string]$BusinessDate,
        [int]$ExpectedCount,
        [string[]]$RolloverSourceIds,
        [hashtable]$ExpectedReconciliation
    )

    $outputPath = Join-Path $tempRoot "$DayName-normalized.json"
    $reconciliationPath = Join-Path $tempRoot "$DayName-reconciliation.json"
    $result = Invoke-Normalizer `
        -XmlPath (Join-Path $FixtureRoot $SourceFile) `
        -OutputPath $outputPath `
        -ReconciliationPath $reconciliationPath `
        -BusinessDate $BusinessDate

    Assert-Equal -Actual $result.ExitCode -Expected 0 -Message "$DayName normalizer exit code."
    Assert-True -Condition (Test-Path -LiteralPath $outputPath) -Message "$DayName normalized output was created."
    Assert-True -Condition (Test-Path -LiteralPath $reconciliationPath) -Message "$DayName reconciliation output was created."

    if (-not (Test-Path -LiteralPath $outputPath)) { return }
    if (-not (Test-Path -LiteralPath $reconciliationPath)) { return }

    $records = @(Read-JsonArray -Path $outputPath)
    $reconciliation = Read-JsonObject -Path $reconciliationPath

    Assert-Equal -Actual $records.Count -Expected $ExpectedCount -Message "$DayName canonical record count."
    Assert-True -Condition (@($records | Where-Object { $_.business_date -ne $BusinessDate }).Count -eq 0) -Message "$DayName every transaction has business_date $BusinessDate."
    Assert-True -Condition (@($records | Where-Object { [string]::IsNullOrWhiteSpace($_.source_unique_id) }).Count -eq 0) -Message "$DayName has no missing source_unique_id values."
    Assert-True -Condition (@($records | Group-Object source_unique_id | Where-Object { $_.Count -gt 1 }).Count -eq 0) -Message "$DayName has no duplicate source_unique_id values."
    Assert-True -Condition (@($records | Where-Object { [string]::IsNullOrWhiteSpace($_.transaction_type) }).Count -eq 0) -Message "$DayName has no blank transaction_type values."

    foreach ($sourceId in $RolloverSourceIds) {
        $rollover = @($records | Where-Object { $_.source_unique_id -eq $sourceId })
        Assert-Equal -Actual $rollover.Count -Expected 1 -Message "$DayName rollover source ID $sourceId exists once."
        if ($rollover.Count -eq 1) {
            Assert-Equal -Actual $rollover[0].business_date -Expected $BusinessDate -Message "$DayName rollover source ID $sourceId business_date."
        }
    }

    foreach ($key in $ExpectedReconciliation.Keys) {
        $actual = $reconciliation.$key
        $expected = $ExpectedReconciliation[$key]
        if ($expected -is [decimal]) {
            if ($key -eq "refund_total") {
                $actual = [math]::Abs([decimal]$actual)
            }
            Assert-MoneyEqual -Actual $actual -Expected $expected -Message "$DayName reconciliation $key."
        }
        else {
            Assert-Equal -Actual $actual -Expected $expected -Message "$DayName reconciliation $key."
        }
    }
}

function Test-OmittedBusinessDate {
    $outputPath = Join-Path $tempRoot "omitted-business-date-normalized.json"
    $reconciliationPath = Join-Path $tempRoot "omitted-business-date-reconciliation.json"
    $result = Invoke-Normalizer `
        -XmlPath (Join-Path $FixtureRoot "day-733-source.xml") `
        -OutputPath $outputPath `
        -ReconciliationPath $reconciliationPath

    Assert-Equal -Actual $result.ExitCode -Expected 0 -Message "Omitted BusinessDate normalizer exit code."
    if (-not (Test-Path -LiteralPath $outputPath)) { return }

    $records = @(Read-JsonArray -Path $outputPath)
    $withBusinessDate = @(
        $records |
        Where-Object {
            $_.PSObject.Properties.Name -contains "business_date" -and
            -not [string]::IsNullOrWhiteSpace([string]$_.business_date)
        }
    )

    Assert-Equal -Actual $withBusinessDate.Count -Expected 0 -Message "Omitted BusinessDate does not emit nonblank business_date."
}

function Test-InvalidBusinessDate {
    param([string]$BusinessDate)

    $safeName = $BusinessDate -replace '[^0-9A-Za-z-]', '_'
    $outputPath = Join-Path $tempRoot "invalid-$safeName-normalized.json"
    $reconciliationPath = Join-Path $tempRoot "invalid-$safeName-reconciliation.json"
    $result = Invoke-Normalizer `
        -XmlPath (Join-Path $FixtureRoot "day-733-source.xml") `
        -OutputPath $outputPath `
        -ReconciliationPath $reconciliationPath `
        -BusinessDate $BusinessDate

    Assert-True -Condition ($result.ExitCode -ne 0) -Message "Invalid BusinessDate '$BusinessDate' exits unsuccessfully."
    Assert-True -Condition (-not (Test-Path -LiteralPath $outputPath)) -Message "Invalid BusinessDate '$BusinessDate' does not produce normalized output."
}

try {
    $requiredFiles = @(
        "day-733-source.xml",
        "day-733-normalized.json",
        "day-733-reconciliation.json",
        "day-734-source.xml",
        "day-734-normalized.json",
        "day-734-reconciliation.json",
        "storepulse-normalize-transactions.ps1",
        "README.txt",
        "manifest.csv"
    )

    Assert-True -Condition (Test-Path -LiteralPath $normalizerPath) -Message "Repository normalizer exists."
    foreach ($file in $requiredFiles) {
        Assert-True -Condition (Test-Path -LiteralPath (Join-Path $FixtureRoot $file)) -Message "Fixture file exists: $file."
    }

    if ($failures.Count -eq 0) {
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

        Test-DayFixture `
            -DayName "day-733" `
            -SourceFile "day-733-source.xml" `
            -BusinessDate "2026-07-09" `
            -ExpectedCount 396 `
            -RolloverSourceIds @("1729916791000-660300915-0004321103") `
            -ExpectedReconciliation @{
                gross_sales = [decimal]6958.90
                net_sales = [decimal]6958.90
                net_tax = [decimal]105.04
                safe_drop_count = 4
                safe_drop_amount = [decimal]2076.00
            }

        Test-DayFixture `
            -DayName "day-734" `
            -SourceFile "day-734-source.xml" `
            -BusinessDate "2026-07-10" `
            -ExpectedCount 507 `
            -RolloverSourceIds @(
                "1729916791000-660300915-0004324093",
                "1729916791000-660300915-0004324098",
                "1729916791000-660300915-0004324101",
                "1729916791000-660300915-0004324104"
            ) `
            -ExpectedReconciliation @{
                gross_sales = [decimal]8505.17
                refund_total = [decimal]1.73
                net_sales = [decimal]8503.44
                net_tax = [decimal]139.54
                paid_out_count = 4
                paid_out_amount = [decimal]1643.00
                safe_drop_count = 3
                safe_drop_amount = [decimal]236.01
            }

        Test-OmittedBusinessDate
        Test-InvalidBusinessDate -BusinessDate "07/09/2026"
        Test-InvalidBusinessDate -BusinessDate "2026-02-30"
    }
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host ("FAIL: {0} assertion(s) failed." -f $failures.Count) -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "PASS: explicit business-date regression checks passed." -ForegroundColor Green
exit 0
