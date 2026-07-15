[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseProgramDataRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}

function Get-StorePulseInstallationIdPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "state") "installation-id.txt")
}

function Test-StorePulseUuidText {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    return ([string]$Value -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
}

function Get-StorePulseInstallationId {
    param([string]$ProgramDataRoot = "")
    $path = Get-StorePulseInstallationIdPath -ProgramDataRoot $ProgramDataRoot
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $existing = (Get-Content -LiteralPath $path -Raw).Trim()
        if (-not (Test-StorePulseUuidText -Value $existing)) {
            throw "StorePulse installation ID is malformed: $path"
        }
        return $existing.ToLowerInvariant()
    }
    $parent = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $id = [guid]::NewGuid().ToString()
    $tempPath = Join-Path $parent ("installation-id-" + [guid]::NewGuid().ToString("N") + ".tmp")
    try {
        Set-Content -LiteralPath $tempPath -Value $id -Encoding ASCII -NoNewline
        Move-Item -LiteralPath $tempPath -Destination $path -ErrorAction Stop
    }
    catch {
        Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $existing = (Get-Content -LiteralPath $path -Raw).Trim()
            if (Test-StorePulseUuidText -Value $existing) { return $existing.ToLowerInvariant() }
        }
        throw
    }
    return $id
}
