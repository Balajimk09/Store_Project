[CmdletBinding()]
param()

Set-StrictMode -Version Latest

$script:StorePulsePosPublishChildActive = $false

if (-not (Get-Command Get-StorePulseProgramDataRoot -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-config.ps1")
}
if (-not (Get-Command Read-StorePulseMachineSecrets -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-machine-secrets.ps1")
}
if (-not (Get-Command Test-StorePulseNodeRuntime -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-node-runtime.ps1")
}
if (-not (Get-Command Invoke-StorePulseConnectorHeartbeat -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot "storepulse-connector-heartbeat.ps1")
}

$script:StorePulseRuntimeVersion = "3.1.3-pos-publish-runtime"

function Get-StorePulseStateRoot {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseProgramDataRoot -Root $ProgramDataRoot) "state")
}

function Get-StorePulseRuntimeStatusPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseStateRoot -ProgramDataRoot $ProgramDataRoot) "runtime-status.json")
}

function Get-StorePulseRuntimeStopPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseStateRoot -ProgramDataRoot $ProgramDataRoot) "runtime.stop")
}

function Get-StorePulseRuntimeLockPath {
    param([string]$ProgramDataRoot = "")
    return (Join-Path (Get-StorePulseStateRoot -ProgramDataRoot $ProgramDataRoot) "runtime.lock")
}

function Test-StorePulseServiceScripts {
    param([Parameter(Mandatory)][string]$Root)
    $required = @(
        "storepulse-connector.mjs",
        "storepulse-finalize-closed-day.ps1",
        "storepulse-normalize-transactions.ps1",
        "storepulse-upload-finalized-business-day.ps1",
        "lib\pos-publish-runtime-entry.mjs",
        "lib\pos-publish-runtime.mjs",
        "lib\pos-publish-worker.mjs",
        "lib\pos-publish-api-client.mjs",
        "lib\commander-price-adapter.mjs",
        "lib\pos-publish-errors.mjs",
        "lib\pos-publish-result-contract.json",
        "lib\storepulse-origin-policy.json",
        "service\storepulse-machine-identity.ps1",
        "service\storepulse-connector-heartbeat.ps1"
    )
    foreach ($name in $required) {
        $path = Join-Path $Root $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required connector script missing: $name" }
    }
    $nodeManifest = Join-Path (Join-Path $Root "service") "node-runtime-manifest.json"
    if (-not (Test-Path -LiteralPath $nodeManifest -PathType Leaf)) { throw "Required Node runtime manifest missing." }
    Get-StorePulsePosPublishResultContract -Path (Join-Path $Root "lib\pos-publish-result-contract.json") | Out-Null
    return $true
}

function New-StorePulseWorkerStatus {
    param([string]$Name, [bool]$Enabled)
    [ordered]@{
        name = $Name
        enabled = $Enabled
        status = if ($Enabled) { "idle" } else { "disabled" }
        consecutive_failures = 0
        next_delay_seconds = 0
        last_started_at = $null
        last_completed_at = $null
        last_success_at = $null
        last_failure_at = $null
        last_error_code = $null
        last_error = $null
        last_result = $null
    }
}

function New-StorePulseHeartbeatReporterStatus {
    param([bool]$Enabled)
    [ordered]@{
        enabled = $Enabled
        status = if ($Enabled) { "idle" } else { "disabled" }
        consecutive_failures = 0
        last_attempt_at = $null
        last_success_at = $null
        last_failure_at = $null
        last_error = $null
        last_request_id = $null
    }
}

function New-StorePulsePosPublishStatus {
    param([bool]$Enabled)
    [ordered]@{
        enabled = $Enabled
        state = if ($Enabled) { "idle" } else { "disabled" }
        last_poll_at = $null
        last_outcome = $null
        last_job_id = $null
        last_error_code = $null
    }
}

function Get-StorePulsePosPublishPollSeconds {
    param([Parameter(Mandatory)]$Config)
    $value = if ($Config.PSObject.Properties["pos_publish_poll_seconds"]) { $Config.pos_publish_poll_seconds } else { 60 }
    $text = [string]$value
    if ($text -notmatch '^[0-9]+$') { throw "pos_publish_poll_seconds must be a whole number." }
    $seconds = [int]$text
    if ($seconds -lt 30 -or $seconds -gt 3600) { throw "pos_publish_poll_seconds must be between 30 and 3600." }
    return $seconds
}

function Get-StorePulsePosPublishChildTimeoutSeconds {
    param([Parameter(Mandatory)]$Config)
    $value = if ($Config.PSObject.Properties["pos_publish_child_timeout_seconds"]) { $Config.pos_publish_child_timeout_seconds } else { 60 }
    $text = [string]$value
    if ($text -notmatch '^[0-9]+$') { throw "pos_publish_child_timeout_seconds must be a whole number." }
    $seconds = [int]$text
    if ($seconds -lt 5 -or $seconds -gt 300) { throw "pos_publish_child_timeout_seconds must be between 5 and 300." }
    return $seconds
}

function Get-StorePulsePosPublishResultContract {
    param([string]$Path = "")
    $contractPath = if ([string]::IsNullOrWhiteSpace($Path)) { Join-Path (Split-Path -Parent $PSScriptRoot) "lib\pos-publish-result-contract.json" } else { $Path }
    try { $contract = Get-Content -LiteralPath $contractPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { throw "pos_publish_result_contract_invalid" }
    $required = @("properties", "outcomes", "states", "error_codes", "parent_error_codes")
    if ($null -eq $contract -or @($contract.PSObject.Properties.Name).Count -ne $required.Count -or @($required | Where-Object { $null -eq $contract.PSObject.Properties[$_] }).Count -gt 0) {
        throw "pos_publish_result_contract_invalid"
    }
    foreach ($name in $required) {
        $values = @($contract.$name)
        if ($values.Count -eq 0 -or @($values | Where-Object { $_ -isnot [string] -or $_ -notmatch '^[a-z][a-z0-9_]{0,79}$' }).Count -gt 0 -or (@($values | Select-Object -Unique).Count -ne $values.Count)) {
            throw "pos_publish_result_contract_invalid"
        }
    }
    if ((@($contract.properties) -join "|") -ne "outcome|state|last_job_id|last_error_code") { throw "pos_publish_result_contract_invalid" }
    return [PSCustomObject]@{
        properties = @($contract.properties)
        outcomes = @($contract.outcomes)
        states = @($contract.states)
        error_codes = @($contract.error_codes)
        parent_error_codes = @($contract.parent_error_codes)
    }
}

function New-StorePulseBoundedStreamReader {
    param([Parameter(Mandatory)]$Stream)
    $state = [PSCustomObject]@{
        stream = $Stream
        buffer = New-Object byte[] 1024
        pending = $null
        output = New-Object IO.MemoryStream
        complete = $false
        failed = $false
        overflow = $false
    }
    $state.pending = $state.stream.BeginRead($state.buffer, 0, $state.buffer.Length, $null, $null)
    return $state
}

function Receive-StorePulseBoundedStreamReader {
    param([Parameter(Mandatory)]$State, [int]$MaximumBytes = 4096)
    if ($State.complete -or $State.failed -or $State.overflow -or -not $State.pending.IsCompleted) { return }
    try {
        $count = $State.stream.EndRead($State.pending)
    }
    catch {
        $State.failed = $true
        return
    }
    if ($count -le 0) {
        $State.complete = $true
        return
    }
    if (($State.output.Length + $count) -gt $MaximumBytes) {
        $State.overflow = $true
        return
    }
    $State.output.Write($State.buffer, 0, $count)
    try {
        $State.pending = $State.stream.BeginRead($State.buffer, 0, $State.buffer.Length, $null, $null)
    }
    catch {
        $State.failed = $true
    }
}

function Complete-StorePulseBoundedStreamReaders {
    param([Parameter(Mandatory)]$StdoutReader, [Parameter(Mandatory)]$StderrReader, [int]$Milliseconds = 5000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $Milliseconds -and (-not $StdoutReader.complete -or -not $StderrReader.complete)) {
        Receive-StorePulseBoundedStreamReader -State $StdoutReader
        Receive-StorePulseBoundedStreamReader -State $StderrReader
        if ($StdoutReader.overflow -or $StderrReader.overflow -or $StdoutReader.failed -or $StderrReader.failed) { break }
        [Threading.Thread]::Sleep(20)
    }
}

function ConvertFrom-StorePulsePosPublishChildResult {
    param([Parameter(Mandatory)][string]$Json, [string]$ContractPath = "")
    $contract = Get-StorePulsePosPublishResultContract -Path $ContractPath
    $allowedProperties = $contract.properties
    $allowedOutcomes = $contract.outcomes
    $allowedStates = $contract.states
    $allowedErrorCodes = $contract.error_codes
    if ([string]::IsNullOrWhiteSpace($Json) -or $Json.Length -gt 4096 -or $Json -notmatch '^\s*\{[\s\S]*\}\s*$') { throw "pos_publish_child_invalid_output" }
    try { $result = $Json | ConvertFrom-Json -ErrorAction Stop } catch { throw "pos_publish_child_invalid_output" }
    if ($null -eq $result -or $result -is [System.Array]) { throw "pos_publish_child_invalid_output" }
    $properties = @($result.PSObject.Properties.Name)
    if ($properties.Count -ne $allowedProperties.Count -or @($properties | Where-Object { $_ -notin $allowedProperties }).Count -gt 0 -or @($allowedProperties | Where-Object { $_ -notin $properties }).Count -gt 0) {
        throw "pos_publish_child_invalid_output"
    }
    $outcome = $result.outcome
    $state = $result.state
    if ($outcome -isnot [string] -or $outcome.Length -gt 80 -or $outcome -notin $allowedOutcomes -or $state -isnot [string] -or $state.Length -gt 80 -or $state -notin $allowedStates) {
        throw "pos_publish_child_invalid_output"
    }
    $jobId = $result.last_job_id
    if ($null -ne $jobId -and ($jobId -isnot [string] -or $jobId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')) {
        throw "pos_publish_child_invalid_output"
    }
    $errorCode = $result.last_error_code
    if ($null -ne $errorCode -and ($errorCode -isnot [string] -or $errorCode.Length -gt 80 -or $errorCode -notin $allowedErrorCodes)) {
        throw "pos_publish_child_invalid_output"
    }
    return [PSCustomObject]@{ outcome = $outcome; state = $state; last_job_id = $jobId; last_error_code = $errorCode }
}

function Invoke-StorePulsePosPublishChild {
    param(
        [Parameter(Mandatory)][string]$NodePath,
        [Parameter(Mandatory)][string]$EntryScript,
        [Parameter(Mandatory)][Alias("Input")][string]$PayloadJson,
        [Parameter(Mandatory)][int]$TimeoutSeconds,
        [scriptblock]$StopRequested = { $false },
        [scriptblock]$EncodingFactory = $null,
        [scriptblock]$StartInfoFactory = $null,
        [scriptblock]$ProcessFactory = $null
    )
    $process = $null
    $started = $false
    $stdoutReader = $null
    $stderrReader = $null
    $inputTask = $null
    $stdinClosed = $false
    $inputWriter = $null
    $previousConsoleInputEncoding = $null
    $previousConsoleOutputEncoding = $null
    $consoleEncodingChanged = $false
    if ($script:StorePulsePosPublishChildActive) {
        return [PSCustomObject]@{ outcome = "busy"; state = "busy"; last_job_id = $null; last_error_code = $null }
    }
    $script:StorePulsePosPublishChildActive = $true
    try {
        $PayloadJson = $PayloadJson.TrimStart([char]0xfeff)
        if ($null -eq $EncodingFactory) { $EncodingFactory = { New-Object Text.UTF8Encoding($false, $true) } }
        if ($null -eq $StartInfoFactory) { $StartInfoFactory = { New-Object System.Diagnostics.ProcessStartInfo } }
        if ($null -eq $ProcessFactory) { $ProcessFactory = { New-Object System.Diagnostics.Process } }
        $utf8 = & $EncodingFactory
        if ($null -eq $utf8) { throw "pos_publish_child_start_failed" }
        $startInfo = & $StartInfoFactory
        if ($null -eq $startInfo) { throw "pos_publish_child_start_failed" }
        $startInfo.FileName = $NodePath
        $startInfo.Arguments = ('"{0}"' -f $EntryScript)
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        foreach ($name in @("STOREPULSE_CONNECTOR_TOKEN", "STOREPULSE_COMMANDER_USERNAME", "STOREPULSE_COMMANDER_PASSWORD")) {
            [void]$startInfo.EnvironmentVariables.Remove($name)
        }
        $process = & $ProcessFactory
        if ($null -eq $process) { throw "pos_publish_child_start_failed" }
        $process.StartInfo = $startInfo
        $previousConsoleInputEncoding = [Console]::InputEncoding
        $previousConsoleOutputEncoding = [Console]::OutputEncoding
        [Console]::InputEncoding = $utf8
        [Console]::OutputEncoding = $utf8
        $consoleEncodingChanged = $true
        if (-not $process.Start()) { throw "pos_publish_child_start_failed" }
        $started = $true
        $stdoutReader = New-StorePulseBoundedStreamReader -Stream $process.StandardOutput.BaseStream
        $stderrReader = New-StorePulseBoundedStreamReader -Stream $process.StandardError.BaseStream
        try {
            # Windows PowerShell 5.1 creates Process.StandardInput with Console.InputEncoding.
            # Temporarily select no-BOM UTF-8 before materializing that redirected stream.
            $stdinStream = $process.StandardInput.BaseStream
        }
        finally {
            [Console]::InputEncoding = $previousConsoleInputEncoding
            [Console]::OutputEncoding = $previousConsoleOutputEncoding
            $consoleEncodingChanged = $false
        }
        $inputWriter = New-Object IO.StreamWriter($stdinStream, $utf8, 1024, $false)
        $inputTask = $inputWriter.WriteAsync($PayloadJson)
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $reason = $null
        while ($true) {
            [void](Receive-StorePulseBoundedStreamReader -State $stdoutReader)
            [void](Receive-StorePulseBoundedStreamReader -State $stderrReader)
            if ($stdoutReader.overflow -or $stderrReader.overflow) { $reason = "pos_publish_child_output_too_large"; break }
            if ($stdoutReader.failed -or $stderrReader.failed) { $reason = "pos_publish_child_invalid_output"; break }
            if (-not $stdinClosed -and $inputTask.IsCompleted) {
                try { [void]$inputTask.GetAwaiter().GetResult(); $inputWriter.Flush(); $inputWriter.Dispose(); $inputWriter = $null; $stdinClosed = $true; $PayloadJson = $null } catch { $reason = "pos_publish_child_input_failed"; break }
            }
            $stop = $false
            try { $stop = [bool](& $StopRequested) } catch { $stop = $true }
            if ($stop) { $reason = "pos_publish_shutdown_requested"; break }
            if ($watch.Elapsed.TotalSeconds -ge $TimeoutSeconds) { $reason = "pos_publish_child_timeout"; break }
            if ($process.WaitForExit(50)) { break }
        }
        if ($null -ne $reason -and -not $process.HasExited) {
            try { $process.Kill() } catch { }
        }
        if ($process.HasExited -or $null -ne $reason) {
            [void](Complete-StorePulseBoundedStreamReaders -StdoutReader $stdoutReader -StderrReader $stderrReader -Milliseconds 5000)
        }
        if ($null -ne $reason) { throw $reason }
        if (-not $process.HasExited) { throw "pos_publish_child_timeout" }
        if ($stdoutReader.overflow -or $stderrReader.overflow) { throw "pos_publish_child_output_too_large" }
        if ($stdoutReader.failed -or $stderrReader.failed -or -not $stdoutReader.complete -or -not $stderrReader.complete) { throw "pos_publish_child_invalid_output" }
        if ($process.ExitCode -ne 0 -or $stderrReader.output.Length -gt 0) { throw "pos_publish_child_invalid_output" }
        try { $stdout = $utf8.GetString($stdoutReader.output.ToArray()) } catch { throw "pos_publish_child_invalid_output" }
        return ConvertFrom-StorePulsePosPublishChildResult -Json $stdout
    }
    catch {
        $isSafeParentCode = $false
        try { $isSafeParentCode = $_.Exception.Message -in (Get-StorePulsePosPublishResultContract).parent_error_codes } catch { }
        if ($isSafeParentCode) { throw }
        throw "pos_publish_child_start_failed"
    }
    finally {
        if ($consoleEncodingChanged) {
            try { [Console]::InputEncoding = $previousConsoleInputEncoding } catch { }
            try { [Console]::OutputEncoding = $previousConsoleOutputEncoding } catch { }
        }
        $PayloadJson = $null
        if ($null -ne $inputWriter) { try { $inputWriter.Dispose() } catch { } }
        if ($started) {
            try { if (-not $stdinClosed) { $process.StandardInput.Close() } } catch { }
            try { if (-not $process.HasExited) { $process.Kill() } } catch { }
            try {
                $killWait = [Diagnostics.Stopwatch]::StartNew()
                while (-not $process.HasExited -and $killWait.ElapsedMilliseconds -lt 5000) { [void]$process.WaitForExit(50) }
            } catch { }
        }
        if ($null -ne $stdoutReader) { $stdoutReader.output.Dispose() }
        if ($null -ne $stderrReader) { $stderrReader.output.Dispose() }
        if ($null -ne $process) { $process.Dispose() }
        $script:StorePulsePosPublishChildActive = $false
    }
}

function New-StorePulseDefaultPosPublishWorker {
    return {
        param($Config, $Secrets, $InstallRoot)
        $nodeManifestPath = Join-Path (Join-Path $InstallRoot "service") "node-runtime-manifest.json"
        $nodeValidation = Test-StorePulseNodeRuntime -InstallRoot $InstallRoot -ManifestPath $nodeManifestPath -PassThru
        if (-not $nodeValidation.ok) { throw "POS publishing Node runtime is unavailable." }
        $entryScript = Join-Path $InstallRoot "lib\pos-publish-runtime-entry.mjs"
        if (-not (Test-Path -LiteralPath $entryScript -PathType Leaf)) { throw "POS publishing runtime entry script is missing." }

        $input = [ordered]@{
            connector_token = [string]$Secrets.connector_token
            trusted_source_endpoint_url = [string]$Config.live_endpoint_url
            poll_seconds = Get-StorePulsePosPublishPollSeconds -Config $Config
            worker_version = $script:StorePulseRuntimeVersion
        } | ConvertTo-Json -Compress

        $programDataRoot = Split-Path -Parent ([string]$Config.logs_root)
        $stopPath = Get-StorePulseRuntimeStopPath -ProgramDataRoot $programDataRoot
        try {
            # The only cross-process secret transport is this bounded in-memory stdin pipe.
            $stopRequested = { Test-Path -LiteralPath $stopPath -PathType Leaf }.GetNewClosure()
            return Invoke-StorePulsePosPublishChild -NodePath ([string]$nodeValidation.node_path) -EntryScript $entryScript -Input $input -TimeoutSeconds (Get-StorePulsePosPublishChildTimeoutSeconds -Config $Config) -StopRequested $stopRequested
        }
        finally {
            $input = $null
        }
    }.GetNewClosure()
}

function Invoke-StorePulsePosPublishOnce {
    param(
        [Parameter(Mandatory)]$PublishStatus,
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][scriptblock]$Worker,
        [Parameter(Mandatory)][string]$LogsRoot
    )
    $PublishStatus.last_poll_at = (Get-Date).ToString("o")
    try {
        $workerResult = & $Worker $Config $Secrets $InstallRoot
        $result = ConvertFrom-StorePulsePosPublishChildResult -Json ($workerResult | ConvertTo-Json -Depth 5 -Compress)
        $PublishStatus.state = [string]$result.state
        $PublishStatus.last_outcome = [string]$result.outcome
        $PublishStatus.last_job_id = $result.last_job_id
        $PublishStatus.last_error_code = $result.last_error_code
        Write-StorePulseSafePublishLog -LogsRoot $LogsRoot -Level "info" -Event "pos publish poll completed" -Data @{ outcome = $PublishStatus.last_outcome; error_code = $PublishStatus.last_error_code } -Secrets $Secrets
    }
    catch {
        # Do not preserve child-process errors: they could contain remote or secret-bearing text.
        $contract = Get-StorePulsePosPublishResultContract
        $code = if ($_.Exception.Message -in $contract.parent_error_codes) { $_.Exception.Message } else { "pos_publish_runtime_failed" }
        $PublishStatus.state = "error"
        $PublishStatus.last_outcome = "internal_error"
        $PublishStatus.last_job_id = $null
        $PublishStatus.last_error_code = $code
        Write-StorePulseSafePublishLog -LogsRoot $LogsRoot -Level "error" -Event "pos publish poll failed" -Data @{ error_code = $code } -Secrets $Secrets
    }
}

function Write-StorePulseSafePublishLog {
    param(
        [Parameter(Mandatory)][string]$LogsRoot,
        [Parameter(Mandatory)][string]$Level,
        [Parameter(Mandatory)][string]$Event,
        [AllowNull()][hashtable]$Data = $null,
        [AllowNull()]$Secrets = $null
    )
    try { Write-StorePulseJsonLog -LogsRoot $LogsRoot -Level $Level -Event $Event -Data $Data -Secrets $Secrets } catch { }
}

function Update-StorePulseHeartbeatReporterStatus {
    param(
        [Parameter(Mandatory)]$ReporterStatus,
        [Parameter(Mandatory)]$Result,
        [Parameter(Mandatory)]$Secrets
    )
    if ($Result.enabled -eq $false) {
        $ReporterStatus.enabled = $false
        $ReporterStatus.status = "disabled"
        return
    }
    $ReporterStatus.enabled = $true
    $ReporterStatus.last_attempt_at = (Get-Date).ToString("o")
    if ($Result.status -eq "succeeded") {
        $ReporterStatus.status = "succeeded"
        $ReporterStatus.consecutive_failures = 0
        $ReporterStatus.last_success_at = (Get-Date).ToString("o")
        $ReporterStatus.last_error = $null
        $ReporterStatus.last_request_id = $Result.request_id
    }
    else {
        $ReporterStatus.status = "failed"
        $ReporterStatus.consecutive_failures = [int]$ReporterStatus.consecutive_failures + 1
        $ReporterStatus.last_failure_at = (Get-Date).ToString("o")
        $ReporterStatus.last_error = ConvertTo-StorePulseSafeText -Value ([string]$Result.error_message) -Secrets $Secrets
        $ReporterStatus.last_request_id = $null
    }
}

function Invoke-StorePulseRuntimeHeartbeat {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)]$Status,
        [Parameter(Mandatory)][ValidateSet("starting", "syncing", "ready", "degraded", "error", "stopping")][string]$ReportedState,
        [scriptblock]$HeartbeatReporter = $null,
        [AllowNull()][string]$ErrorMessage = $null
    )
    $errorCode = if ([string]::IsNullOrWhiteSpace($ErrorMessage)) { $null } else { Get-StorePulseErrorCode -Stage "worker" -Message $ErrorMessage }
    if ($null -eq $HeartbeatReporter) {
        $result = Invoke-StorePulseConnectorHeartbeat -Config $Config -Secrets $Secrets -RuntimeStatus $Status -ReportedState $ReportedState -ErrorCode $errorCode -ErrorMessage $ErrorMessage
    }
    else {
        $result = & $HeartbeatReporter $Config $Secrets $Status $ReportedState $errorCode $ErrorMessage
    }
    Update-StorePulseHeartbeatReporterStatus -ReporterStatus $Status.heartbeat_reporter -Result $result -Secrets $Secrets
    return $result
}

function ConvertTo-StorePulseSafeText {
    param([AllowNull()][string]$Value, [AllowNull()]$Secrets)
    if ($null -eq $Value) { return $null }
    $result = $Value
    if ($null -ne $Secrets) {
        foreach ($name in @("commander_username", "commander_password", "connector_token")) {
            $property = $Secrets.PSObject.Properties[$name]
            if ($null -ne $property -and -not [string]::IsNullOrEmpty([string]$property.Value)) {
                $result = $result.Replace([string]$property.Value, "[REDACTED]")
            }
        }
    }
    if ($result.Length -gt 500) { return $result.Substring(0, 500) }
    return $result
}

function Redact-StorePulseSecretsFromString {
    param([AllowNull()][string]$Value, [AllowNull()]$Secrets)
    if ($null -eq $Value) { return $null }
    $result = $Value
    if ($null -ne $Secrets) {
        foreach ($name in @("commander_username", "commander_password", "connector_token")) {
            $property = $Secrets.PSObject.Properties[$name]
            if ($null -ne $property -and -not [string]::IsNullOrEmpty([string]$property.Value)) {
                $result = $result.Replace([string]$property.Value, "[REDACTED]")
            }
        }
    }
    return $result
}

function Write-StorePulseJsonLog {
    param(
        [Parameter(Mandatory)][string]$LogsRoot,
        [Parameter(Mandatory)][string]$Level,
        [Parameter(Mandatory)][string]$Event,
        [AllowNull()][hashtable]$Data = $null,
        [AllowNull()]$Secrets = $null
    )
    if (-not (Test-Path -LiteralPath $LogsRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
    }
    $safeData = [ordered]@{}
    if ($null -ne $Data) {
        foreach ($key in $Data.Keys) {
            $value = $Data[$key]
            if ($value -is [string]) { $safeData[$key] = ConvertTo-StorePulseSafeText -Value $value -Secrets $Secrets }
            else { $safeData[$key] = $value }
        }
    }
    $entry = [ordered]@{
        timestamp = (Get-Date).ToString("o")
        level = $Level
        event = $Event
        data = $safeData
    }
    $path = Join-Path $LogsRoot ("runtime-" + (Get-Date -Format "yyyyMMdd") + ".jsonl")
    Add-Content -LiteralPath $path -Encoding UTF8 -Value ($entry | ConvertTo-Json -Depth 20 -Compress)
}

function Write-StorePulseRuntimeStatus {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Status,
        [AllowNull()]$Secrets = $null,
        [scriptblock]$FileReplace = $null,
        [scriptblock]$FileMove = $null,
        [scriptblock]$Sleep = $null
    )
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $json = $Status | ConvertTo-Json -Depth 20
    if ($null -ne $Secrets) {
        $json = Redact-StorePulseSecretsFromString -Value $json -Secrets $Secrets
    }
    $tempPath = Join-Path $parent ("." + [IO.Path]::GetFileName($Path) + "." + $PID + "." + [guid]::NewGuid().ToString("N") + ".tmp")
    $backupPath = Join-Path $parent ("." + [IO.Path]::GetFileName($Path) + "." + $PID + "." + [guid]::NewGuid().ToString("N") + ".bak")
    if ($null -eq $FileReplace) { $FileReplace = { param($Source, $Destination, $Backup) [IO.File]::Replace($Source, $Destination, $Backup) } }
    if ($null -eq $FileMove) { $FileMove = { param($Source, $Destination) [IO.File]::Move($Source, $Destination) } }
    if ($null -eq $Sleep) { $Sleep = { param([int]$Milliseconds) [Threading.Thread]::Sleep($Milliseconds) } }
    $stream = $null
    try {
        $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
        $stream = New-Object IO.FileStream($tempPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $replaced = $false
            $replaceError = $null
            foreach ($attempt in 1..20) {
                try {
                    & $FileReplace $tempPath $Path $backupPath
                    $replaced = $true
                    break
                }
                catch {
                    $replaceError = $_
                    if (-not (Test-StorePulseStatusReplaceRetryableException -Exception $_.Exception)) { throw }
                    & $Sleep 10
                }
            }
            if (-not $replaced) { throw $replaceError }
        }
        else {
            & $FileMove $tempPath $Path
        }
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if (Test-Path -LiteralPath $tempPath -PathType Leaf) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $backupPath -PathType Leaf) { Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue }
    }
}

function Test-StorePulseStatusReplaceRetryableException {
    param([Parameter(Mandatory)][Exception]$Exception)
    # Win32 ERROR_SHARING_VIOLATION (0x80070020) and ERROR_LOCK_VIOLATION (0x80070021).
    $current = $Exception
    while ($null -ne $current) {
        if ([int]$current.HResult -in @(-2147024864, -2147024863)) { return $true }
        $current = $current.InnerException
    }
    return $false
}

function Get-StorePulseConfigBool {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$Name, [bool]$Default)
    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $Default }
    return [bool]$property.Value
}

function Get-StorePulseConfigString {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$Name, [string]$Default = "")
    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value -or [string]::IsNullOrWhiteSpace([string]$property.Value)) { return $Default }
    return [string]$property.Value
}

function Get-StorePulseBackoffSeconds {
    param([int]$ConsecutiveFailures, [int]$BaseSeconds, [int]$MaxSeconds)
    if ($ConsecutiveFailures -le 0) { return 0 }
    $power = [math]::Min($ConsecutiveFailures - 1, 8)
    $delay = $BaseSeconds * [math]::Pow(2, $power)
    return [int]([math]::Min($delay, $MaxSeconds))
}

function Invoke-StorePulseWorkerOnce {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)]$WorkerStatus,
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)]$Secrets,
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][scriptblock]$Worker,
        [Parameter(Mandatory)][string]$LogsRoot
    )
    $WorkerStatus.status = "running"
    $WorkerStatus.last_started_at = (Get-Date).ToString("o")
    try {
        $workerResult = & $Worker $Config $Secrets $InstallRoot
        $completedAt = (Get-Date).ToString("o")
        $WorkerStatus.status = "succeeded"
        $WorkerStatus.last_completed_at = $completedAt
        $WorkerStatus.last_success_at = $completedAt
        $WorkerStatus.last_error_code = $null
        $WorkerStatus.last_error = $null
        $WorkerStatus.last_result = $workerResult
        $WorkerStatus.consecutive_failures = 0
        $WorkerStatus.next_delay_seconds = 0
        Write-StorePulseJsonLog -LogsRoot $LogsRoot -Level "info" -Event "$Name worker succeeded" -Secrets $Secrets
    }
    catch {
        $completedAt = (Get-Date).ToString("o")
        $WorkerStatus.status = "failed"
        $WorkerStatus.last_completed_at = $completedAt
        $WorkerStatus.last_failure_at = $completedAt
        $WorkerStatus.last_error = ConvertTo-StorePulseSafeText -Value $_.Exception.Message -Secrets $Secrets
        $WorkerStatus.last_error_code = Get-StorePulseErrorCode -Stage "worker" -Message $WorkerStatus.last_error
        $WorkerStatus.consecutive_failures = [int]$WorkerStatus.consecutive_failures + 1
        $WorkerStatus.next_delay_seconds = Get-StorePulseBackoffSeconds -ConsecutiveFailures ([int]$WorkerStatus.consecutive_failures) -BaseSeconds 5 -MaxSeconds 300
        Write-StorePulseJsonLog -LogsRoot $LogsRoot -Level "error" -Event "$Name worker failed" -Data @{ error = $WorkerStatus.last_error } -Secrets $Secrets
    }
}

function New-StorePulseDefaultLiveWorker {
    return {
        param($Config, $Secrets, $InstallRoot)
        $connectorScript = Join-Path $InstallRoot "storepulse-connector.mjs"
        if (-not (Test-Path -LiteralPath $connectorScript -PathType Leaf)) { throw "Live connector script is missing." }
        $nodeManifestPath = Join-Path (Join-Path $InstallRoot "service") "node-runtime-manifest.json"
        $nodeValidation = Test-StorePulseNodeRuntime -InstallRoot $InstallRoot -ManifestPath $nodeManifestPath -PassThru
        if (-not $nodeValidation.ok) {
            throw ("{0}: {1}" -f $nodeValidation.status, $nodeValidation.message)
        }
        $nodeExe = [string]$nodeValidation.node_path

        $programDataRoot = Split-Path -Parent ([string]$Config.logs_root)
        $stateRoot = Get-StorePulseStateRoot -ProgramDataRoot $programDataRoot
        if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
            New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
        }
        $summaryPath = Join-Path $stateRoot "live-once-summary.json"
        $statePath = Join-Path $stateRoot "live-upload-state.json"
        $watchFolder = Get-StorePulseConfigString -Config $Config -Name "live_watch_folder" -Default (Join-Path ([string]$Config.working_root) "live")
        $archiveFolder = Get-StorePulseConfigString -Config $Config -Name "live_archive_folder" -Default ""

        $previous = @{}
        foreach ($name in @("STOREPULSE_API_URL", "STOREPULSE_CONNECTOR_TOKEN", "STOREPULSE_WATCH_FOLDER", "STOREPULSE_ARCHIVE_FOLDER", "STOREPULSE_POLL_SECONDS", "STOREPULSE_ONCE", "STOREPULSE_SUMMARY_PATH", "STOREPULSE_STATE_PATH")) {
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
        }
        try {
            [Environment]::SetEnvironmentVariable("STOREPULSE_API_URL", [string]$Config.live_endpoint_url, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", [string]$Secrets.connector_token, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_WATCH_FOLDER", $watchFolder, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_ARCHIVE_FOLDER", $archiveFolder, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_POLL_SECONDS", [string]$Config.live_poll_interval_seconds, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_ONCE", "true", "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_SUMMARY_PATH", $summaryPath, "Process")
            [Environment]::SetEnvironmentVariable("STOREPULSE_STATE_PATH", $statePath, "Process")

            $output = & $nodeExe $connectorScript --once --summary-path $summaryPath 2>&1
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) {
                $safeOutput = ConvertTo-StorePulseSafeText -Value (($output | ForEach-Object { [string]$_ }) -join "`n") -Secrets $Secrets
                throw "Live connector one-shot exited with code $exitCode. $safeOutput"
            }
            if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) {
                throw "Live connector one-shot did not write summary JSON."
            }
            $summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
            return [PSCustomObject]@{
                scanned = [int]$summary.scanned
                eligible = [int]$summary.eligible
                uploaded = [int]$summary.uploaded
                skipped_duplicate = [int]$summary.skipped_duplicate
                skipped_unstable = [int]$summary.skipped_unstable
                failed = [int]$summary.failed
                summary_path = $summaryPath
            }
        }
        finally {
            foreach ($name in $previous.Keys) {
                [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
            }
        }
    }.GetNewClosure()
}

function New-StorePulseDefaultClosedDayWorker {
    return {
        param($Config, $Secrets, $InstallRoot)
        $enabled = Get-StorePulseConfigBool -Config $Config -Name "closed_day_once_enabled" -Default $false
        if (-not $enabled) { return }
        $closedScript = Join-Path $InstallRoot "storepulse-finalize-closed-day.ps1"
        if (-not (Test-Path -LiteralPath $closedScript -PathType Leaf)) { throw "Closed-day finalizer script is missing." }
        $previousToken = [Environment]::GetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", "Process")
        try {
            [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", [string]$Secrets.connector_token, "Process")
            $arguments = @(
                "-InstallPath", $InstallRoot,
                "-CommanderIp", ([string]$Config.commander_ip),
                "-SourceStoreNumber", ([string]$Config.source_store_number),
                "-WorkingRoot", ([string]$Config.working_root),
                "-ArchiveRoot", ([string]$Config.archive_root),
                "-Endpoint", ([string]$Config.finalization_endpoint_url)
            )
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $closedScript @arguments
            if ($LASTEXITCODE -ne 0) { throw "Closed-day finalizer exited with code $LASTEXITCODE." }
        }
        finally {
            [Environment]::SetEnvironmentVariable("STOREPULSE_CONNECTOR_TOKEN", $previousToken, "Process")
        }
    }.GetNewClosure()
}

function Invoke-StorePulseServiceRuntime {
    param(
        [ValidateSet("Validate", "Once", "Run")]
        [string]$Mode = "Validate",
        [string]$ConfigPath = "",
        [string]$SecretsPath = "",
        [string]$InstallRoot = "",
        [scriptblock]$LiveWorker = $null,
        [scriptblock]$ClosedDayWorker = $null,
        [scriptblock]$PosPublishWorker = $null,
        [scriptblock]$HeartbeatReporter = $null,
        [scriptblock]$Sleep = $null,
        [int]$MaxIterations = 0
    )
    $config = Read-StorePulseMachineConfig -Path $ConfigPath
    Test-StorePulseMachineConfig -Config $config | Out-Null
    $secrets = Read-StorePulseMachineSecrets -Path $SecretsPath
    Test-StorePulseMachineSecrets -Secrets $secrets | Out-Null
    $resolvedInstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { [string]$config.install_root } else { $InstallRoot }
    Test-StorePulseServiceScripts -Root $resolvedInstallRoot | Out-Null

    $programDataRoot = Split-Path -Parent ([string]$config.logs_root)
    $stateRoot = Get-StorePulseStateRoot -ProgramDataRoot $programDataRoot
    $statusPath = Get-StorePulseRuntimeStatusPath -ProgramDataRoot $programDataRoot
    $stopPath = Get-StorePulseRuntimeStopPath -ProgramDataRoot $programDataRoot
    $lockPath = Get-StorePulseRuntimeLockPath -ProgramDataRoot $programDataRoot
    foreach ($path in @([string]$config.logs_root, $stateRoot)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    }

    $liveEnabled = Get-StorePulseConfigBool -Config $config -Name "live_worker_enabled" -Default $true
    $closedEnabled = Get-StorePulseConfigBool -Config $config -Name "closed_day_worker_enabled" -Default $true
    $heartbeatEnabled = Get-StorePulseConfigBool -Config $config -Name "heartbeat_enabled" -Default $false
    $posPublishEnabled = Get-StorePulseConfigBool -Config $config -Name "pos_publish_enabled" -Default $false
    $posPublishPollSeconds = Get-StorePulsePosPublishPollSeconds -Config $config
    if ($null -eq $LiveWorker) { $LiveWorker = New-StorePulseDefaultLiveWorker }
    if ($null -eq $ClosedDayWorker) { $ClosedDayWorker = New-StorePulseDefaultClosedDayWorker }
    if ($null -eq $PosPublishWorker) { $PosPublishWorker = New-StorePulseDefaultPosPublishWorker }
    if ($null -eq $Sleep) { $Sleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds } }

    $status = [ordered]@{
        runtime_version = $script:StorePulseRuntimeVersion
        process_id = $PID
        started_at = (Get-Date).ToString("o")
        last_heartbeat_at = (Get-Date).ToString("o")
        mode = $Mode
        live_worker = New-StorePulseWorkerStatus -Name "live" -Enabled $liveEnabled
        closed_day_worker = New-StorePulseWorkerStatus -Name "closed_day" -Enabled $closedEnabled
        heartbeat_reporter = New-StorePulseHeartbeatReporterStatus -Enabled $heartbeatEnabled
        pos_publish = New-StorePulsePosPublishStatus -Enabled $posPublishEnabled
        stop_file = $stopPath
    }
    Write-StorePulseRuntimeStatus -Path $statusPath -Status $status -Secrets $secrets
    Write-StorePulseJsonLog -LogsRoot ([string]$config.logs_root) -Level "info" -Event "runtime validated" -Data @{ mode = $Mode; process_id = $PID } -Secrets $secrets

    if ($Mode -eq "Validate") {
        return [PSCustomObject]@{ ok = $true; status_path = $statusPath; stop_path = $stopPath; lock_path = $lockPath }
    }

    $lockStream = $null
    try {
        $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $lockBytes = [Text.Encoding]::UTF8.GetBytes("$PID`n")
        $lockStream.SetLength(0)
        $lockStream.Write($lockBytes, 0, $lockBytes.Length)
        $lockStream.Flush()
    }
    catch {
        throw "StorePulse service runtime is already active or lock file cannot be acquired."
    }

    try {
        Invoke-StorePulseRuntimeHeartbeat -Config $config -Secrets $secrets -Status $status -ReportedState "starting" -HeartbeatReporter $HeartbeatReporter | Out-Null
        Write-StorePulseRuntimeStatus -Path $statusPath -Status $status -Secrets $secrets
        $iteration = 0
        $nextPosPublishAt = Get-Date
        do {
            $iteration += 1
            $status.last_heartbeat_at = (Get-Date).ToString("o")
            if (Test-Path -LiteralPath $stopPath -PathType Leaf) {
                Write-StorePulseJsonLog -LogsRoot ([string]$config.logs_root) -Level "info" -Event "runtime stop requested" -Secrets $secrets
                break
            }
            if ($liveEnabled) {
                Invoke-StorePulseRuntimeHeartbeat -Config $config -Secrets $secrets -Status $status -ReportedState "syncing" -HeartbeatReporter $HeartbeatReporter | Out-Null
                Invoke-StorePulseWorkerOnce -Name "live" -WorkerStatus $status.live_worker -Config $config -Secrets $secrets -InstallRoot $resolvedInstallRoot -Worker $LiveWorker -LogsRoot ([string]$config.logs_root)
                if ($status.live_worker.status -eq "succeeded") {
                    Invoke-StorePulseRuntimeHeartbeat -Config $config -Secrets $secrets -Status $status -ReportedState "ready" -HeartbeatReporter $HeartbeatReporter | Out-Null
                }
                else {
                    $state = if ([int]$status.live_worker.consecutive_failures -ge 3) { "error" } else { "degraded" }
                    Invoke-StorePulseRuntimeHeartbeat -Config $config -Secrets $secrets -Status $status -ReportedState $state -HeartbeatReporter $HeartbeatReporter -ErrorMessage ([string]$status.live_worker.last_error) | Out-Null
                }
            }
            if ($closedEnabled) {
                Invoke-StorePulseWorkerOnce -Name "closed_day" -WorkerStatus $status.closed_day_worker -Config $config -Secrets $secrets -InstallRoot $resolvedInstallRoot -Worker $ClosedDayWorker -LogsRoot ([string]$config.logs_root)
            }
            if ($posPublishEnabled -and ($Mode -eq "Once" -or (Get-Date) -ge $nextPosPublishAt)) {
                Invoke-StorePulsePosPublishOnce -PublishStatus $status.pos_publish -Config $config -Secrets $secrets -InstallRoot $resolvedInstallRoot -Worker $PosPublishWorker -LogsRoot ([string]$config.logs_root)
                $nextPosPublishAt = (Get-Date).AddSeconds($posPublishPollSeconds)
            }
            Write-StorePulseRuntimeStatus -Path $statusPath -Status $status -Secrets $secrets
            if ($Mode -eq "Once") { break }
            $liveDelay = if ($liveEnabled -and [int]$status.live_worker.consecutive_failures -gt 0) { [int]$status.live_worker.next_delay_seconds } else { [int]$config.live_poll_interval_seconds }
            $closedDelay = if ($closedEnabled -and [int]$status.closed_day_worker.consecutive_failures -gt 0) { [int]$status.closed_day_worker.next_delay_seconds } else { [int]$config.closed_day_poll_interval_seconds }
            $publishDelay = if ($posPublishEnabled) { [math]::Max(1, [int][math]::Ceiling(($nextPosPublishAt - (Get-Date)).TotalSeconds)) } else { [int]::MaxValue }
            $delay = [math]::Min([math]::Min($liveDelay, $closedDelay), $publishDelay)
            if ($delay -lt 1) { $delay = 1 }
            & $Sleep ([int]$delay)
        } while ($Mode -eq "Run" -and ($MaxIterations -le 0 -or $iteration -lt $MaxIterations))
        $status.last_heartbeat_at = (Get-Date).ToString("o")
        Invoke-StorePulseRuntimeHeartbeat -Config $config -Secrets $secrets -Status $status -ReportedState "stopping" -HeartbeatReporter $HeartbeatReporter | Out-Null
        Write-StorePulseRuntimeStatus -Path $statusPath -Status $status -Secrets $secrets
        return [PSCustomObject]@{ ok = $true; iterations = $iteration; status_path = $statusPath; stop_path = $stopPath; lock_path = $lockPath }
    }
    finally {
        if ($null -ne $lockStream) { $lockStream.Dispose() }
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}
