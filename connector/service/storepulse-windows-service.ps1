[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseInstallRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}

$script:StorePulseServiceName = "StorePulseConnector"
$script:StorePulseServiceDisplayName = "StorePulse Connector Service"
$script:StorePulseServiceDescription = "Runs the StorePulse machine-wide POS connector runtime."

function ConvertTo-StorePulseQuotedArgument {
    param([Parameter(Mandatory)][string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Assert-StorePulsePathUnderRoot {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Name
    )
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Name must be under the StorePulse install root."
    }
    return $fullPath
}

function Get-StorePulseServiceHostRoot {
    param([string]$InstallRoot = "")
    return (Join-Path (Join-Path (Get-StorePulseInstallRoot -Root $InstallRoot) "service") "host")
}

function Get-StorePulseServiceWrapperPath {
    param([string]$InstallRoot = "")
    return (Join-Path (Get-StorePulseServiceHostRoot -InstallRoot $InstallRoot) "StorePulseConnector.exe")
}

function Get-StorePulseServiceWrapperXmlPath {
    param([string]$InstallRoot = "")
    return (Join-Path (Get-StorePulseServiceHostRoot -InstallRoot $InstallRoot) "StorePulseConnector.xml")
}

function Get-StorePulseServiceEntrypointPath {
    param([string]$InstallRoot = "")
    return (Join-Path (Join-Path (Get-StorePulseInstallRoot -Root $InstallRoot) "service") "storepulse-service-entrypoint.ps1")
}

function Get-StorePulseWinSWManifestPath {
    param([string]$InstallRoot = "")
    return (Join-Path (Join-Path (Get-StorePulseInstallRoot -Root $InstallRoot) "service") "winsw-manifest.json")
}

function Read-StorePulseWinSWManifest {
    param([string]$ManifestPath = "")
    $path = if ([string]::IsNullOrWhiteSpace($ManifestPath)) { Join-Path $PSScriptRoot "winsw-manifest.json" } else { $ManifestPath }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "WinSW manifest not found: $path"
    }
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Test-StorePulseWinSWBinary {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [string]$ManifestPath = "",
        [switch]$PassThru
    )
    try {
        $manifest = Read-StorePulseWinSWManifest -ManifestPath $ManifestPath
        $wrapperPath = Get-StorePulseServiceWrapperPath -InstallRoot $InstallRoot
        if (-not (Test-Path -LiteralPath $wrapperPath -PathType Leaf)) {
            throw "WinSW wrapper is missing: $wrapperPath"
        }
        $actualHash = (Get-FileHash -LiteralPath $wrapperPath -Algorithm SHA256).Hash.ToUpperInvariant()
        $expectedHash = ([string]$manifest.sha256).ToUpperInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "WinSW wrapper SHA-256 mismatch."
        }
        $result = [PSCustomObject]@{
            ok = $true
            status = "runtime_valid"
            version = [string]$manifest.version
            asset_name = [string]$manifest.asset_name
            architecture = [string]$manifest.architecture
            wrapper_path = $wrapperPath
            sha256 = $actualHash
            message = "WinSW wrapper is present and hash-valid."
        }
    }
    catch {
        $result = [PSCustomObject]@{
            ok = $false
            status = "runtime_invalid"
            version = $null
            asset_name = $null
            architecture = $null
            wrapper_path = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { "" } else { Get-StorePulseServiceWrapperPath -InstallRoot $InstallRoot }
            sha256 = $null
            message = $_.Exception.Message
        }
    }
    if ($PassThru) { return $result }
    if (-not [bool]$result.ok) { throw $result.message }
    return $true
}

function New-StorePulseWinSWXml {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][string]$ProgramDataRoot,
        [ValidateSet("ManualPilot", "AutomaticDelayed")][string]$StartupMode = "ManualPilot",
        [string]$PowerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
    $entrypoint = Assert-StorePulsePathUnderRoot -Path (Get-StorePulseServiceEntrypointPath -InstallRoot $resolvedInstallRoot) -Root $resolvedInstallRoot -Name "Service entrypoint"
    $logRoot = Join-Path (Join-Path $resolvedProgramDataRoot "logs") "service-host"
    $startMode = if ($StartupMode -eq "AutomaticDelayed") { "Automatic" } else { "Manual" }
    $delayed = if ($StartupMode -eq "AutomaticDelayed") { "true" } else { "false" }
    $arguments = ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $entrypoint)

    $xml = New-Object System.Xml.XmlDocument
    $service = $xml.CreateElement("service")
    [void]$xml.AppendChild($service)
    foreach ($pair in @(
        @("id", $script:StorePulseServiceName),
        @("name", $script:StorePulseServiceDisplayName),
        @("description", $script:StorePulseServiceDescription),
        @("executable", $PowerShellPath),
        @("arguments", $arguments),
        @("workingdirectory", $resolvedInstallRoot),
        @("logpath", $logRoot),
        @("logmode", "roll"),
        @("startmode", $startMode),
        @("delayedAutoStart", $delayed)
    )) {
        $node = $xml.CreateElement([string]$pair[0])
        $node.InnerText = [string]$pair[1]
        [void]$service.AppendChild($node)
    }
    $account = $xml.CreateElement("serviceaccount")
    $username = $xml.CreateElement("username")
    $username.InnerText = "LocalSystem"
    [void]$account.AppendChild($username)
    [void]$service.AppendChild($account)
    foreach ($failure in @(@("restart", "1 min"), @("restart", "5 min"), @("restart", "15 min"))) {
        $node = $xml.CreateElement("onfailure")
        $node.SetAttribute("action", [string]$failure[0])
        $node.SetAttribute("delay", [string]$failure[1])
        [void]$service.AppendChild($node)
    }
    $reset = $xml.CreateElement("resetfailure")
    $reset.InnerText = "1 day"
    [void]$service.AppendChild($reset)
    return $xml.OuterXml
}

function Write-StorePulseWinSWXml {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][string]$ProgramDataRoot,
        [ValidateSet("ManualPilot", "AutomaticDelayed")][string]$StartupMode = "ManualPilot"
    )
    $xmlPath = Get-StorePulseServiceWrapperXmlPath -InstallRoot $InstallRoot
    $parent = Split-Path -Parent $xmlPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $xml = New-StorePulseWinSWXml -InstallRoot $InstallRoot -ProgramDataRoot $ProgramDataRoot -StartupMode $StartupMode
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($xmlPath, $xml, $utf8NoBom)
    return $xmlPath
}

function Get-StorePulseServiceBinaryPath {
    param([string]$InstallRoot = "")
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    return (Assert-StorePulsePathUnderRoot -Path (Get-StorePulseServiceWrapperPath -InstallRoot $resolvedInstallRoot) -Root $resolvedInstallRoot -Name "Service wrapper")
}

function Get-StorePulseServicePlan {
    param(
        [string]$InstallRoot = "",
        [string]$ProgramDataRoot = "",
        [ValidateSet("ManualPilot", "AutomaticDelayed")][string]$StartupMode = "ManualPilot"
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
    $wrapperPath = Get-StorePulseServiceBinaryPath -InstallRoot $resolvedInstallRoot
    $xmlPath = Get-StorePulseServiceWrapperXmlPath -InstallRoot $resolvedInstallRoot
    $xml = New-StorePulseWinSWXml -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $StartupMode
    return [PSCustomObject]@{
        service_name = $script:StorePulseServiceName
        display_name = $script:StorePulseServiceDisplayName
        description = $script:StorePulseServiceDescription
        account = "LocalSystem"
        startup_mode = $StartupMode
        startup_type = if ($StartupMode -eq "AutomaticDelayed") { "Automatic" } else { "Manual" }
        delayed_auto_start = ($StartupMode -eq "AutomaticDelayed")
        status_after_install = "Stopped"
        wrapper_path = $wrapperPath
        xml_path = $xmlPath
        image_path = $wrapperPath
        binary_path = $wrapperPath
        working_directory = $resolvedInstallRoot
        log_path = Join-Path (Join-Path $resolvedProgramDataRoot "logs") "service-host"
        wrapper_xml = $xml
    }
}

function Invoke-StorePulseWinSWCommand {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][string]$Command,
        [scriptblock]$Executor = $null
    )
    $wrapperPath = Get-StorePulseServiceWrapperPath -InstallRoot $InstallRoot
    if ($null -ne $Executor) {
        return & $Executor $wrapperPath @($Command)
    }
    $output = & $wrapperPath $Command 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "WinSW command failed: $wrapperPath $Command $($output -join ' ')"
    }
    return $output
}

function Test-StorePulseServiceInstalled {
    param(
        [string]$Name = $script:StorePulseServiceName,
        [scriptblock]$GetService = $null
    )
    try {
        if ($null -ne $GetService) {
            return [bool](& $GetService $Name)
        }
        return [bool](Get-Service -Name $Name -ErrorAction Stop)
    }
    catch {
        return $false
    }
}

function Get-StorePulseServiceStatus {
    param(
        [string]$Name = $script:StorePulseServiceName,
        [scriptblock]$GetService = $null
    )
    if ($null -ne $GetService) {
        return & $GetService $Name
    }
    return Get-Service -Name $Name -ErrorAction Stop
}

function Install-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string]$InstallRoot = "",
        [string]$ProgramDataRoot = "",
        [ValidateSet("ManualPilot", "AutomaticDelayed")][string]$StartupMode = "ManualPilot",
        [switch]$ValidateOnly,
        [scriptblock]$Executor = $null
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
    $plan = Get-StorePulseServicePlan -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $StartupMode
    if ($ValidateOnly) { return $plan }
    Test-StorePulseWinSWBinary -InstallRoot $resolvedInstallRoot -ManifestPath (Get-StorePulseWinSWManifestPath -InstallRoot $resolvedInstallRoot) | Out-Null
    Write-StorePulseWinSWXml -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $StartupMode | Out-Null
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Install StorePulse WinSW service")) {
        Invoke-StorePulseWinSWCommand -InstallRoot $resolvedInstallRoot -Command "install" -Executor $Executor | Out-Null
    }
    return $plan
}

function Start-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([string]$InstallRoot = "", [scriptblock]$Executor = $null)
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Start service")) {
        Invoke-StorePulseWinSWCommand -InstallRoot (Get-StorePulseInstallRoot -Root $InstallRoot) -Command "start" -Executor $Executor | Out-Null
    }
}

function Stop-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([string]$InstallRoot = "", [scriptblock]$Executor = $null)
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Stop service")) {
        Invoke-StorePulseWinSWCommand -InstallRoot (Get-StorePulseInstallRoot -Root $InstallRoot) -Command "stop" -Executor $Executor | Out-Null
    }
}

function Restart-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([string]$InstallRoot = "", [scriptblock]$Executor = $null)
    Stop-StorePulseWindowsService -InstallRoot $InstallRoot -Executor $Executor
    Start-StorePulseWindowsService -InstallRoot $InstallRoot -Executor $Executor
}

function Remove-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([string]$InstallRoot = "", [scriptblock]$Executor = $null)
    if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Remove service")) {
        Invoke-StorePulseWinSWCommand -InstallRoot (Get-StorePulseInstallRoot -Root $InstallRoot) -Command "uninstall" -Executor $Executor | Out-Null
    }
}

function Set-StorePulseServiceRecovery {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([scriptblock]$Executor = $null)
    return $true
}
