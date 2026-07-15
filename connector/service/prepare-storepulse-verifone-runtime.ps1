[CmdletBinding()]
param(
    [ValidateSet("ValidateSource", "Install", "ValidateInstalled")]
    [string]$Mode = "ValidateSource",

    [string]$SourceDllPath = "",

    [string]$DestinationRoot = "C:\Program Files\StorePulse\VerifoneRuntime",

    [string]$OutputPath = "",

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-StorePulseWindowsPlatform {
    $isWindowsPlatform = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
    if (-not $isWindowsPlatform) {
        throw "Verifone runtime preparation requires Windows."
    }
}

function Test-StorePulseAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-StorePulseVerifoneSourceDll {
    param([Parameter(Mandatory)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "SourceDllPath is required."
    }

    $resolved = @(Resolve-Path -LiteralPath $Path -ErrorAction Stop)
    if ($resolved.Count -ne 1) {
        throw "SourceDllPath must resolve to exactly one file."
    }

    $item = Get-Item -LiteralPath $resolved[0].ProviderPath -ErrorAction Stop
    if (-not $item.PSIsContainer -and $item.Name -ceq "SMTCommon.dll") {
        return $item.FullName
    }

    throw "SourceDllPath must point to a file named exactly SMTCommon.dll."
}

function Test-StorePulseMachineOwnedDestination {
    param([Parameter(Mandatory)][string]$DestinationRoot)

    if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
        throw "DestinationRoot is required."
    }

    if (-not [IO.Path]::IsPathRooted($DestinationRoot)) {
        throw "DestinationRoot must be an absolute machine-owned path."
    }

    $full = [IO.Path]::GetFullPath($DestinationRoot)
    $trimmed = $full.TrimEnd('\')
    $lower = $trimmed.ToLowerInvariant()

    foreach ($forbidden in @("c:\users", "c:\windows\system32\config\systemprofile", "c:\programdata\microsoft\windows\start menu")) {
        if ($lower -eq $forbidden -or $lower.StartsWith($forbidden + "\")) {
            throw "DestinationRoot must not be under a user profile or Windows profile path."
        }
    }

    if ($lower.Contains("\onedrive\") -or $lower.EndsWith("\onedrive") -or
        $lower.Contains("\desktop\") -or $lower.EndsWith("\desktop")) {
        throw "DestinationRoot must not be under OneDrive or Desktop."
    }

    return $full
}

function Get-StorePulseVerifoneFileMetadata {
    param([Parameter(Mandatory)][string]$Path)

    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($item.FullName)
    $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName -ErrorAction SilentlyContinue

    [PSCustomObject]@{
        path = $item.FullName
        filename = $item.Name
        length = [int64]$item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
        file_version = if ($version.FileVersion) { [string]$version.FileVersion } else { "" }
        product_version = if ($version.ProductVersion) { [string]$version.ProductVersion } else { "" }
        signature_status = if ($null -ne $signature) { [string]$signature.Status } else { "Unknown" }
    }
}

function Test-StorePulseSmtCommonAssembly {
    param(
        [Parameter(Mandatory)][string]$DllPath,
        [scriptblock]$Validator = $null
    )

    if ($null -ne $Validator) {
        return (& $Validator $DllPath)
    }

    $encodedPath = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($DllPath))
    $script = @"
`$ErrorActionPreference = 'Stop'
`$dllPath = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('$encodedPath'))
`$assembly = [Reflection.Assembly]::LoadFrom(`$dllPath)
`$type = `$assembly.GetType('SMTCommon.clsHTTPConnection', `$false)
if (`$null -eq `$type) { throw 'SMTCommon.clsHTTPConnection type was not found.' }
`$instance = [Activator]::CreateInstance(`$type)
try {
    `$property = `$type.GetProperty('CGIDefault')
    `$propertyValue = ''
    if (`$null -ne `$property) { `$propertyValue = [string]`$property.GetValue(`$instance, `$null) }
    [PSCustomObject]@{
        ok = `$true
        assembly_full_name = `$assembly.FullName
        validated_type = `$type.FullName
        harmless_property = 'CGIDefault'
        harmless_property_available = (`$null -ne `$property)
    } | ConvertTo-Json -Depth 5
}
finally {
    if (`$instance -is [IDisposable]) { `$instance.Dispose() }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
"@
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $script 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Isolated SMTCommon assembly validation failed."
    }

    $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
    return ($text | ConvertFrom-Json)
}

function Get-StorePulseVerifoneRuntimePlan {
    param(
        [Parameter(Mandatory)][string]$SourceDllPath,
        [Parameter(Mandatory)][string]$DestinationRoot
    )

    $source = Resolve-StorePulseVerifoneSourceDll -Path $SourceDllPath
    $destination = Test-StorePulseMachineOwnedDestination -DestinationRoot $DestinationRoot
    [PSCustomObject]@{
        source_path = $source
        destination_root = $destination
        destination_dll_path = Join-Path $destination "SMTCommon.dll"
        manifest_path = Join-Path $destination "storepulse-verifone-runtime.json"
    }
}

function Write-StorePulseVerifoneRuntimeManifest {
    param(
        [Parameter(Mandatory)]$Metadata,
        [Parameter(Mandatory)]$Validation,
        [Parameter(Mandatory)][string]$DestinationRoot,
        [Parameter(Mandatory)][string]$Path
    )

    $manifest = [PSCustomObject]@{
        schema_version = 1
        installed_at = (Get-Date).ToUniversalTime().ToString("o")
        source_filename = "SMTCommon.dll"
        source_sha256 = $Metadata.sha256
        destination_sha256 = $Metadata.sha256
        file_length = $Metadata.length
        file_version = $Metadata.file_version
        product_version = $Metadata.product_version
        signature_status = $Metadata.signature_status
        destination_root = $DestinationRoot
        assembly_full_name = [string]$Validation.assembly_full_name
        validated_type = [string]$Validation.validated_type
        validation_status = "ok"
    }

    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
    return $manifest
}

function Set-StorePulseVerifoneRuntimeAcl {
    param(
        [Parameter(Mandatory)][string]$DestinationRoot,
        [scriptblock]$AclApplier = $null
    )

    $icacls = Get-Command icacls.exe -ErrorAction SilentlyContinue
    if ($null -eq $icacls -and $null -eq $AclApplier) {
        throw "icacls.exe was not found; cannot secure Verifone runtime ACLs."
    }

    $root = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd('\')
    $directories = @($root)
    $directories += @(Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    $files = @(Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })

    foreach ($directory in $directories) {
        $arguments = @(
            $directory,
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-18:(OI)(CI)(RX)",
            "*S-1-5-32-544:(OI)(CI)(F)"
        )
        $icaclsPath = if ($null -ne $icacls) { $icacls.Source } else { "" }
        Invoke-StorePulseIcacls -Arguments $arguments -AclApplier $AclApplier -IcaclsPath $icaclsPath -ScopeRoot $root
    }

    foreach ($file in $files) {
        $arguments = @(
            $file,
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-18:(RX)",
            "*S-1-5-32-544:(F)"
        )
        $icaclsPath = if ($null -ne $icacls) { $icacls.Source } else { "" }
        Invoke-StorePulseIcacls -Arguments $arguments -AclApplier $AclApplier -IcaclsPath $icaclsPath -ScopeRoot $root
    }
}

function Invoke-StorePulseIcacls {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [scriptblock]$AclApplier = $null,
        [string]$IcaclsPath = "",
        [Parameter(Mandatory)][string]$ScopeRoot
    )

    $targetPath = [IO.Path]::GetFullPath($Arguments[0])
    $root = [IO.Path]::GetFullPath($ScopeRoot).TrimEnd('\')
    if ($targetPath -ne $root -and -not $targetPath.StartsWith($root + "\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify ACL outside DestinationRoot: $targetPath"
    }

    if ($Arguments -contains "/T") {
        throw "Refusing to combine recursive icacls /T with explicit Verifone runtime ACL application."
    }

    if ($null -ne $AclApplier) {
        $result = & $AclApplier $Arguments[0] $Arguments
        if ($result -is [int] -and $result -ne 0) {
            throw "Injected ACL operation failed. Exit code: $result"
        }
        $exitCodeProperty = if ($null -ne $result) { $result.PSObject.Properties["ExitCode"] } else { $null }
        if ($null -ne $exitCodeProperty -and [int]$exitCodeProperty.Value -ne 0) {
            throw "Injected ACL operation failed. Exit code: $($exitCodeProperty.Value)"
        }
        return
    }

    if ([string]::IsNullOrWhiteSpace($IcaclsPath)) {
        throw "icacls.exe was not found; cannot secure Verifone runtime ACLs."
    }

    & $IcaclsPath @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "icacls.exe failed while securing Verifone runtime ACLs for $($Arguments[0]). Exit code: $LASTEXITCODE"
    }
}

function Grant-StorePulseRollbackAccess {
    param(
        [Parameter(Mandatory)][string[]]$Paths,
        [scriptblock]$AclApplier = $null,
        [Parameter(Mandatory)][string]$ScopeRoot
    )

    $icacls = Get-Command icacls.exe -ErrorAction SilentlyContinue
    if ($null -eq $icacls -and $null -eq $AclApplier) {
        throw "icacls.exe was not found; cannot recover Verifone runtime rollback ACLs."
    }

    $failures = New-Object System.Collections.Generic.List[string]
    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) { continue }
        $arguments = @($path, "/grant:r", "*S-1-5-32-544:(F)")
        try {
            $icaclsPath = if ($null -ne $icacls) { $icacls.Source } else { "" }
            Invoke-StorePulseIcacls -Arguments $arguments -AclApplier $AclApplier -IcaclsPath $icaclsPath -ScopeRoot $ScopeRoot
        }
        catch {
            $failures.Add("$path :: $($_.Exception.Message)")
        }
    }

    if ($failures.Count -gt 0) {
        throw "Rollback ACL recovery failed: $($failures -join '; ')"
    }
}

function Test-StorePulseIdentityHasFileSystemRights {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Sid,
        [Parameter(Mandatory)][Security.AccessControl.FileSystemRights]$RequiredRights
    )

    try {
        $targetSid = New-Object Security.Principal.SecurityIdentifier($Sid)
        $acl = Get-Acl -LiteralPath $Path
        $allowRights = [Security.AccessControl.FileSystemRights]0

        foreach ($rule in $acl.Access) {
            $ruleSid = $null
            try {
                $ruleSid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier])
            }
            catch {
                continue
            }

            if ($ruleSid.Value -ne $targetSid.Value) { continue }

            $intersectsRequiredRights = (($rule.FileSystemRights -band $RequiredRights) -ne 0)
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny -and $intersectsRequiredRights) {
                return $false
            }

            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {
                $allowRights = $allowRights -bor $rule.FileSystemRights
            }
        }

        if (($allowRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) {
            return $true
        }

        return (($allowRights -band $RequiredRights) -eq $RequiredRights)
    }
    catch {
        return $false
    }
}

function Test-StorePulseVerifoneRuntimeAcl {
    param(
        [Parameter(Mandatory)][string]$DestinationRoot,
        [scriptblock]$AclValidator = $null
    )

    if ($null -ne $AclValidator) {
        return [bool](& $AclValidator $DestinationRoot)
    }

    $paths = @(
        $DestinationRoot,
        (Join-Path $DestinationRoot "SMTCommon.dll"),
        (Join-Path $DestinationRoot "storepulse-verifone-runtime.json")
    )

    foreach ($path in $paths) {
        if (-not (Test-Path -LiteralPath $path)) {
            return $false
        }

        $systemOk = Test-StorePulseIdentityHasFileSystemRights `
            -Path $path `
            -Sid "S-1-5-18" `
            -RequiredRights ([Security.AccessControl.FileSystemRights]::ReadAndExecute)

        $administratorsOk = Test-StorePulseIdentityHasFileSystemRights `
            -Path $path `
            -Sid "S-1-5-32-544" `
            -RequiredRights ([Security.AccessControl.FileSystemRights]::FullControl)

        if (-not $systemOk -or -not $administratorsOk) {
            return $false
        }
    }

    return $true
}

function Assert-StorePulseVerifoneRuntimeAcl {
    param(
        [Parameter(Mandatory)][string]$DestinationRoot,
        [scriptblock]$AclValidator = $null
    )

    if (-not (Test-StorePulseVerifoneRuntimeAcl -DestinationRoot $DestinationRoot -AclValidator $AclValidator)) {
        throw "Verifone runtime ACL validation failed. SYSTEM requires ReadAndExecute and Administrators requires FullControl."
    }

    [PSCustomObject]@{
        system_read_execute = $true
        administrators_full_control = $true
        acl_validation_status = "ok"
    }
}

function Invoke-StorePulseVerifoneSourceValidation {
    param(
        [Parameter(Mandatory)][string]$SourceDllPath,
        [scriptblock]$Validator = $null
    )

    Test-StorePulseWindowsPlatform
    $source = Resolve-StorePulseVerifoneSourceDll -Path $SourceDllPath
    $metadata = Get-StorePulseVerifoneFileMetadata -Path $source
    $validation = Test-StorePulseSmtCommonAssembly -DllPath $source -Validator $Validator

    [PSCustomObject]@{
        ok = $true
        mode = "ValidateSource"
        source_path = $source
        length = $metadata.length
        sha256 = $metadata.sha256
        file_version = $metadata.file_version
        product_version = $metadata.product_version
        signature_status = $metadata.signature_status
        assembly_full_name = [string]$validation.assembly_full_name
        validated_type = [string]$validation.validated_type
        validation_status = "ok"
    }
}

function Install-StorePulseVerifoneRuntime {
    param(
        [Parameter(Mandatory)][string]$SourceDllPath,
        [Parameter(Mandatory)][string]$DestinationRoot,
        [switch]$Force,
        [scriptblock]$Validator = $null,
        [scriptblock]$AclApplier = $null,
        [scriptblock]$AclValidator = $null,
        [switch]$SkipElevationCheck
    )

    Test-StorePulseWindowsPlatform
    if (-not $SkipElevationCheck -and -not (Test-StorePulseAdministrator)) {
        throw "Administrator elevation is required for Install mode."
    }

    $plan = Get-StorePulseVerifoneRuntimePlan -SourceDllPath $SourceDllPath -DestinationRoot $DestinationRoot
    $sourceMetadata = Get-StorePulseVerifoneFileMetadata -Path $plan.source_path
    $sourceValidation = Test-StorePulseSmtCommonAssembly -DllPath $plan.source_path -Validator $Validator

    New-Item -ItemType Directory -Path $plan.destination_root -Force | Out-Null
    $destinationExists = Test-Path -LiteralPath $plan.destination_dll_path -PathType Leaf
    $backupPath = ""
    $manifestBackupPath = ""

    if ($destinationExists) {
        $existingHash = (Get-FileHash -LiteralPath $plan.destination_dll_path -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($existingHash -eq $sourceMetadata.sha256) {
            $destinationValidation = Test-StorePulseSmtCommonAssembly -DllPath $plan.destination_dll_path -Validator $Validator
            $manifest = Write-StorePulseVerifoneRuntimeManifest -Metadata $sourceMetadata -Validation $destinationValidation -DestinationRoot $plan.destination_root -Path $plan.manifest_path
            Set-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root -AclApplier $AclApplier
            $acl = Assert-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root -AclValidator $AclValidator
            return [PSCustomObject]@{
                ok = $true
                mode = "Install"
                status = "already_installed"
                destination_root = $plan.destination_root
                destination_dll_path = $plan.destination_dll_path
                sha256 = $sourceMetadata.sha256
                file_length = $sourceMetadata.length
                backup_path = ""
                manifest_path = $plan.manifest_path
                manifest = $manifest
                system_read_execute = $acl.system_read_execute
                administrators_full_control = $acl.administrators_full_control
                acl_validation_status = $acl.acl_validation_status
            }
        }

        if (-not $Force) {
            throw "Destination SMTCommon.dll already exists with a different SHA-256. Re-run with -Force to replace it."
        }

        $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
        $backupPath = Join-Path $plan.destination_root ("SMTCommon.dll.$stamp.bak")
        Move-Item -LiteralPath $plan.destination_dll_path -Destination $backupPath -Force
        if (Test-Path -LiteralPath $plan.manifest_path -PathType Leaf) {
            $manifestBackupPath = Join-Path $plan.destination_root ("storepulse-verifone-runtime.json.$stamp.bak")
            Move-Item -LiteralPath $plan.manifest_path -Destination $manifestBackupPath -Force
        }
    }

    $tempPath = Join-Path $plan.destination_root ("SMTCommon.dll.tmp." + [guid]::NewGuid().ToString("N"))
    $freshInstall = (-not $destinationExists)
    try {
        Copy-Item -LiteralPath $plan.source_path -Destination $tempPath -Force
        Move-Item -LiteralPath $tempPath -Destination $plan.destination_dll_path -Force
        $destinationMetadata = Get-StorePulseVerifoneFileMetadata -Path $plan.destination_dll_path
        if ($destinationMetadata.length -ne $sourceMetadata.length -or $destinationMetadata.sha256 -ne $sourceMetadata.sha256) {
            throw "Destination SMTCommon.dll does not match source length and SHA-256."
        }

        $destinationValidation = Test-StorePulseSmtCommonAssembly -DllPath $plan.destination_dll_path -Validator $Validator
        $manifest = Write-StorePulseVerifoneRuntimeManifest -Metadata $destinationMetadata -Validation $destinationValidation -DestinationRoot $plan.destination_root -Path $plan.manifest_path
        Set-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root -AclApplier $AclApplier
        $acl = Assert-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root -AclValidator $AclValidator

        [PSCustomObject]@{
            ok = $true
            mode = "Install"
            status = "installed"
            destination_root = $plan.destination_root
            destination_dll_path = $plan.destination_dll_path
            sha256 = $destinationMetadata.sha256
            file_length = $destinationMetadata.length
            backup_path = $backupPath
            manifest_path = $plan.manifest_path
            manifest = $manifest
            source_validation_status = [string]$sourceValidation.validation_status
            system_read_execute = $acl.system_read_execute
            administrators_full_control = $acl.administrators_full_control
            acl_validation_status = $acl.acl_validation_status
        }
    }
    catch {
        $originalError = $_
        $rollbackFailures = New-Object System.Collections.Generic.List[string]
        $rollbackPaths = @(
            $tempPath,
            $plan.destination_dll_path,
            $plan.manifest_path,
            $backupPath,
            $manifestBackupPath
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        try {
            Grant-StorePulseRollbackAccess -Paths $rollbackPaths -AclApplier $AclApplier -ScopeRoot $plan.destination_root
        }
        catch {
            $rollbackFailures.Add($_.Exception.Message)
        }

        Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $tempPath) { $rollbackFailures.Add("Failed to remove temporary DLL: $tempPath") }
        if ($freshInstall) {
            Remove-Item -LiteralPath $plan.destination_dll_path -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $plan.manifest_path -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $plan.destination_dll_path) { $rollbackFailures.Add("Failed to remove invalid fresh DLL: $($plan.destination_dll_path)") }
            if (Test-Path -LiteralPath $plan.manifest_path) { $rollbackFailures.Add("Failed to remove stale fresh manifest: $($plan.manifest_path)") }
        }
        else {
            Remove-Item -LiteralPath $plan.destination_dll_path -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $plan.manifest_path -Force -ErrorAction SilentlyContinue
            if (-not [string]::IsNullOrWhiteSpace($backupPath) -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
                try { Move-Item -LiteralPath $backupPath -Destination $plan.destination_dll_path -Force } catch { $rollbackFailures.Add("Failed to restore old DLL: $($_.Exception.Message)") }
            }
            if (-not [string]::IsNullOrWhiteSpace($manifestBackupPath) -and (Test-Path -LiteralPath $manifestBackupPath -PathType Leaf)) {
                try { Move-Item -LiteralPath $manifestBackupPath -Destination $plan.manifest_path -Force } catch { $rollbackFailures.Add("Failed to restore old manifest: $($_.Exception.Message)") }
            }
            if (-not (Test-Path -LiteralPath $plan.destination_dll_path -PathType Leaf)) { $rollbackFailures.Add("Forced replacement rollback did not restore old DLL.") }
            if (-not [string]::IsNullOrWhiteSpace($manifestBackupPath) -and -not (Test-Path -LiteralPath $plan.manifest_path -PathType Leaf)) { $rollbackFailures.Add("Forced replacement rollback did not restore old manifest.") }
            if ((Test-Path -LiteralPath $plan.destination_dll_path -PathType Leaf) -and (Test-Path -LiteralPath $plan.manifest_path -PathType Leaf)) {
                try {
                    Set-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root -AclApplier $AclApplier
                    Assert-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root -AclValidator $AclValidator | Out-Null
                }
                catch {
                    $rollbackFailures.Add("Failed to reapply/validate ACLs on restored runtime: $($_.Exception.Message)")
                }
            }
        }

        if ($rollbackFailures.Count -gt 0) {
            throw "Verifone runtime installation failed: $($originalError.Exception.Message) Rollback cleanup also failed: $($rollbackFailures -join '; ')"
        }
        throw $originalError
    }
}

function Test-StorePulseInstalledVerifoneRuntime {
    param(
        [Parameter(Mandatory)][string]$DestinationRoot,
        [scriptblock]$Validator = $null,
        [scriptblock]$AclValidator = $null
    )

    Test-StorePulseWindowsPlatform
    $destination = Test-StorePulseMachineOwnedDestination -DestinationRoot $DestinationRoot
    $dllPath = Join-Path $destination "SMTCommon.dll"
    $manifestPath = Join-Path $destination "storepulse-verifone-runtime.json"

    if (-not (Test-Path -LiteralPath $dllPath -PathType Leaf)) {
        throw "Installed SMTCommon.dll was not found."
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Verifone runtime manifest was not found."
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $metadata = Get-StorePulseVerifoneFileMetadata -Path $dllPath
    if ($metadata.sha256 -ne [string]$manifest.destination_sha256) {
        throw "Installed SMTCommon.dll SHA-256 does not match the runtime manifest."
    }
    if ($metadata.length -ne [int64]$manifest.file_length) {
        throw "Installed SMTCommon.dll length does not match the runtime manifest."
    }

    $validation = Test-StorePulseSmtCommonAssembly -DllPath $dllPath -Validator $Validator
    $acl = Assert-StorePulseVerifoneRuntimeAcl -DestinationRoot $destination -AclValidator $AclValidator
    [PSCustomObject]@{
        ok = $true
        mode = "ValidateInstalled"
        destination_root = $destination
        destination_dll_path = $dllPath
        manifest_path = $manifestPath
        sha256 = $metadata.sha256
        file_length = $metadata.length
        assembly_full_name = [string]$validation.assembly_full_name
        validated_type = [string]$validation.validated_type
        validation_status = "ok"
        system_read_execute = $acl.system_read_execute
        administrators_full_control = $acl.administrators_full_control
        acl_validation_status = $acl.acl_validation_status
    }
}

function Write-StorePulseVerifoneResult {
    param(
        [Parameter(Mandatory)]$Result,
        [string]$OutputPath = ""
    )

    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        $parent = Split-Path -Parent $OutputPath
        if (-not [string]::IsNullOrWhiteSpace($parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $Result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    }

    return $Result
}

function Invoke-StorePulseVerifoneRuntimePreparation {
    param(
        [ValidateSet("ValidateSource", "Install", "ValidateInstalled")]
        [string]$Mode,
        [string]$SourceDllPath,
        [string]$DestinationRoot,
        [string]$OutputPath,
        [switch]$Force
    )

    switch ($Mode) {
        "ValidateSource" {
            $result = Invoke-StorePulseVerifoneSourceValidation -SourceDllPath $SourceDllPath
        }
        "Install" {
            $result = Install-StorePulseVerifoneRuntime -SourceDllPath $SourceDllPath -DestinationRoot $DestinationRoot -Force:$Force
        }
        "ValidateInstalled" {
            $result = Test-StorePulseInstalledVerifoneRuntime -DestinationRoot $DestinationRoot
        }
    }

    Write-StorePulseVerifoneResult -Result $result -OutputPath $OutputPath
}

if ($MyInvocation.InvocationName -ne ".") {
    $result = Invoke-StorePulseVerifoneRuntimePreparation -Mode $Mode -SourceDllPath $SourceDllPath -DestinationRoot $DestinationRoot -OutputPath $OutputPath -Force:$Force
    $result | ConvertTo-Json -Depth 12
}
