Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$connectorRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $connectorRoot 'build'
$packageName = 'connector-commander-read-test-product-4951ceac'
$zipRoot = 'StorePulse-Connector-Commander-Read-Test-Product-4951ceac'
$stagingRoot = Join-Path $buildRoot $packageName
$zipPath = Join-Path $buildRoot ($zipRoot + '.zip')
$sourceBranch = 'research/commander-auth-session'
$sourceHead = '4951ceac0f31f229e82745ae4cbc6e21b186d9fa'
$provenRawClientSha256 = 'd7b856ff63f1f9ae2b7292c9fa28c98e745d0cd2ecbda0aab005dec45eb3cd49'
$runtimeFiles = @(
    'maintenance/run-connector-commander-read-test-product.ps1'
    'research/commander-vplus-raw-client.mjs'
) | Sort-Object

function Fail-Package([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-SourceFile([string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath) -or $RelativePath.Contains('..')) { Fail-Package 'read_test_product_package_source_invalid' }
    $root = [IO.Path]::GetFullPath($connectorRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $full = [IO.Path]::GetFullPath((Join-Path $root $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Fail-Package 'read_test_product_package_source_invalid' }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { Fail-Package 'read_test_product_package_source_invalid' }
    return $item
}
function Get-Records { return @($runtimeFiles | ForEach-Object { $item = Get-SourceFile $_; [ordered]@{ path = $_; size_bytes = [int64]$item.Length; sha256 = Get-Sha256 $item.FullName } }) }
function Assert-ProvenRawClientHash([string]$Path) { if ((Get-Sha256 $Path) -ne $provenRawClientSha256) { Fail-Package 'read_test_product_raw_client_hash_mismatch' } }
function Get-StagingFiles {
    if (-not (Test-Path -LiteralPath $stagingRoot -PathType Container)) { return @() }
    $root = [IO.Path]::GetFullPath($stagingRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    return @(Get-ChildItem -LiteralPath $stagingRoot -File -Recurse -Force | ForEach-Object { $full = [IO.Path]::GetFullPath($_.FullName); if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Fail-Package 'read_test_product_package_conflict' }; $full.Substring($root.Length + 1).Replace('\', '/') } | Sort-Object)
}
function Get-ManifestText($Records) {
    [ordered]@{
        schema_version = 1
        package_name = 'StorePulse-Connector-Commander-Read-Test-Product'
        package_purpose = 'connector_integrated_read_test_product'
        source_branch = $sourceBranch
        source_git_head = $sourceHead
        source_tree_was_dirty = $true
        runtime_entrypoint = 'maintenance/run-connector-commander-read-test-product.ps1'
        allowed_operation = 'read_test_product'
        runtime_file_count = $runtimeFiles.Count
        package_file_count = $runtimeFiles.Count + 2
        runtime_files = @($Records)
        safety_assertions = [ordered]@{ one_product_read_maximum = $true; no_catalog_pagination = $true; no_product_writes = $true; no_publishing = $true; no_supabase = $true; no_transaction_upload = $true; no_service_control = $true; installed_connector_runtime_only = $true; proven_raw_vplu_client_sha256 = 'd7b856ff63f1f9ae2b7292c9fa28c98e745d0cd2ecbda0aab005dec45eb3cd49'; session_memory_only = $true; child_timeout_seconds = 30 }
    } | ConvertTo-Json -Depth 8 -Compress
}
$runbook = @'
StorePulse Connector Commander read-test-product maintenance bundle
Entrypoint: maintenance\run-connector-commander-read-test-product.ps1

This is an explicit, disabled-by-default, one-request maintenance operation. A separately approved supervised run dot-sources the installed connector machine readers and Current Shift worker, uses that installed SMTCommon runtime in the primary PowerShell process, then performs one vPLUs read for the controlled test identity. It stops after identity verification and disposes the in-memory session.

No catalog pagination, product update, publishing, Supabase, transaction upload, service modification, configuration write, or secret write is included. Public stdout is exactly one bounded JSON object and contains no credentials, cookie, product values, XML, certificate material, paths, or stack traces.
No live request was made while building this bundle.
'@
function Test-Staging($Records) {
    if (-not (Test-Path -LiteralPath $stagingRoot -PathType Container)) { return $false }
    $expected = @(@($runtimeFiles) + @('manifest.json', 'RUNBOOK.txt') | Sort-Object)
    if ((@(Get-StagingFiles) -join "`n") -ne ($expected -join "`n")) { Fail-Package 'read_test_product_package_conflict' }
    try { $manifest = Get-Content -LiteralPath (Join-Path $stagingRoot 'manifest.json') -Raw | ConvertFrom-Json -ErrorAction Stop } catch { Fail-Package 'read_test_product_package_conflict' }
    if ($manifest.package_purpose -ne 'connector_integrated_read_test_product' -or $manifest.allowed_operation -ne 'read_test_product' -or @($manifest.runtime_files).Count -ne $runtimeFiles.Count) { Fail-Package 'read_test_product_package_conflict' }
    foreach ($record in $Records) { $entry = @($manifest.runtime_files | Where-Object { $_.path -eq $record.path }); $file = Join-Path $stagingRoot $record.path.Replace('/', [IO.Path]::DirectorySeparatorChar); if ($entry.Count -ne 1 -or $entry[0].size_bytes -ne $record.size_bytes -or $entry[0].sha256 -ne $record.sha256 -or (Get-Sha256 $file) -ne $record.sha256) { Fail-Package 'read_test_product_package_conflict' } }
    return $true
}
function Test-Zip($Records) {
    if (-not (Test-Staging $Records) -or -not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { return $false }
    $expected = @((@($runtimeFiles) + @('manifest.json', 'RUNBOOK.txt') | ForEach-Object { "$zipRoot/$_" } | Sort-Object))
    Add-Type -AssemblyName System.IO.Compression
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try { $entries = @($archive.Entries | ForEach-Object FullName | Sort-Object); if (($entries -join "`n") -ne ($expected -join "`n") -or $entries.Count -ne $expected.Count) { Fail-Package 'read_test_product_package_conflict' } } finally { $archive.Dispose() }
    return $true
}
function Assert-ZipRawClientHash {
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entry = @($archive.Entries | Where-Object { $_.FullName -eq "$zipRoot/research/commander-vplus-raw-client.mjs" })
        if ($entry.Count -ne 1) { Fail-Package 'read_test_product_raw_client_hash_mismatch' }
        $input = $entry[0].Open()
        try { $bytes = [IO.MemoryStream]::new(); $input.CopyTo($bytes); $sha = [Security.Cryptography.SHA256]::Create(); try { $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes.ToArray()))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }; if ($actual -ne $provenRawClientSha256) { Fail-Package 'read_test_product_raw_client_hash_mismatch' } } finally { $input.Dispose() }
    }
    finally { $archive.Dispose() }
}
try {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Assert-ProvenRawClientHash (Join-Path $connectorRoot 'research\commander-vplus-raw-client.mjs')
    $records = Get-Records; $stageExists = Test-Path -LiteralPath $stagingRoot -PathType Container; $zipExists = Test-Path -LiteralPath $zipPath -PathType Leaf
    if ($zipExists -and -not $stageExists) { Fail-Package 'read_test_product_package_conflict' }
    if ($stageExists) {
        $alreadyValid = $false
        try { $alreadyValid = (Test-Staging $records) -and $zipExists -and (Test-Zip $records) } catch { $alreadyValid = $false }
        if ($alreadyValid) { [Console]::Out.Write('{"status":"read_test_product_package_already_valid"}'); exit 0 }
        if ($zipExists) { [IO.File]::Delete($zipPath) }
        [IO.Directory]::Delete($stagingRoot, $true)
        $stageExists = $false
    }
    if (-not (Test-Path -LiteralPath $buildRoot -PathType Container)) { [void][IO.Directory]::CreateDirectory($buildRoot) }
    if (-not $stageExists) { [void][IO.Directory]::CreateDirectory($stagingRoot); foreach ($record in $records) { $target = Join-Path $stagingRoot $record.path.Replace('/', [IO.Path]::DirectorySeparatorChar); [void][IO.Directory]::CreateDirectory((Split-Path -Parent $target)); [IO.File]::Copy((Join-Path $connectorRoot $record.path.Replace('/', [IO.Path]::DirectorySeparatorChar)), $target, $false) }; [IO.File]::WriteAllText((Join-Path $stagingRoot 'manifest.json'), (Get-ManifestText $records) + "`n", [Text.UTF8Encoding]::new($false)); [IO.File]::WriteAllText((Join-Path $stagingRoot 'RUNBOOK.txt'), $runbook, [Text.UTF8Encoding]::new($false)) }
    $stream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
    try { $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false); try { foreach ($relative in @($runtimeFiles + @('manifest.json', 'RUNBOOK.txt') | Sort-Object)) { $entry = $archive.CreateEntry("$zipRoot/$relative", [IO.Compression.CompressionLevel]::Optimal); $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero); $input = [IO.File]::OpenRead((Join-Path $stagingRoot $relative.Replace('/', [IO.Path]::DirectorySeparatorChar))); try { $output = $entry.Open(); try { $input.CopyTo($output) } finally { $output.Dispose() } } finally { $input.Dispose() } } } finally { $archive.Dispose() } } finally { $stream.Dispose() }
    Assert-ProvenRawClientHash (Join-Path $stagingRoot 'research\commander-vplus-raw-client.mjs')
    if (-not (Test-Zip $records)) { Fail-Package 'read_test_product_package_conflict' }
    Assert-ZipRawClientHash
    [Console]::Out.Write('{"status":"read_test_product_package_created"}')
} catch { [Console]::Error.Write('read_test_product_package_build_failed'); exit 1 }
