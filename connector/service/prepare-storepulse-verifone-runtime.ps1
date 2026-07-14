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
    param([Parameter(Mandatory)][string]$DestinationRoot)

    if (-not (Get-Command icacls.exe -ErrorAction SilentlyContinue)) { return }
    & icacls.exe $DestinationRoot /inheritance:r /grant:r "SYSTEM:(OI)(CI)(RX)" "Administrators:(OI)(CI)(F)" | Out-Null
}

function Test-StorePulseSystemReadExecuteAccess {
    param([Parameter(Mandatory)][string]$Path)

    try {
        $acl = Get-Acl -LiteralPath $Path
        foreach ($rule in $acl.Access) {
            $identity = [string]$rule.IdentityReference
            if ($identity -match '(^|\\)SYSTEM$' -and
                (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) -ne 0 -or
                 ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne 0)) {
                return $true
            }
        }
    }
    catch {
        return $false
    }
    return $false
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

    if ($destinationExists) {
        $existingHash = (Get-FileHash -LiteralPath $plan.destination_dll_path -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($existingHash -eq $sourceMetadata.sha256) {
            $destinationValidation = Test-StorePulseSmtCommonAssembly -DllPath $plan.destination_dll_path -Validator $Validator
            $manifest = Write-StorePulseVerifoneRuntimeManifest -Metadata $sourceMetadata -Validation $destinationValidation -DestinationRoot $plan.destination_root -Path $plan.manifest_path
            Set-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root
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
            }
        }

        if (-not $Force) {
            throw "Destination SMTCommon.dll already exists with a different SHA-256. Re-run with -Force to replace it."
        }

        $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
        $backupPath = Join-Path $plan.destination_root ("SMTCommon.dll.$stamp.bak")
        Move-Item -LiteralPath $plan.destination_dll_path -Destination $backupPath -Force
    }

    $tempPath = Join-Path $plan.destination_root ("SMTCommon.dll.tmp." + [guid]::NewGuid().ToString("N"))
    try {
        Copy-Item -LiteralPath $plan.source_path -Destination $tempPath -Force
        Move-Item -LiteralPath $tempPath -Destination $plan.destination_dll_path -Force
        $destinationMetadata = Get-StorePulseVerifoneFileMetadata -Path $plan.destination_dll_path
        if ($destinationMetadata.length -ne $sourceMetadata.length -or $destinationMetadata.sha256 -ne $sourceMetadata.sha256) {
            throw "Destination SMTCommon.dll does not match source length and SHA-256."
        }

        $destinationValidation = Test-StorePulseSmtCommonAssembly -DllPath $plan.destination_dll_path -Validator $Validator
        $manifest = Write-StorePulseVerifoneRuntimeManifest -Metadata $destinationMetadata -Validation $destinationValidation -DestinationRoot $plan.destination_root -Path $plan.manifest_path
        Set-StorePulseVerifoneRuntimeAcl -DestinationRoot $plan.destination_root

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
        }
    }
    catch {
        Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $plan.destination_dll_path -Force -ErrorAction SilentlyContinue
        if (-not [string]::IsNullOrWhiteSpace($backupPath) -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
            Move-Item -LiteralPath $backupPath -Destination $plan.destination_dll_path -Force
        }
        throw
    }
}

function Test-StorePulseInstalledVerifoneRuntime {
    param(
        [Parameter(Mandatory)][string]$DestinationRoot,
        [scriptblock]$Validator = $null
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
        system_read_execute = Test-StorePulseSystemReadExecuteAccess -Path $destination
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
