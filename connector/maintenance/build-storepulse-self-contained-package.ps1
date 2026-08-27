[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OutputRoot,
    [string]$WinSWCacheRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$connectorRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $connectorRoot
$manifestPath = Join-Path $connectorRoot 'service\install-manifest.json'
$winswManifestPath = Join-Path $connectorRoot 'service\winsw-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (Test-Path -LiteralPath $OutputRoot) { throw 'package_output_exists' }

. (Join-Path $connectorRoot 'service\storepulse-node-runtime.ps1')
. (Join-Path $connectorRoot 'service\storepulse-runtime-node-dependencies.ps1')

$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ('storepulse-package-' + [guid]::NewGuid().ToString('N'))
$downloadPath = Join-Path ([IO.Path]::GetTempPath()) ('storepulse-winsw-' + [guid]::NewGuid().ToString('N') + '.exe')
$payloadRoot = Join-Path $stagingRoot 'connector'
function Fail-Package([string]$Code) { throw $Code }
function Get-SafeWinSWManifest {
    try { $value = Get-Content -LiteralPath $winswManifestPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { Fail-Package 'winsw_manifest_invalid' }
    foreach ($name in @('name','version','asset_name','download_url','sha256','architecture','installed_relative_path','expected_hosts','license_notice_file')) {
        if (-not $value.PSObject.Properties[$name] -or [string]::IsNullOrWhiteSpace([string]$value.$name)) { Fail-Package 'winsw_manifest_invalid' }
    }
    if ([string]$value.name -ne 'WinSW' -or [string]$value.version -notmatch '^\d+(?:\.\d+){2}$' -or [string]$value.architecture -notmatch '^[A-Za-z0-9_-]{1,32}$') { Fail-Package 'winsw_manifest_invalid' }
    if ([string]$value.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { Fail-Package 'winsw_manifest_invalid' }
    try { $uri = [uri][string]$value.download_url } catch { Fail-Package 'winsw_manifest_invalid' }
    if ($uri.Scheme -ne 'https' -or [string]::IsNullOrWhiteSpace($uri.Host)) { Fail-Package 'winsw_manifest_invalid' }
    $hosts = @($value.expected_hosts | ForEach-Object { [string]$_ })
    if ($hosts.Count -lt 1 -or $hosts.Count -gt 16 -or $hosts | Where-Object { $_ -notmatch '^[A-Za-z0-9.-]{1,253}$' }) { Fail-Package 'winsw_manifest_invalid' }
    if ($hosts -notcontains $uri.Host) { Fail-Package 'winsw_manifest_host_invalid' }
    $relative = [string]$value.installed_relative_path
    if ([IO.Path]::IsPathRooted($relative) -or $relative.Contains('..') -or $relative -notmatch '^service[\\/]host[\\/][^\\/]+\.exe$') { Fail-Package 'winsw_manifest_path_invalid' }
    if ([string]$value.license_notice_file -notmatch '^service[\\/][^\\/]+$') { Fail-Package 'winsw_manifest_invalid' }
    return [pscustomobject]@{ Manifest = $value; Uri = $uri; RelativePath = $relative.Replace('/','\\') }
}
function Get-VerifiedWinSW([Parameter(Mandatory)]$SafeManifest) {
    $cacheCandidate = $null
    if ($WinSWCacheRoot) {
        $cacheRoot = [IO.Path]::GetFullPath($WinSWCacheRoot)
        $cacheCandidate = Join-Path $cacheRoot ([string]$SafeManifest.Manifest.asset_name)
    }
    try {
        if ($cacheCandidate -and (Test-Path -LiteralPath $cacheCandidate -PathType Leaf)) {
            Copy-Item -LiteralPath $cacheCandidate -Destination $downloadPath -Force
        } else {
            try { Invoke-WebRequest -Uri $SafeManifest.Uri.AbsoluteUri -OutFile $downloadPath -UseBasicParsing -ErrorAction Stop } catch { Fail-Package 'winsw_download_failed' }
        }
        $actual = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash
        if ($actual -notmatch '^[A-Fa-f0-9]{64}$' -or -not $actual.Equals([string]$SafeManifest.Manifest.sha256, [StringComparison]::OrdinalIgnoreCase)) { Fail-Package 'winsw_hash_mismatch' }
        return $downloadPath
    } catch { throw }
}

function Test-StorePulseEmittedPackage {
    param(
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$PackageRoot,
        [Parameter(Mandatory)][string]$PayloadRoot,
        [Parameter(Mandatory)]$SafeWinSW
    )

    $resolvedPackageRoot = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')
    $resolvedPayloadRoot = [IO.Path]::GetFullPath($PayloadRoot).TrimEnd('\')
    if (-not $resolvedPayloadRoot.StartsWith($resolvedPackageRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Fail-Package 'package_layout_invalid'
    }

    foreach ($relativePath in @($Manifest.required_files)) {
        $requiredPath = [IO.Path]::GetFullPath((Join-Path $resolvedPayloadRoot ([string]$relativePath)))
        if (-not $requiredPath.StartsWith($resolvedPayloadRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            Fail-Package 'package_required_file_missing'
        }
    }

    Test-StorePulseNodeRuntime -InstallRoot $resolvedPayloadRoot -ManifestPath (Join-Path $resolvedPayloadRoot 'service\node-runtime-manifest.json') | Out-Null
    Test-StorePulseRuntimeNodeDependencies -Manifest $Manifest -Root $resolvedPayloadRoot | Out-Null

    $winswPath = [IO.Path]::GetFullPath((Join-Path $resolvedPayloadRoot ([string]$SafeWinSW.RelativePath)))
    if (-not $winswPath.StartsWith($resolvedPayloadRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $winswPath -PathType Leaf)) {
        Fail-Package 'package_winsw_missing'
    }
    $winswHash = (Get-FileHash -LiteralPath $winswPath -Algorithm SHA256).Hash
    if (-not $winswHash.Equals([string]$SafeWinSW.Manifest.sha256, [StringComparison]::OrdinalIgnoreCase)) {
        Fail-Package 'package_winsw_hash_mismatch'
    }

    $checksumPath = Join-Path $resolvedPackageRoot 'SHA256SUMS.csv'
    if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
        Fail-Package 'package_checksums_missing'
    }

    try { $rows = @(Import-Csv -LiteralPath $checksumPath -ErrorAction Stop) } catch { Fail-Package 'package_checksums_invalid' }
    $files = @(Get-ChildItem -LiteralPath $resolvedPayloadRoot -File -Recurse)
    if ($rows.Count -ne $files.Count -or $rows.Count -lt 1) {
        Fail-Package 'package_checksums_invalid'
    }

    $seen = @{}
    foreach ($row in $rows) {
        $keys = @($row.PSObject.Properties.Name | Sort-Object)
        if (($keys -join '|') -cne 'Path|SHA256') { Fail-Package 'package_checksums_invalid' }

        $relative = [string]$row.Path
        $expectedHash = [string]$row.SHA256
        if ([string]::IsNullOrWhiteSpace($relative) -or
            $relative.Contains('..') -or
            [IO.Path]::IsPathRooted($relative) -or
            $relative -notmatch '^connector[\\/]' -or
            $expectedHash -notmatch '^[A-Fa-f0-9]{64}$' -or
            $seen.ContainsKey($relative.ToLowerInvariant())) {
            Fail-Package 'package_checksums_invalid'
        }

        $filePath = [IO.Path]::GetFullPath((Join-Path $resolvedPackageRoot $relative))
        if (-not $filePath.StartsWith($resolvedPayloadRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
            Fail-Package 'package_checksums_invalid'
        }

        $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
        if (-not $actualHash.Equals($expectedHash, [StringComparison]::OrdinalIgnoreCase)) {
            Fail-Package 'package_checksum_mismatch'
        }
        $seen[$relative.ToLowerInvariant()] = $true
    }

    foreach ($file in $files) {
        $relative = $file.FullName.Substring($resolvedPackageRoot.Length).TrimStart('\')
        if (-not $seen.ContainsKey($relative.ToLowerInvariant())) {
            Fail-Package 'package_checksums_invalid'
        }
    }

    return $true
}

$packageMoved = $false
$packageCompleted = $false

try {
    $safeWinSW = Get-SafeWinSWManifest
    New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
foreach ($relativePath in @($manifest.required_files)) {
    $source = Join-Path $connectorRoot ([string]$relativePath)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'required_package_source_missing' }
    $destination = Join-Path $payloadRoot ([string]$relativePath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

$runtimeRelativePath = [string]$manifest.bundled_node_runtime_relative_path
$runtimeSource = Join-Path $connectorRoot $runtimeRelativePath
$runtimeDestination = Join-Path $payloadRoot $runtimeRelativePath
if (-not (Test-Path -LiteralPath $runtimeSource -PathType Container)) { throw 'runtime_node_missing' }
Copy-Item -LiteralPath $runtimeSource -Destination $runtimeDestination -Recurse -Force
# Development dependencies live at the repository root; the installed package keeps
# the same approved closure beneath its connector root, as required by the installer.
Copy-StorePulseRuntimeNodeDependencies -Manifest $manifest -SourceRoot $repositoryRoot -InstallRoot $payloadRoot | Out-Null

$winswRelativePath = $safeWinSW.RelativePath
$winswSource = Get-VerifiedWinSW -SafeManifest $safeWinSW
$winswDestination = Join-Path $payloadRoot $winswRelativePath
New-Item -ItemType Directory -Path (Split-Path -Parent $winswDestination) -Force | Out-Null
Copy-Item -LiteralPath $winswSource -Destination $winswDestination -Force

Test-StorePulseNodeRuntime -InstallRoot $payloadRoot -ManifestPath (Join-Path $payloadRoot 'service\node-runtime-manifest.json') | Out-Null
Test-StorePulseRuntimeNodeDependencies -Manifest $manifest -Root $payloadRoot | Out-Null

$checksumPath = Join-Path $stagingRoot 'SHA256SUMS.csv'
Get-ChildItem -LiteralPath $payloadRoot -File -Recurse | ForEach-Object {
    [pscustomobject]@{
        Path = $_.FullName.Substring($stagingRoot.Length).TrimStart('\')
        SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
} | Sort-Object Path | Export-Csv -LiteralPath $checksumPath -NoTypeInformation -Encoding utf8

if (Test-Path -LiteralPath $OutputRoot) { Fail-Package 'package_output_exists' }
Move-Item -LiteralPath $stagingRoot -Destination $OutputRoot
$packageMoved = $true
$finalChecksumPath = Join-Path $OutputRoot 'SHA256SUMS.csv'
$finalPayloadRoot = Join-Path $OutputRoot 'connector'

Test-StorePulseEmittedPackage -Manifest $manifest -PackageRoot $OutputRoot -PayloadRoot $finalPayloadRoot -SafeWinSW $safeWinSW | Out-Null

$packageCompleted = $true
[pscustomobject]@{
    ok = $true
    package_root = $OutputRoot
    payload_root = $finalPayloadRoot
    version = [string]$manifest.version
    file_count = @(Import-Csv -LiteralPath $finalChecksumPath).Count
    dependency_count = @(Get-StorePulseRuntimeNodeDependencyRecords -Manifest $manifest).Count
} | ConvertTo-Json -Compress
} finally {
    if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Force -Recurse -ErrorAction SilentlyContinue }
    if ($packageMoved -and -not $packageCompleted -and (Test-Path -LiteralPath $OutputRoot)) {
        Remove-Item -LiteralPath $OutputRoot -Force -Recurse -ErrorAction SilentlyContinue
    }
}
