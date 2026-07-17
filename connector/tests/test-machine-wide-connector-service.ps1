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

function Assert-DateTimeClose {
    param($Actual, $Expected, [double]$ToleranceSeconds, [string]$Message)
    $actualTime = [datetimeoffset]::Parse([string]$Actual)
    $expectedTime = [datetimeoffset]::Parse([string]$Expected)
    $deltaSeconds = [math]::Abs(($actualTime - $expectedTime).TotalSeconds)
    if ($deltaSeconds -le $ToleranceSeconds) {
        $global:MachineServicePassCount += 1
    } else {
        $global:MachineServiceFailures.Add("$Message Expected=[$Expected] Actual=[$Actual] DeltaSeconds=[$deltaSeconds]")
    }
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

function Assert-ThrowsCode {
    param([scriptblock]$ScriptBlock, [string]$Code, [string]$Message)
    try {
        & $ScriptBlock
        $global:MachineServiceFailures.Add("$Message Expected exception '$Code'.")
    }
    catch {
        if ($_.Exception.Message -eq $Code) { $global:MachineServicePassCount += 1 }
        else { $global:MachineServiceFailures.Add("$Message Expected=[$Code] Actual=[$($_.Exception.Message)]") }
    }
}

function New-TestConfig {
    param([string]$Root, [string]$InstallRoot)
    [PSCustomObject]@{
        source_store_number = "SYNTH"
        commander_ip = "commander.local"
        commander_install_path = Join-Path $InstallRoot "Commander"
        live_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions"
        finalization_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/finalize-pos-business-day"
        heartbeat_enabled = $false
        heartbeat_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/report-pos-connector-heartbeat"
        heartbeat_payload_version = "1"
        heartbeat_timeout_seconds = 15
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
        pos_publish_enabled = $false
        pos_publish_poll_seconds = 60
        pos_publish_child_timeout_seconds = 60
        pos_publish_claim_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/claim-pos-publish-job"
        pos_publish_report_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/report-pos-publish-job-status"
    }
}

function Write-TestRuntimeConfig {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$Path)
    # Runtime isolation tests need a deliberately enabled in-memory fixture. Production
    # config writers always reset publishing to disabled and are tested separately.
    $Config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Install-TestNodeRuntime {
    param([string]$InstallRoot, [string]$Architecture = "any")
    $nodeCommand = Get-Command node -ErrorAction Stop
    $nodeSource = $nodeCommand.Source
    $nodeDir = Join-Path (Join-Path $InstallRoot "runtime") "node"
    $serviceDir = Join-Path $InstallRoot "service"
    $libDir = Join-Path $InstallRoot "lib"
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
    New-Item -ItemType Directory -Path $libDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot "connector\lib\storepulse-origin-policy.json") -Destination (Join-Path $libDir "storepulse-origin-policy.json") -Force
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
    . (Join-Path $serviceRoot "storepulse-machine-installer-core.ps1")
    . (Join-Path $serviceRoot "storepulse-machine-secrets.ps1")
    . (Join-Path $serviceRoot "storepulse-service-runtime.ps1")
    . (Join-Path $serviceRoot "storepulse-windows-service.ps1")
    . (Join-Path $serviceRoot "storepulse-node-runtime.ps1")
    . (Join-Path $serviceRoot "storepulse-machine-identity.ps1")
    . (Join-Path $serviceRoot "storepulse-connector-heartbeat.ps1")

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
    Assert-Equal -Actual $manifest.version -Expected "3.1.2-heartbeat3" -Message "manifest package version"
    Assert-True -Condition (($manifest.required_files -contains "service\storepulse-windows-service.ps1") -and ($manifest.required_files -contains "service\storepulse-service-entrypoint.ps1")) -Message "manifest includes service files"
    Assert-Equal -Actual $manifest.bundled_node_runtime_relative_path -Expected "runtime\node" -Message "manifest declares private Node runtime path"
    Assert-True -Condition ($manifest.required_files -contains "service\node-runtime-manifest.json") -Message "manifest includes Node runtime manifest"
    Assert-True -Condition ($manifest.required_files -contains "service\storepulse-machine-identity.ps1" -and $manifest.required_files -contains "service\storepulse-connector-heartbeat.ps1") -Message "manifest includes heartbeat scripts"
    Assert-True -Condition (($manifest.required_files -contains "lib\pos-publish-runtime.mjs") -and ($manifest.required_files -contains "lib\pos-publish-runtime-entry.mjs") -and ($manifest.required_files -contains "lib\pos-publish-result-contract.json")) -Message "manifest includes POS publishing runtime contract files"

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
    Set-Content -LiteralPath (Join-Path $serviceSubdir "storepulse-machine-identity.ps1") -Value "placeholder" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $serviceSubdir "storepulse-connector-heartbeat.ps1") -Value "placeholder" -Encoding UTF8
    $libSubdir = Join-Path $installRoot "lib"
    New-Item -ItemType Directory -Path $libSubdir -Force | Out-Null
    foreach ($name in @("commander-price-adapter.mjs", "pos-publish-api-client.mjs", "pos-publish-errors.mjs", "pos-publish-worker.mjs", "pos-publish-runtime.mjs", "pos-publish-runtime-entry.mjs")) {
        Set-Content -LiteralPath (Join-Path $libSubdir $name) -Value "placeholder" -Encoding UTF8
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot "connector\lib\pos-publish-result-contract.json") -Destination (Join-Path $libSubdir "pos-publish-result-contract.json")
    $testNode = Install-TestNodeRuntime -InstallRoot $installRoot
    Assert-True -Condition (Test-StorePulseServiceScripts -Root $installRoot) -Message "complete installation including result contract passes service validation"
    $installedContractPath = Join-Path $libSubdir "pos-publish-result-contract.json"
    Remove-Item -LiteralPath $installedContractPath -Force
    $missingContractError = ""
    try { Test-StorePulseServiceScripts -Root $installRoot | Out-Null } catch { $missingContractError = $_.Exception.Message }
    Assert-True -Condition ($missingContractError -match "Required connector script missing" -and $missingContractError -notmatch "synthetic-token|synthetic-password") -Message "missing result contract fails before child startup without exposing secrets"
    Copy-Item -LiteralPath (Join-Path $repoRoot "connector\lib\pos-publish-result-contract.json") -Destination $installedContractPath
    $installedOriginPolicyPath = Join-Path $libSubdir "storepulse-origin-policy.json"
    Remove-Item -LiteralPath $installedOriginPolicyPath -Force
    $missingOriginPolicyError = ""
    try { Test-StorePulseServiceScripts -Root $installRoot | Out-Null } catch { $missingOriginPolicyError = $_.Exception.Message }
    Assert-True -Condition ($missingOriginPolicyError -match "storepulse-origin-policy" -and $missingOriginPolicyError -notmatch "synthetic-token|synthetic-password") -Message "missing installed origin policy fails service validation before child startup"
    Copy-Item -LiteralPath (Join-Path $repoRoot "connector\lib\storepulse-origin-policy.json") -Destination $installedOriginPolicyPath
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
    $approvedOrigin = "https://kurnxpzcgcvsjmxsqjok.supabase.co"
    Assert-Equal -Actual (Get-StorePulseDerivedHeartbeatEndpoint -LiveEndpointUrl "$approvedOrigin/functions/v1/ingest-pos-transactions") -Expected "$approvedOrigin/functions/v1/report-pos-connector-heartbeat" -Message "heartbeat endpoint derives safely from ingest endpoint"
    Assert-Throws -ScriptBlock { Get-StorePulseDerivedHeartbeatEndpoint -LiveEndpointUrl "$approvedOrigin/functions/v1/not-ingest" | Out-Null } -Message "unsafe heartbeat derivation fails"
    $publishEndpoints = Get-StorePulseDerivedPosPublishEndpoints -LiveEndpointUrl "$approvedOrigin/functions/v1/ingest-pos-transactions"
    Assert-Equal -Actual $publishEndpoints.claim_endpoint_url -Expected "$approvedOrigin/functions/v1/claim-pos-publish-job" -Message "approved production ingest derives claim endpoint"
    Assert-Equal -Actual $publishEndpoints.report_endpoint_url -Expected "$approvedOrigin/functions/v1/report-pos-publish-job-status" -Message "approved production ingest derives report endpoint"
    $publishEndpointsFromHeartbeat = Get-StorePulseDerivedPosPublishEndpoints -HeartbeatEndpointUrl "$approvedOrigin/functions/v1/report-pos-connector-heartbeat"
    Assert-Equal -Actual $publishEndpointsFromHeartbeat.claim_endpoint_url -Expected "$approvedOrigin/functions/v1/claim-pos-publish-job" -Message "approved production heartbeat derives claim endpoint"
    foreach ($unsafePublishSource in @(
        "https://attacker.example/functions/v1/ingest-pos-transactions",
        "https://attacker.example/functions/v1/report-pos-connector-heartbeat",
        "https://kurnxpzcgcvsjmxsqjok.supabase.co.attacker.example/functions/v1/ingest-pos-transactions",
        "https://attacker-kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions",
        "https://kurnxpzcgcvsjmxsqjok.supabase.co:444/functions/v1/ingest-pos-transactions",
        "http://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions",
        "https://user@kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions",
        "$approvedOrigin/functions/v1/ingest-pos-transactions?x=1",
        "$approvedOrigin/functions/v1/ingest-pos-transactions#fragment",
        "$approvedOrigin/functions/v1//ingest-pos-transactions",
        "$approvedOrigin/functions/v1/%2fingest-pos-transactions",
        "$approvedOrigin/functions/v1/%5cingest-pos-transactions",
        "$approvedOrigin/functions/v1/%2e%2e/ingest-pos-transactions",
        "$approvedOrigin/functions/v1/%zz",
        "$approvedOrigin/functions/v1\\ingest-pos-transactions"
    )) {
        Assert-Throws -ScriptBlock { Get-StorePulseDerivedPosPublishEndpoints -LiveEndpointUrl $unsafePublishSource | Out-Null } -Message "unsafe or unapproved publishing source is rejected"
    }
    $nodeRuntimeModule = ([Uri](Join-Path $repoRoot "connector\lib\pos-publish-runtime.mjs")).AbsoluteUri.Replace("'", "\\'")
    $originParityCases = @(
        [PSCustomObject]@{ source = "$approvedOrigin/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $true },
        [PSCustomObject]@{ source = "$approvedOrigin/functions/v1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $true },
        [PSCustomObject]@{ source = "$approvedOrigin`:443/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin`:443/functions/v1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin`:444/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin`:444/functions/v1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "HTTPS://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "HTTPS://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "https://KURNXPZCGCVSJMXSQJOK.supabase.co/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "https://KURNXPZCGCVSJMXSQJOK.supabase.co/functions/v1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "https://Kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "https://attacker.example/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "https://attacker.example/functions/v1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "https://kurnxpzcgcvsjmxsqjok.supabase.co.attacker.example/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "https://attacker-kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/FUNCTIONS/v1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/functions/V1/ingest-pos-transactions"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/functions/v1/INGEST-POS-TRANSACTIONS"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/functions/v1/InGeSt-PoS-tRaNsAcTiOnS"; endpoint = "live"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/FUNCTIONS/v1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/functions/V1/report-pos-connector-heartbeat"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/functions/v1/REPORT-POS-CONNECTOR-HEARTBEAT"; endpoint = "heartbeat"; accepted = $false },
        [PSCustomObject]@{ source = "$approvedOrigin/functions/v1/RePoRt-PoS-cOnNeCtOr-HeArTbEaT"; endpoint = "heartbeat"; accepted = $false }
    )
    foreach ($parityCase in $originParityCases) {
        $powerShellAccepted = $true
        try {
            if ($parityCase.endpoint -eq "heartbeat") {
                Get-StorePulseDerivedPosPublishEndpoints -HeartbeatEndpointUrl $parityCase.source | Out-Null
            }
            else {
                Get-StorePulseDerivedPosPublishEndpoints -LiveEndpointUrl $parityCase.source | Out-Null
            }
        }
        catch { $powerShellAccepted = $false }
        $nodeSourceLiteral = "'" + $parityCase.source.Replace("\\", "\\\\").Replace("'", "\\'") + "'"
        $nodeParity = & $testNode.NodePath --input-type=module -e "import { derivePosPublishEndpoints } from '$nodeRuntimeModule'; try { derivePosPublishEndpoints({ trustedSourceEndpointUrl: $nodeSourceLiteral }); console.log('accepted') } catch { console.log('rejected') }"
        $nodeAccepted = (($nodeParity -join "`n").Trim() -eq "accepted")
        Assert-Equal -Actual $powerShellAccepted -Expected $parityCase.accepted -Message "PowerShell exact-origin decision matches expected result for $($parityCase.source)"
        Assert-Equal -Actual $nodeAccepted -Expected $parityCase.accepted -Message "Node exact-origin decision matches expected result for $($parityCase.source)"
        Assert-Equal -Actual $powerShellAccepted -Expected $nodeAccepted -Message "Node and PowerShell have identical exact-origin decisions for $($parityCase.source)"
    }
    $configPath = Write-StorePulseMachineConfig -Config $config -CreateDirectories
    Assert-True -Condition (Test-Path -LiteralPath $configPath -PathType Leaf) -Message "config written"
    $configText = Get-Content -LiteralPath $configPath -Raw
    Assert-True -Condition ($configText -notmatch "commander_password|connector_token|commander_username") -Message "config excludes secret names"
    $writtenConfig = $configText | ConvertFrom-Json
    Assert-Equal -Actual ([bool]$writtenConfig.pos_publish_enabled) -Expected $false -Message "POS publishing defaults to disabled"
    Assert-Equal -Actual ([int]$writtenConfig.pos_publish_poll_seconds) -Expected 60 -Message "POS publishing default poll interval is conservative"
    Assert-Equal -Actual ([int]$writtenConfig.pos_publish_child_timeout_seconds) -Expected 60 -Message "POS publishing child timeout defaults conservatively"
    $freshEnabledConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $freshEnabledConfig.pos_publish_enabled = $true
    $freshEnabledConfigPath = Join-Path $programDataRoot "fresh-enabled-config.json"
    Write-StorePulseMachineConfig -Config $freshEnabledConfig -Path $freshEnabledConfigPath | Out-Null
    $freshEnabledWritten = Get-Content -LiteralPath $freshEnabledConfigPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual ([bool]$freshEnabledWritten.pos_publish_enabled) -Expected $false -Message "fresh configuration writer forcibly disables a pre-existing enabled publishing value"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.pos_publish_poll_seconds = 0; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "POS publishing rejects zero poll interval"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.pos_publish_child_timeout_seconds = 4; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "POS publishing rejects short child timeout"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.pos_publish_enabled = $true; $bad.pos_publish_claim_endpoint_url = "https://example.invalid/functions/v1/arbitrary"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "POS publishing rejects arbitrary endpoint paths"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.pos_publish_enabled = $true; $bad.pos_publish_claim_endpoint_url = "https://other.invalid/functions/v1/claim-pos-publish-job"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "POS publishing rejects different endpoint origin"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.pos_publish_enabled = $true; $bad.live_endpoint_url = "https://example.invalid:443/functions/v1/ingest-pos-transactions"; $bad.pos_publish_claim_endpoint_url = "https://example.invalid/functions/v1/claim-pos-publish-job"; $bad.pos_publish_report_endpoint_url = "https://example.invalid/functions/v1/report-pos-publish-job-status"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "POS publishing rejects a configured endpoint that removes an explicit default port"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.pos_publish_enabled = $true; $bad.pos_publish_claim_endpoint_url = "https://example.invalid:443/functions/v1/claim-pos-publish-job"; $bad.pos_publish_report_endpoint_url = "https://example.invalid:443/functions/v1/report-pos-publish-job-status"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "POS publishing rejects a configured endpoint that adds an absent default port"
    Assert-Throws -ScriptBlock { $bad = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot; $bad.pos_publish_enabled = $true; $bad.live_endpoint_url = "https://example.invalid:8443/functions/v1/ingest-pos-transactions"; $bad.pos_publish_claim_endpoint_url = "https://example.invalid:9443/functions/v1/claim-pos-publish-job"; $bad.pos_publish_report_endpoint_url = "https://example.invalid:9443/functions/v1/report-pos-publish-job-status"; Test-StorePulseMachineConfig -Config $bad | Out-Null } -Message "POS publishing rejects an altered configured endpoint port"
    $invalidPathRuntimeRoot = Join-Path $tempRoot ("invalid-publish-path-" + [guid]::NewGuid().ToString("N"))
    $invalidPathProgramDataRoot = Join-Path $invalidPathRuntimeRoot "programdata"
    New-Item -ItemType Directory -Path $invalidPathProgramDataRoot -Force | Out-Null
    $invalidPathConfig = New-TestConfig -Root $invalidPathProgramDataRoot -InstallRoot (Join-Path $invalidPathRuntimeRoot "install")
    $invalidPathConfig.pos_publish_enabled = $true
    $invalidPathRejectedUrl = "$approvedOrigin/FUNCTIONS/v1/ingest-pos-transactions"
    $invalidPathConfig.live_endpoint_url = $invalidPathRejectedUrl
    $invalidPathConfigPath = Join-Path $invalidPathProgramDataRoot "config.json"
    Write-TestRuntimeConfig -Config $invalidPathConfig -Path $invalidPathConfigPath
    $invalidPathToken = "invalid-path-token-" + [guid]::NewGuid().ToString("N")
    $invalidPathSecretsPath = Join-Path $invalidPathProgramDataRoot "secrets.json"
    [PSCustomObject]@{ connector_token = $invalidPathToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $invalidPathSecretsPath -Encoding UTF8
    $global:InvalidPathLiveCalls = 0
    $global:InvalidPathPublishChildCalls = 0
    $global:InvalidPathApiCalls = 0
    $global:InvalidPathClaimCalls = 0
    $global:InvalidPathCommanderCalls = 0
    $invalidPathException = ""
    $invalidPathOutput = @()
    try {
        $invalidPathOutput = @(Invoke-StorePulseServiceRuntime -Mode Once -ConfigPath $invalidPathConfigPath -SecretsPath $invalidPathSecretsPath -InstallRoot $invalidPathConfig.install_root -LiveWorker { param($Config,$Secrets,$Root) $global:InvalidPathLiveCalls += 1 } -ClosedDayWorker { param($Config,$Secrets,$Root) } -PosPublishWorker { param($Config,$Secrets,$Root) $global:InvalidPathPublishChildCalls += 1; $global:InvalidPathApiCalls += 1; $global:InvalidPathClaimCalls += 1; $global:InvalidPathCommanderCalls += 1 } -Sleep { param($Seconds) })
    }
    catch { $invalidPathException = $_.Exception.Message }
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($invalidPathException)) -Message "invalid publish path configuration fails before runtime work"
    Assert-Equal -Actual $global:InvalidPathLiveCalls -Expected 0 -Message "invalid publish path configuration starts no live worker"
    Assert-Equal -Actual $global:InvalidPathPublishChildCalls -Expected 0 -Message "invalid publish path configuration starts no publishing child"
    Assert-Equal -Actual $global:InvalidPathApiCalls -Expected 0 -Message "invalid publish path configuration creates no API client"
    Assert-Equal -Actual $global:InvalidPathClaimCalls -Expected 0 -Message "invalid publish path configuration makes no claim"
    Assert-Equal -Actual $global:InvalidPathCommanderCalls -Expected 0 -Message "invalid publish path configuration performs no Commander work"
    $invalidPathArtifactText = (($invalidPathOutput | ForEach-Object { [string]$_ }) -join "`n") + "`n" + $invalidPathException
    Assert-True -Condition (-not $invalidPathArtifactText.Contains($invalidPathRejectedUrl) -and -not $invalidPathArtifactText.Contains($invalidPathToken)) -Message "invalid publish path does not reflect the rejected URL or token"
    Assert-Equal -Actual (Test-Path -LiteralPath (Join-Path $invalidPathProgramDataRoot "state\runtime-status.json") -PathType Leaf) -Expected $false -Message "invalid publish path writes no runtime status"
    Assert-Equal -Actual (Test-Path -LiteralPath $invalidPathConfig.logs_root -PathType Container) -Expected $false -Message "invalid publish path writes no runtime logs"
    $explicitPortConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $explicitPortConfig.pos_publish_enabled = $true
    $explicitPortConfig.live_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co:443/functions/v1/ingest-pos-transactions"
    $explicitPortConfig.pos_publish_claim_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co:443/functions/v1/claim-pos-publish-job"
    $explicitPortConfig.pos_publish_report_endpoint_url = "https://kurnxpzcgcvsjmxsqjok.supabase.co:443/functions/v1/report-pos-publish-job-status"
    Assert-Throws -ScriptBlock { Test-StorePulseMachineConfig -Config $explicitPortConfig | Out-Null } -Message "production origin policy rejects an added explicit port"
    $blankPublishConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $blankPublishConfig.pos_publish_claim_endpoint_url = " "
    $blankPublishConfig.pos_publish_report_endpoint_url = ""
    $blankPublishConfigPath = Join-Path $programDataRoot "blank-publish-config.json"
    Write-StorePulseMachineConfig -Config $blankPublishConfig -Path $blankPublishConfigPath | Out-Null
    $blankPublishWritten = Get-Content -LiteralPath $blankPublishConfigPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $blankPublishWritten.pos_publish_claim_endpoint_url -Expected "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/claim-pos-publish-job" -Message "blank publish claim endpoint derives safely"
    Assert-Equal -Actual $blankPublishWritten.pos_publish_report_endpoint_url -Expected "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/report-pos-publish-job-status" -Message "blank publish report endpoint derives safely"
    $legacyPublishConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    foreach ($propertyName in @("pos_publish_enabled", "pos_publish_poll_seconds", "pos_publish_child_timeout_seconds", "pos_publish_claim_endpoint_url", "pos_publish_report_endpoint_url")) { $legacyPublishConfig.PSObject.Properties.Remove($propertyName) }
    Assert-True -Condition (Test-StorePulseMachineConfig -Config $legacyPublishConfig) -Message "legacy configuration without publishing fields remains valid"
    Assert-Equal -Actual (Get-StorePulsePosPublishPollSeconds -Config $legacyPublishConfig) -Expected 60 -Message "legacy configuration defaults publishing poll safely"
    Assert-Equal -Actual (Get-StorePulsePosPublishChildTimeoutSeconds -Config $legacyPublishConfig) -Expected 60 -Message "legacy configuration defaults child timeout safely"
    $resultContract = Get-StorePulsePosPublishResultContract
    $originPolicyPath = Join-Path $repoRoot "connector\lib\storepulse-origin-policy.json"
    Assert-Equal -Actual (@(Get-StorePulseOriginPolicy -Path $originPolicyPath)[0]) -Expected "https://kurnxpzcgcvsjmxsqjok.supabase.co" -Message "approved production origin policy loads"
    $temporaryOriginPolicy = Join-Path $programDataRoot "origin-policy-test.json"
    foreach ($badPolicy in @(
        '{',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co"],"extra":true}',
        '{"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co"]}',
        '{"version":1}',
        '{"version":0,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co"]}',
        '{"version":2,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co"]}',
        '{"version":"1","allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co"]}',
        '{"version":null,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co"]}',
        '{"version":1,"allowed_https_origins":[]}',
        '{"version":1,"allowed_https_origins":null}',
        '{"version":1,"allowed_https_origins":"https://kurnxpzcgcvsjmxsqjok.supabase.co"}',
        '{"version":1,"allowed_https_origins":[""]}',
        '{"version":1,"allowed_https_origins":["   "]}',
        '{"version":1,"allowed_https_origins":[1]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co/path"]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co/"]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co?x=1"]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co#fragment"]}',
        '{"version":1,"allowed_https_origins":["https://user@kurnxpzcgcvsjmxsqjok.supabase.co"]}',
        '{"version":1,"allowed_https_origins":["http://kurnxpzcgcvsjmxsqjok.supabase.co"]}',
        '{"version":1,"allowed_https_origins":["https://*.supabase.co"]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok%2esupabase.co"]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co:443"]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co:444"]}',
        '{"version":1,"allowed_https_origins":["https://kurnxpzcgcvsjmxsqjok.supabase.co","https://kurnxpzcgcvsjmxsqjok.supabase.co"]}'
    )) {
        Set-Content -LiteralPath $temporaryOriginPolicy -Value $badPolicy -Encoding UTF8
        Assert-Throws -ScriptBlock { Get-StorePulseOriginPolicy -Path $temporaryOriginPolicy | Out-Null } -Message "invalid origin policy fails closed"
    }
    Assert-Throws -ScriptBlock { Get-StorePulseOriginPolicy -Path (Join-Path $programDataRoot "missing-origin-policy.json") | Out-Null } -Message "missing origin policy fails closed"
    $configPolicyOverride = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    Add-Member -InputObject $configPolicyOverride -NotePropertyName "allowed_https_origins" -NotePropertyValue @("https://attacker.example")
    Assert-True -Condition (Test-StorePulseMachineConfig -Config $configPolicyOverride) -Message "configuration policy-like fields cannot replace the installed origin policy"
    foreach ($outcome in @($resultContract.outcomes)) {
        $state = if ($outcome -eq "internal_error") { "error" } else { $outcome }
        $json = @{ outcome = $outcome; state = $state; last_job_id = $null; last_error_code = $null } | ConvertTo-Json -Compress
        Assert-Equal -Actual (ConvertFrom-StorePulsePosPublishChildResult -Json $json).outcome -Expected $outcome -Message "shared result contract accepts every runtime outcome"
    }
    foreach ($state in @($resultContract.states)) {
        $json = @{ outcome = "internal_error"; state = $state; last_job_id = $null; last_error_code = $null } | ConvertTo-Json -Compress
        if ($state -eq "internal_error") { $json = @{ outcome = "internal_error"; state = "internal_error"; last_job_id = $null; last_error_code = $null } | ConvertTo-Json -Compress }
        Assert-Equal -Actual (ConvertFrom-StorePulsePosPublishChildResult -Json $json).state -Expected $state -Message "shared result contract accepts every state"
    }
    foreach ($code in @($resultContract.error_codes)) {
        $json = @{ outcome = "internal_error"; state = "error"; last_job_id = $null; last_error_code = $code } | ConvertTo-Json -Compress
        Assert-Equal -Actual (ConvertFrom-StorePulsePosPublishChildResult -Json $json).last_error_code -Expected $code -Message "shared result contract accepts every child error code"
    }
    foreach ($code in @($resultContract.parent_error_codes)) {
        Assert-True -Condition ($code -match '^[a-z][a-z0-9_]{0,79}$') -Message "shared result contract accepts every parent error code"
    }
    $malformedContractPath = Join-Path $programDataRoot "malformed-pos-publish-result-contract.json"
    $validContractJson = Get-Content -LiteralPath (Join-Path $repoRoot "connector\lib\pos-publish-result-contract.json") -Raw
    $contractSentinel = "contract-token-sentinel"
    $baseContract = [ordered]@{
        properties = @("outcome", "state", "last_job_id", "last_error_code")
        outcomes = @("disabled")
        states = @("disabled")
        error_codes = @("internal_connector_error")
        parent_error_codes = @("pos_publish_runtime_failed")
    }
    $invalidContractTexts = @(
        '{',
        '{"properties":[],"outcomes":[],"states":[],"error_codes":[],"parent_error_codes":[],"extra":"contract-token-sentinel"}',
        '{"properties":["outcome","state","last_job_id","last_error_code"],"outcomes":["disabled"],"states":["disabled"],"error_codes":["internal_connector_error"]}',
        (@{ properties = @("outcome", "outcome", "last_job_id", "last_error_code"); outcomes = $baseContract.outcomes; states = $baseContract.states; error_codes = $baseContract.error_codes; parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = @("disabled", "disabled"); states = $baseContract.states; error_codes = $baseContract.error_codes; parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = $baseContract.outcomes; states = @("disabled", "disabled"); error_codes = $baseContract.error_codes; parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = $baseContract.outcomes; states = $baseContract.states; error_codes = @("internal_connector_error", "internal_connector_error"); parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = $baseContract.outcomes; states = $baseContract.states; error_codes = $baseContract.error_codes; parent_error_codes = @("pos_publish_runtime_failed", "pos_publish_runtime_failed") } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = @(" "); states = $baseContract.states; error_codes = $baseContract.error_codes; parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = @(1, "state", "last_job_id", "last_error_code"); outcomes = $baseContract.outcomes; states = $baseContract.states; error_codes = $baseContract.error_codes; parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = @(1); states = $baseContract.states; error_codes = $baseContract.error_codes; parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = $baseContract.outcomes; states = @(1); error_codes = $baseContract.error_codes; parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = $baseContract.outcomes; states = $baseContract.states; error_codes = @(1); parent_error_codes = $baseContract.parent_error_codes } | ConvertTo-Json -Compress),
        (@{ properties = $baseContract.properties; outcomes = $baseContract.outcomes; states = $baseContract.states; error_codes = $baseContract.error_codes; parent_error_codes = @(1) } | ConvertTo-Json -Compress)
    )
    foreach ($invalidContractText in $invalidContractTexts) {
        Set-Content -LiteralPath $malformedContractPath -Value $invalidContractText -Encoding UTF8
        $contractFailure = ""
        try { Get-StorePulsePosPublishResultContract -Path $malformedContractPath | Out-Null } catch { $contractFailure = $_.Exception.Message }
        Assert-Equal -Actual $contractFailure -Expected "pos_publish_result_contract_invalid" -Message "invalid shared result contract fails closed"
        Assert-True -Condition ($contractFailure -notmatch [regex]::Escape($contractSentinel)) -Message "invalid shared result contract never reflects arbitrary content"
        Assert-Equal -Actual $script:StorePulsePosPublishChildActive -Expected $false -Message "invalid shared result contract cannot start a publishing child"
    }
    Assert-ThrowsCode -ScriptBlock { Get-StorePulsePosPublishResultContract -Path (Join-Path $programDataRoot "missing-pos-publish-result-contract.json") | Out-Null } -Code "pos_publish_result_contract_invalid" -Message "missing result contract fails closed"

    $publishChildRoot = Join-Path $tempRoot "publish-child-fixtures"
    New-Item -ItemType Directory -Path $publishChildRoot -Force | Out-Null
    function New-TestPosPublishChildScript {
        param([string]$Name, [string]$Source)
        $path = Join-Path $publishChildRoot ($Name + ".mjs")
        Set-Content -LiteralPath $path -Value $Source -Encoding UTF8
        return $path
    }
    $safeChildJson = '{"outcome":"completed","state":"completed","last_job_id":null,"last_error_code":null}'
    $successPidPath = Join-Path $publishChildRoot "success.pid"
    $successChild = New-TestPosPublishChildScript -Name "success" -Source ("import fs from 'node:fs';`nfs.writeFileSync(" + ($successPidPath | ConvertTo-Json -Compress) + ", String(process.pid));`nprocess.stdin.resume();`nprocess.stdin.on('end', () => process.stdout.write('" + $safeChildJson + "'));" )
    $utf8ResultItems = @(Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $successChild -Input '{"connector_token":"tökén"}' -TimeoutSeconds 2)
    Assert-Equal -Actual $utf8ResultItems.Count -Expected 1 -Message "publishing child emits exactly one result object"
    [array]$utf8Result = @($utf8ResultItems | Where-Object { $null -ne $_.PSObject.Properties["outcome"] })
    Assert-Equal -Actual $utf8Result.Count -Expected 1 -Message "publishing child result has the expected schema"
    if ($utf8Result.Count -eq 1) { Assert-Equal -Actual $utf8Result[0].outcome -Expected "completed" -Message "publishing child accepts explicit UTF-8 stdin" }
    $successPid = [int](Get-Content -LiteralPath $successPidPath -Raw)
    Assert-True -Condition ($null -eq (Get-Process -Id $successPid -ErrorAction SilentlyContinue)) -Message "publishing child is gone after successful disposal"
    $initializationSecret = "initialization-secret-sentinel"
    foreach ($factoryFailure in @(
        @{ Name = "encoding"; Parameter = "EncodingFactory"; Factory = { throw "encoding $initializationSecret" }.GetNewClosure() },
        @{ Name = "start-info"; Parameter = "StartInfoFactory"; Factory = { throw "start-info $initializationSecret" }.GetNewClosure() },
        @{ Name = "process"; Parameter = "ProcessFactory"; Factory = { throw "process $initializationSecret" }.GetNewClosure() }
    )) {
        $failureText = ""
        try {
            $parameters = @{ NodePath = $testNode.NodePath; EntryScript = $successChild; Input = ('{"connector_token":"' + $initializationSecret + '"}'); TimeoutSeconds = 2 }
            $parameters[$factoryFailure.Parameter] = $factoryFailure.Factory
            Invoke-StorePulsePosPublishChild @parameters | Out-Null
        }
        catch { $failureText = $_.Exception.Message }
        Assert-Equal -Actual $failureText -Expected "pos_publish_child_start_failed" -Message "$($factoryFailure.Name) initialization failure maps to a fixed safe code"
        Assert-True -Condition ($failureText -notmatch $initializationSecret) -Message "$($factoryFailure.Name) initialization failure never reflects the token"
        $postFailure = @(Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $successChild -Input '{"connector_token":"safe-after-init-failure"}' -TimeoutSeconds 2)
        Assert-Equal -Actual (@($postFailure | Where-Object { $_.outcome -eq "completed" }).Count) -Expected 1 -Message "$($factoryFailure.Name) failure releases the active child guard"
    }
    $overlapPidPath = Join-Path $publishChildRoot "overlap.pid"
    $overlapChild = New-TestPosPublishChildScript -Name "overlap" -Source ("import fs from 'node:fs'; fs.writeFileSync(" + ($overlapPidPath | ConvertTo-Json -Compress) + ", String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000);")
    $overlapState = [PSCustomObject]@{ attempted = $false; result = $null }
    $stopForOverlap = {
        if (-not (Test-Path -LiteralPath $overlapPidPath -PathType Leaf)) { return $false }
        if (-not $overlapState.attempted) {
            $overlapState.attempted = $true
            $overlapState.result = Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $successChild -Input '{"connector_token":"second-child-token"}' -TimeoutSeconds 2
        }
        return $true
    }.GetNewClosure()
    Assert-ThrowsCode -ScriptBlock { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $overlapChild -Input '{"connector_token":"first-child-token"}' -TimeoutSeconds 2 -StopRequested $stopForOverlap | Out-Null } -Code "pos_publish_shutdown_requested" -Message "first publishing child exits cleanly after direct overlap attempt"
    Assert-Equal -Actual $overlapState.result.outcome -Expected "busy" -Message "second direct publishing child returns the safe busy result without launching"
    $overlapPid = [int](Get-Content -LiteralPath $overlapPidPath -Raw)
    Start-Sleep -Milliseconds 100
    Assert-True -Condition ($null -eq (Get-Process -Id $overlapPid -ErrorAction SilentlyContinue)) -Message "direct overlap test cleans up the only launched child"
    $timeoutPidPath = Join-Path $publishChildRoot "timeout.pid"
    $timeoutChild = New-TestPosPublishChildScript -Name "timeout" -Source ("import fs from 'node:fs'; fs.writeFileSync(" + ($timeoutPidPath | ConvertTo-Json -Compress) + ", String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000);")
    Assert-ThrowsCode -ScriptBlock { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $timeoutChild -Input '{"connector_token":"sentinel"}' -TimeoutSeconds 1 | Out-Null } -Code "pos_publish_child_timeout" -Message "publishing child timeout kills a hung child"
    $timeoutPid = [int](Get-Content -LiteralPath $timeoutPidPath -Raw)
    Start-Sleep -Milliseconds 100
    Assert-True -Condition ($null -eq (Get-Process -Id $timeoutPid -ErrorAction SilentlyContinue)) -Message "timed out publishing child is terminated and disposed"
    $shutdownPidPath = Join-Path $publishChildRoot "shutdown.pid"
    $shutdownChild = New-TestPosPublishChildScript -Name "shutdown" -Source ("import fs from 'node:fs'; fs.writeFileSync(" + ($shutdownPidPath | ConvertTo-Json -Compress) + ", String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000);")
    Assert-ThrowsCode -ScriptBlock { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $shutdownChild -Input '{"connector_token":"sentinel"}' -TimeoutSeconds 2 -StopRequested { Test-Path -LiteralPath $shutdownPidPath -PathType Leaf } | Out-Null } -Code "pos_publish_shutdown_requested" -Message "publishing shutdown kills an active child"
    $shutdownPid = [int](Get-Content -LiteralPath $shutdownPidPath -Raw)
    Start-Sleep -Milliseconds 100
    Assert-True -Condition ($null -eq (Get-Process -Id $shutdownPid -ErrorAction SilentlyContinue)) -Message "shutdown publishing child is terminated and disposed"
    $largeStdoutPidPath = Join-Path $publishChildRoot "large-stdout.pid"
    $largeStdoutChild = New-TestPosPublishChildScript -Name "large-stdout" -Source ("import fs from 'node:fs'; fs.writeFileSync(" + ($largeStdoutPidPath | ConvertTo-Json -Compress) + ", String(process.pid)); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('x'.repeat(5000)));" )
    Assert-ThrowsCode -ScriptBlock { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $largeStdoutChild -Input '{"connector_token":"sentinel"}' -TimeoutSeconds 2 | Out-Null } -Code "pos_publish_child_output_too_large" -Message "oversized child stdout is rejected safely"
    $largeStdoutPid = [int](Get-Content -LiteralPath $largeStdoutPidPath -Raw)
    Start-Sleep -Milliseconds 100
    Assert-True -Condition ($null -eq (Get-Process -Id $largeStdoutPid -ErrorAction SilentlyContinue)) -Message "oversized stdout child is terminated and disposed"
    $largeStderrPidPath = Join-Path $publishChildRoot "large-stderr.pid"
    $largeStderrChild = New-TestPosPublishChildScript -Name "large-stderr" -Source ("import fs from 'node:fs'; fs.writeFileSync(" + ($largeStderrPidPath | ConvertTo-Json -Compress) + ", String(process.pid)); process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('x'.repeat(5000)); process.stdout.write('" + $safeChildJson + "'); });")
    Assert-ThrowsCode -ScriptBlock { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $largeStderrChild -Input '{"connector_token":"sentinel"}' -TimeoutSeconds 2 | Out-Null } -Code "pos_publish_child_output_too_large" -Message "oversized child stderr is rejected safely"
    $largeStderrPid = [int](Get-Content -LiteralPath $largeStderrPidPath -Raw)
    Start-Sleep -Milliseconds 100
    Assert-True -Condition ($null -eq (Get-Process -Id $largeStderrPid -ErrorAction SilentlyContinue)) -Message "oversized stderr child is terminated and disposed"
    $malformedPidPath = Join-Path $publishChildRoot "malformed.pid"
    $malformedChild = New-TestPosPublishChildScript -Name "malformed" -Source ("import fs from 'node:fs'; fs.writeFileSync(" + ($malformedPidPath | ConvertTo-Json -Compress) + ", String(process.pid)); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('not-json'));" )
    Assert-ThrowsCode -ScriptBlock { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $malformedChild -Input '{"connector_token":"sentinel"}' -TimeoutSeconds 2 | Out-Null } -Code "pos_publish_child_invalid_output" -Message "malformed child output is rejected safely"
    $malformedPid = [int](Get-Content -LiteralPath $malformedPidPath -Raw)
    Start-Sleep -Milliseconds 100
    Assert-True -Condition ($null -eq (Get-Process -Id $malformedPid -ErrorAction SilentlyContinue)) -Message "malformed-output child is disposed"
    $sentinel = "secret-sentinel-connector-token"
    $argumentEnvironmentChild = New-TestPosPublishChildScript -Name "argument-environment" -Source ("const forbidden = " + ($sentinel | ConvertTo-Json -Compress) + "; const leaked = process.argv.join('|').includes(forbidden) || Object.keys(process.env).some((key) => String(process.env[key]).includes(forbidden)); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ outcome: leaked ? 'internal_error' : 'completed', state: leaked ? 'error' : 'completed', last_job_id: null, last_error_code: leaked ? 'internal_connector_error' : null })));" )
    $argumentEnvironmentItems = @(Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $argumentEnvironmentChild -Input ('{"connector_token":"' + $sentinel + '"}') -TimeoutSeconds 2)
    [array]$argumentEnvironmentResult = @($argumentEnvironmentItems | Where-Object { $null -ne $_.PSObject.Properties["outcome"] })
    Assert-Equal -Actual $argumentEnvironmentResult.Count -Expected 1 -Message "argument/environment child result has the expected schema"
    if ($argumentEnvironmentResult.Count -eq 1) { Assert-Equal -Actual $argumentEnvironmentResult[0].outcome -Expected "completed" -Message "child arguments and environment exclude connector token sentinel" }
    $utf8RoundTripToken = "token-stdin-only-sentinel"
    $utf8RoundTripText = "caf$([char]0x00e9)"
    $utf8RoundTripChild = Join-Path $repoRoot "connector\tests\fixtures\pos-publish-utf8-stdin-child.mjs"
    $utf8RoundTripInput = ConvertTo-Json -InputObject ([ordered]@{ connector_token = $utf8RoundTripToken; label = $utf8RoundTripText }) -Compress
    $utf8RoundTripInput = $utf8RoundTripInput.TrimStart([char]0xfeff)
    $utf8ParentStreams = @(& { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $utf8RoundTripChild -PayloadJson $utf8RoundTripInput -TimeoutSeconds 2 } *>&1)
    [array]$utf8RoundTripObject = @($utf8ParentStreams | Where-Object { $_ -is [psobject] -and $null -ne $_.PSObject.Properties["outcome"] })
    Assert-Equal -Actual $utf8RoundTripObject.Count -Expected 1 -Message "UTF-8 stdin round trip returns one safe result"
    if ($utf8RoundTripObject.Count -eq 1) { Assert-Equal -Actual $utf8RoundTripObject[0].outcome -Expected "completed" -Message "UTF-8 stdin has no BOM and preserves non-ASCII data without leaking the token" }
    $utf8ParentText = ($utf8ParentStreams | Out-String)
    Assert-True -Condition ($utf8ParentText -notmatch [regex]::Escape($utf8RoundTripToken)) -Message "UTF-8 token sentinel is absent from parent stdout, stderr, warnings, verbose output, and child stream forwarding"
    $utf8ExceptionText = ""
    try { Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $malformedChild -PayloadJson ('{"connector_token":"' + $utf8RoundTripToken + '"}') -TimeoutSeconds 2 | Out-Null } catch { $utf8ExceptionText = $_.Exception.Message }
    Assert-Equal -Actual $utf8ExceptionText -Expected "pos_publish_child_invalid_output" -Message "malformed child output maps to a fixed parent exception"
    Assert-True -Condition ($utf8ExceptionText -notmatch [regex]::Escape($utf8RoundTripToken)) -Message "UTF-8 token sentinel is absent from parent exception text"
    $utf8Artifacts = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $programDataRoot -Recurse -File -ErrorAction SilentlyContinue)) {
        try { $utf8Artifacts += Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop } catch { }
    }
    Assert-True -Condition (($utf8Artifacts -join "`n") -notmatch [regex]::Escape($utf8RoundTripToken)) -Message "UTF-8 token sentinel is absent from parent logs, status, temporary files, and backups"
    foreach ($invalidChildJson in @(
        "not-json",
        ($safeChildJson + " {}"),
        '{"outcome":"completed","state":"completed","last_job_id":null,"last_error_code":null,"extra":true}',
        '{"outcome":"not-safe","state":"completed","last_job_id":null,"last_error_code":null}',
        '{"outcome":"completed","state":"not-safe","last_job_id":null,"last_error_code":null}',
        '{"outcome":"completed","state":"completed","last_job_id":null,"last_error_code":"not_safe"}',
        '{"outcome":"completed","state":"completed","last_job_id":"not-a-uuid","last_error_code":null}'
    )) {
        Assert-ThrowsCode -ScriptBlock { ConvertFrom-StorePulsePosPublishChildResult -Json $invalidChildJson | Out-Null } -Code "pos_publish_child_invalid_output" -Message "invalid child result schema is rejected safely"
    }
    $atomicStatusPath = Join-Path $programDataRoot "state\atomic-status.json"
    $atomicStatus = [ordered]@{ enabled = $false; state = "disabled"; last_poll_at = $null; last_outcome = $null; last_job_id = $null; last_error_code = $null }
    foreach ($i in 1..20) {
        $atomicStatus.last_outcome = "disabled"
        Write-StorePulseRuntimeStatus -Path $atomicStatusPath -Status $atomicStatus
        try { Get-Content -LiteralPath $atomicStatusPath -Raw | ConvertFrom-Json | Out-Null; $global:MachineServicePassCount += 1 } catch { $global:MachineServiceFailures.Add("atomic status write produced partial JSON") }
    }
    $atomicReader = Start-Job -ScriptBlock {
        param($Path)
        $failures = 0
        foreach ($i in 1..100) {
            $read = $false
            foreach ($attempt in 1..10) {
                try { Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop | Out-Null; $read = $true; break } catch { Start-Sleep -Milliseconds 5 }
            }
            if (-not $read) { $failures += 1 }
            Start-Sleep -Milliseconds 2
        }
        return $failures
    } -ArgumentList $atomicStatusPath
    try {
        foreach ($i in 1..100) { Write-StorePulseRuntimeStatus -Path $atomicStatusPath -Status $atomicStatus }
        Wait-Job -Job $atomicReader | Out-Null
        Assert-Equal -Actual (Receive-Job -Job $atomicReader) -Expected 0 -Message "concurrent status reader never observes partial JSON"
    }
    finally {
        Remove-Job -Job $atomicReader -Force -ErrorAction SilentlyContinue
    }
    Assert-Equal -Actual (@(Get-ChildItem -LiteralPath (Split-Path -Parent $atomicStatusPath) -Filter ".atomic-status.json.*" -ErrorAction SilentlyContinue).Count) -Expected 0 -Message "atomic status writes clean temporary files"
    $replaceStatusPath = Join-Path $programDataRoot "state\replace-status.json"
    $previousStatusText = '{"enabled":false,"state":"disabled","last_poll_at":null,"last_outcome":"previous","last_job_id":null,"last_error_code":null}'
    [IO.File]::WriteAllText($replaceStatusPath, $previousStatusText, (New-Object Text.UTF8Encoding($false)))
    $global:ReplaceAttempts = 0
    $global:ReplaceSleeps = 0
    $retryingReplace = {
        param($Source, $Destination, $Backup)
        $global:ReplaceAttempts += 1
        if ($global:ReplaceAttempts -le 2) { throw (New-Object IO.IOException("sharing", -2147024864)) }
        [IO.File]::Replace($Source, $Destination, $Backup)
    }.GetNewClosure()
    $retrySleep = { param($Milliseconds) $global:ReplaceSleeps += 1 }.GetNewClosure()
    Write-StorePulseRuntimeStatus -Path $replaceStatusPath -Status $atomicStatus -FileReplace $retryingReplace -Sleep $retrySleep
    Assert-Equal -Actual $global:ReplaceAttempts -Expected 3 -Message "sharing violations retry replacement"
    Assert-Equal -Actual $global:ReplaceSleeps -Expected 2 -Message "sharing retries use bounded delay"
    Assert-True -Condition ((Get-Content -LiteralPath $replaceStatusPath -Raw | ConvertFrom-Json).state -eq "disabled") -Message "successful replacement remains valid JSON"
    $global:LockAttempts = 0
    $lockingReplace = {
        param($Source, $Destination, $Backup)
        $global:LockAttempts += 1
        if ($global:LockAttempts -eq 1) { throw (New-Object IO.IOException("lock", -2147024863)) }
        [IO.File]::Replace($Source, $Destination, $Backup)
    }.GetNewClosure()
    Write-StorePulseRuntimeStatus -Path $replaceStatusPath -Status $atomicStatus -FileReplace $lockingReplace -Sleep { param($Milliseconds) }
    Assert-Equal -Actual $global:LockAttempts -Expected 2 -Message "lock violations retry replacement"
    $global:NonRetryAttempts = 0
    $failingReplace = {
        param($Source, $Destination, $Backup)
        $global:NonRetryAttempts += 1
        throw (New-Object UnauthorizedAccessException("denied"))
    }.GetNewClosure()
    $originalBytes = [IO.File]::ReadAllBytes($replaceStatusPath)
    Assert-Throws -ScriptBlock { Write-StorePulseRuntimeStatus -Path $replaceStatusPath -Status $atomicStatus -FileReplace $failingReplace -Sleep { param($Milliseconds) } } -Message "unauthorized replacement fails without retry"
    Assert-Equal -Actual $global:NonRetryAttempts -Expected 1 -Message "unauthorized replacement is not retried"
    $global:IoFailureAttempts = 0
    $ioFailingReplace = {
        param($Source, $Destination, $Backup)
        $global:IoFailureAttempts += 1
        throw (New-Object IO.IOException("disk", -2147024894))
    }.GetNewClosure()
    Assert-Throws -ScriptBlock { Write-StorePulseRuntimeStatus -Path $replaceStatusPath -Status $atomicStatus -FileReplace $ioFailingReplace -Sleep { param($Milliseconds) } } -Message "unrelated IO replacement failure is surfaced"
    Assert-Equal -Actual $global:IoFailureAttempts -Expected 1 -Message "unrelated IO replacement is not retried"
    Assert-Equal -Actual ([Convert]::ToBase64String([IO.File]::ReadAllBytes($replaceStatusPath))) -Expected ([Convert]::ToBase64String($originalBytes)) -Message "failed replacement preserves prior valid status bytes"
    Assert-True -Condition ($null -ne (Get-Content -LiteralPath $replaceStatusPath -Raw | ConvertFrom-Json)) -Message "failed replacement leaves parseable previous status"
    Assert-Equal -Actual (@(Get-ChildItem -LiteralPath (Split-Path -Parent $replaceStatusPath) -Filter ".replace-status.json.*" -ErrorAction SilentlyContinue).Count) -Expected 0 -Message "replacement failure cleans temporary and backup files"

    $oldConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $oldConfig.live_poll_interval_seconds = 120
    $oldConfig.closed_day_worker_enabled = $false
    $oldConfig.closed_day_once_enabled = $false
    $oldConfig.pos_publish_enabled = $true
    $oldConfig.pos_publish_poll_seconds = 75
    $oldConfig.pos_publish_child_timeout_seconds = 90
    foreach ($propertyName in @("heartbeat_enabled", "heartbeat_endpoint_url", "heartbeat_payload_version", "heartbeat_timeout_seconds")) {
        $oldConfig.PSObject.Properties.Remove($propertyName)
    }
    $oldConfigPath = Join-Path $programDataRoot "old-300-config.json"
    $oldConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $oldConfigPath -Encoding UTF8
    $syntheticSecretsPath = Join-Path $programDataRoot "old-300-secrets.json"
    Set-Content -LiteralPath $syntheticSecretsPath -Value '{"commander_username":"encrypted","commander_password":"encrypted","connector_token":"encrypted"}' -Encoding UTF8
    $secretsHashBefore = (Get-FileHash -LiteralPath $syntheticSecretsPath -Algorithm SHA256).Hash
    $migrationResult = Update-StorePulseMachineConfigForHeartbeat -Path $oldConfigPath -CreateBackup
    $upgradedConfig = Get-Content -LiteralPath $oldConfigPath -Raw | ConvertFrom-Json
    $secretsHashAfter = (Get-FileHash -LiteralPath $syntheticSecretsPath -Algorithm SHA256).Hash
    Assert-True -Condition ([bool]$migrationResult.changed) -Message "old 3.0 config receives heartbeat defaults during upgrade"
    Assert-True -Condition ([bool]$upgradedConfig.heartbeat_enabled) -Message "heartbeat is enabled after config upgrade"
    Assert-Equal -Actual $upgradedConfig.heartbeat_endpoint_url -Expected "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/report-pos-connector-heartbeat" -Message "upgraded config derives heartbeat endpoint"
    Assert-Equal -Actual ([int]$upgradedConfig.live_poll_interval_seconds) -Expected 120 -Message "upgrade preserves 120-second live poll interval"
    Assert-Equal -Actual ([bool]$upgradedConfig.closed_day_worker_enabled) -Expected $false -Message "upgrade preserves closed-day disabled worker setting"
    Assert-Equal -Actual ([bool]$upgradedConfig.closed_day_once_enabled) -Expected $false -Message "upgrade preserves closed-day one-shot disabled setting"
    Assert-Equal -Actual ([bool]$upgradedConfig.pos_publish_enabled) -Expected $false -Message "installer upgrade helper resets an existing enabled publishing configuration"
    Assert-Equal -Actual ([int]$upgradedConfig.pos_publish_poll_seconds) -Expected 75 -Message "installer upgrade helper preserves publishing poll configuration while disabling publishing"
    Assert-Equal -Actual ([int]$upgradedConfig.pos_publish_child_timeout_seconds) -Expected 90 -Message "installer upgrade helper preserves publishing child timeout while disabling publishing"
    Assert-Equal -Actual $secretsHashAfter -Expected $secretsHashBefore -Message "config upgrade preserves encrypted secrets file hash"
    $repeatMigration = Update-StorePulseMachineConfigForHeartbeat -Path $oldConfigPath -CreateBackup
    $repeatUpgradedConfig = Get-Content -LiteralPath $oldConfigPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual ([bool]$repeatUpgradedConfig.pos_publish_enabled) -Expected $false -Message "repeated repair or upgrade remains publishing-disabled"
    Assert-Equal -Actual ([bool]$repeatMigration.changed) -Expected $false -Message "repeated repair or upgrade is idempotent after publishing is disabled"
    Restore-StorePulseMachineConfigBackup -Path $oldConfigPath -BackupPath $migrationResult.backup_path | Out-Null
    $rolledBackConfigText = Get-Content -LiteralPath $oldConfigPath -Raw
    Assert-True -Condition ($rolledBackConfigText -notmatch "heartbeat_endpoint_url") -Message "config backup restores after simulated later upgrade failure"

    $approvedWorkflowRoot = Join-Path $tempRoot ("approved-installer-" + [guid]::NewGuid().ToString("N"))
    $approvedProgramData = Join-Path $approvedWorkflowRoot "programdata"
    $approvedInstallRoot = Join-Path $approvedWorkflowRoot "install"
    New-Item -ItemType Directory -Path $approvedProgramData -Force | Out-Null
    $approvedConfigPath = Join-Path $approvedProgramData "config.json"
    $approvedConfig = New-TestConfig -Root $approvedProgramData -InstallRoot $approvedInstallRoot
    $approvedConfig.pos_publish_enabled = $true
    $approvedConfig.live_poll_interval_seconds = 123
    $approvedConfig.closed_day_poll_interval_seconds = 4567
    $approvedConfig.closed_day_worker_enabled = $false
    $approvedConfig.closed_day_once_enabled = $true
    $approvedConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $approvedConfigPath -Encoding UTF8
    $global:ApprovedWorkflowEvents = New-Object System.Collections.Generic.List[string]
    $approvedOperations = @{
        UpdateConfiguration = { $global:ApprovedWorkflowEvents.Add("config"); Update-StorePulseMachineConfigForHeartbeat -Path $approvedConfigPath -CreateBackup }
        RestoreConfiguration = { param($migration) $global:ApprovedWorkflowEvents.Add("restore-config"); Restore-StorePulseMachineConfigBackup -Path $migration.path -BackupPath $migration.backup_path | Out-Null }
        ValidateSecrets = { $global:ApprovedWorkflowEvents.Add("secrets") }
        ValidateSource = { $global:ApprovedWorkflowEvents.Add("source") }
        ValidateVerifone = { $global:ApprovedWorkflowEvents.Add("verifone") }
        EnsureDirectories = { $global:ApprovedWorkflowEvents.Add("directories"); New-Item -ItemType Directory -Path $approvedInstallRoot -Force | Out-Null }
        CreateInstallBackup = { $global:ApprovedWorkflowEvents.Add("backup"); return $null }
        CopyPayload = { $global:ApprovedWorkflowEvents.Add("copy"); New-Item -ItemType Directory -Path (Join-Path $approvedInstallRoot "lib") -Force | Out-Null; Copy-Item -LiteralPath (Join-Path $repoRoot "connector\lib\storepulse-origin-policy.json") -Destination (Join-Path $approvedInstallRoot "lib\storepulse-origin-policy.json") }
        ValidateInstalled = { $global:ApprovedWorkflowEvents.Add("validate-installed"); if (-not (Test-Path -LiteralPath (Join-Path $approvedInstallRoot "lib\storepulse-origin-policy.json") -PathType Leaf)) { throw "policy missing" } }
        ConfigureService = { $global:ApprovedWorkflowEvents.Add("service-update") }
        RestoreInstallBackup = { param($backup) $global:ApprovedWorkflowEvents.Add("restore-install") }
        CleanupInstallBackup = { param($backup) $global:ApprovedWorkflowEvents.Add("cleanup-install") }
    }
    $approvedResult = Invoke-StorePulseApprovedInstallerWorkflow -Operations $approvedOperations
    $approvedWrittenConfig = Get-Content -LiteralPath $approvedConfigPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual ([bool]$approvedWrittenConfig.pos_publish_enabled) -Expected $false -Message "approved installer orchestration forces publishing disabled"
    Assert-Equal -Actual ([int]$approvedWrittenConfig.live_poll_interval_seconds) -Expected 123 -Message "approved installer orchestration preserves live polling"
    Assert-Equal -Actual ([int]$approvedWrittenConfig.closed_day_poll_interval_seconds) -Expected 4567 -Message "approved installer orchestration preserves finalized-day polling"
    Assert-Equal -Actual ([bool]$approvedWrittenConfig.closed_day_worker_enabled) -Expected $false -Message "approved installer orchestration preserves current-shift settings"
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $approvedInstallRoot "lib\storepulse-origin-policy.json") -PathType Leaf) -Message "approved installer orchestration installs product-owned origin policy"
    Assert-Equal -Actual ($global:ApprovedWorkflowEvents -join ",") -Expected "config,secrets,source,verifone,directories,backup,copy,validate-installed,service-update" -Message "approved installer orchestration invokes service update after safe validation"
    Assert-True -Condition ($global:ApprovedWorkflowEvents -notcontains "restore-install" -and $global:ApprovedWorkflowEvents -notcontains "restore-config") -Message "approved installer fixture performs no rollback on success"
    $repeatApprovedResult = Invoke-StorePulseApprovedInstallerWorkflow -Operations $approvedOperations
    Assert-Equal -Actual ([bool]$repeatApprovedResult.changed) -Expected $false -Message "approved installer orchestration is idempotent on repeated upgrade"

    $installationIdPath = Get-StorePulseInstallationIdPath -ProgramDataRoot $programDataRoot
    $installationId1 = Get-StorePulseInstallationId -ProgramDataRoot $programDataRoot
    $installationId2 = Get-StorePulseInstallationId -ProgramDataRoot $programDataRoot
    Assert-True -Condition (Test-StorePulseUuidText -Value $installationId1) -Message "installation ID is a UUID"
    Assert-Equal -Actual $installationId2 -Expected $installationId1 -Message "installation ID is stable across reads"
    Assert-True -Condition (Test-Path -LiteralPath $installationIdPath -PathType Leaf) -Message "installation ID file created under ProgramData state"
    Set-Content -LiteralPath $installationIdPath -Value "not-a-uuid" -Encoding ASCII
    Assert-Throws -ScriptBlock { Get-StorePulseInstallationId -ProgramDataRoot $programDataRoot | Out-Null } -Message "malformed existing installation ID fails closed"
    Set-Content -LiteralPath $installationIdPath -Value $installationId1 -Encoding ASCII

    $heartbeatConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $heartbeatConfig.heartbeat_enabled = $true
    $heartbeatSecrets = [PSCustomObject]@{
        commander_username = "synthetic-user"
        commander_password = "synthetic-password"
        connector_token = "synthetic-token-value-that-is-long-enough"
    }
    $heartbeatStatus = [ordered]@{
        runtime_version = "3.1.2-heartbeat3"
        process_id = $PID
        started_at = (Get-Date).ToString("o")
        mode = "Run"
        live_worker = [ordered]@{
            status = "succeeded"
            consecutive_failures = 0
            last_started_at = (Get-Date).ToString("o")
            last_completed_at = (Get-Date).ToString("o")
            last_success_at = (Get-Date).ToString("o")
            last_failure_at = $null
            last_error = $null
            last_result = [PSCustomObject]@{
                canonical_record_count = 342
                inserted_count = 3
                updated_count = 19
                unchanged_count = 320
                failed_count = 0
                request_id = "synthetic-request"
            }
        }
    }
    $global:HeartbeatHttpCapture = $null
    $heartbeatResult = Invoke-StorePulseConnectorHeartbeat -Config $heartbeatConfig -Secrets $heartbeatSecrets -RuntimeStatus $heartbeatStatus -ReportedState "ready" -HttpExecutor {
        param($Endpoint, $Headers, $Json, $TimeoutSeconds)
        $global:HeartbeatHttpCapture = [PSCustomObject]@{ Endpoint = $Endpoint; Headers = $Headers; Json = $Json; TimeoutSeconds = $TimeoutSeconds }
        [PSCustomObject]@{ ok = $true; request_id = "heartbeat-request"; connector_id = "connector-id"; server_received_at = (Get-Date).ToString("o"); installation_bound = $false }
    }
    $heartbeatPayload = $global:HeartbeatHttpCapture.Json | ConvertFrom-Json
    Assert-Equal -Actual $heartbeatResult.status -Expected "succeeded" -Message "heartbeat reporter handles success response"
    Assert-Equal -Actual $heartbeatPayload.reported_state -Expected "ready" -Message "heartbeat payload reports ready state"
    Assert-Equal -Actual $heartbeatPayload.canonical_record_count -Expected 342 -Message "heartbeat payload includes latest canonical count"
    Assert-DateTimeClose -Actual $heartbeatPayload.last_sync_completed_at -Expected $heartbeatStatus.live_worker.last_completed_at -ToleranceSeconds 1 -Message "heartbeat payload uses latest worker completion timestamp"
    Assert-True -Condition ($global:HeartbeatHttpCapture.Headers["x-storepulse-connector-token"] -eq "synthetic-token-value-that-is-long-enough") -Message "heartbeat sends connector token header"
    Assert-True -Condition ($global:HeartbeatHttpCapture.Json -notmatch "synthetic-token-value-that-is-long-enough|synthetic-password") -Message "heartbeat JSON excludes secrets"
    $failedHeartbeat = Invoke-StorePulseConnectorHeartbeat -Config $heartbeatConfig -Secrets $heartbeatSecrets -RuntimeStatus $heartbeatStatus -ReportedState "ready" -HttpExecutor {
        param($Endpoint, $Headers, $Json, $TimeoutSeconds)
        throw "server rejected synthetic-token-value-that-is-long-enough"
    }
    Assert-Equal -Actual $failedHeartbeat.status -Expected "failed" -Message "heartbeat reporter handles server failure"
    Assert-True -Condition ($failedHeartbeat.error_message -match '\[REDACTED\]' -and $failedHeartbeat.error_message -notmatch "synthetic-token-value-that-is-long-enough") -Message "heartbeat reporter redacts secrets from errors"
    Assert-Equal -Actual (Get-StorePulseErrorCode -Stage "commander" -Message "Commander authentication failed" -HttpStatus 401) -Expected "commander_authentication_failed" -Message "Commander authentication failure receives Commander code"
    Assert-Equal -Actual (Get-StorePulseErrorCode -Stage "commander" -Message "Commander connection timed out") -Expected "commander_unreachable" -Message "Commander unreachable receives Commander code"
    Assert-Equal -Actual (Get-StorePulseErrorCode -Stage "cloud" -Message "HTTP 401 unauthorized" -HttpStatus 401) -Expected "cloud_unauthorized" -Message "Cloud 401 receives cloud_unauthorized"
    Assert-Equal -Actual (Get-StorePulseErrorCode -Stage "heartbeat" -Message "HTTP 401 unauthorized" -HttpStatus 401) -Expected "heartbeat_unauthorized" -Message "Heartbeat 401 receives heartbeat_unauthorized"
    Assert-Equal -Actual (Get-StorePulseErrorCode -Stage "heartbeat" -Message "installation_mismatch" -HttpStatus 409) -Expected "installation_mismatch" -Message "Heartbeat 409 installation mismatch receives installation_mismatch"
    Assert-Equal -Actual (Get-StorePulseErrorCode -Stage "heartbeat" -Message "connection timeout") -Expected "heartbeat_unreachable" -Message "Heartbeat timeout receives heartbeat_unreachable"
    Assert-Equal -Actual (Get-StorePulseCommanderStatus -ErrorCode "commander_authentication_failed" -ReportedState "degraded") -Expected "authentication_failed" -Message "Commander auth code maps to authentication_failed status"
    Assert-Equal -Actual (Get-StorePulseCommanderStatus -ErrorCode "commander_unreachable" -ReportedState "degraded") -Expected "unreachable" -Message "Commander unreachable code maps to unreachable status"
    Assert-Equal -Actual (Get-StorePulseCommanderStatus -ErrorCode "commander_response_invalid" -ReportedState "degraded") -Expected "error" -Message "Commander invalid response maps to error status"
    Assert-Equal -Actual (Get-StorePulseCommanderStatus -ErrorCode $null -ReportedState "ready") -Expected "connected" -Message "Commander success maps to connected status"
    Assert-Equal -Actual (Get-StorePulseCloudStatus -ErrorCode "cloud_rejected" -ReportedState "degraded") -Expected "error" -Message "Cloud transaction failure maps to cloud error"
    Assert-Equal -Actual (Get-StorePulseCloudStatus -ErrorCode "heartbeat_unauthorized" -ReportedState "degraded") -Expected "unknown" -Message "Heartbeat failure does not alter transaction cloud status"

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
        -LiveUploadUrl "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions" `
        -FinalizationUrl "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/finalize-pos-business-day" `
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
        -LiveUploadUrl "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions" `
        -FinalizationUrl "https://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/finalize-pos-business-day" `
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
    $partialConfig.pos_publish_enabled = $true
    $partialConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configurePath -Encoding UTF8
    $reconfigureOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "configure-storepulse-machine-connector.ps1") `
        -NonInteractive `
        -UseTestPlaintextSecrets `
        -ConfigPath $configurePath `
        -SecretsPath $configureSecretsPath `
        -ProgramDataRoot $programDataRoot `
        -InstallRoot $installRoot `
        -TestCommanderUsername "synthetic-user" `
        -TestCommanderPassword "synthetic-password" `
        -TestConnectorToken "synthetic-token"
    $reconfigured = Get-Content -LiteralPath $configurePath -Raw | ConvertFrom-Json
    Assert-Equal -Actual ([bool]$reconfigured.pos_publish_enabled) -Expected $false -Message "reconfiguring an enabled config always disables POS publishing"
    Assert-True -Condition (($reconfigureOutput -join "`n") -notmatch "synthetic-token|synthetic-password") -Message "reconfiguration does not start publishing or expose secrets"

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
    Assert-True -Condition ($runtimeSource -match 'RedirectStandardInput' -and $runtimeSource -match 'EnvironmentVariables.Remove' -and $runtimeSource -notmatch 'pos_publish.*STOREPULSE_CONNECTOR_TOKEN') -Message "publishing child uses stdin and strips connector-secret environment variables"

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
    $global:MachinePublishCount = 0
    $onceResult = Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:MachineLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:MachineClosedCount += 1 } `
        -PosPublishWorker { param($Config,$Secrets,$Root) $global:MachinePublishCount += 1 } `
        -Sleep { param($Seconds) }
    Assert-Equal -Actual $onceResult.iterations -Expected 1 -Message "Once mode runs one iteration"
    Assert-Equal -Actual $global:MachineLiveCount -Expected 1 -Message "Once mode invokes live worker once"
    Assert-Equal -Actual $global:MachineClosedCount -Expected 1 -Message "Once mode invokes closed worker once"
    Assert-Equal -Actual $global:MachinePublishCount -Expected 0 -Message "disabled publishing does not invoke worker"

    $publishRuntimeConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $publishRuntimeConfig.pos_publish_enabled = $true
    $publishRuntimeConfig.pos_publish_poll_seconds = 60
    $publishRuntimeConfigPath = Join-Path $programDataRoot "publish-runtime-config.json"
    Write-TestRuntimeConfig -Config $publishRuntimeConfig -Path $publishRuntimeConfigPath
    $global:PublishLiveCount = 0
    $global:PublishWorkerCount = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $publishRuntimeConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:PublishLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -PosPublishWorker { param($Config,$Secrets,$Root) $global:PublishWorkerCount += 1; [PSCustomObject]@{ outcome = "idle"; state = "idle"; last_job_id = $null; last_error_code = $null } } `
        -Sleep { param($Seconds) } | Out-Null
    $publishRuntimeStatus = Get-Content -LiteralPath (Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot) -Raw | ConvertFrom-Json
    Assert-Equal -Actual $global:PublishLiveCount -Expected 1 -Message "publishing poll does not stop transaction ingestion"
    Assert-Equal -Actual $global:PublishWorkerCount -Expected 1 -Message "enabled publishing polls once per runtime iteration"
    Assert-Equal -Actual $publishRuntimeStatus.pos_publish.state -Expected "idle" -Message "runtime records safe publishing state"
    Assert-True -Condition (($publishRuntimeStatus.pos_publish | ConvertTo-Json -Depth 10) -notmatch "synthetic-token|synthetic-password") -Message "publishing status excludes secrets"

    $global:PublishFailureLiveCount = 0
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $publishRuntimeConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:PublishFailureLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -PosPublishWorker { param($Config,$Secrets,$Root) throw "connector-token must not be preserved" } `
        -Sleep { param($Seconds) } | Out-Null
    $publishFailureStatus = Get-Content -LiteralPath (Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot) -Raw | ConvertFrom-Json
    Assert-Equal -Actual $global:PublishFailureLiveCount -Expected 1 -Message "publishing failures do not stop transaction ingestion"
    Assert-Equal -Actual $publishFailureStatus.pos_publish.last_error_code -Expected "pos_publish_runtime_failed" -Message "publishing failure records a stable safe code"
    Assert-True -Condition (($publishFailureStatus.pos_publish | ConvertTo-Json -Depth 10) -notmatch "connector-token") -Message "publishing failures do not store worker error text"

    $childTimeoutRuntimeConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $childTimeoutRuntimeConfig.pos_publish_enabled = $true
    $childTimeoutRuntimeConfig.heartbeat_enabled = $true
    $childTimeoutRuntimeConfig.closed_day_worker_enabled = $false
    $childTimeoutRuntimeConfigPath = Join-Path $programDataRoot "child-timeout-runtime-config.json"
    Write-TestRuntimeConfig -Config $childTimeoutRuntimeConfig -Path $childTimeoutRuntimeConfigPath
    $global:ChildTimeoutLiveCount = 0
    $global:ChildTimeoutHeartbeatStates = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $childTimeoutRuntimeConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:ChildTimeoutLiveCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -PosPublishWorker { param($Config,$Secrets,$Root) Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $timeoutChild -Input '{"connector_token":"synthetic-token"}' -TimeoutSeconds 1 } `
        -HeartbeatReporter { param($Config,$Secrets,$Status,$State,$ErrorCode,$ErrorMessage) $global:ChildTimeoutHeartbeatStates += $State; [PSCustomObject]@{ enabled = $true; status = "succeeded"; request_id = "child-timeout-heartbeat" } } `
        -Sleep { param($Seconds) } | Out-Null
    $childTimeoutStatus = Get-Content -LiteralPath (Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot) -Raw | ConvertFrom-Json
    Assert-Equal -Actual $global:ChildTimeoutLiveCount -Expected 1 -Message "ingestion continues when publishing child times out"
    Assert-Equal -Actual $childTimeoutStatus.pos_publish.last_error_code -Expected "pos_publish_child_timeout" -Message "runtime records safe child timeout code"
    Assert-True -Condition (($global:ChildTimeoutHeartbeatStates -join ",") -match "stopping") -Message "heartbeat shutdown continues after publishing child timeout"
    $global:PublishSleepIntervals = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $publishRuntimeConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -PosPublishWorker { param($Config,$Secrets,$Root) [PSCustomObject]@{ outcome = "internal_error"; state = "error"; last_job_id = $null; last_error_code = "internal_connector_error" } } `
        -Sleep { param($Seconds) $global:PublishSleepIntervals += $Seconds } `
        -MaxIterations 2 | Out-Null
    Assert-True -Condition ($global:PublishSleepIntervals -contains 60) -Message "publishing errors retain the configured poll sleep"

    $timeoutIsolationConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $timeoutIsolationConfig.pos_publish_enabled = $true
    $timeoutIsolationConfig.heartbeat_enabled = $true
    $timeoutIsolationConfig.closed_day_worker_enabled = $true
    $timeoutIsolationConfig.pos_publish_poll_seconds = 60
    $timeoutIsolationConfigPath = Join-Path $programDataRoot "timeout-isolation-runtime-config.json"
    Write-TestRuntimeConfig -Config $timeoutIsolationConfig -Path $timeoutIsolationConfigPath
    $global:TimeoutIsolationCurrentShiftCount = 0
    $global:TimeoutIsolationClosedDayCount = 0
    $global:TimeoutIsolationHeartbeatStates = @()
    $global:TimeoutIsolationSleeps = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $timeoutIsolationConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) $global:TimeoutIsolationCurrentShiftCount += 1 } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) $global:TimeoutIsolationClosedDayCount += 1 } `
        -PosPublishWorker { param($Config,$Secrets,$Root) Invoke-StorePulsePosPublishChild -NodePath $testNode.NodePath -EntryScript $timeoutChild -Input '{"connector_token":"synthetic-token"}' -TimeoutSeconds 1 } `
        -HeartbeatReporter { param($Config,$Secrets,$Status,$State,$ErrorCode,$ErrorMessage) $global:TimeoutIsolationHeartbeatStates += $State; [PSCustomObject]@{ enabled = $true; status = "succeeded"; request_id = "timeout-isolation-heartbeat" } } `
        -Sleep { param($Seconds) $global:TimeoutIsolationSleeps += $Seconds } `
        -MaxIterations 2 | Out-Null
    Assert-Equal -Actual $global:TimeoutIsolationCurrentShiftCount -Expected 2 -Message "current-shift/live processing continues on the next iteration after publishing timeout"
    Assert-Equal -Actual $global:TimeoutIsolationClosedDayCount -Expected 2 -Message "closed-day processing continues after publishing timeout"
    Assert-True -Condition (($global:TimeoutIsolationHeartbeatStates -join ",") -match "starting" -and ($global:TimeoutIsolationHeartbeatStates -join ",") -match "stopping") -Message "heartbeat remains operational after publishing timeout"
    Assert-True -Condition ($global:TimeoutIsolationSleeps -contains 60) -Message "next iteration respects publishing polling delay after timeout"

    $heartbeatRuntimeConfig = New-TestConfig -Root $programDataRoot -InstallRoot $installRoot
    $heartbeatRuntimeConfig.heartbeat_enabled = $true
    $heartbeatRuntimeConfig.closed_day_worker_enabled = $false
    $heartbeatRuntimeConfigPath = Join-Path $programDataRoot "heartbeat-runtime-config.json"
    Write-StorePulseMachineConfig -Config $heartbeatRuntimeConfig -Path $heartbeatRuntimeConfigPath | Out-Null
    $global:HeartbeatStates = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $heartbeatRuntimeConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) [PSCustomObject]@{ canonical_record_count = 12; inserted_count = 1; updated_count = 2; unchanged_count = 9; failed_count = 0; request_id = "live-request" } } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -HeartbeatReporter { param($Config,$Secrets,$Status,$State,$ErrorCode,$ErrorMessage) $global:HeartbeatStates += $State; [PSCustomObject]@{ enabled = $true; status = "succeeded"; request_id = "hb-$State" } } `
        -Sleep { param($Seconds) } | Out-Null
    Assert-True -Condition (($global:HeartbeatStates -join ",") -match "starting" -and ($global:HeartbeatStates -join ",") -match "syncing" -and ($global:HeartbeatStates -join ",") -match "ready" -and ($global:HeartbeatStates -join ",") -match "stopping") -Message "runtime sends starting/syncing/ready/stopping heartbeats"
    $heartbeatRuntimeStatus = Get-Content -LiteralPath (Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot) -Raw | ConvertFrom-Json
    Assert-Equal -Actual $heartbeatRuntimeStatus.heartbeat_reporter.status -Expected "succeeded" -Message "runtime records successful heartbeat reporter"
    Assert-Equal -Actual $heartbeatRuntimeStatus.heartbeat_reporter.consecutive_failures -Expected 0 -Message "heartbeat reporter failure count clears after success"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$heartbeatRuntimeStatus.live_worker.last_completed_at)) -Message "successful worker attempt sets last_completed_at"

    $global:HeartbeatFailureStates = @()
    Invoke-StorePulseServiceRuntime `
        -Mode Run `
        -ConfigPath $heartbeatRuntimeConfigPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) throw "cloud rejected synthetic-token" } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -HeartbeatReporter { param($Config,$Secrets,$Status,$State,$ErrorCode,$ErrorMessage) $global:HeartbeatFailureStates += "$State/$ErrorCode"; [PSCustomObject]@{ enabled = $true; status = "failed"; error_message = "heartbeat failed" } } `
        -Sleep { param($Seconds) } `
        -MaxIterations 3 | Out-Null
    $heartbeatFailureStatus = Get-Content -LiteralPath (Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot) -Raw | ConvertFrom-Json
    Assert-True -Condition (($global:HeartbeatFailureStates -join ",") -match "degraded" -and ($global:HeartbeatFailureStates -join ",") -match "error") -Message "runtime sends degraded then error after repeated live failures"
    Assert-True -Condition (($global:HeartbeatFailureStates -join ",") -match "cloud_rejected") -Message "runtime uses safe cloud error code"
    Assert-True -Condition ([int]$heartbeatFailureStatus.heartbeat_reporter.consecutive_failures -gt 0) -Message "heartbeat reporter tracks independent failure count"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$heartbeatFailureStatus.live_worker.last_completed_at)) -Message "failed worker attempt sets last_completed_at"
    Invoke-StorePulseServiceRuntime `
        -Mode Once `
        -ConfigPath $configPath `
        -SecretsPath $secretsPathForRuntime `
        -InstallRoot $installRoot `
        -LiveWorker { param($Config,$Secrets,$Root) } `
        -ClosedDayWorker { param($Config,$Secrets,$Root) } `
        -Sleep { param($Seconds) } | Out-Null

    $statusPath = Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot
    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $status.live_worker.status -Expected "succeeded" -Message "heartbeat records live worker success"
    Assert-Equal -Actual $status.closed_day_worker.status -Expected "succeeded" -Message "heartbeat records closed worker success"
    Assert-Equal -Actual $status.heartbeat_reporter.status -Expected "disabled" -Message "runtime status records disabled heartbeat reporter"
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
    $whatIfFixtureRoot = Join-Path $tempRoot ("installer-whatif-" + [guid]::NewGuid().ToString("N"))
    $whatIfProgramDataRoot = Join-Path $whatIfFixtureRoot "programdata"
    $whatIfInstallRoot = Join-Path $whatIfFixtureRoot "install"
    New-Item -ItemType Directory -Path $whatIfProgramDataRoot -Force | Out-Null
    $whatIfConfig = New-TestConfig -Root $whatIfProgramDataRoot -InstallRoot $whatIfInstallRoot
    $whatIfConfig.pos_publish_enabled = $true
    $whatIfConfig.live_poll_interval_seconds = 123
    $whatIfConfig.closed_day_poll_interval_seconds = 4567
    $whatIfConfig.closed_day_worker_enabled = $false
    $whatIfConfig.closed_day_once_enabled = $true
    $whatIfConfigPath = Join-Path $whatIfProgramDataRoot "config.json"
    $whatIfConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $whatIfConfigPath -Encoding UTF8
    $whatIfTokenSentinel = "whatif-token-" + [guid]::NewGuid().ToString("N")
    [PSCustomObject]@{ connector_token = $whatIfTokenSentinel } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $whatIfProgramDataRoot "secrets.json") -Encoding UTF8
    $whatIfConfigBytes = [IO.File]::ReadAllBytes($whatIfConfigPath)
    $whatIfConfigHash = (Get-FileHash -LiteralPath $whatIfConfigPath -Algorithm SHA256).Hash
    $whatIfFilesBefore = @(Get-ChildItem -LiteralPath $whatIfFixtureRoot -Recurse -Force -File | ForEach-Object { "{0}|{1}|{2}" -f $_.FullName.Substring($whatIfFixtureRoot.Length), $_.Length, $_.LastWriteTimeUtc.Ticks }) | Sort-Object
    $whatIfOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "install-storepulse-machine-connector.ps1") -Upgrade -WhatIf -SourceRoot (Join-Path $repoRoot "connector") -InstallRoot $whatIfInstallRoot -ProgramDataRoot $whatIfProgramDataRoot 2>&1
    $whatIfExitCode = $LASTEXITCODE
    $whatIfFilesAfter = @(Get-ChildItem -LiteralPath $whatIfFixtureRoot -Recurse -Force -File | ForEach-Object { "{0}|{1}|{2}" -f $_.FullName.Substring($whatIfFixtureRoot.Length), $_.Length, $_.LastWriteTimeUtc.Ticks }) | Sort-Object
    $whatIfOutputText = ($whatIfOutput | ForEach-Object { [string]$_ }) -join "`n"
    Assert-Equal -Actual $whatIfExitCode -Expected 0 -Message "installer Upgrade WhatIf exits successfully without elevation or mutation"
    Assert-True -Condition ($whatIfOutputText -match "What if:" -and $whatIfOutputText -match "No configuration, service, secret, or installation artifact was modified") -Message "installer Upgrade WhatIf reports the non-mutating plan"
    Assert-Equal -Actual ([Convert]::ToBase64String([IO.File]::ReadAllBytes($whatIfConfigPath))) -Expected ([Convert]::ToBase64String($whatIfConfigBytes)) -Message "installer Upgrade WhatIf leaves config bytes unchanged"
    Assert-Equal -Actual (Get-FileHash -LiteralPath $whatIfConfigPath -Algorithm SHA256).Hash -Expected $whatIfConfigHash -Message "installer Upgrade WhatIf leaves config hash unchanged"
    Assert-Equal -Actual ([bool]((Get-Content -LiteralPath $whatIfConfigPath -Raw | ConvertFrom-Json).pos_publish_enabled)) -Expected $true -Message "installer Upgrade WhatIf leaves an existing enabled value untouched"
    Assert-Equal -Actual ($whatIfFilesAfter -join "`n") -Expected ($whatIfFilesBefore -join "`n") -Message "installer Upgrade WhatIf creates no files or metadata changes"
    Assert-Equal -Actual (@(Get-ChildItem -LiteralPath $whatIfProgramDataRoot -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "config.json.tmp-*" -or $_.Name -like "config.json.pre-heartbeat-*.bak" }).Count) -Expected 0 -Message "installer Upgrade WhatIf creates no config backup or temporary files"
    Assert-True -Condition (-not $whatIfOutputText.Contains($whatIfTokenSentinel)) -Message "installer Upgrade WhatIf never reflects the connector token"
    # This is the same mutation helper used by the real repair/upgrade path after
    # ShouldProcess approval. It proves the approved path still disables publishing.
    $whatIfUpgrade = Update-StorePulseMachineConfigForHeartbeat -Path $whatIfConfigPath -CreateBackup
    $whatIfUpgradedConfig = Get-Content -LiteralPath $whatIfConfigPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual ([bool]$whatIfUpgradedConfig.pos_publish_enabled) -Expected $false -Message "approved upgrade migration forces publishing disabled"
    Assert-Equal -Actual ([int]$whatIfUpgradedConfig.live_poll_interval_seconds) -Expected 123 -Message "approved upgrade migration preserves live polling"
    Assert-Equal -Actual ([int]$whatIfUpgradedConfig.closed_day_poll_interval_seconds) -Expected 4567 -Message "approved upgrade migration preserves finalized-day polling"
    Assert-Equal -Actual ([bool]$whatIfUpgradedConfig.closed_day_worker_enabled) -Expected $false -Message "approved upgrade migration preserves current-shift settings"
    Assert-Equal -Actual ([bool]$whatIfUpgradedConfig.closed_day_once_enabled) -Expected $true -Message "approved upgrade migration preserves finalized-day settings"
    $whatIfRepeatUpgrade = Update-StorePulseMachineConfigForHeartbeat -Path $whatIfConfigPath -CreateBackup
    Assert-Equal -Actual ([bool]$whatIfRepeatUpgrade.changed) -Expected $false -Message "repeated approved upgrade is idempotent after publishing is disabled"
    $uninstallOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $serviceRoot "uninstall-storepulse-machine-connector.ps1") -WhatIf -InstallRoot $installRoot
    Assert-True -Condition (($uninstallOutput -join "`n") -match "preserved") -Message "uninstall WhatIf preserves ProgramData"

    $controlSource = Get-Content -LiteralPath (Join-Path $serviceRoot "storepulse-service-control.ps1") -Raw
    Assert-True -Condition ($controlSource -match 'InstallStatus' -and $controlSource -match 'PilotStatus' -and $controlSource -match 'CutoverStatus' -and $controlSource -match 'SetAutomaticDelayed' -and $controlSource -match '"Start"' -and $controlSource -match '"Restart"') -Message "control script exposes native service lifecycle commands"
    Assert-True -Condition ($controlSource -match 'StorePulse-CurrentShift-Sync' -and $controlSource -match 'AllowPilotWithScheduledTask') -Message "control Start has scheduled-task duplicate guard with explicit override"
    Assert-True -Condition ($controlSource.Contains('Remove-Item -LiteralPath $stopPath') -and $controlSource.Contains('Set-Content -LiteralPath $stopPath')) -Message "control Start clears stale stop file and Stop writes graceful stop file"
    $uninstallSource = Get-Content -LiteralPath (Join-Path $serviceRoot "uninstall-storepulse-machine-connector.ps1") -Raw
    Assert-True -Condition ($uninstallSource -match 'PurgeData' -and $uninstallSource -match 'ConfirmImpact = "High"') -Message "uninstall purge requires explicit destructive mode"
    $installerSource = Get-Content -LiteralPath (Join-Path $serviceRoot "install-storepulse-machine-connector.ps1") -Raw
    $installerCoreSource = Get-Content -LiteralPath (Join-Path $serviceRoot "storepulse-machine-installer-core.ps1") -Raw
    Assert-True -Condition ($installerSource -match 'storepulse-machine-installer-core.ps1' -and $installerCoreSource -match 'CreateInstallBackup' -and $installerSource -notmatch 'Start-StorePulseWindowsService') -Message "installer contains upgrade rollback without automatic service start"
    Assert-True -Condition ($installerSource -match 'Resolve-StorePulseInstallerStartupMode' -and $installerSource -match 'Set-StorePulseServiceStartupMode') -Message "installer preserves or explicitly applies startup mode for existing services"
    Assert-True -Condition ($installerSource.IndexOf('Test-StorePulseNodeRuntime') -lt $installerSource.LastIndexOf('Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot')) -Message "installer validates Node runtime before service registration"
    Assert-True -Condition ($installerSource.IndexOf('Test-StorePulseWinSWBinary') -lt $installerSource.LastIndexOf('Install-StorePulseWindowsService -InstallRoot $resolvedInstallRoot')) -Message "installer validates WinSW before service registration"
    Assert-True -Condition ($installerSource -match 'Read-StorePulseMachineConfig' -and $installerSource -match 'Read-StorePulseMachineSecrets') -Message "installer validates config and secrets before registration"

    foreach ($file in Get-ChildItem -LiteralPath $serviceRoot -Filter "*.ps1") {
        $content = Get-Content -LiteralPath $file.FullName -Raw
        Assert-True -Condition ($content -notmatch "Deepika|AB123|C:\\Users\\|Register-ScheduledTask|New-Service|192\.168\.|ABC") -Message "$($file.Name) has no user/store/service hardcoding"
        if ($file.Name -eq "storepulse-connector-heartbeat.ps1") {
            Assert-True -Condition ($content -match "Invoke-WebRequest") -Message "$($file.Name) owns heartbeat HTTP transport"
        }
        else {
            Assert-True -Condition ($content -notmatch "Invoke-RestMethod|Invoke-WebRequest") -Message "$($file.Name) performs no network calls"
        }
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
