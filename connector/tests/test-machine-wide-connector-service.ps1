[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$serviceRoot = Join-Path $repoRoot "connector\service"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("storepulse-machine-service-tests-" + [guid]::NewGuid().ToString("N"))
$global:MachineServiceFailures = New-Object System.Collections.Generic.List[string]
$global:MachineServicePassCount = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { $global:MachineServicePassCount += 1 } else { $global:MachineServiceFailures.Add($Message) }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -eq $Expected) { $global:MachineServicePassCount += 1 } else { $global:MachineServiceFailures.Add("$Message Expected=[$Expected] Actual=[$Actual]") }
}

function Assert-Throws {
    param([scriptblock]$ScriptBlock, [string]$Message)
    try {
        & $ScriptBlock
        $global:MachineServiceFailures.Add("$Message Expected exception.")
    }
    catch {
        $global:MachineServicePassCount += 1
    }
}

function New-TestConfig {
    param([string]$Root, [string]$InstallRoot)
    [PSCustomObject]@{
        source_store_number = "SYNTH"
        commander_ip = "commander.local"
        commander_install_path = Join-Path $InstallRoot "Commander"
        live_endpoint_url = "https://example.invalid/functions/v1/ingest-pos-transactions"
        finalization_endpoint_url = "https://example.invalid/functions/v1/finalize-pos-business-day"
        live_poll_interval_seconds = 300
        closed_day_poll_interval_seconds = 3600
        install_root = $InstallRoot
        logs_root = Join-Path $Root "logs"
        working_root = Join-Path $Root "working"
        archive_root = Join-Path $Root "archive"
        live_watch_folder = Join-Path (Join-Path $Root "working") "live"
        live_archive_folder = Join-Path (Join-Path $Root "archive") "live"
        closed_day_once_enabled = $false
        live_worker_enabled = $true
        closed_day_worker_enabled = $true
    }
}

function Install-TestNodeRuntime {
    param([string]$InstallRoot, [string]$Architecture = "any")
    $nodeCommand = Get-Command node -ErrorAction Stop
    $nodeSource = $nodeCommand.Source
    $nodeDir = Join-Path (Join-Path $InstallRoot "runtime") "node"
    $serviceDir = Join-Path $InstallRoot "service"
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
    $nodeDestination = Join-Path $nodeDir "node.exe"
    Copy-Item -LiteralPath $nodeSource -Destination $nodeDestination -Force
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $nodeDestination).Hash.ToLowerInvariant()
    [PSCustomObject]@{
        required_node_major = 20
        expected_relative_path = "runtime\node"
        executable_name = "node.exe"
        architecture = $Architecture
        sha256 = $hash
        source = "Synthetic local test runtime"
        version = "test"
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $serviceDir "node-runtime-manifest.json") -Encoding UTF8
    return [PSCustomObject]@{ NodePath = $nodeDestination; Hash = $hash; ManifestPath = (Join-Path $serviceDir "node-runtime-manifest.json") }
}

function Invoke-ConnectorOnceTest {
    param(
        [string]$Name,
        [string]$UploadResult = "success",
        [scriptblock]$Prepare = $null,
        [int]$StabilityWaitMs = 25,
        [string]$ExistingWatch = "",
        [string]$ExistingState = ""
    )
    $dir = Join-Path $tempRoot ("connector-once-" + $Name + "-" + [guid]::NewGuid().ToString("N"))
    $watch = if ([string]::IsNullOrWhiteSpace($ExistingWatch)) { Join-Path $dir "watch" } else { $ExistingWatch }
    $summary = Join-Path $dir "summary.json"
    $state = if ([string]::IsNullOrWhiteSpace($ExistingState)) { Join-Path $dir "state.json" } else { $ExistingState }
    New-Item -ItemType Directory -Path $watch -Force | Out-Null
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    if ($null -ne $Prepare) {
        & $Prepare $watch $state
    }

    $previous = @{}
    foreach ($nameKey in @("STOREPULSE_API_URL", "STOREPULSE_CONNECTOR_TOKEN", "STOREPULSE_WATCH_FOLDER", "STOREPULSE_ARCHIVE_FOLDER", "STOREPULSE_POLL_SECONDS", "STOREPULSE_DRY_RUN", "STOREPULSE_ONCE", "STOREPULSE_SUMMARY_PATH", "STOREPULSE_STATE_PATH", "STOREPULSE_STABILITY_WAIT_MS", "STOREPULSE_CONNECTOR_TEST_UPLOAD_RESULT")) {
        $previous[$nameKey] = [Environment]::GetEnvironmentVariable($nameKey, "Process")
    }
    try {
        [Environment]::SetEnvironmentVariable("STOREPULSE_API_URL", "https://example.invalid", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "synthetic-token", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_WATCH_FOLDER", $watch, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_ARCHIVE_FOLDER", " ", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_POLL_SECONDS", "60", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_DRY_RUN", "false", "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_SUMMARY_PATH", $summary, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_STATE_PATH", $state, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_STABILITY_WAIT_MS", [string]$StabilityWaitMs, "Process")
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TEST_UPLOAD_RESULT", $UploadResult, "Process")
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $output = & node (Join-Path $repoRoot "connector\storepulse-connector.mjs") --once --summary-path $summary 2>&1
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        [PSCustomObject]@{
            ExitCode = $exitCode
            OutputText = (($output | ForEach-Object { [string]$_ }) -join "`n")
            Summary = if (Test-Path -LiteralPath $summary -PathType Leaf) { Get-Content -LiteralPath $summary -Raw | ConvertFrom-Json } else { $null }
            SummaryText = if (Test-Path -LiteralPath $summary -PathType Leaf) { Get-Content -LiteralPath $summary -Raw } else { "" }
            Directory = $dir
            Watch = $watch
            State = $state
        }
    }
    finally {
        foreach ($nameKey in $previous.Keys) {
            [Environment]::SetEnvironmentVariable($nameKey, $previous[$nameKey], "Process")
        }
    }
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$previousProgramData = [Environment]::GetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", "Process")
$previousInstall = [Environment]::GetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", "Process")

try {
    . (Join-Path $serviceRoot "storepulse-machine-config.ps1")
    . (Join-Path $serviceRoot "storepulse-machine-secrets.ps1")
    . (Join-Path $serviceRoot "storepulse-service-runtime.ps1")
    . (Join-Path $serviceRoot "storepulse-windows-service.ps1")
    . (Join-Path $serviceRoot "storepulse-node-runtime.ps1")

    [Environment]::SetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", (Join-Path $tempRoot "ProgramData"), "Process")
    [Environment]::SetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", (Join-Path $tempRoot "ProgramFiles\StorePulse\Connector"), "Process")

    Assert-Equal -Actual (Get-StorePulseProgramDataRoot -Root "") -Expected (Join-Path $tempRoot "ProgramData") -Message "program data root override honored"
    Assert-Equal -Actual (Get-StorePulseInstallRoot -Root "") -Expected (Join-Path $tempRoot "ProgramFiles\StorePulse\Connector") -Message "install root override honored"
    Assert-Equal -Actual (Get-StorePulseConfigPath) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "config.json") -Message "config path default"
    Assert-Equal -Actual (Get-StorePulseSecretsPath) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "secrets.json") -Message "secrets path default"
    Assert-Equal -Actual (Get-StorePulseLogsRoot) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "logs") -Message "logs path default"
    Assert-Equal -Actual (Get-StorePulseWorkingRoot) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "working") -Message "working path default"
    Assert-Equal -Actual (Get-StorePulseArchiveRoot) -Expected (Join-Path (Join-Path $tempRoot "ProgramData") "archive") -Message "archive path default"

    $manifestPath = Join-Path $serviceRoot "install-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $manifest.service_name -Expected "StorePulseConnector" -Message "manifest service name"
    Assert-Equal -Actual $manifest.service_display_name -Expected "StorePulse Connector Service" -Message "manifest display name"
    Assert-Equal -Actual $manifest.version -Expected "3.0.0-servicehost-cutover1" -Message "manifest cutover hotfix version"
    Assert-True -Condition (($manifest.required_files -contains "service\storepulse-windows-service.ps1") -and ($manifest.required_files -contains "service\storepulse-service-entrypoint.ps1")) -Message "manifest includes service files"
    Assert-Equal -Actual $manifest.bundled_node_runtime_relative_path -Expected "runtime\node" -Message "manifest declares private Node runtime path"
    Assert-True -Condition ($manifest.required_files -contains "service\node-runtime-manifest.json") -Message "manifest includes Node runtime manifest"

    $programDataRoot = Get-StorePulseProgramDataRoot
    $installRoot = Get-StorePulseInstallRoot
    New-Item -ItemType Directory -Path $programDataRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

    foreach ($name in @("storepulse-connector.mjs", "storepulse-finalize-closed-day.ps1", "storepulse-finalize-closed-day-machine.ps1", "storepulse-normalize-transactions.ps1", "storepulse-upload-finalized-business-day.ps1", "storepulse-upload-normalized-transactions.ps1")) {
        Set-Content -LiteralPath (Join-Path $installRoot $name) -Value "placeholder" -Encoding UTF8
    }

    $serviceSubdir = Join-Path $installRoot "service"
    New-Item -ItemType Directory -Path $serviceSubdir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $serviceSubdir "storepulse-service-entrypoint.ps1") -Value "placeholder" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $serviceSubdir "storepulse-current-shift-worker.ps1") -Value "placeholder" -Encoding UTF8
    $testNode = Install-TestNodeRuntime -InstallRoot $installRoot
    $hostRoot = Join-Path $serviceSubdir "host"
    New-Item -ItemType Directory -Path $hostRoot -Force | Out-Null
    $wrapperPath = Join-Path $hostRoot "StorePulseConnector.exe"
    Set-Content -LiteralPath $wrapperPath -Value "synthetic winsw wrapper" -Encoding UTF8
    $wrapperHash = (Get-FileHash -LiteralPath $wrapperPath -Algorithm SHA256).Hash.ToUpperInvariant()
    [PSCustomObject]@{
        name = "WinSW"
        version = "2.12.0"
        asset_name = "WinSW-x64.exe"
        official_release_url = "https://github.com/winsw/winsw/releases/tag/v2.12.0"
        download_url = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
        sha256 = $wrapperHash
        architecture = "x64"
        license = "MIT"
        installed_relative_path = "service\host\StorePulseConnector.exe"
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $serviceSubdir "winsw-manifest.json") -Encoding UTF8

    $servicePlan = Install-StorePulseWindowsService -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode ManualPilot -ValidateOnly
    Assert-Equal -Actual $servicePlan.service_name -Expected "StorePulseConnector" -Message "service plan name"
    Assert-Equal -Actual $servicePlan.display_name -Expected "StorePulse Connector Service" -Message "service plan display name"
    Assert-Equal -Actual $servicePlan.account -Expected "LocalSystem" -Message "service plan LocalSystem account"
    Assert-Equal -Actual $servicePlan.startup_type -Expected "Manual" -Message "ManualPilot service plan uses Manual startup"
    Assert-True -Condition (-not [bool]$servicePlan.delayed_auto_start) -Message "ManualPilot does not use delayed auto start"
    Assert-True -Condition ($servicePlan.image_path.EndsWith("service\host\StorePulseConnector.exe", [StringComparison]::OrdinalIgnoreCase)) -Message "service ImagePath points to StorePulseConnector.exe"
    Assert-True -Condition ($servicePlan.image_path -notmatch "powershell\.exe") -Message "service ImagePath does not point directly to PowerShell"
    Assert-True -Condition ($servicePlan.wrapper_path.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)) -Message "wrapper executable path is under install root"
    Assert-True -Condition ($servicePlan.wrapper_xml -match 'powershell\.exe' -and $servicePlan.wrapper_xml -match 'storepulse-service-entrypoint\.ps1') -Message "wrapper XML launches PowerShell entrypoint"
    Assert-True -Condition ($servicePlan.wrapper_xml -match 'LocalSystem') -Message "wrapper XML uses LocalSystem"
    Assert-True -Condition ($servicePlan.wrapper_xml -match [regex]::Escape((Join-Path $programDataRoot "logs\service-host"))) -Message "wrapper logs are directed under ProgramData"
    Assert-True -Condition ($servicePlan.wrapper_xml -notmatch "synthetic-token|synthetic-password|connector_token") -Message "wrapper XML excludes secrets"
    $automaticPlan = Install-StorePulseWindowsService -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode AutomaticDelayed -ValidateOnly
    Assert-Equal -Actual $automaticPlan.startup_type -Expected "Automatic" -Message "AutomaticDelayed uses Automatic startup only when explicit"
    Assert-True -Condition ([bool]$automaticPlan.delayed_auto_start) -Message "AutomaticDelayed uses delayed auto start"
    $winswValid = Test-StorePulseWinSWBinary -InstallRoot $installRoot -ManifestPath (Join-Path $serviceSubdir "winsw-manifest.json") -PassThru
    Assert-True -Condition ([bool]$winswValid.ok -and $winswValid.architecture -eq "x64") -Message "WinSW wrapper validates with matching SHA and architecture"
    $missingWinswRoot = Join-Path $tempRoot "missing-winsw"
    New-Item -ItemType Directory -Path (Join-Path $missingWinswRoot "service") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $serviceSubdir "winsw-manifest.json") -Destination (Join-Path (Join-Path $missingWinswRoot "service") "winsw-manifest.json")
    $missingWinsw = Test-StorePulseWinSWBinary -InstallRoot $missingWinswRoot -ManifestPath (Join-Path (Join-Path $missingWinswRoot "service") "winsw-manifest.json") -PassThru
    Assert-True -Condition (-not [bool]$missingWinsw.ok) -Message "missing WinSW wrapper fails closed"
    $badWinswManifestPath = Join-Path $serviceSubdir "winsw-manifest-bad.json"
    (Get-Content -LiteralPath (Join-Path $serviceSubdir "winsw-manifest.json") -Raw).Replace($wrapperHash, ("0" * 64)) | Set-Content -LiteralPath $badWinswManifestPath -Encoding UTF8
    $badWinsw = Test-StorePulseWinSWBinary -InstallRoot $installRoot -ManifestPath $badWinswManifestPath -PassThru
    Assert-True -Condition (-not [bool]$badWinsw.ok) -Message "WinSW wrapper hash mismatch fails closed"
    Assert-Throws -ScriptBlock { Assert-StorePulsePathUnderRoot -Path (Join-Path $tempRoot "outside\entrypoint.ps1") -Root $installRoot -Name "outside test" | Out-Null } -Message "service path outside install root rejected"

    $global:CapturedServiceCommands = @()
    $serviceExecutor = { param([string]$Wrapper, [string[]]$Arguments) $global:CapturedServiceCommands += ,($Wrapper + " " + ($Arguments -join " ")); return "mocked" }
    Install-StorePulseWindowsService -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode ManualPilot -Executor $serviceExecutor -GetService { param($Name) $false } | Out-Null
    Assert-True -Condition (($global:CapturedServiceCommands -join "`n") -match "StorePulseConnector\.exe install") -Message "install command registers through WinSW wrapper"
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $hostRoot "StorePulseConnector.xml") -PathType Leaf) -Message "installer writes WinSW XML beside wrapper"
    $installedXml = Get-Content -LiteralPath (Join-Path $hostRoot "StorePulseConnector.xml") -Raw
    Assert-True -Condition ($installedXml -match '<startmode>Manual</startmode>') -Message "ManualPilot installs as Manual"
    Assert-True -Condition ($installedXml -match '<delayedAutoStart>false</delayedAutoStart>') -Message "ManualPilot remains stopped and not delayed auto"
    Assert-True -Condition ($installedXml -match '<onfailure action=\"restart\" delay=\"1 min\"' -and $installedXml -match '<onfailure action=\"restart\" delay=\"5 min\"' -and $installedXml -match '<onfailure action=\"restart\" delay=\"15 min\"') -Message "WinSW XML contains restart recovery policy"
    Assert-True -Condition (($global:CapturedServiceCommands -join "`n") -notmatch "synthetic-token|synthetic-password") -Message "service command generation excludes secrets"
    Assert-Throws -ScriptBlock {
        Install-StorePulseWindowsService -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode ManualPilot -Executor $serviceExecutor -GetService { param($Name) $true } | Out-Null
    } -Message "fresh Install fails when service already exists"

    $global:StartupState = [PSCustomObject]@{
        name = "StorePulseConnector"
        status = "Stopped"
        start_mode = "Manual"
        startup_mode = "ManualPilot"
        delayed_auto_start = $false
        account = "LocalSystem"
        image_path = $wrapperPath
    }
    $global:ScCommands = @()
    $stateReader = { param($Name) $global:StartupState }
    $scExecutor = {
        param([string]$Executable, [string[]]$Arguments)
        $global:ScCommands += ,($Executable + " " + ($Arguments -join " "))
        $mode = $Arguments[-1]
        if ($mode -eq "delayed-auto") {
            $global:StartupState.start_mode = "Auto"
            $global:StartupState.startup_mode = "AutomaticDelayed"
            $global:StartupState.delayed_auto_start = $true
        }
        elseif ($mode -eq "demand") {
            $global:StartupState.start_mode = "Manual"
            $global:StartupState.startup_mode = "ManualPilot"
            $global:StartupState.delayed_auto_start = $false
        }
        return "mock sc"
    }
    Set-StorePulseServiceStartupMode -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode AutomaticDelayed -ScExecutor $scExecutor -StateReader $stateReader | Out-Null
    $automaticXml = Get-Content -LiteralPath (Join-Path $hostRoot "StorePulseConnector.xml") -Raw
    Assert-True -Condition (($global:ScCommands -join "`n") -match "sc\.exe config StorePulseConnector start= delayed-auto") -Message "SetAutomaticDelayed uses SCM delayed-auto configuration"
    Assert-True -Condition ($automaticXml -match '<startmode>Automatic</startmode>' -and $automaticXml -match '<delayedAutoStart>true</delayedAutoStart>') -Message "SetAutomaticDelayed writes Automatic XML"
    Assert-Equal -Actual $global:StartupState.status -Expected "Stopped" -Message "SetAutomaticDelayed leaves service stopped"
    Assert-True -Condition (($global:ScCommands -join "`n") -notmatch "StorePulseConnector\.exe install") -Message "existing AutomaticDelayed transition does not invoke WinSW install"
    Set-StorePulseServiceStartupMode -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode ManualPilot -ScExecutor $scExecutor -StateReader $stateReader | Out-Null
    $manualXml = Get-Content -LiteralPath (Join-Path $hostRoot "StorePulseConnector.xml") -Raw
    Assert-True -Condition (($global:ScCommands -join "`n") -match "sc\.exe config StorePulseConnector start= demand") -Message "SetManualPilot uses SCM demand configuration"
    Assert-True -Condition ($manualXml -match '<startmode>Manual</startmode>' -and $manualXml -match '<delayedAutoStart>false</delayedAutoStart>') -Message "SetManualPilot writes Manual XML"
    Assert-True -Condition (-not [bool]$global:StartupState.delayed_auto_start) -Message "SetManualPilot clears delayed-auto state"
    $global:StartupState.status = "Running"
    Assert-Throws -ScriptBlock {
        Set-StorePulseServiceStartupMode -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode AutomaticDelayed -ScExecutor $scExecutor -StateReader $stateReader | Out-Null
    } -Message "SetAutomaticDelayed fails before modifying a running service"
    Assert-Throws -ScriptBlock {
        Set-StorePulseServiceStartupMode -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode ManualPilot -ScExecutor $scExecutor -StateReader $stateReader | Out-Null
    } -Message "SetManualPilot fails before modifying a running service"
    $global:StartupState.status = "Stopped"
    $previousXmlForRollback = Get-Content -LiteralPath (Join-Path $hostRoot "StorePulseConnector.xml") -Raw
    $failingSc = { param([string]$Executable, [string[]]$Arguments) throw "synthetic sc failure" }
    Assert-Throws -ScriptBlock {
        Set-StorePulseServiceStartupMode -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode AutomaticDelayed -ScExecutor $failingSc -StateReader $stateReader | Out-Null
    } -Message "SCM update failure fails closed"
    Assert-Equal -Actual (Get-Content -LiteralPath (Join-Path $hostRoot "StorePulseConnector.xml") -Raw) -Expected $previousXmlForRollback -Message "SCM failure restores previous XML"
    $mismatchSc = {
        param([string]$Executable, [string[]]$Arguments)
        $global:StartupState.start_mode = "Manual"
        $global:StartupState.startup_mode = "ManualPilot"
        $global:StartupState.delayed_auto_start = $false
        return "mock mismatch"
    }
    Assert-Throws -ScriptBlock {
        Set-StorePulseServiceStartupMode -InstallRoot $installRoot -ProgramDataRoot $programDataRoot -StartupMode AutomaticDelayed -ScExecutor $mismatchSc -StateReader $stateReader | Out-Null
    } -Message "verification mismatch fails and rolls back"

    $global:ControlServiceState = [PSCustomObject]@{ Status = "Stopped" }
    Assert-True -Condition (-not (Test-StorePulseServiceInstalled -GetService { param($Name) $null })) -Message "service installed test handles absent service"
    Assert-True -Condition (Test-StorePulseServiceInstalled -GetService { param($Name) $global:ControlServiceState }) -Message "service installed test handles present service"
    Assert-Equal -Actual (Get-StorePulseServiceStatus -GetService { param($Name) $global:ControlServiceState }).Status -Expected "Stopped" -Message "service status returns mocked state"

    $nodeRuntimeValid = Test-StorePulseNodeRuntime -InstallRoot $installRoot -ManifestPath $testNode.ManifestPath -PassThru
    Assert-True -Condition ([bool]$nodeRuntimeValid.ok) -Message "private Node runtime validates with matching SHA"
    $missingRuntimeRoot = Join-Path $tempRoot "missing-runtime"
    New-Item -ItemType Directory -Path (Join-Path $missingRuntimeRoot "service") -Force | Out-Null
    Copy-Item -LiteralPath $testNode.ManifestPath -Destination (Join-Path (Join-Path $missingRuntimeRoot "service") "node-runtime-manifest.json")
    $nodeRuntimeMissing = Test-StorePulseNodeRuntime -InstallRoot $missingRuntimeRoot -ManifestPath (Join-Path (Join-Path $missingRuntimeRoot "service") "node-runtime-manifest.json") -PassThru
    Assert-Equal -Actual $nodeRuntimeMissing.status -Expected "runtime_missing" -Message "missing private Node runtime is reported"
    $badHashManifest = Join-Path $serviceSubdir "node-runtime-bad-hash.json"
    (Get-Content -LiteralPath $testNode.ManifestPath -Raw).Replace($testNode.Hash, ("0" * 64)) | Set-Content -LiteralPath $badHashManifest -Encoding UTF8
    $nodeRuntimeBadHash = Test-StorePulseNodeRuntime -InstallRoot $installRoot -ManifestPath $badHashManifest -PassThru
    Assert-Equal -Actual $nodeRuntimeBadHash.status -Expected "runtime_invalid" -Message "Node runtime SHA mismatch is reported"
    $badArchManifest = Join-Path $serviceSubdir "node-runtime-bad-arch.json"
    $badArchObject = Get-Content -LiteralPath $testNode.ManifestPath -Raw | ConvertFrom-Json
    $badArchObject.architecture = "not-this-architecture"
    $badArchObject | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $badArchManifest -Encoding UTF8
    $nodeRuntimeBadArch = Test-StorePulseNodeRuntime -InstallRoot $installRoot -ManifestPath $badArchManifest -PassThru
    Assert-Equal -Actual $nodeRuntimeBadArch.status -Expected "runtime_invalid" -Message "Node runtime architecture mismatch is reported"

    $config = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    Assert-True -Condition (Test-StorePulseMachineConfig -Config $config) -Message "valid config accepted"
    $configPath = Write-StorePulseMachineConfig -Config $config -CreateDirectories
    Assert-True -Condition (Test-Path -LiteralPath $configPath -PathType Leaf) -Message "config written"
    $configText = Get-Content -LiteralPath $configPath -Raw
    Assert-True -Condition ($configText -notmatch "commander_password|connector_token|commander_username") -Message "config excludes secret names"

    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.live_endpoint_url = "http://example.invalid"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "non-HTTPS URL rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.source_store_number = "bad/store"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "invalid store number rejected"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; Add-Member -InputObject $bad -NotePropertyName "connector_token" -NotePropertyValue "plain"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "secret in config rejected"

    $configureValidateOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "configure-storepulse-machine-connector.ps1") `
        -ValidateOnly `
        -ConfigPath (Join-Path $programDataRoot "validate-only-config.json") `
        -SecretsPath (Join-Path $programDataRoot "validate-only-secrets.json") `
        -ProgramDataRoot $programDataRoot `
        -InstallRoot $installRoot `
        -SourceStoreNumber "SYNTH" `
        -CommanderIp "commander.local" `
        -CommanderInstallPath (Join-Path $installRoot "Commander") `
        -LiveUploadUrl "https://example.invalid/functions/v1/ingest-pos-transactions" `
        -FinalizationUrl "https://example.invalid/functions/v1/finalize-pos-business-day" `
        -LivePollSeconds 300 `
        -ClosedDayPollSeconds 3600 `
        -LogsRoot (Join-Path $programDataRoot "logs") `
        -WorkingRoot (Join-Path $programDataRoot "working") `
        -ArchiveRoot (Join-Path $programDataRoot "archive") `
        -StateRoot (Join-Path $programDataRoot "state")
    Assert-True -Condition (($configureValidateOutput -join "`n") -match "ValidateOnly complete") -Message "configuration setup ValidateOnly succeeds"
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $programDataRoot "validate-only-config.json"))) -Message "configuration ValidateOnly writes no config"

    $configurePath = Join-Path $programDataRoot "configured.json"
    $configureSecretsPath = Join-Path $programDataRoot "configured-secrets.json"
    $configureOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "configure-storepulse-machine-connector.ps1") `
        -NonInteractive `
        -UseTestPlaintextSecrets `
        -ConfigPath $configurePath `
        -SecretsPath $configureSecretsPath `
        -ProgramDataRoot $programDataRoot `
        -InstallRoot $installRoot `
        -SourceStoreNumber "SYNTH" `
        -CommanderIp "commander.local" `
        -CommanderInstallPath (Join-Path $installRoot "Commander") `
        -LiveUploadUrl "https://example.invalid/functions/v1/ingest-pos-transactions" `
        -FinalizationUrl "https://example.invalid/functions/v1/finalize-pos-business-day" `
        -LivePollSeconds 300 `
        -ClosedDayPollSeconds 3600 `
        -LogsRoot (Join-Path $programDataRoot "logs") `
        -WorkingRoot (Join-Path $programDataRoot "working") `
        -ArchiveRoot (Join-Path $programDataRoot "archive") `
        -StateRoot (Join-Path $programDataRoot "state") `
        -TestCommanderUsername "synthetic-user" `
        -TestCommanderPassword "synthetic-password" `
        -TestConnectorToken "synthetic-token"
    Assert-True -Condition (Test-Path -LiteralPath $configurePath -PathType Leaf) -Message "configuration setup writes config"
    Assert-True -Condition (Test-Path -LiteralPath $configureSecretsPath -PathType Leaf) -Message "configuration setup writes encrypted secrets"
    Assert-True -Condition ((Get-Content -LiteralPath $configureSecretsPath -Raw) -notmatch "synthetic-user|synthetic-password|synthetic-token") -Message "configuration secrets file does not contain plaintext"
    Assert-True -Condition (($configureOutput -join "`n") -notmatch "synthetic-password|synthetic-token") -Message "configuration output excludes secret values"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "configure-storepulse-machine-connector.ps1") `
        -NonInteractive `
        -UseTestPlaintextSecrets `
        -ConfigPath $configurePath `
        -SecretsPath $configureSecretsPath `
        -ProgramDataRoot $programDataRoot `
        -CommanderIp "commander.changed.local" `
        -TestCommanderUsername "synthetic-user" `
        -TestCommanderPassword "synthetic-password" `
        -TestConnectorToken "synthetic-token" | Out-Null
    $partialConfig = Get-Content -LiteralPath $configurePath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $partialConfig.source_store_number -Expected "SYNTH" -Message "partial configuration preserves existing source store"
    Assert-Equal -Actual $partialConfig.commander_ip -Expected "commander.changed.local" -Message "partial configuration updates supplied field"

    $validationReportPath = Join-Path $programDataRoot "state\install-validation.json"
    $validationOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "test-storepulse-installation.ps1") `
        -Mode All `
        -ConfigPath $configurePath `
        -SecretsPath $configureSecretsPath `
        -InstallRoot $installRoot `
        -ProgramDataRoot $programDataRoot `
        -OutputPath $validationReportPath `
        -NoProduction
    Assert-True -Condition (($validationOutput -join "`n") -match "Validation report") -Message "installation validation writes report"
    $validationReport = Get-Content -LiteralPath $validationReportPath -Raw | ConvertFrom-Json
    Assert-True -Condition ([bool]$validationReport.ok) -Message "installation validation report succeeds"
    Assert-True -Condition (($validationReport | ConvertTo-Json -Depth 20) -notmatch "synthetic-password|synthetic-token") -Message "installation validation report excludes secrets"

    $zeroNew = Invoke-ConnectorOnceTest -Name "zero-new"
    Assert-Equal -Actual $zeroNew.ExitCode -Expected 0 -Message "--once zero files exits 0"
    Assert-Equal -Actual $zeroNew.Summary.scanned -Expected 0 -Message "--once zero files scanned count"
    Assert-Equal -Actual $zeroNew.Summary.uploaded -Expected 0 -Message "--once zero files uploaded count"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$zeroNew.Summary.started_at)) -Message "--once summary has started_at"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$zeroNew.Summary.completed_at)) -Message "--once summary has completed_at"

    $uploadedOnce = Invoke-ConnectorOnceTest -Name "upload" -Prepare {
        param($Watch, $State)
        Set-Content -LiteralPath (Join-Path $Watch "report.xml") -Value "<report />" -Encoding UTF8
    }
    Assert-Equal -Actual $uploadedOnce.ExitCode -Expected 0 -Message "--once upload exits 0"
    Assert-Equal -Actual $uploadedOnce.Summary.scanned -Expected 1 -Message "--once scans one eligible file"
    Assert-Equal -Actual $uploadedOnce.Summary.eligible -Expected 1 -Message "--once reports eligible file"
    Assert-Equal -Actual $uploadedOnce.Summary.uploaded -Expected 1 -Message "--once reports uploaded file"

    $duplicateSeed = Invoke-ConnectorOnceTest -Name "duplicate-seed" -Prepare {
        param($Watch, $State)
        Set-Content -LiteralPath (Join-Path $Watch "duplicate.xml") -Value "<report />" -Encoding UTF8
    }
    $duplicate = Invoke-ConnectorOnceTest -Name "duplicate" -ExistingWatch $duplicateSeed.Watch -ExistingState $duplicateSeed.State
    Assert-Equal -Actual $duplicate.ExitCode -Expected 0 -Message "--once duplicate exits 0"
    Assert-Equal -Actual $duplicate.Summary.skipped_duplicate -Expected 1 -Message "--once reports skipped duplicate"

    $unstable = Invoke-ConnectorOnceTest -Name "unstable" -StabilityWaitMs 1000 -Prepare {
        param($Watch, $State)
        $file = Join-Path $Watch "unstable.xml"
        Set-Content -LiteralPath $file -Value "first" -Encoding UTF8
        Start-Job -ScriptBlock {
            param($Path)
            Start-Sleep -Milliseconds 200
            Add-Content -LiteralPath $Path -Value "second"
        } -ArgumentList $file | Out-Null
    }
    Assert-Equal -Actual $unstable.ExitCode -Expected 0 -Message "--once unstable exits 0"
    Assert-Equal -Actual $unstable.Summary.skipped_unstable -Expected 1 -Message "--once reports unstable file"

    $uploadFailure = Invoke-ConnectorOnceTest -Name "upload-failure" -UploadResult "failure" -Prepare {
        param($Watch, $State)
        Set-Content -LiteralPath (Join-Path $Watch "fail.xml") -Value "<report />" -Encoding UTF8
    }
    Assert-True -Condition ($uploadFailure.ExitCode -ne 0) -Message "--once upload failure exits nonzero"
    Assert-Equal -Actual $uploadFailure.Summary.failed -Expected 1 -Message "--once reports upload failure"
    Assert-True -Condition ($uploadFailure.OutputText -notmatch "synthetic-token" -and $uploadFailure.SummaryText -notmatch "synthetic-token") -Message "--once output and summary exclude connector token"

    $connectorSource = Get-Content -LiteralPath (Join-Path $repoRoot "connector\storepulse-connector.mjs") -Raw
    Assert-True -Condition ($connectorSource.Contains("while (!shuttingDown)")) -Message "default continuous polling loop remains present"
    $runtimeSource = Get-Content -LiteralPath (Join-Path $serviceRoot "storepulse-service-runtime.ps1") -Raw
    Assert-True -Condition ($runtimeSource -match 'Test-StorePulseNodeRuntime' -and $runtimeSource -match '\$nodeExe' -and $runtimeSource -notmatch '& node \$connectorScript') -Message "runtime uses private Node runtime instead of global node"

    $secretsObject = [PSCustomObject]@{
        commander_username = "synthetic-user"
        commander_password = "synthetic-password"
        connector_token = "synthetic-token"
    }
    if ($env:OS -eq "Windows_NT") {
        $secretsPath = Write-StorePulseMachineSecrets -Secrets $secretsObject -CreateDirectories
        $secretsText = Get-Content -LiteralPath $secretsPath -Raw
        Assert-True -Condition ($secretsText -notmatch "synthetic-user|synthetic-password|synthetic-token") -Message "secrets file contains encrypted content only"
        $roundTrip = Read-StorePulseMachineSecrets -Path $secretsPath
        Assert-Equal -Actual $roundTrip.commander_username -Expected "synthetic-user" -Message "DPAPI username round trip"
        Assert-Equal -Actual $roundTrip.commander_password -Expected "synthetic-password" -Message "DPAPI password round trip"
        Assert-Equal -Actual $roundTrip.connector_token -Expected "synthetic-token" -Message "DPAPI token round trip"
    }
    else {
        Assert-Throws -ScriptBlock { Protect-StorePulseMachineSecret -PlainText "x" | Out-Null } -Message "DPAPI fails clearly outside Windows"
    }

    $hostOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "storepulse-service-host.ps1") -Mode Validate -ConfigPath $configPath -SecretsPath (Get-StorePulseSecretsPath) -InstallRoot $installRoot
    Assert-True -Condition (($hostOutput -join "`n") -match "Runtime status path") -Message "host Validate mode succeeds"
    Assert-True -Condition (($hostOutput -join "`n") -notmatch "synthetic-password|synthetic-token") -Message "host Validate does not print secrets"

    $secretsPathForRuntime = Get-StorePulseSecretsPath
    $global:MachineLiveCount = 0
    $global:MachineClosedCount = 0
    $onceResult = Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:MachineLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:MachineClosedCount += 1 } `
        -Sleep { param($Seconds) }
    Assert-Equal -Actual $onceResult.iterations -Expected 1 -Message "Once mode runs one iteration"
    Assert-Equal -Actual $global:MachineLiveCount -Expected 1 -Message "Once mode invokes live worker once"
    Assert-Equal -Actual $global:MachineClosedCount -Expected 1 -Message "Once mode invokes closed worker once"

    $statusPath = Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot
    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $status.live_worker.status -Expected "succeeded" -Message "heartbeat records live worker success"
    Assert-Equal -Actual $status.closed_day_worker.status -Expected "succeeded" -Message "heartbeat records closed worker success"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$status.last_heartbeat_at)) -Message "heartbeat timestamp written"
    Assert-True -Condition (($status | ConvertTo-Json -Depth 20) -notmatch "synthetic-password|synthetic-token") -Message "status excludes secrets"

    $logFile = Get-ChildItem -LiteralPath ([string]$config.logs_root) -Filter "runtime-*.jsonl" | Select-Object -First 1
    Assert-True -Condition ($null -ne $logFile) -Message "JSONL runtime log written"
    $logText = Get-Content -LiteralPath $logFile.FullName -Raw
    Assert-True -Condition ($logText -match '"event"') -Message "runtime log is JSON lines"
    Assert-True -Condition ($logText -notmatch "synthetic-password|synthetic-token") -Message "runtime logs exclude secrets"

    $global:MachineClosedAfterLiveFailure = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) throw "live failed with synthetic-token" } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:MachineClosedAfterLiveFailure += 1 } `
        -Sleep { param($Seconds) } | Out-Null
    $failureIsolationStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $global:MachineClosedAfterLiveFailure -Expected 1 -Message "closed worker runs when live worker fails"
    Assert-Equal -Actual $failureIsolationStatus.live_worker.status -Expected "failed" -Message "live worker failure recorded"
    Assert-Equal -Actual $failureIsolationStatus.closed_day_worker.status -Expected "succeeded" -Message "closed worker isolated from live failure"
    Assert-True -Condition (($failureIsolationStatus | ConvertTo-Json -Depth 20) -notmatch "synthetic-token") -Message "failure status redacts token"

    $disabledConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $disabledConfig.live_worker_enabled = $false
    $disabledConfigPath = Join-Path $programDataRoot "disabled-config.json"
    Write-StorePulseMachineConfig -Config $disabledConfig -Path $disabledConfigPath | Out-Null
    $global:DisabledLiveCount = 0
    $global:DisabledClosedCount = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $disabledConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:DisabledLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:DisabledClosedCount += 1 } `
        -Sleep { param($Seconds) } | Out-Null
    Assert-Equal -Actual $global:DisabledLiveCount -Expected 0 -Message "disabled live worker skipped"
    Assert-Equal -Actual $global:DisabledClosedCount -Expected 1 -Message "enabled closed worker still runs"

    $fakeConnectorScript = @'
import { appendFileSync, writeFileSync } from 'node:fs';
const summaryIndex = process.argv.indexOf('--summary-path');
const summaryPath = summaryIndex >= 0 ? process.argv[summaryIndex + 1] : process.env.STOREPULSE_SUMMARY_PATH;
const statePath = process.env.STOREPULSE_STATE_PATH;
appendFileSync(`${statePath}.calls`, `${process.argv.join(' ')}|${process.env.STOREPULSE_WATCH_FOLDER}|${process.env.STOREPULSE_CONNECTOR_TOKEN ? 'token-present' : 'token-missing'}\n`);
writeFileSync(summaryPath, JSON.stringify({
  scanned: 0,
  eligible: 0,
  uploaded: 0,
  skipped_duplicate: 0,
  skipped_unstable: 0,
  failed: 0,
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString()
}, null, 2));
'@
    Set-Content -LiteralPath (Join-Path $installRoot "storepulse-connector.mjs") -Value $fakeConnectorScript -Encoding UTF8
    New-Item -ItemType Directory -Path $config.live_watch_folder -Force | Out-Null
    $defaultLiveConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $defaultLiveConfig.closed_day_worker_enabled = $false
    $defaultLiveConfigPath = Join-Path $programDataRoot "default-live-config.json"
    Write-StorePulseMachineConfig -Config $defaultLiveConfig -Path $defaultLiveConfigPath | Out-Null
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $defaultLiveConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -Sleep { param($Seconds) } | Out-Null
    $defaultLiveStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    $liveStateRoot = Get-StorePulseStateRoot -ProgramDataRoot $programDataRoot
    $liveCallsPath = Join-Path $liveStateRoot "live-upload-state.json.calls"
    $liveCalls = Get-Content -LiteralPath $liveCallsPath -Raw
    Assert-Equal -Actual $defaultLiveStatus.live_worker.status -Expected "succeeded" -Message "runtime default live worker succeeds"
    Assert-True -Condition ($liveCalls -match "--once") -Message "runtime invokes connector with --once"
    Assert-True -Condition ($liveCalls -match "--summary-path") -Message "runtime passes live summary path"
    Assert-True -Condition ($liveCalls -match "token-present") -Message "runtime passes connector token through environment"
    Assert-True -Condition (($defaultLiveStatus.live_worker.last_result | ConvertTo-Json -Depth 10) -notmatch "synthetic-token") -Message "runtime live result excludes token"

    Remove-Item -LiteralPath $liveCallsPath -Force -ErrorAction SilentlyContinue
    $global:RuntimeSleepIntervals = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $defaultLiveConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -Sleep { param($Seconds) $global:RuntimeSleepIntervals += $Seconds } `
        -MaxIterations 2 | Out-Null
    $liveRunCalls = Get-Content -LiteralPath $liveCallsPath -Raw
    Assert-Equal -Actual (($liveRunCalls -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count) -Expected 2 -Message "Run mode repeats one-shot live connector"
    Assert-True -Condition ($global:RuntimeSleepIntervals -contains 300) -Message "Run mode uses configured live polling interval"

    $backoffConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $backoffConfig.closed_day_worker_enabled = $false
    $backoffConfig.live_poll_interval_seconds = 60
    $backoffConfigPath = Join-Path $programDataRoot "backoff-config.json"
    Write-StorePulseMachineConfig -Config $backoffConfig -Path $backoffConfigPath | Out-Null
    $global:BackoffSleeps = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $backoffConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) throw "repeat failure" } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -Sleep { param($Seconds) $global:BackoffSleeps += $Seconds } `
        -MaxIterations 2 | Out-Null
    $backoffStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $backoffStatus.live_worker.consecutive_failures -Expected 2 -Message "backoff tracks consecutive failures"
    Assert-Equal -Actual $backoffStatus.live_worker.next_delay_seconds -Expected 10 -Message "backoff doubles after repeated failure"
    Assert-True -Condition ($global:BackoffSleeps.Count -ge 2) -Message "Run mode uses sleep callback"

    $lockPath = Get-StorePulseRuntimeLockPath -ProgramDataRoot $programDataRoot
    $lockParent = Split-Path -Parent $lockPath
    if (-not (Test-Path -LiteralPath $lockParent -PathType Container)) { New-Item -ItemType Directory -Path $lockParent -Force | Out-Null }
    $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        Assert-Throws -ScriptBlock {
            Invoke-StorePulseServiceRuntime -Mode Once -ConfigPath $configPath -SecretsPath $secretsPathForRuntime -InstallRoot $installRoot -LiveWorker { param($Config,$Secrets,$Root) } -ClosedDayWorker { param($Config,$Secrets,$Root) } -Sleep { param($Seconds) } | Out-Null
        } -Message "single-instance lock prevents second runtime"
    }
    finally {
        $lockStream.Dispose()
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }

    $stopPath = Get-StorePulseRuntimeStopPath -ProgramDataRoot $programDataRoot
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
    $global:RunCancelCount = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:RunCancelCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -Sleep { param($Seconds) Set-Content -LiteralPath $stopPath -Value "stop" -Encoding UTF8 } `
        -MaxIterations 5 | Out-Null
    Assert-True -Condition (Test-Path -LiteralPath $stopPath -PathType Leaf) -Message "stop file created for cancellation"
    Assert-Equal -Actual $global:RunCancelCount -Expected 1 -Message "Run mode cancels after stop file"

    $statusOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "storepulse-service-control.ps1") -Command Status -ProgramDataRoot $programDataRoot
    Assert-True -Condition (($statusOutput -join "`n") -match "runtime_version") -Message "control Status reads heartbeat"
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
    $stopOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "storepulse-service-control.ps1") -Command Stop -ProgramDataRoot $programDataRoot
    Assert-True -Condition (Test-Path -LiteralPath $stopPath -PathType Leaf) -Message "control Stop writes stop file"
    Assert-True -Condition (($stopOutput -join "`n") -match "Stop requested") -Message "control Stop reports stop request"

    try {
        $installOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "install-storepulse-machine-connector.ps1") -ValidateOnly -WhatIf -SourceRoot (Join-Path $repoRoot "connector") -InstallRoot $installRoot -ProgramDataRoot $programDataRoot
        Assert-True -Condition (($installOutput -join "`n") -match "ValidateOnly complete") -Message "installer WhatIf ValidateOnly succeeds"
        Assert-True -Condition (($installOutput -join "`n") -match "Planned service executable" -and ($installOutput -join "`n") -match "ManualPilot") -Message "installer WhatIf shows native wrapper ManualPilot plan"
    }
    catch {
        Assert-True -Condition ($false) -Message "installer ValidateOnly should not require elevation"
    }
    $uninstallOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "uninstall-storepulse-machine-connector.ps1") -WhatIf -InstallRoot $installRoot
    Assert-True -Condition (($uninstallOutput -join "`n") -match "preserved") -Message "uninstall WhatIf preserves ProgramData"

    $controlSource = Get-Content -LiteralPath (Join-Path $serviceRoot "storepulse-service-control.ps1") -Raw
    Assert-True -Condition ($controlSource -match 'InstallStatus' -and $controlSource -match 'PilotStatus' -and $controlSource -match 'CutoverStatus' -and $controlSource -match 'SetAutomaticDelayed' -and $controlSource -match '"Start"' -and $controlSource -match '"Restart"') -Message "control script exposes native service lifecycle commands"
    Assert-True -Condition ($controlSource -match 'StorePulse-CurrentShift-Sync' -and $controlSource -match 'AllowPilotWithScheduledTask') -Message "control Start has scheduled-task duplicate guard with explicit override"
    Assert-True -Condition ($controlSource.Contains('Remove-Item -LiteralPath $stopPath') -and $controlSource.Contains('Set-Content -LiteralPath $stopPath')) -Message "control Start clears stale stop file and Stop writes graceful stop file"
    $uninstallSource = Get-Content -LiteralPath (Join-Path $serviceRoot "uninstall-storepulse-machine-connector.ps1") -Raw
    Assert-True -Condition ($uninstallSource -match 'PurgeData' -and $uninstallSource -match 'ConfirmImpact = "High"') -Message "uninstall purge requires explicit destructive mode"
    $installerSource = Get-Content -LiteralPath (Join-Path $serviceRoot "install-storepulse-machine-connector.ps1") -Raw
    Assert-True -Condition ($installerSource -match 'backupRoot' -and $installerSource -notmatch 'Start-StorePulseWindowsService') -Message "installer contains upgrade rollback without automatic service start"
    Assert-True -Condition ($installerSource -match 'Resolve-StorePulseInstallerStartupMode' -and $installerSource -match 'Set-StorePulseServiceStartupMode') -Message "installer preserves or explicitly applies startup mode for existing services"
    Assert-True -Condition ($installerSource.IndexOf('Test-StorePulseNodeRuntime') -lt $installerSource.LastIndexOf('Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot')) -Message "installer validates Node runtime before service registration"
    Assert-True -Condition ($installerSource.IndexOf('Test-StorePulseWinSWBinary') -lt $installerSource.LastIndexOf('Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot')) -Message "installer validates WinSW before service registration"
    Assert-True -Condition ($installerSource -match 'Read-StorePulseMachineConfig' -and $installerSource -match 'Read-StorePulseMachineSecrets') -Message "installer validates config and secrets before registration"

    foreach ($file in Get-ChildItem -LiteralPath $serviceRoot -Filter "*.ps1") {
        $content = Get-Content -LiteralPath $file.FullName -Raw
        Assert-True -Condition ($content -notmatch "Deepika|AB123|C:\\Users\\|Register-ScheduledTask|New-Service|192\.168\.|ABC") -Message "$($file.Name) has no user/store/service hardcoding"
        Assert-True -Condition ($content -notmatch "Invoke-RestMethod|Invoke-WebRequest") -Message "$($file.Name) performs no network calls"
    }

    Write-Host ("PASS: machine-wide connector service tests passed ({0} assertions)." -f $global:MachineServicePassCount)
}
finally {
    [Environment]::SetEnvironmentVariable("STOREPULSE_PROGRAMDATA_ROOT", $previousProgramData, "Process")
    [Environment]::SetEnvironmentVariable("STOREPULSE_INSTALL_ROOT", $previousInstall, "Process")
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($global:MachineServiceFailures.Count -gt 0) {
    Write-Host "FAIL: machine-wide connector service tests failed."
    foreach ($failure in $global:MachineServiceFailures) { Write-Host " - $failure" }
    exit 1
}
