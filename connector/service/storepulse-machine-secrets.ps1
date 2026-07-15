[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseProgramDataRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}

function Assert-StorePulseWindows {
    if (-not $env:OS -or $env:OS -ne "Windows_NT") {
        throw "StorePulse machine secrets require Windows DPAPI."
    }
    try {
        Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
    }
    catch {
    }
    if (-not ("Security.Cryptography.ProtectedData" -as [type])) {
        throw "Windows DPAPI ProtectedData API is unavailable in this PowerShell runtime."
    }
}

function Protect-StorePulseMachineSecret {
    param([Parameter(Mandatory)][string]$PlainText)
    Assert-StorePulseWindows
    $bytes = [Text.Encoding]::UTF8.GetBytes($PlainText)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    return [Convert]::ToBase64String($protected)
}

function Unprotect-StorePulseMachineSecret {
    param([Parameter(Mandatory)][string]$EncryptedText)
    Assert-StorePulseWindows
    $bytes = [Convert]::FromBase64String($EncryptedText)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    return [Text.Encoding]::UTF8.GetString($plain)
}

function Read-StorePulseMachineSecrets {
    param([string]$Path = "")
    $secretsPath = if ([string]::IsNullOrWhiteSpace($Path)) { Get-StorePulseSecretsPath } else { $Path }
    if (-not (Test-Path -LiteralPath $secretsPath -PathType Leaf)) { throw "StorePulse machine secrets file not found." }
    $encrypted = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
    $result = [ordered]@{}
    foreach ($name in @("commander_username", "commander_password", "connector_token")) {
        $property = $encrypted.PSObject.Properties[$name]
        if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            throw "Required StorePulse machine secret is missing: $name"
        }
        $result[$name] = Unprotect-StorePulseMachineSecret -EncryptedText ([string]$property.Value)
    }
    return [PSCustomObject]$result
}

function Set-StorePulseSecretAcl {
    param([Parameter(Mandatory)][string]$Path)
    try {
        $acl = Get-Acl -LiteralPath $Path
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in @($acl.Access)) {
            [void]$acl.RemoveAccessRule($rule)
        }
        foreach ($identity in @("SYSTEM", "Administrators")) {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow")
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $Path -AclObject $acl
    }
    catch {
        Write-Warning "Unable to tighten StorePulse secrets ACL. Run elevated to repair ACLs."
    }
}

function Write-StorePulseMachineSecrets {
    param(
        [Parameter(Mandatory)]$Secrets,
        [string]$Path = "",
        [switch]$CreateDirectories
    )
    Assert-StorePulseWindows
    $secretsPath = if ([string]::IsNullOrWhiteSpace($Path)) { Get-StorePulseSecretsPath } else { $Path }
    $parent = Split-Path -Parent $secretsPath
    if ($CreateDirectories -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "Secrets directory does not exist." }
    $output = [ordered]@{}
    foreach ($name in @("commander_username", "commander_password", "connector_token")) {
        $property = $Secrets.PSObject.Properties[$name]
        if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            throw "Required StorePulse machine secret is missing: $name"
        }
        $output[$name] = Protect-StorePulseMachineSecret -PlainText ([string]$property.Value)
    }
    $output | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $secretsPath -Encoding UTF8
    Set-StorePulseSecretAcl -Path $secretsPath
    return $secretsPath
}

function Test-StorePulseMachineSecrets {
    param([Parameter(Mandatory)]$Secrets)
    foreach ($name in @("commander_username", "commander_password", "connector_token")) {
        $property = $Secrets.PSObject.Properties[$name]
        if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            throw "Required StorePulse machine secret is missing: $name"
        }
    }
    return $true
}
