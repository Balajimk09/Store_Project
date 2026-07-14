[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$serviceRoot = Join-Path $repoRoot "connector\service"
$helperPath = Join-Path $serviceRoot "prepare-storepulse-verifone-runtime.ps1"
$tempRoot = Join-Path ([IO.Path]::GetPathRoot($env:TEMP)) ("StorePulseVerifoneRuntimeTests-" + [guid]::NewGuid().ToString("N"))
$global:VerifoneRuntimeFailures = New-Object System.Collections.Generic.List[string]
$global:VerifoneRuntimePassCount = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { $global:VerifoneRuntimePassCount += 1 } else { $global:VerifoneRuntimeFailures.Add($Message) }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -eq $Expected) { $global:VerifoneRuntimePassCount += 1 } else { $global:VerifoneRuntimeFailures.Add("$Message Expected=[$Expected] Actual=[$Actual]") }
}

function Assert-Throws {
    param([scriptblock]$ScriptBlock, [string]$Message)
    try {
        & $ScriptBlock
        $global:VerifoneRuntimeFailures.Add("$Message Expected exception.")
    }
    catch {
        $global:VerifoneRuntimePassCount += 1
    }
}

function New-SyntheticSmtCommon {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [string]$Content = "synthetic smtcommon"
    )
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    $path = Join-Path $Directory "SMTCommon.dll"
    Set-Content -LiteralPath $path -Value $Content -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Directory "SMTCommon.pdb") -Value "debug" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Directory "ReportNavigator.exe") -Value "exe" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Directory "TransactionManager.exe") -Value "exe" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Directory "manual.pdf") -Value "pdf" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Directory "C1.Win.C1Input.dll") -Value "ui" -Encoding UTF8
    return $path
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    Assert-True -Condition (Test-Path -LiteralPath $helperPath -PathType Leaf) -Message "Verifone runtime helper exists"
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$tokens, [ref]$errors)
    Assert-Equal -Actual $errors.Count -Expected 0 -Message "Verifone runtime helper parses"

    . $helperPath

    $validator = {
        param([string]$DllPath)
        [PSCustomObject]@{
            ok = $true
            assembly_full_name = "Synthetic.SMTCommon, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"
            validated_type = "SMTCommon.clsHTTPConnection"
            validation_status = "ok"
            dll_path = $DllPath
        }
    }

    Assert-Throws -ScriptBlock { Invoke-StorePulseVerifoneSourceValidation -SourceDllPath (Join-Path $tempRoot "missing\SMTCommon.dll") -Validator $validator | Out-Null } -Message "ValidateSource rejects missing source"
    $wrongNameDir = Join-Path $tempRoot "wrong-name"
    New-Item -ItemType Directory -Path $wrongNameDir -Force | Out-Null
    $wrongName = Join-Path $wrongNameDir "NotSMTCommon.dll"
    Set-Content -LiteralPath $wrongName -Value "dll" -Encoding UTF8
    Assert-Throws -ScriptBlock { Invoke-StorePulseVerifoneSourceValidation -SourceDllPath $wrongName -Validator $validator | Out-Null } -Message "ValidateSource rejects source not named SMTCommon.dll"

    Assert-Throws -ScriptBlock { Test-StorePulseMachineOwnedDestination -DestinationRoot "relative\VerifoneRuntime" | Out-Null } -Message "destination rejects relative paths"
    Assert-Throws -ScriptBlock { Test-StorePulseMachineOwnedDestination -DestinationRoot "C:\Users\SomeUser\VerifoneRuntime" | Out-Null } -Message "destination rejects C:\Users paths"
    Assert-Throws -ScriptBlock { Test-StorePulseMachineOwnedDestination -DestinationRoot "C:\StorePulse\OneDrive\VerifoneRuntime" | Out-Null } -Message "destination rejects OneDrive paths"
    Assert-Throws -ScriptBlock { Test-StorePulseMachineOwnedDestination -DestinationRoot "C:\StorePulse\Desktop\VerifoneRuntime" | Out-Null } -Message "destination rejects Desktop paths"
    Assert-Equal -Actual (Test-StorePulseMachineOwnedDestination -DestinationRoot "C:\Program Files\StorePulse\VerifoneRuntime") -Expected "C:\Program Files\StorePulse\VerifoneRuntime" -Message "Program Files-style destination accepted"

    $sourceDir = Join-Path $tempRoot "source"
    $sourceDll = New-SyntheticSmtCommon -Directory $sourceDir -Content "synthetic-source-v1"
    $sourceHash = (Get-FileHash -LiteralPath $sourceDll -Algorithm SHA256).Hash.ToUpperInvariant()
    $destinationRoot = Join-Path $tempRoot "MachineOwned\VerifoneRuntime"

    $sourceResult = Invoke-StorePulseVerifoneSourceValidation -SourceDllPath $sourceDll -Validator $validator
    Assert-True -Condition ([bool]$sourceResult.ok) -Message "ValidateSource succeeds with injected validator"
    Assert-Equal -Actual $sourceResult.validated_type -Expected "SMTCommon.clsHTTPConnection" -Message "ValidateSource reports validated type"

    $installResult = Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $destinationRoot -Validator $validator -SkipElevationCheck
    Assert-True -Condition ([bool]$installResult.ok) -Message "Install succeeds with synthetic SMTCommon"
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $destinationRoot "SMTCommon.dll") -PathType Leaf) -Message "Install copies SMTCommon.dll"
    foreach ($forbiddenName in @("SMTCommon.pdb", "ReportNavigator.exe", "TransactionManager.exe", "manual.pdf", "C1.Win.C1Input.dll")) {
        Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $destinationRoot $forbiddenName))) -Message "Install does not copy $forbiddenName"
    }
    $destinationHash = (Get-FileHash -LiteralPath (Join-Path $destinationRoot "SMTCommon.dll") -Algorithm SHA256).Hash.ToUpperInvariant()
    Assert-Equal -Actual $destinationHash -Expected $sourceHash -Message "destination hash equals source hash"

    $idempotentResult = Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $destinationRoot -Validator $validator -SkipElevationCheck
    Assert-Equal -Actual $idempotentResult.status -Expected "already_installed" -Message "same-hash reinstall is idempotent"

    $differentSourceDir = Join-Path $tempRoot "source-v2"
    $differentSource = New-SyntheticSmtCommon -Directory $differentSourceDir -Content "synthetic-source-v2"
    Assert-Throws -ScriptBlock { Install-StorePulseVerifoneRuntime -SourceDllPath $differentSource -DestinationRoot $destinationRoot -Validator $validator -SkipElevationCheck | Out-Null } -Message "different-hash reinstall fails without Force"

    $forcedResult = Install-StorePulseVerifoneRuntime -SourceDllPath $differentSource -DestinationRoot $destinationRoot -Validator $validator -SkipElevationCheck -Force
    Assert-True -Condition ([bool]$forcedResult.ok) -Message "different-hash reinstall with Force succeeds"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($forcedResult.backup_path) -and (Test-Path -LiteralPath $forcedResult.backup_path -PathType Leaf)) -Message "Force replacement creates backup"
    $newDestinationHash = (Get-FileHash -LiteralPath (Join-Path $destinationRoot "SMTCommon.dll") -Algorithm SHA256).Hash.ToUpperInvariant()
    $newSourceHash = (Get-FileHash -LiteralPath $differentSource -Algorithm SHA256).Hash.ToUpperInvariant()
    Assert-Equal -Actual $newDestinationHash -Expected $newSourceHash -Message "Force replacement updates destination DLL"

    $manifestPath = Join-Path $destinationRoot "storepulse-verifone-runtime.json"
    Assert-True -Condition (Test-Path -LiteralPath $manifestPath -PathType Leaf) -Message "runtime manifest is written"
    $manifestText = Get-Content -LiteralPath $manifestPath -Raw
    $manifest = $manifestText | ConvertFrom-Json
    Assert-True -Condition ($manifestText -notmatch [regex]::Escape($sourceDir)) -Message "manifest contains no source user-profile path"
    Assert-Equal -Actual $manifest.source_filename -Expected "SMTCommon.dll" -Message "manifest records source filename only"
    Assert-Equal -Actual $manifest.destination_sha256 -Expected $newSourceHash -Message "manifest records destination SHA"
    Assert-True -Condition ([int64]$manifest.file_length -gt 0) -Message "manifest records file length"
    Assert-Equal -Actual $manifest.destination_root -Expected $destinationRoot -Message "manifest records destination root"
    Assert-Equal -Actual $manifest.validation_status -Expected "ok" -Message "manifest records validation status"

    $installedResult = Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $destinationRoot -Validator $validator
    Assert-True -Condition ([bool]$installedResult.ok) -Message "ValidateInstalled succeeds for valid synthetic installation"

    $mismatchRoot = Join-Path $tempRoot "hash-mismatch"
    Copy-Item -LiteralPath $destinationRoot -Destination $mismatchRoot -Recurse
    Set-Content -LiteralPath (Join-Path $mismatchRoot "SMTCommon.dll") -Value "tampered" -Encoding UTF8
    Assert-Throws -ScriptBlock { Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $mismatchRoot -Validator $validator | Out-Null } -Message "ValidateInstalled detects DLL hash mismatch"

    $missingManifestRoot = Join-Path $tempRoot "missing-manifest"
    Copy-Item -LiteralPath $destinationRoot -Destination $missingManifestRoot -Recurse
    Remove-Item -LiteralPath (Join-Path $missingManifestRoot "storepulse-verifone-runtime.json") -Force
    Assert-Throws -ScriptBlock { Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $missingManifestRoot -Validator $validator | Out-Null } -Message "ValidateInstalled detects missing manifest"

    $helperSource = Get-Content -LiteralPath $helperPath -Raw
    Assert-True -Condition ($helperSource -notmatch 'C:\\Users\\ABC') -Message "helper contains no literal ABC path"
    Assert-True -Condition ($helperSource -notmatch 'AppData\\Local\\Programs\\Verifone') -Message "helper contains no hard-coded Verifone source profile"
    foreach ($forbidden in @("GetData", "commander_password", "connector_token", "SUPABASE", "Register-ScheduledTask", "New-Service", "sc.exe create")) {
        Assert-True -Condition ($helperSource -notmatch [regex]::Escape($forbidden)) -Message "helper source excludes forbidden operation: $forbidden"
    }

    if ($global:VerifoneRuntimeFailures.Count -gt 0) {
        $global:VerifoneRuntimeFailures | ForEach-Object { Write-Host "FAIL: $_" }
        throw "machine-wide Verifone runtime tests failed ($($global:VerifoneRuntimeFailures.Count) failures)."
    }

    Write-Host "PASS: machine-wide Verifone runtime tests passed ($global:VerifoneRuntimePassCount assertions)."
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
