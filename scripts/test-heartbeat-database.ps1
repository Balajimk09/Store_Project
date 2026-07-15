[CmdletBinding()]
param(
    [string]$SupabaseExe = "supabase",
    [string]$DatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    [string]$TestPath = "",
    [switch]$SkipStop
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RequiredSupabaseVersion = "2.109.1"
$repoRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($TestPath)) {
    $TestPath = Join-Path $repoRoot "supabase\tests\connector_heartbeat_status.sql"
}

function Assert-StorePulseLocalDatabaseUrl {
    param([Parameter(Mandatory = $true)][string]$Url)

    if ($Url -notmatch "^(postgres(?:ql)?://)") {
        throw "DatabaseUrl must be a PostgreSQL connection string."
    }

    if ($Url -notmatch "(@|\b)(127\.0\.0\.1|localhost)(:|/)") {
        throw "DatabaseUrl must point to local Supabase only."
    }

    if ($Url -match "supabase\.co|pooler\.supabase|amazonaws\.com|azure\.com|googleapis\.com") {
        throw "DatabaseUrl appears to reference a remote or production database."
    }
}

function Assert-NoProductionSupabaseContext {
    $linkedProjectFiles = @(
        (Join-Path $repoRoot "supabase\.temp\project-ref"),
        (Join-Path $repoRoot "supabase\.temp\pooler-url")
    )

    foreach ($path in $linkedProjectFiles) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $value = (Get-Content -LiteralPath $path -Raw).Trim()
            if ($value) {
                throw "Linked Supabase project metadata was detected at $path. Refusing to run database verification."
            }
        }
    }

    $environmentNames = @(
        "SUPABASE_DB_URL",
        "DATABASE_URL",
        "POSTGRES_URL",
        "SUPABASE_PROJECT_REF",
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_SERVICE_ROLE_KEY"
    )

    foreach ($name in $environmentNames) {
        $item = Get-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        if ($null -eq $item) {
            continue
        }

        $value = [string]$item.Value
        if ($value -match "supabase\.co|pooler\.supabase|postgres://|postgresql://|service_role|eyJ") {
            throw "Production-looking Supabase environment variable $name is present. Refusing to run local database verification."
        }
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

Assert-StorePulseLocalDatabaseUrl -Url $DatabaseUrl
Assert-NoProductionSupabaseContext

if (-not (Test-Path -LiteralPath $TestPath -PathType Leaf)) {
    throw "Heartbeat SQL test not found: $TestPath"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $docker) {
    throw "Docker is required for isolated local Supabase verification."
}

Invoke-CheckedCommand -FilePath $docker.Source -Arguments @("version")

$supabase = Get-Command $SupabaseExe -ErrorAction SilentlyContinue
if ($null -eq $supabase) {
    throw "Supabase CLI was not found. Install version $RequiredSupabaseVersion or pass -SupabaseExe."
}

$versionOutput = (& $supabase.Source --version).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read Supabase CLI version."
}

if ($versionOutput -notmatch [regex]::Escape($RequiredSupabaseVersion)) {
    throw "Supabase CLI version $RequiredSupabaseVersion is required. Found: $versionOutput"
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if ($null -eq $psql) {
    throw "psql is required to execute the plain SQL heartbeat regression test."
}

$started = $false

try {
    Invoke-CheckedCommand -FilePath $supabase.Source -Arguments @("start")
    $started = $true

    Invoke-CheckedCommand -FilePath $supabase.Source -Arguments @("db", "reset", "--local")

    Invoke-CheckedCommand -FilePath $psql.Source -Arguments @(
        $DatabaseUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        $TestPath
    )

    Write-Host "Heartbeat database verification passed against isolated local Supabase."
}
finally {
    if ($started -and -not $SkipStop) {
        & $supabase.Source stop --no-backup
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to stop local Supabase cleanly. Exit code: $LASTEXITCODE"
        }
    }
}
