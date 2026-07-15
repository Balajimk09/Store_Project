[CmdletBinding()]
param(
    [string]$InstallPath = "",
    [string]$CommanderIp = "",
    [string]$SourceStoreNumber = "",
    [string]$WorkingRoot = "",
    [string]$ArchiveRoot = "",
    [string]$Endpoint = "",
    [string]$PeriodFilename = "",
    [ValidateRange(1, 1000)][int]$BatchSize = 500,
    [switch]$DryRun,
    [switch]$FetchOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ("StorePulse.NativeCredential" -as [type])) {
    Add-Type -TypeDefinition @"
using System;

namespace StorePulse
{
    public static class NativeCredential
    {
        public static string[] ReadGeneric(string target)
        {
            string username = Environment.GetEnvironmentVariable("STOREPULSE_COMMANDER_USERNAME", EnvironmentVariableTarget.Process) ?? string.Empty;
            string password = Environment.GetEnvironmentVariable("STOREPULSE_COMMANDER_PASSWORD", EnvironmentVariableTarget.Process) ?? string.Empty;
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            {
                throw new InvalidOperationException("Machine-wide Commander credentials are unavailable in the service process environment.");
            }
            return new[] { username, password };
        }
    }
}
"@
}

$finalizerPath = Join-Path $PSScriptRoot "storepulse-finalize-closed-day.ps1"
if (-not (Test-Path -LiteralPath $finalizerPath -PathType Leaf)) {
    throw "Closed-day finalizer script is missing."
}

$arguments = @(
    "-InstallPath", $InstallPath,
    "-CommanderIp", $CommanderIp,
    "-CredentialTarget", "StorePulseMachineSecrets",
    "-SourceStoreNumber", $SourceStoreNumber,
    "-WorkingRoot", $WorkingRoot,
    "-ArchiveRoot", $ArchiveRoot,
    "-Endpoint", $Endpoint,
    "-BatchSize", [string]$BatchSize
)
if (-not [string]::IsNullOrWhiteSpace($PeriodFilename)) { $arguments += @("-PeriodFilename", $PeriodFilename) }
if ($DryRun) { $arguments += "-DryRun" }
if ($FetchOnly) { $arguments += "-FetchOnly" }

& $finalizerPath @arguments
