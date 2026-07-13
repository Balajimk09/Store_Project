[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseInstallRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}

function Read-StorePulseNodeRuntimeManifest {
    param([string]$Path = "")
    $manifestPath = if ([string]::IsNullOrWhiteSpace($Path)) { Join-Path $PSScriptRoot "node-runtime-manifest.json" } else { $Path }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Node runtime manifest not found: $manifestPath" }
    return Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}

function Get-StorePulseNodeRuntimeExecutable {
    param(
        [string]$InstallRoot = "",
        $Manifest = $null
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $runtimeManifest = if ($null -eq $Manifest) { Read-StorePulseNodeRuntimeManifest } else { $Manifest }
    return (Join-Path (Join-Path $resolvedInstallRoot ([string]$runtimeManifest.expected_relative_path)) ([string]$runtimeManifest.executable_name))
}

function Get-StorePulseFileSha256 {
    param([Parameter(Mandatory)][string]$Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead($Path)
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream)).Replace("-", "").ToLowerInvariant())
        }
        finally {
            $stream.Dispose()
        }
    }
    finally {
        $sha.Dispose()
    }
}

function Get-StorePulseRuntimeArchitecture {
    $arch = [Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE", "Process")
    if ([string]::IsNullOrWhiteSpace($arch)) { return "unknown" }
    if ($arch -match "64") { return "x64" }
    if ($arch -match "86") { return "x86" }
    return $arch.ToLowerInvariant()
}

function Test-StorePulseNodeRuntime {
    param(
        [string]$InstallRoot = "",
        [string]$ManifestPath = "",
        [switch]$PassThru
    )
    $manifest = Read-StorePulseNodeRuntimeManifest -Path $ManifestPath
    $nodePath = Get-StorePulseNodeRuntimeExecutable -InstallRoot $InstallRoot -Manifest $manifest
    $result = [ordered]@{
        ok = $false
        status = "runtime_missing"
        node_path = $nodePath
        expected_sha256 = [string]$manifest.sha256
        actual_sha256 = $null
        expected_architecture = [string]$manifest.architecture
        actual_architecture = Get-StorePulseRuntimeArchitecture
        message = $null
    }
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
        $result.message = "Private Node runtime is missing."
        if ($PassThru) { return [PSCustomObject]$result }
        throw "runtime_missing: private Node runtime is missing at $nodePath"
    }
    $expectedArch = [string]$manifest.architecture
    if (-not [string]::IsNullOrWhiteSpace($expectedArch) -and $expectedArch -notin @("any", "test") -and $expectedArch -ne $result.actual_architecture) {
        $result.status = "runtime_invalid"
        $result.message = "Private Node runtime architecture mismatch."
        if ($PassThru) { return [PSCustomObject]$result }
        throw "runtime_invalid: private Node runtime architecture mismatch."
    }
    $actualHash = Get-StorePulseFileSha256 -Path $nodePath
    $result.actual_sha256 = $actualHash
    $expectedHash = [string]$manifest.sha256
    if ($expectedHash -notmatch '^[a-fA-F0-9]{64}$') {
        $result.status = "runtime_invalid"
        $result.message = "Node runtime manifest must contain a 64-character SHA-256 before installation."
        if ($PassThru) { return [PSCustomObject]$result }
        throw "runtime_invalid: Node runtime manifest must contain a 64-character SHA-256 before installation."
    }
    if ($actualHash -ne $expectedHash.ToLowerInvariant()) {
        $result.status = "runtime_invalid"
        $result.message = "Private Node runtime SHA-256 mismatch."
        if ($PassThru) { return [PSCustomObject]$result }
        throw "runtime_invalid: private Node runtime SHA-256 mismatch."
    }
    $result.ok = $true
    $result.status = "ok"
    $result.message = "Private Node runtime validated."
    if ($PassThru) { return [PSCustomObject]$result }
    return $true
}
