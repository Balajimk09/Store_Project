[CmdletBinding()]
param()

Set-StrictMode -Version Latest

function Invoke-StorePulseApprovedInstallerWorkflow {
    param(
        [Parameter(Mandatory)][hashtable]$Operations
    )
    $required = @(
        "UpdateConfiguration", "RestoreConfiguration", "ValidateSecrets", "ValidateSource", "ValidateVerifone",
        "EnsureDirectories", "CreateInstallBackup", "CopyPayload", "ValidateInstalled", "ConfigureService",
        "RestoreInstallBackup", "CleanupInstallBackup"
    )
    foreach ($name in $required) {
        if (-not $Operations.ContainsKey($name) -or $Operations[$name] -isnot [scriptblock]) { throw "installer_operations_invalid" }
    }

    $configuration = $null
    $installBackup = $null
    try {
        $configuration = & $Operations.UpdateConfiguration
        & $Operations.ValidateSecrets
        & $Operations.ValidateSource
        & $Operations.ValidateVerifone
        & $Operations.EnsureDirectories
        $installBackup = & $Operations.CreateInstallBackup
        try {
            & $Operations.CopyPayload
            & $Operations.ValidateInstalled
            & $Operations.ConfigureService
        }
        catch {
            if ($null -ne $installBackup) { & $Operations.RestoreInstallBackup $installBackup }
            throw
        }
        finally {
            if ($null -ne $installBackup) { & $Operations.CleanupInstallBackup $installBackup }
        }
        return $configuration
    }
    catch {
        if ($null -ne $configuration -and [bool]$configuration.changed) { & $Operations.RestoreConfiguration $configuration }
        throw
    }
}
