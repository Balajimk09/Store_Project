[CmdletBinding()]
param()

Set-StrictMode -Version Latest

function Get-StorePulseRuntimeNodeDependencyRecords {
    param([Parameter(Mandatory)]$Manifest)

    if (-not $Manifest.PSObject.Properties['runtime_node_dependencies']) { throw 'runtime_node_dependencies_missing' }
    $records = @($Manifest.runtime_node_dependencies)
    if ($records.Count -lt 1 -or $records.Count -gt 32) { throw 'runtime_node_dependencies_invalid' }

    $seen = @{}
    foreach ($record in $records) {
        if ($null -eq $record) { throw 'runtime_node_dependencies_invalid' }
        $keys = @($record.PSObject.Properties.Name | Sort-Object)
        if (($keys -join '|') -cne ('name|relative_path|version')) { throw 'runtime_node_dependencies_invalid' }
        $name = [string]$record.name
        $version = [string]$record.version
        $relativePath = [string]$record.relative_path
        if ($name -notmatch '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' -or $version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw 'runtime_node_dependencies_invalid' }
        $expectedPath = 'node_modules\' + $name.Replace('/', '\')
        if ($relativePath -cne $expectedPath -or $relativePath.Contains('..') -or [IO.Path]::IsPathRooted($relativePath)) { throw 'runtime_node_dependencies_invalid' }
        if ($seen.ContainsKey($name)) { throw 'runtime_node_dependencies_invalid' }
        $seen[$name] = $true
    }

    return $records
}

function Get-StorePulseRuntimeNodeDependencyPath {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$RelativePath
    )

    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $path = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $RelativePath))
    if (-not $path.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'runtime_node_dependencies_invalid' }
    return $path
}

function Get-StorePulseRuntimeNodeDependencyRecordMap {
    param([Parameter(Mandatory)]$Manifest)

    $map = @{}
    foreach ($record in (Get-StorePulseRuntimeNodeDependencyRecords -Manifest $Manifest)) {
        $map[[string]$record.name] = $record
    }
    return $map
}

function Read-StorePulseRuntimeNodePackage {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)]$Record
    )

    $packageRoot = Get-StorePulseRuntimeNodeDependencyPath -Root $Root -RelativePath ([string]$Record.relative_path)
    $packageJson = Join-Path $packageRoot 'package.json'
    if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) { throw 'runtime_node_dependency_missing' }
    try { $package = Get-Content -LiteralPath $packageJson -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { throw 'runtime_node_dependency_invalid' }
    if ([string]$package.name -cne [string]$Record.name -or [string]$package.version -cne [string]$Record.version) { throw 'runtime_node_dependency_invalid' }
    return $package
}

function Get-StorePulseRuntimeNodePackageDependencyNames {
    param([Parameter(Mandatory)]$Package)

    if (-not $Package.PSObject.Properties['dependencies'] -or $null -eq $Package.dependencies) { return @() }
    if (-not ($Package.dependencies -is [System.Management.Automation.PSCustomObject])) { throw 'runtime_node_dependency_invalid' }

    $names = @($Package.dependencies.PSObject.Properties.Name)
    if ($names.Count -gt 64) { throw 'runtime_node_dependency_invalid' }
    foreach ($name in $names) {
        if ([string]$name -notmatch '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$') { throw 'runtime_node_dependency_invalid' }
    }
    return $names
}

function Test-StorePulseRuntimeNodeDependencies {
    param(
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$Root
    )

    $records = @(Get-StorePulseRuntimeNodeDependencyRecords -Manifest $Manifest)
    $recordMap = Get-StorePulseRuntimeNodeDependencyRecordMap -Manifest $Manifest
    $packages = @{}

    foreach ($record in $records) {
        $packages[[string]$record.name] = Read-StorePulseRuntimeNodePackage -Root $Root -Record $record
    }

    foreach ($record in $records) {
        $packageName = [string]$record.name
        foreach ($dependencyName in @(Get-StorePulseRuntimeNodePackageDependencyNames -Package $packages[$packageName])) {
            if (-not $recordMap.ContainsKey([string]$dependencyName)) { throw 'runtime_node_dependency_manifest_incomplete' }
        }
    }

    return $true
}

function Copy-StorePulseRuntimeNodeDependencies {
    param(
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$InstallRoot
    )

    Test-StorePulseRuntimeNodeDependencies -Manifest $Manifest -Root $SourceRoot | Out-Null
    foreach ($record in (Get-StorePulseRuntimeNodeDependencyRecords -Manifest $Manifest)) {
        $source = Get-StorePulseRuntimeNodeDependencyPath -Root $SourceRoot -RelativePath ([string]$record.relative_path)
        $destination = Get-StorePulseRuntimeNodeDependencyPath -Root $InstallRoot -RelativePath ([string]$record.relative_path)
        $parent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    }
    Test-StorePulseRuntimeNodeDependencies -Manifest $Manifest -Root $InstallRoot | Out-Null
    return $true
}
