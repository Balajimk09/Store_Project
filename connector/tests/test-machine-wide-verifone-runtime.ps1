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
    $aclState = [ordered]@{
        apply_count = 0
        apply_paths = @()
        apply_commands = @()
        apply_should_fail = $false
        fail_secure_acl_target = ""
        validate_result = $true
    }
    $aclApplier = {
        param([string]$TargetPath, [string[]]$Arguments)
        $aclState.apply_count += 1
        $aclState.apply_paths += $TargetPath
        $aclState.apply_commands += [PSCustomObject]@{
            target = $TargetPath
            arguments = @($Arguments)
            text = (@($Arguments) -join " ")
        }
        if ($aclState.apply_should_fail) { throw "synthetic ACL apply failure" }
        if (-not [string]::IsNullOrWhiteSpace($aclState.fail_secure_acl_target) -and
            $TargetPath.EndsWith($aclState.fail_secure_acl_target, [StringComparison]::OrdinalIgnoreCase) -and
            (@($Arguments) -contains "/inheritance:r")) {
            $aclState.fail_secure_acl_target = ""
            throw "synthetic child ACL failure"
        }
        return 0
    }
    $aclValidator = {
        param([string]$DestinationRoot)
        return [bool]$aclState.validate_result
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

    $installResult = Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $destinationRoot -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck
    Assert-True -Condition ([bool]$installResult.ok) -Message "Install succeeds with synthetic SMTCommon"
    Assert-Equal -Actual $installResult.acl_validation_status -Expected "ok" -Message "successful install reports ACL validation status"
    Assert-True -Condition ([bool]$installResult.system_read_execute -and [bool]$installResult.administrators_full_control) -Message "successful install reports required ACL booleans"
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $destinationRoot "SMTCommon.dll") -PathType Leaf) -Message "Install copies SMTCommon.dll"
    foreach ($forbiddenName in @("SMTCommon.pdb", "ReportNavigator.exe", "TransactionManager.exe", "manual.pdf", "C1.Win.C1Input.dll")) {
        Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $destinationRoot $forbiddenName))) -Message "Install does not copy $forbiddenName"
    }
    $destinationHash = (Get-FileHash -LiteralPath (Join-Path $destinationRoot "SMTCommon.dll") -Algorithm SHA256).Hash.ToUpperInvariant()
    Assert-Equal -Actual $destinationHash -Expected $sourceHash -Message "destination hash equals source hash"

    $childDirectory = Join-Path $destinationRoot "nested"
    New-Item -ItemType Directory -Path $childDirectory -Force | Out-Null
    $childFile = Join-Path $childDirectory "child.txt"
    Set-Content -LiteralPath $childFile -Value "child" -Encoding UTF8
    $aclState.apply_commands = @()
    Set-StorePulseVerifoneRuntimeAcl -DestinationRoot $destinationRoot -AclApplier $aclApplier
    $combinedRecursiveCommands = @($aclState.apply_commands | Where-Object { ($_.arguments -contains "/inheritance:r") -and ($_.arguments -contains "/T") })
    Assert-Equal -Actual $combinedRecursiveCommands.Count -Expected 0 -Message "ACL commands never combine /inheritance:r with /T"
    $rootAclCommand = @($aclState.apply_commands | Where-Object { $_.target -eq $destinationRoot })[0]
    Assert-True -Condition ($rootAclCommand.text -match '\*S-1-5-18:\(OI\)\(CI\)\(RX\)' -and $rootAclCommand.text -match '\*S-1-5-32-544:\(OI\)\(CI\)\(F\)') -Message "destination folder receives explicit inheritable grants"
    $childDirectoryCommand = @($aclState.apply_commands | Where-Object { $_.target -eq $childDirectory })[0]
    Assert-True -Condition ($childDirectoryCommand.text -match '\*S-1-5-18:\(OI\)\(CI\)\(RX\)' -and $childDirectoryCommand.text -match '\*S-1-5-32-544:\(OI\)\(CI\)\(F\)') -Message "child directory receives explicit inheritable grants"
    foreach ($expectedFile in @((Join-Path $destinationRoot "SMTCommon.dll"), (Join-Path $destinationRoot "storepulse-verifone-runtime.json"), $childFile)) {
        $fileCommand = @($aclState.apply_commands | Where-Object { $_.target -eq $expectedFile })[0]
        Assert-True -Condition ($fileCommand.text -match '\*S-1-5-18:\(RX\)' -and $fileCommand.text -match '\*S-1-5-32-544:\(F\)' -and $fileCommand.text -notmatch '\(OI\)\(CI\)') -Message "child file receives explicit SYSTEM RX and Administrators F grants: $expectedFile"
    }

    $idempotentResult = Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $destinationRoot -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck
    Assert-Equal -Actual $idempotentResult.status -Expected "already_installed" -Message "same-hash reinstall is idempotent"
    $sameHashAclCommands = @($aclState.apply_commands | Where-Object { $_.target -eq (Join-Path $destinationRoot "SMTCommon.dll") -and $_.text -match '\*S-1-5-18:\(RX\)' })
    Assert-True -Condition ($sameHashAclCommands.Count -gt 0) -Message "same-hash reinstall applies explicit child file ACLs"

    $differentSourceDir = Join-Path $tempRoot "source-v2"
    $differentSource = New-SyntheticSmtCommon -Directory $differentSourceDir -Content "synthetic-source-v2"
    Assert-Throws -ScriptBlock { Install-StorePulseVerifoneRuntime -SourceDllPath $differentSource -DestinationRoot $destinationRoot -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck | Out-Null } -Message "different-hash reinstall fails without Force"

    $forcedResult = Install-StorePulseVerifoneRuntime -SourceDllPath $differentSource -DestinationRoot $destinationRoot -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck -Force
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

    $installedResult = Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $destinationRoot -Validator $validator -AclValidator $aclValidator
    Assert-True -Condition ([bool]$installedResult.ok) -Message "ValidateInstalled succeeds for valid synthetic installation"
    Assert-Equal -Actual $installedResult.acl_validation_status -Expected "ok" -Message "ValidateInstalled reports ACL validation status"

    $aclState.validate_result = $false
    Assert-Throws -ScriptBlock { Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $destinationRoot -Validator $validator -AclValidator $aclValidator | Out-Null } -Message "ValidateInstalled throws when SYSTEM access is false"
    Assert-Throws -ScriptBlock { Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $destinationRoot -Validator $validator -AclValidator $aclValidator | Out-Null } -Message "ValidateInstalled throws when Administrators Full Control is false"
    $aclState.validate_result = $true

    $mismatchRoot = Join-Path $tempRoot "hash-mismatch"
    Copy-Item -LiteralPath $destinationRoot -Destination $mismatchRoot -Recurse
    Set-Content -LiteralPath (Join-Path $mismatchRoot "SMTCommon.dll") -Value "tampered" -Encoding UTF8
    Assert-Throws -ScriptBlock { Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $mismatchRoot -Validator $validator -AclValidator $aclValidator | Out-Null } -Message "ValidateInstalled detects DLL hash mismatch"

    $missingManifestRoot = Join-Path $tempRoot "missing-manifest"
    Copy-Item -LiteralPath $destinationRoot -Destination $missingManifestRoot -Recurse
    Remove-Item -LiteralPath (Join-Path $missingManifestRoot "storepulse-verifone-runtime.json") -Force
    Assert-Throws -ScriptBlock { Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $missingManifestRoot -Validator $validator -AclValidator $aclValidator | Out-Null } -Message "ValidateInstalled detects missing manifest"

    $aclRuleRoot = Join-Path $tempRoot "acl-rule-root"
    New-Item -ItemType Directory -Path $aclRuleRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $aclRuleRoot "SMTCommon.dll") -Value "dll" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $aclRuleRoot "storepulse-verifone-runtime.json") -Value "{}" -Encoding UTF8
    $partialAclValidator = { param([string]$DestinationRoot) return $false }
    Assert-Throws -ScriptBlock { Assert-StorePulseVerifoneRuntimeAcl -DestinationRoot $aclRuleRoot -AclValidator $partialAclValidator | Out-Null } -Message "partial SYSTEM right does not satisfy ReadAndExecute"
    Assert-Throws -ScriptBlock { Assert-StorePulseVerifoneRuntimeAcl -DestinationRoot $aclRuleRoot -AclValidator $partialAclValidator | Out-Null } -Message "SYSTEM Deny rule prevents validation"
    $failedAclResult = $null
    try {
        $failedAclResult = Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $destinationRoot -Validator $validator -AclValidator $partialAclValidator
    }
    catch { }
    Assert-True -Condition ($null -eq $failedAclResult) -Message "ValidateInstalled never returns ok=true with failed ACL result"

    $freshAclFailDestination = Join-Path $tempRoot "fresh-acl-fail"
    $aclState.validate_result = $false
    Assert-Throws -ScriptBlock { Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $freshAclFailDestination -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck | Out-Null } -Message "Install fails when post-install ACL validation fails"
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $freshAclFailDestination "SMTCommon.dll"))) -Message "failed fresh install removes newly copied DLL"
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $freshAclFailDestination "storepulse-verifone-runtime.json"))) -Message "failed fresh install removes newly written manifest"
    $aclState.validate_result = $true

    $applyFailDestination = Join-Path $tempRoot "apply-fail"
    $aclState.apply_should_fail = $true
    Assert-Throws -ScriptBlock { Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $applyFailDestination -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck | Out-Null } -Message "Install fails when ACL applier fails"
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $applyFailDestination "SMTCommon.dll"))) -Message "ACL applier failure removes fresh DLL"
    $aclState.apply_should_fail = $false

    $childAclFailDestination = Join-Path $tempRoot "child-acl-fail"
    $aclState.apply_commands = @()
    $aclState.fail_secure_acl_target = "SMTCommon.dll"
    Assert-Throws -ScriptBlock { Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $childAclFailDestination -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck | Out-Null } -Message "child-file ACL application failure causes Install to fail"
    $rollbackGrantCommands = @($aclState.apply_commands | Where-Object { $_.target.EndsWith("SMTCommon.dll", [StringComparison]::OrdinalIgnoreCase) -and $_.text -match '\*S-1-5-32-544:\(F\)' -and ($_.arguments -notcontains "/inheritance:r") })
    Assert-True -Condition ($rollbackGrantCommands.Count -gt 0) -Message "rollback repairs cleanup access before deleting failed files"
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $childAclFailDestination "SMTCommon.dll"))) -Message "failed child ACL fresh install leaves no active DLL"
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $childAclFailDestination "storepulse-verifone-runtime.json"))) -Message "failed child ACL fresh install leaves no active manifest"

    $forceRollbackRoot = Join-Path $tempRoot "force-rollback"
    Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $forceRollbackRoot -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck | Out-Null
    $oldDllHash = (Get-FileHash -LiteralPath (Join-Path $forceRollbackRoot "SMTCommon.dll") -Algorithm SHA256).Hash.ToUpperInvariant()
    $oldManifestText = Get-Content -LiteralPath (Join-Path $forceRollbackRoot "storepulse-verifone-runtime.json") -Raw
    $aclState.apply_commands = @()
    $aclState.validate_result = $false
    Assert-Throws -ScriptBlock { Install-StorePulseVerifoneRuntime -SourceDllPath $differentSource -DestinationRoot $forceRollbackRoot -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck -Force | Out-Null } -Message "failed forced replacement throws on ACL validation"
    $restoredDllHash = (Get-FileHash -LiteralPath (Join-Path $forceRollbackRoot "SMTCommon.dll") -Algorithm SHA256).Hash.ToUpperInvariant()
    $restoredManifestText = Get-Content -LiteralPath (Join-Path $forceRollbackRoot "storepulse-verifone-runtime.json") -Raw
    Assert-Equal -Actual $restoredDllHash -Expected $oldDllHash -Message "failed forced replacement restores old DLL"
    Assert-Equal -Actual $restoredManifestText -Expected $oldManifestText -Message "failed forced replacement restores old manifest"
    $restoredAclCommands = @($aclState.apply_commands | Where-Object { ($_.target -eq (Join-Path $forceRollbackRoot "SMTCommon.dll") -or $_.target -eq (Join-Path $forceRollbackRoot "storepulse-verifone-runtime.json")) -and ($_.arguments -contains "/inheritance:r") })
    Assert-True -Condition ($restoredAclCommands.Count -ge 2) -Message "failed forced replacement reapplies ACLs to restored files"
    $aclState.validate_result = $true

    $aclState.validate_result = $false
    Assert-Throws -ScriptBlock { Install-StorePulseVerifoneRuntime -SourceDllPath $sourceDll -DestinationRoot $forceRollbackRoot -Validator $validator -AclApplier $aclApplier -AclValidator $aclValidator -SkipElevationCheck | Out-Null } -Message "same-hash reinstall does not report success when ACL validation fails"
    $aclState.validate_result = $true

    Assert-True -Condition ($aclState.apply_count -gt 0) -Message "ACL applier is invoked during install"
    $outsideApply = @($aclState.apply_paths | Where-Object { -not ([string]$_).StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) })
    Assert-Equal -Actual $outsideApply.Count -Expected 0 -Message "ACL application is scoped only to synthetic destination roots"

    $helperSource = Get-Content -LiteralPath $helperPath -Raw
    Assert-True -Condition ($helperSource.Contains('$LASTEXITCODE')) -Message "ACL implementation checks icacls.exe exit code"
    Assert-True -Condition ($helperSource -notmatch '/inheritance:r\s+/grant:r[\s\S]*?/T') -Message "helper source does not combine inheritance removal with recursive /T grants"
    Assert-True -Condition ($helperSource -notmatch 'C:\\Users\\ABC') -Message "helper contains no literal ABC path"
    Assert-True -Condition ($helperSource -notmatch 'AppData\\Local\\Programs\\Verifone') -Message "helper contains no hard-coded Verifone source profile"
    foreach ($forbidden in @("GetData", "commander_password", "connector_token", "SUPABASE", "Register-ScheduledTask", "New-Service", "sc.exe create")) {
        Assert-True -Condition ($helperSource -notmatch [regex]::Escape($forbidden)) -Message "helper source excludes forbidden operation: $forbidden"
    }
    $repoVerifoneBinaries = @(Get-ChildItem -LiteralPath $repoRoot -File -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @("SMTCommon.dll", "SMTCommon.pdb", "ReportNavigator.exe", "TransactionManager.exe") })
    Assert-Equal -Actual $repoVerifoneBinaries.Count -Expected 0 -Message "no Verifone binary is added to the repository"

    if ($global:VerifoneRuntimeFailures.Count -gt 0) {
        $global:VerifoneRuntimeFailures | ForEach-Object { Write-Host "FAIL: $_" }
        throw "machine-wide Verifone runtime tests failed ($($global:VerifoneRuntimeFailures.Count) failures)."
    }

    Write-Host "PASS: machine-wide Verifone runtime tests passed ($global:VerifoneRuntimePassCount assertions)."
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
