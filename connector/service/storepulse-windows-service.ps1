[CmdletBinding()]
param()

Set-StrictMode -Version Latest

if (-not (Get-Command Get-StorePulseInstallRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}

$script:StorePulseServiceName = "StorePulseConnector"
$script:StorePulseServiceDisplayName = "StorePulse Connector Service"
$script:StorePulseServiceDescription = "Runs the StorePulse machine-wide POS connector runtime."
$script:StorePulseManualPilot = "ManualPilot"
$script:StorePulseAutomaticDelayed = "AutomaticDelayed"

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

function Read-StorePulseWinSWXmlStartupMode {
    param([Parameter(Mandatory)][string]$InstallRoot)
    $xmlPath = Get-StorePulseServiceWrapperXmlPath -InstallRoot $InstallRoot
    if (-not (Test-Path -LiteralPath $xmlPath -PathType Leaf)) {
        return $null
    }
    [xml]$xml = Get-Content -LiteralPath $xmlPath -Raw
    $startMode = [string]$xml.service.startmode
    $delayed = [string]$xml.service.delayedAutoStart
    if ($startMode -ieq "Automatic" -and $delayed -ieq "true") {
        return $script:StorePulseAutomaticDelayed
    }
    if ($startMode -ieq "Manual") {
        return $script:StorePulseManualPilot
    }
    return $null
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

function Invoke-StorePulseScConfig {
    param(
        [Parameter(Mandatory)][ValidateSet("ManualPilot", "AutomaticDelayed")][string]$StartupMode,
        [scriptblock]$Executor = $null
    )
    $startValue = if ($StartupMode -eq $script:StorePulseAutomaticDelayed) { "delayed-auto" } else { "demand" }
    $arguments = @("config", $script:StorePulseServiceName, "start=", $startValue)
    if ($null -ne $Executor) {
        return & $Executor "sc.exe" $arguments
    }
    $sc = Get-Command sc.exe -ErrorAction SilentlyContinue
    if ($null -eq $sc) {
        throw "sc.exe was not found."
    }
    $output = & $sc.Source @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "SCM startup-mode update failed: sc.exe $($arguments -join ' ') $($output -join ' ')"
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

function Get-StorePulseServiceConfiguration {
    param(
        [string]$Name = $script:StorePulseServiceName,
        [scriptblock]$Reader = $null
    )
    if ($null -ne $Reader) {
        return & $Reader $Name
    }
    $service = Get-CimInstance -ClassName Win32_Service -Filter ("Name='{0}'" -f $Name.Replace("'", "''")) -ErrorAction Stop
    if ($null -eq $service) {
        throw "Service is not installed: $Name"
    }
    $registryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$Name"
    $delayedAutoStart = $false
    if (Test-Path -LiteralPath $registryPath) {
        $registry = Get-ItemProperty -LiteralPath $registryPath -ErrorAction SilentlyContinue
        if ($null -ne $registry -and $registry.PSObject.Properties["DelayedAutoStart"]) {
            $delayedAutoStart = ([int]$registry.DelayedAutoStart -eq 1)
        }
    }
    $startupMode = if ([string]$service.StartMode -eq "Auto" -and $delayedAutoStart) {
        $script:StorePulseAutomaticDelayed
    }
    elseif ([string]$service.StartMode -eq "Manual") {
        $script:StorePulseManualPilot
    }
    else {
        [string]$service.StartMode
    }
    return [PSCustomObject]@{
        name = [string]$service.Name
        status = [string]$service.State
        start_mode = [string]$service.StartMode
        startup_mode = $startupMode
        delayed_auto_start = $delayedAutoStart
        account = [string]$service.StartName
        image_path = [string]$service.PathName
    }
}

function Assert-StorePulseInstalledServiceStopped {
    param(
        [Parameter(Mandatory)]$Configuration,
        [string]$Operation = "Service reconfiguration"
    )
    if ($null -eq $Configuration) {
        throw "$Operation requires StorePulseConnector to be installed."
    }
    if ([string]$Configuration.status -ne "Stopped") {
        throw "$Operation requires StorePulseConnector to be Stopped."
    }
}

function Assert-StorePulseServiceStartupModeState {
    param(
        [Parameter(Mandatory)]$Configuration,
        [Parameter(Mandatory)][ValidateSet("ManualPilot", "AutomaticDelayed")][string]$ExpectedStartupMode
    )
    if ($ExpectedStartupMode -eq $script:StorePulseAutomaticDelayed) {
        if ([string]$Configuration.start_mode -notin @("Auto", "Automatic")) {
            throw "Service StartMode is not Automatic."
        }
        if (-not [bool]$Configuration.delayed_auto_start) {
            throw "Service delayed-auto state is not enabled."
        }
        return $true
    }
    if ([string]$Configuration.start_mode -ne "Manual") {
        throw "Service StartMode is not Manual."
    }
    if ([bool]$Configuration.delayed_auto_start) {
        throw "Service delayed-auto state is still enabled."
    }
    return $true
}

function Get-StorePulseInstalledStartupMode {
    param(
        [string]$InstallRoot = "",
        [scriptblock]$StateReader = $null
    )
    $config = Get-StorePulseServiceConfiguration -Reader $StateReader
    if ($config.startup_mode -in @($script:StorePulseManualPilot, $script:StorePulseAutomaticDelayed)) {
        return [string]$config.startup_mode
    }
    $xmlMode = Read-StorePulseWinSWXmlStartupMode -InstallRoot (Get-StorePulseInstallRoot -Root $InstallRoot)
    if ($null -ne $xmlMode) {
        return $xmlMode
    }
    throw "Installed service startup mode could not be determined."
}

function Set-StorePulseServiceStartupMode {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string]$InstallRoot = "",
        [string]$ProgramDataRoot = "",
        [Parameter(Mandatory)][ValidateSet("ManualPilot", "AutomaticDelayed")][string]$StartupMode,
        [scriptblock]$ScExecutor = $null,
        [scriptblock]$StateReader = $null
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
    $xmlPath = Get-StorePulseServiceWrapperXmlPath -InstallRoot $resolvedInstallRoot
    $previousXmlExists = Test-Path -LiteralPath $xmlPath -PathType Leaf
    $previousXml = if ($previousXmlExists) { Get-Content -LiteralPath $xmlPath -Raw } else { $null }
    $previousMode = $null
    $previousConfig = Get-StorePulseServiceConfiguration -Reader $StateReader
    Assert-StorePulseInstalledServiceStopped -Configuration $previousConfig -Operation "Startup-mode update"
    if ($previousConfig.startup_mode -in @($script:StorePulseManualPilot, $script:StorePulseAutomaticDelayed)) {
        $previousMode = [string]$previousConfig.startup_mode
    }
    else {
        $previousMode = Read-StorePulseWinSWXmlStartupMode -InstallRoot $resolvedInstallRoot
    }

    $xmlWritten = $false
    try {
        if ($PSCmdlet.ShouldProcess($script:StorePulseServiceName, "Set startup mode to $StartupMode")) {
            Write-StorePulseWinSWXml -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $StartupMode | Out-Null
            $xmlWritten = $true
            Invoke-StorePulseScConfig -StartupMode $StartupMode -Executor $ScExecutor | Out-Null
            $newConfig = Get-StorePulseServiceConfiguration -Reader $StateReader
            Assert-StorePulseInstalledServiceStopped -Configuration $newConfig -Operation "Startup-mode verification"
            Assert-StorePulseServiceStartupModeState -Configuration $newConfig -ExpectedStartupMode $StartupMode | Out-Null
            $xmlMode = Read-StorePulseWinSWXmlStartupMode -InstallRoot $resolvedInstallRoot
            if ($xmlMode -ne $StartupMode) {
                throw "WinSW XML startup mode does not match $StartupMode."
            }
        }
        return [PSCustomObject]@{
            ok = $true
            service_name = $script:StorePulseServiceName
            startup_mode = $StartupMode
            status = "Stopped"
            xml_path = $xmlPath
        }
    }
    catch {
        $original = $_.Exception.Message
        $rollbackErrors = New-Object System.Collections.Generic.List[string]
        try {
            if ($previousXmlExists) {
                $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                [IO.File]::WriteAllText($xmlPath, $previousXml, $utf8NoBom)
            }
            elseif ($xmlWritten -and (Test-Path -LiteralPath $xmlPath -PathType Leaf)) {
                Remove-Item -LiteralPath $xmlPath -Force
            }
        }
        catch {
            [void]$rollbackErrors.Add("XML rollback failed: $($_.Exception.Message)")
        }
        if ($previousMode -in @($script:StorePulseManualPilot, $script:StorePulseAutomaticDelayed)) {
            try {
                Invoke-StorePulseScConfig -StartupMode $previousMode -Executor $ScExecutor | Out-Null
                $restored = Get-StorePulseServiceConfiguration -Reader $StateReader
                Assert-StorePulseInstalledServiceStopped -Configuration $restored -Operation "Startup-mode rollback verification"
                Assert-StorePulseServiceStartupModeState -Configuration $restored -ExpectedStartupMode $previousMode | Out-Null
            }
            catch {
                [void]$rollbackErrors.Add("SCM rollback failed: $($_.Exception.Message)")
            }
        }
        if ($rollbackErrors.Count -gt 0) {
            throw "$original Rollback also failed: $($rollbackErrors -join ' ')"
        }
        throw $original
    }
}

function Install-StorePulseWindowsService {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string]$InstallRoot = "",
        [string]$ProgramDataRoot = "",
        [ValidateSet("ManualPilot", "AutomaticDelayed")][string]$StartupMode = "ManualPilot",
        [switch]$ValidateOnly,
        [scriptblock]$Executor = $null,
        [scriptblock]$GetService = $null
    )
    $resolvedInstallRoot = Get-StorePulseInstallRoot -Root $InstallRoot
    $resolvedProgramDataRoot = Get-StorePulseProgramDataRoot -Root $ProgramDataRoot
    $plan = Get-StorePulseServicePlan -InstallRoot $resolvedInstallRoot -ProgramDataRoot $resolvedProgramDataRoot -StartupMode $StartupMode
    if ($ValidateOnly) { return $plan }
    if (Test-StorePulseServiceInstalled -GetService $GetService) {
        throw "StorePulseConnector is already installed; use Set-StorePulseServiceStartupMode for startup-mode changes."
    }
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
