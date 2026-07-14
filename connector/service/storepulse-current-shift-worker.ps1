[CmdletBinding()]
param()

Set-StrictMode -Version Latest

$script:StorePulseCommanderAssemblyResolverInstalled = $false
$script:StorePulseCommanderInstallPath = $null

function Assert-StorePulseMachineSecret {
    param(
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][string]$Name
    )

    $property = $Secrets.PSObject.Properties[$Name]
    if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
        throw "Required machine secret is missing: $Name"
    }

    return [string]$property.Value
}

function Get-StorePulseRequiredConfigPath {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)][string]$Name
    )

    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
        throw "Required machine config path is missing: $Name"
    }

    return [string]$property.Value
}

function Initialize-StorePulseCommanderRuntime {
    param([Parameter(Mandatory)][string]$CommanderInstallPath)

    $resolvedInstallPath = [IO.Path]::GetFullPath($CommanderInstallPath)
    $dllPath = Join-Path $resolvedInstallPath "SMTCommon.dll"
    if (-not (Test-Path -LiteralPath $dllPath -PathType Leaf)) {
        throw "SMTCommon.dll was not found at commander_install_path."
    }

    $script:StorePulseCommanderInstallPath = $resolvedInstallPath
    if (-not $script:StorePulseCommanderAssemblyResolverInstalled) {
        [System.AppDomain]::CurrentDomain.add_AssemblyResolve({
            param($sender, $eventArgs)

            if ([string]::IsNullOrWhiteSpace([string]$script:StorePulseCommanderInstallPath)) {
                return $null
            }

            $assemblyName = ([System.Reflection.AssemblyName]$eventArgs.Name).Name + ".dll"
            $dependencyPath = Join-Path $script:StorePulseCommanderInstallPath $assemblyName
            if (Test-Path -LiteralPath $dependencyPath -PathType Leaf) {
                return [System.Reflection.Assembly]::LoadFrom($dependencyPath)
            }

            return $null
        }) | Out-Null
        $script:StorePulseCommanderAssemblyResolverInstalled = $true
    }

    if (-not ("SMTCommon.clsHTTPConnection" -as [type])) {
        [void][System.Reflection.Assembly]::LoadFrom($dllPath)
    }
}

function New-StorePulseCommanderConnection {
    param(
        [Parameter(Mandatory)][string]$CommanderInstallPath,
        [Parameter(Mandatory)][string]$CommanderIp,
        [Parameter(Mandatory)][string]$Username,
        [Parameter(Mandatory)][string]$Password
    )

    Initialize-StorePulseCommanderRuntime -CommanderInstallPath $CommanderInstallPath

    $connection = New-Object SMTCommon.clsHTTPConnection
    $connection.CGIApplication = $connection.CGIDefault
    $connection.SiteIP = $CommanderIp
    $connection.SSL = $true
    $connection.User = $Username
    $connection.PassWd = $Password
    return $connection
}

function Invoke-StorePulseCommanderRequest {
    param(
        [Parameter(Mandatory)]$Connection,
        [Parameter(Mandatory)][string]$Command,
        [hashtable]$Parameters = @{},
        [string]$Cookie = ""
    )

    foreach ($key in $Parameters.Keys) {
        $null = $Connection.SetParam([string]$key, [string]$Parameters[$key])
    }
    $null = $Connection.SetParam("cmd", $Command)
    if (-not [string]::IsNullOrWhiteSpace($Cookie)) {
        $Connection.Cookie = $Cookie
    }

    $ok = $Connection.GetData()
    if (-not $ok) {
        throw "Commander request '$Command' returned False."
    }

    $responseXml = $Connection.getResponseXML()
    if ([string]::IsNullOrWhiteSpace([string]$responseXml)) {
        throw "Commander request '$Command' returned an empty response."
    }

    return [string]$responseXml
}

function Get-StorePulseCommanderSessionCookie {
    param([Parameter(Mandatory)]$Connection)

    [xml]$loginXml = Invoke-StorePulseCommanderRequest -Connection $Connection -Command "validate"
    $cookieNode = $loginXml.SelectSingleNode("//*[local-name()='cookie']")
    if ($null -eq $cookieNode -or [string]::IsNullOrWhiteSpace([string]$cookieNode.InnerText)) {
        throw "Commander login response did not contain a session cookie."
    }

    return [string]$cookieNode.InnerText.Trim()
}

function Write-StorePulseAtomicTextFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $temporaryPath = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($temporaryPath, $Content, $utf8NoBom)
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-StorePulseCurrentShiftRetrieval {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][string]$OutputPath
    )

    $commanderInstallPath = Get-StorePulseRequiredConfigPath -Config $Config -Name "commander_install_path"
    $username = Assert-StorePulseMachineSecret -Secrets $Secrets -Name "commander_username"
    $password = Assert-StorePulseMachineSecret -Secrets $Secrets -Name "commander_password"

    $connection = New-StorePulseCommanderConnection `
        -CommanderInstallPath $commanderInstallPath `
        -CommanderIp ([string]$Config.commander_ip) `
        -Username $username `
        -Password $password

    try {
        $cookie = Get-StorePulseCommanderSessionCookie -Connection $connection
        $xmlText = Invoke-StorePulseCommanderRequest `
            -Connection $connection `
            -Command "vtranssetz" `
            -Parameters @{ period = "1"; filename = "current" } `
            -Cookie $cookie

        Write-StorePulseAtomicTextFile -Path $OutputPath -Content $xmlText
        return [PSCustomObject]@{
            output_path = $OutputPath
            bytes = (Get-Item -LiteralPath $OutputPath).Length
            period = "1"
            filename = "current"
            command = "vtranssetz"
        }
    }
    finally {
        $username = $null
        $password = $null
    }
}

function Invoke-StorePulseCurrentShiftNormalizer {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][string]$XmlPath,
        [Parameter(Mandatory)][string]$NormalizedPath,
        [Parameter(Mandatory)][string]$ReconciliationPath
    )

    $normalizerPath = Join-Path $InstallRoot "storepulse-normalize-transactions.ps1"
    if (-not (Test-Path -LiteralPath $normalizerPath -PathType Leaf)) {
        throw "Current Shift normalizer script is missing."
    }

    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $normalizerPath `
        -XmlPath $XmlPath `
        -OutputPath $NormalizedPath `
        -ReconciliationPath $ReconciliationPath `
        -PeriodType "shift" `
        -PeriodNumber "current" `
        -SourcePeriodLabel "Current Shift" 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $text = @($output) -join "`n"
        if ($text.Length -gt 500) { $text = $text.Substring(0, 500) }
        throw "Current Shift normalizer exited with code $exitCode. $text"
    }

    if (-not (Test-Path -LiteralPath $NormalizedPath -PathType Leaf)) {
        throw "Current Shift normalizer did not write normalized JSON."
    }
    if (-not (Test-Path -LiteralPath $ReconciliationPath -PathType Leaf)) {
        throw "Current Shift normalizer did not write reconciliation JSON."
    }

    $transactions = @(Get-Content -LiteralPath $NormalizedPath -Raw | ConvertFrom-Json)
    return [PSCustomObject]@{
        normalized_path = $NormalizedPath
        reconciliation_path = $ReconciliationPath
        canonical_record_count = $transactions.Count
    }
}

function Invoke-StorePulseCurrentShiftUpload {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][string]$SourceXmlPath,
        [Parameter(Mandatory)][string]$NormalizedPath,
        [Parameter(Mandatory)][string]$ReconciliationPath,
        [Parameter(Mandatory)][string]$SummaryPath
    )

    $uploaderPath = Join-Path $InstallRoot "storepulse-upload-normalized-transactions.ps1"
    if (-not (Test-Path -LiteralPath $uploaderPath -PathType Leaf)) {
        throw "Normalized transaction uploader script is missing."
    }

    $previousToken = [Environment]::GetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "Process")
    try {
        [Environment]::SetEnvironmentVariable(
            "STOREPULSE_CONNECTOR_TOKEN",
            (Assert-StorePulseMachineSecret -Secrets $Secrets -Name "connector_token"),
            "Process"
        )

        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uploaderPath `
            -NormalizedPath $NormalizedPath `
            -ReconciliationPath $ReconciliationPath `
            -SourceXmlPath $SourceXmlPath `
            -Endpoint ([string]$Config.live_endpoint_url) `
            -SourceStoreNumber ([string]$Config.source_store_number) `
            -SummaryPath $SummaryPath 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $text = @($output) -join "`n"
            if ($text.Length -gt 500) { $text = $text.Substring(0, 500) }
            throw "Normalized transaction uploader exited with code $exitCode. $text"
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", $previousToken, "Process")
    }

    if (-not (Test-Path -LiteralPath $SummaryPath -PathType Leaf)) {
        throw "Normalized transaction uploader did not write summary JSON."
    }

    return (Get-Content -LiteralPath $SummaryPath -Raw | ConvertFrom-Json)
}

function Copy-StorePulseLiveArtifactsToArchive {
    param(
        [Parameter(Mandatory)][string]$ArchiveRoot,
        [Parameter(Mandatory)][string[]]$Paths
    )

    $dateFolder = Join-Path (Join-Path $ArchiveRoot "live") (Get-Date -Format "yyyy-MM-dd")
    $runFolder = Join-Path $dateFolder ((Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + "-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $runFolder -Force | Out-Null

    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Copy-Item -LiteralPath $path -Destination (Join-Path $runFolder (Split-Path -Leaf $path)) -Force
        }
    }

    return $runFolder
}

function Invoke-StorePulseCurrentShiftPipeline {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][string]$InstallRoot,
        [scriptblock]$CommanderRetriever = $null,
        [scriptblock]$NormalizerInvoker = $null,
        [scriptblock]$UploaderInvoker = $null,
        [scriptblock]$ArchiveInvoker = $null
    )

    $liveWorkingRoot = Join-Path ([string]$Config.working_root) "live"
    $stateRoot = if ($Config.PSObject.Properties["state_root"] -and -not [string]::IsNullOrWhiteSpace([string]$Config.state_root)) {
        [string]$Config.state_root
    }
    else {
        Join-Path (Split-Path -Parent ([string]$Config.logs_root)) "state"
    }
    foreach ($path in @($liveWorkingRoot, $stateRoot)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }
    }

    $xmlPath = Join-Path $liveWorkingRoot "current-shift.xml"
    $normalizedPath = Join-Path $liveWorkingRoot "current-shift-normalized.json"
    $reconciliationPath = Join-Path $liveWorkingRoot "current-shift-reconciliation.json"
    $uploadSummaryPath = Join-Path $stateRoot "live-current-shift-upload-summary.json"
    $pipelineSummaryPath = Join-Path $stateRoot "live-current-shift-summary.json"

    if ($null -eq $CommanderRetriever) {
        $CommanderRetriever = { param($configValue, $secretsValue, $outputPathValue) Invoke-StorePulseCurrentShiftRetrieval -Config $configValue -Secrets $secretsValue -OutputPath $outputPathValue }
    }
    if ($null -eq $NormalizerInvoker) {
        $NormalizerInvoker = { param($installRootValue, $xmlPathValue, $normalizedPathValue, $reconciliationPathValue) Invoke-StorePulseCurrentShiftNormalizer -InstallRoot $installRootValue -XmlPath $xmlPathValue -NormalizedPath $normalizedPathValue -ReconciliationPath $reconciliationPathValue }
    }
    if ($null -eq $UploaderInvoker) {
        $UploaderInvoker = { param($configValue, $secretsValue, $installRootValue, $xmlPathValue, $normalizedPathValue, $reconciliationPathValue, $summaryPathValue) Invoke-StorePulseCurrentShiftUpload -Config $configValue -Secrets $secretsValue -InstallRoot $installRootValue -SourceXmlPath $xmlPathValue -NormalizedPath $normalizedPathValue -ReconciliationPath $reconciliationPathValue -SummaryPath $summaryPathValue }
    }
    if ($null -eq $ArchiveInvoker) {
        $ArchiveInvoker = { param($archiveRootValue, $pathsValue) Copy-StorePulseLiveArtifactsToArchive -ArchiveRoot $archiveRootValue -Paths $pathsValue }
    }

    $startedAt = (Get-Date).ToUniversalTime().ToString("o")
    $retrieval = & $CommanderRetriever $Config $Secrets $xmlPath
    $normalization = & $NormalizerInvoker $InstallRoot $xmlPath $normalizedPath $reconciliationPath
    $upload = & $UploaderInvoker $Config $Secrets $InstallRoot $xmlPath $normalizedPath $reconciliationPath $uploadSummaryPath

    $failedCount = if ($upload.PSObject.Properties["failed_count"]) { [int]$upload.failed_count } else { 0 }
    if ($failedCount -gt 0) {
        throw "StorePulse rejected one or more normalized Current Shift transactions."
    }

    $archivePath = & $ArchiveInvoker ([string]$Config.archive_root) @($xmlPath, $normalizedPath, $reconciliationPath, $uploadSummaryPath)
    $summary = [ordered]@{
        status = "completed"
        started_at = $startedAt
        completed_at = (Get-Date).ToUniversalTime().ToString("o")
        source_store_number = [string]$Config.source_store_number
        commander_command = "vtranssetz"
        period = "1"
        filename = "current"
        source_xml_path = $xmlPath
        normalized_path = $normalizedPath
        reconciliation_path = $reconciliationPath
        upload_summary_path = $uploadSummaryPath
        archive_path = [string]$archivePath
        canonical_record_count = [int]$normalization.canonical_record_count
        inserted_count = if ($upload.PSObject.Properties["inserted_count"]) { [int]$upload.inserted_count } else { 0 }
        updated_count = if ($upload.PSObject.Properties["updated_count"]) { [int]$upload.updated_count } else { 0 }
        unchanged_count = if ($upload.PSObject.Properties["unchanged_count"]) { [int]$upload.unchanged_count } else { 0 }
        failed_count = $failedCount
    }
    Write-StorePulseAtomicTextFile -Path $pipelineSummaryPath -Content ($summary | ConvertTo-Json -Depth 20)
    return [PSCustomObject]$summary
}

function New-StorePulseClosedDayInvocationPlan {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)][string]$InstallRoot
    )

    $wrapperPath = Join-Path $InstallRoot "storepulse-finalize-closed-day-machine.ps1"
    return [PSCustomObject]@{
        script_path = $wrapperPath
        arguments = @(
            "-InstallPath", (Get-StorePulseRequiredConfigPath -Config $Config -Name "commander_install_path"),
            "-CommanderIp", ([string]$Config.commander_ip),
            "-SourceStoreNumber", ([string]$Config.source_store_number),
            "-WorkingRoot", ([string]$Config.working_root),
            "-ArchiveRoot", ([string]$Config.archive_root),
            "-Endpoint", ([string]$Config.finalization_endpoint_url)
        )
    }
}


function Test-StorePulseServiceScripts {
    param([Parameter(Mandatory)][string]$Root)

    $required = @(
        "storepulse-connector.mjs",
        "storepulse-finalize-closed-day.ps1",
        "storepulse-finalize-closed-day-machine.ps1",
        "storepulse-normalize-transactions.ps1",
        "storepulse-upload-normalized-transactions.ps1",
        "storepulse-upload-finalized-business-day.ps1",
        "service\storepulse-current-shift-worker.ps1"
    )
    foreach ($name in $required) {
        $path = Join-Path $Root $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required connector script missing: $name"
        }
    }

    $nodeManifest = Join-Path (Join-Path $Root "service") "node-runtime-manifest.json"
    if (-not (Test-Path -LiteralPath $nodeManifest -PathType Leaf)) {
        throw "Required Node runtime manifest missing."
    }
    return $true
}

function New-StorePulseDefaultLiveWorker {
    return {
        param($Config, $Secrets, $InstallRoot)
        Invoke-StorePulseCurrentShiftPipeline -Config $Config -Secrets $Secrets -InstallRoot $InstallRoot
    }.GetNewClosure()
}

function New-StorePulseDefaultClosedDayWorker {
    return {
        param($Config, $Secrets, $InstallRoot)

        $enabled = Get-StorePulseConfigBool -Config $Config -Name "closed_day_once_enabled" -Default $false
        if (-not $enabled) { return }

        $plan = New-StorePulseClosedDayInvocationPlan -Config $Config -InstallRoot $InstallRoot
        if (-not (Test-Path -LiteralPath $plan.script_path -PathType Leaf)) {
            throw "Machine-wide closed-day wrapper script is missing."
        }

        $previous = @{}
        foreach ($name in @("STOREPULSE_COMMANDER_USERNAME", "STOREPULSE_COMMANDER_PASSWORD", "STOREPULSE_CONNECTOR_TOKEN")) {
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
        }

        try {
            [Environment]::SetEnvironmentVariable("STOREPULSE_COMMANDER_USERNAME", (Assert-StorePulseMachineSecret -Secrets $Secrets -Name "commander_username"), "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_COMMANDER_PASSWORD", (Assert-StorePulseMachineSecret -Secrets $Secrets -Name "commander_password"), "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", (Assert-StorePulseMachineSecret -Secrets $Secrets -Name "connector_token"), "Process")

            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $plan.script_path @($plan.arguments)
            if ($LASTEXITCODE -ne 0) {
                throw "Closed-day finalizer exited with code $LASTEXITCODE."
            }
        }
        finally {
            foreach ($name in $previous.Keys) {
                [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
            }
        }
    }.GetNewClosure()
}
