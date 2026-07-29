[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; $VerbosePreference = 'SilentlyContinue'; $WarningPreference = 'SilentlyContinue'; $InformationPreference = 'SilentlyContinue'
$installedConnector = 'C:\Program Files\StorePulse\Connector'; $nodePath = Join-Path $installedConnector 'runtime\node\node.exe'; $caCertPath = 'C:\ProgramData\StorePulse\certificates\commander-ca.pem'; $testUpc = '00999999999993'; $testModifier = '000'
$allowedExceptionTypes = @('COMException', 'CryptographicException', 'FileNotFoundException', 'DirectoryNotFoundException', 'InvalidOperationException', 'IOException', 'UnauthorizedAccessException', 'RuntimeException', 'ArgumentException', 'FormatException', 'JsonException', 'OperationCanceledException', 'TimeoutException', 'ObjectDisposedException', 'NotSupportedException', 'MethodInvocationException', 'Win32Exception', 'MethodException', 'ParameterBindingException')
$approvedCodes = @('runner_initialization', 'machine_config_load', 'machine_secrets_load', 'commander_connection_create', 'commander_authentication', 'product_payload_build', 'product_transport_start', 'product_transport', 'product_response_parse', 'product_identity_verify', 'session_dispose_failed')

function New-ReadTestProductResult {
    param([bool]$AuthenticationSucceeded = $false, [bool]$ProductRequestAttempted = $false, [bool]$ProductFound = $false, [bool]$IdentityMatched = $false, [bool]$SessionDisposed = $false, [AllowNull()][string]$ErrorCode = $null, [AllowNull()][string]$FailureStage = $null, [AllowNull()][string]$ExceptionType = $null)
    [ordered]@{ operation = 'read_test_product'; authentication_succeeded = $AuthenticationSucceeded; product_request_attempted = $ProductRequestAttempted; product_found = $ProductFound; identity_matched = $IdentityMatched; write_attempted = $false; session_disposed = $SessionDisposed; error_code = $ErrorCode; failure_stage = $FailureStage; exception_type = $ExceptionType }
}
function Resolve-OneConnectorMachineFile {
    param([Parameter(Mandatory)][ValidateSet('config.json', 'secrets.json')][string]$LeafName)
    $root = 'C:\ProgramData\StorePulse'; $preferred = Join-Path $root $LeafName
    if (Test-Path -LiteralPath $preferred -PathType Leaf) { return $preferred }
    $matches = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $LeafName -ErrorAction Stop | Where-Object { $_.FullName -notlike "$root\MaintenanceRuns\*" -and $_.FullName -notlike "$root\diagnostics\*" })
    if ($matches.Count -ne 1) { throw 'machine_config_load' }; return $matches[0].FullName
}
function New-DirectVpluStreamState { param([Parameter(Mandatory)][IO.Stream]$Stream) $buffer = New-Object byte[] 512; [PSCustomObject]@{ stream = $Stream; buffer = $buffer; bytes = New-Object IO.MemoryStream; task = $Stream.ReadAsync($buffer, 0, $buffer.Length); complete = $false; overflow = $false } }
function Receive-DirectVpluStreamState {
    param([Parameter(Mandatory)]$State, [int]$Limit)
    try { if ($State.complete -or -not $State.task.IsCompleted) { return }; $count = $State.task.GetAwaiter().GetResult(); if ($count -le 0) { $State.complete = $true; return }; if (($State.bytes.Length + $count) -gt $Limit) { $State.overflow = $true; return }; $State.bytes.Write($State.buffer, 0, $count); $State.task = $State.stream.ReadAsync($State.buffer, 0, $State.buffer.Length) } catch { throw 'product_transport' }
}
function Get-ReadTestProductSafeExceptionType {
    param([AllowNull()]$Exception)
    if ($null -eq $Exception) { return 'UnexpectedException' }
    $candidate = $Exception
    if ($null -ne $Exception.InnerException -and $allowedExceptionTypes -contains [string]$Exception.InnerException.GetType().Name) { $candidate = $Exception.InnerException }
    $name = [string]$candidate.GetType().Name
    if ($allowedExceptionTypes -contains $name) { return $name }
    return 'UnexpectedException'
}
function Invoke-DirectVpluRawChild {
    param([Parameter(Mandatory)][string]$NodePath, [Parameter(Mandatory)][string]$ClientPath, [Parameter(Mandatory)][string]$PayloadJson)
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf) -or -not (Test-Path -LiteralPath $ClientPath -PathType Leaf)) { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport_start'; safe_failure_stage = 'product_transport_start'; safe_exception_type = 'FileNotFoundException' } }
    $process = $null; $writer = $null; $stdout = $null; $stderr = $null; $transportFailure = $false
    try {
        try { $startInfo = New-Object System.Diagnostics.ProcessStartInfo; $startInfo.FileName = $NodePath; $startInfo.Arguments = ('"{0}"' -f $ClientPath); $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true; $startInfo.RedirectStandardInput = $true; $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true; foreach ($name in @('STOREPULSE_CONNECTOR_TOKEN', 'STOREPULSE_COMMANDER_USERNAME', 'STOREPULSE_COMMANDER_PASSWORD', 'COMMANDER_SESSION_TOKEN')) { [void]$startInfo.EnvironmentVariables.Remove($name) }; $process = New-Object System.Diagnostics.Process; $process.StartInfo = $startInfo; if (-not $process.Start()) { throw [InvalidOperationException]::new() } } catch { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport_start'; safe_failure_stage = 'product_transport_start'; safe_exception_type = Get-ReadTestProductSafeExceptionType $_.Exception } }
        try { $utf8 = New-Object System.Text.UTF8Encoding($false); $writer = New-Object System.IO.StreamWriter($process.StandardInput.BaseStream, $utf8, 1024, $true); $writer.Write($PayloadJson); $writer.Flush(); $writer.Dispose(); $writer = $null; $process.StandardInput.Close() } catch { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport_start'; safe_failure_stage = 'product_transport_start'; safe_exception_type = Get-ReadTestProductSafeExceptionType $_.Exception } }
        try { $stdout = New-DirectVpluStreamState -Stream $process.StandardOutput.BaseStream; $stderr = New-DirectVpluStreamState -Stream $process.StandardError.BaseStream } catch { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport'; safe_failure_stage = 'product_transport'; safe_exception_type = Get-ReadTestProductSafeExceptionType $_.Exception } }
        $watch = [Diagnostics.Stopwatch]::StartNew()
        while (-not $process.HasExited -or -not $stdout.complete -or -not $stderr.complete) { try { Receive-DirectVpluStreamState -State $stdout -Limit 8192; Receive-DirectVpluStreamState -State $stderr -Limit 4096; if ($stdout.overflow -or $stderr.overflow -or $watch.Elapsed.TotalSeconds -ge 30) { $transportFailure = $true; throw [TimeoutException]::new() }; [void]$process.WaitForExit(50) } catch { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport'; safe_failure_stage = 'product_transport'; safe_exception_type = Get-ReadTestProductSafeExceptionType $_.Exception } } }
        try { $stdoutText = [Text.Encoding]::UTF8.GetString($stdout.bytes.ToArray()); $stderrText = [Text.Encoding]::UTF8.GetString($stderr.bytes.ToArray()) } catch { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport'; safe_failure_stage = 'product_transport'; safe_exception_type = Get-ReadTestProductSafeExceptionType $_.Exception } }
        if (-not [string]::IsNullOrEmpty($stderrText) -or $process.ExitCode -ne 0) { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport'; safe_failure_stage = 'product_transport'; safe_exception_type = $null } }
        try { $result = $stdoutText | ConvertFrom-Json -ErrorAction Stop } catch { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_response_parse'; safe_failure_stage = 'product_response_parse'; safe_exception_type = Get-ReadTestProductSafeExceptionType $_.Exception } }
        $keys = @($result.PSObject.Properties.Name); $required = @('authentication_succeeded', 'vplu_request_succeeded', 'test_product_found', 'product_count', 'error_code')
        if ($keys.Count -ne $required.Count -or @($required | Where-Object { $_ -cnotin $keys }).Count -gt 0 -or @($keys | Where-Object { $_ -cnotin $required }).Count -gt 0 -or $result.authentication_succeeded -isnot [bool] -or $result.vplu_request_succeeded -isnot [bool] -or $result.test_product_found -isnot [bool] -or ($null -ne $result.error_code -and $result.error_code -notin @('vplu_transport_failed', 'vplu_auth_rejected', 'vplu_response_invalid', 'test_product_not_found'))) { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_response_parse'; safe_failure_stage = 'product_response_parse'; safe_exception_type = $null } }
        return [PSCustomObject]@{ succeeded = $true; result = $result; safe_error_code = $null; safe_failure_stage = $null; safe_exception_type = $null }
    } catch { return [PSCustomObject]@{ succeeded = $false; safe_error_code = 'product_transport'; safe_failure_stage = 'product_transport'; safe_exception_type = Get-ReadTestProductSafeExceptionType $_.Exception } }
    finally { $PayloadJson = $null; if ($null -ne $writer) { try { $writer.Dispose() } catch { } }; if ($null -ne $stdout) { $stdout.bytes.Dispose() }; if ($null -ne $stderr) { $stderr.bytes.Dispose() }; if ($null -ne $process) { try { if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) } } catch { if ($transportFailure) { throw 'product_transport' } }; $process.Dispose() } }
}

$currentStage = 'runner_initialization'; $authenticationSucceeded = $false; $productRequestAttempted = $false; $productFound = $false; $identityMatched = $false; $connectionCreated = $false; $sessionCleanupSucceeded = $false; $safeErrorCode = $null; $safeFailureStage = $null; $safeExceptionType = $null
$connection = $null; $secrets = $null; $cookie = $null; $payload = $null
try {
    foreach ($path in @((Join-Path $installedConnector 'service\storepulse-machine-config.ps1'), (Join-Path $installedConnector 'service\storepulse-machine-secrets.ps1'), (Join-Path $installedConnector 'service\storepulse-current-shift-worker.ps1'), $nodePath, $caCertPath)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'runner_initialization' } }
    . (Join-Path $installedConnector 'service\storepulse-machine-config.ps1'); . (Join-Path $installedConnector 'service\storepulse-machine-secrets.ps1'); . (Join-Path $installedConnector 'service\storepulse-current-shift-worker.ps1')
    $currentStage = 'machine_config_load'; try { $config = Read-StorePulseMachineConfig -Path (Resolve-OneConnectorMachineFile -LeafName 'config.json') } catch { throw 'machine_config_load' }
    $currentStage = 'machine_secrets_load'; try { $secrets = Read-StorePulseMachineSecrets -Path (Resolve-OneConnectorMachineFile -LeafName 'secrets.json') } catch { throw 'machine_secrets_load' }
    $currentStage = 'commander_connection_create'; try { $connection = New-StorePulseCommanderConnection -CommanderInstallPath ([string]$config.commander_install_path) -CommanderIp ([string]$config.commander_ip) -Username ([string]$secrets.commander_username) -Password ([string]$secrets.commander_password); $connectionCreated = $true } catch { throw 'commander_connection_create' }
    $currentStage = 'commander_authentication'; try { $cookie = Get-StorePulseCommanderSessionCookie -Connection $connection; $authenticationSucceeded = $true } catch { throw 'commander_authentication' }
    $currentStage = 'product_payload_build'; try { $payload = [ordered]@{ base_url = 'https://' + [string]$config.commander_ip; session_cookie = $cookie; test_upc = $testUpc; ca_cert_path = $caCertPath; timeout_ms = 15000 } | ConvertTo-Json -Depth 5 -Compress -ErrorAction Stop } catch { throw 'product_payload_build' }
    $currentStage = 'product_transport_start'; $productRequestAttempted = $true; $child = Invoke-DirectVpluRawChild -NodePath $nodePath -ClientPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'research\commander-vplus-raw-client.mjs') -PayloadJson $payload
    if (-not $child.succeeded) { $safeErrorCode = $child.safe_error_code; $safeFailureStage = $child.safe_failure_stage; $safeExceptionType = $child.safe_exception_type; throw [InvalidOperationException]::new('child_failure_mapped') }
    $currentStage = 'product_identity_verify'; $raw = $child.result; if (-not $raw.vplu_request_succeeded) { $safeErrorCode = 'product_transport'; $safeFailureStage = 'product_transport'; throw [InvalidOperationException]::new('child_failure_mapped') }; if (-not $raw.test_product_found) { $productFound = $false; $identityMatched = $false; $safeErrorCode = 'product_not_found'; $safeFailureStage = 'product_identity_verify' } else { $productFound = $true; $identityMatched = $true }
} catch {
    if ($null -eq $safeErrorCode) { $observedType = [string]$_.Exception.GetType().Name; $safeExceptionType = if ($allowedExceptionTypes -contains $observedType) { $observedType } else { 'UnexpectedException' }; if ($approvedCodes -contains [string]$_.Exception.Message) { $safeErrorCode = [string]$_.Exception.Message; $safeFailureStage = if ($safeErrorCode -eq 'session_dispose_failed') { 'session_dispose' } else { $safeErrorCode } } else { $safeErrorCode = $currentStage; $safeFailureStage = $currentStage } }
} finally {
    $currentStage = 'session_dispose'; $cookie = $null; $payload = $null; $secrets = $null
    if (-not $connectionCreated) { $sessionCleanupSucceeded = $true } else { try { if ($connection.PSObject.Methods['Dispose']) { $connection.Dispose() } elseif ([Runtime.InteropServices.Marshal]::IsComObject($connection)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($connection) }; $sessionCleanupSucceeded = $true } catch { $sessionCleanupSucceeded = $false; $safeErrorCode = 'session_dispose_failed'; $safeFailureStage = 'session_dispose'; $observedType = [string]$_.Exception.GetType().Name; $safeExceptionType = if ($allowedExceptionTypes -contains $observedType) { $observedType } else { 'UnexpectedException' } }
    }
    $result = New-ReadTestProductResult -AuthenticationSucceeded $authenticationSucceeded -ProductRequestAttempted $productRequestAttempted -ProductFound $productFound -IdentityMatched $identityMatched -SessionDisposed $sessionCleanupSucceeded -ErrorCode $safeErrorCode -FailureStage $safeFailureStage -ExceptionType $safeExceptionType
    [Console]::Out.Write(([PSCustomObject]$result | ConvertTo-Json -Compress))
    exit $(if ($authenticationSucceeded -and $productRequestAttempted -and $productFound -and $identityMatched -and $sessionCleanupSucceeded -and $null -eq $safeErrorCode -and $null -eq $safeFailureStage -and $null -eq $safeExceptionType) { 0 } else { 1 })
}
