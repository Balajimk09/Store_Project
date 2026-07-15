[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$serviceRoot = $PSScriptRoot
$installRoot = Split-Path -Parent $serviceRoot
$programDataRoot = [Environment]::GetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", "Process")
if ([string]::IsNullOrWhiteSpace($programDataRoot)) {
    $programDataRoot = "C:\ProgramData\StorePulse"
}
$logRoot = Join-Path $programDataRoot "logs"
$startupLog = Join-Path $logRoot "service-entrypoint-startup.log"

try {
    if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    }
    $hostPath = Join-Path $serviceRoot "storepulse-service-host.ps1"
    if (-not (Test-Path -LiteralPath $hostPath -PathType Leaf)) {
        throw "StorePulse service host not found."
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hostPath -Mode Run -InstallRoot $installRoot
    exit $LASTEXITCODE
}
catch {
    try {
        if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) {
            New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
        }
        $safeMessage = $_.Exception.Message
        Add-Content -LiteralPath $startupLog -Encoding UTF8 -Value ("{0} fatal startup failure: {1}" -f (Get-Date).ToString("o"), $safeMessage)
    }
    catch {
    }
    exit 1
}
