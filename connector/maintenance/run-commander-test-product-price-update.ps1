[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ExpectedCurrentPrice,
    [Parameter(Mandatory)][string]$RequestedPrice,
    [Parameter(Mandatory)][string]$WriteAuthorization
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'

$installedConnector = 'C:\Program Files\StorePulse\Connector'
$nodePath = Join-Path $installedConnector 'runtime\node\node.exe'
$machineConfigModule = 'C:\Program Files\StorePulse\Connector\service\storepulse-machine-config.ps1'
$machineSecretsModule = 'C:\Program Files\StorePulse\Connector\service\storepulse-machine-secrets.ps1'
$currentShiftModule = 'C:\Program Files\StorePulse\Connector\service\storepulse-current-shift-worker.ps1'
$childPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'research\commander-test-product-price-update-child.mjs'
$controlledUpc = '00999999999993'
$controlledModifier = '000'
$controlledDescription = 'STOREPULSE TEST'
$requiredAuthorization = 'STOREPULSE_TEST_PRICE_ONLY'

function New-ControlledPriceUpdateResult {
    param(
        [bool]$Ok = $false,
        [bool]$AuthenticationSucceeded = $false,
        [AllowNull()]$ExpectedPrice = $null,
        [AllowNull()]$RequestedPriceValue = $null,
        [AllowNull()]$ObservedCurrentPrice = $null,
        [bool]$WriteAttempted = $false,
        [bool]$WriteSucceeded = $false,
        [bool]$ReadbackAttempted = $false,
        [AllowNull()]$ObservedReadbackPrice = $null,
        [bool]$ReadbackMatched = $false,
        [bool]$SessionDisposed = $false,
        [AllowNull()]$ErrorCode = $null,
        [AllowNull()]$FailureStage = $null
    )

    [ordered]@{
        ok = $Ok
        operation = 'controlled_test_product_price_update'
        target_upc = $controlledUpc
        target_modifier = $controlledModifier
        target_description = $controlledDescription
        authentication_succeeded = $AuthenticationSucceeded
        expected_current_price = $ExpectedPrice
        requested_price = $RequestedPriceValue
        observed_current_price = $ObservedCurrentPrice
        write_attempted = $WriteAttempted
        write_succeeded = $WriteSucceeded
        readback_attempted = $ReadbackAttempted
        observed_readback_price = $ObservedReadbackPrice
        readback_matched = $ReadbackMatched
        session_disposed = $SessionDisposed
        error_code = $ErrorCode
        failure_stage = $FailureStage
    }
}

function Normalize-ControlledPrice {
    param([Parameter(Mandatory)][string]$Value)

    if ($Value -notmatch '^\d+(?:\.\d{1,2})?$') { throw 'price_validation' }
    $number = [decimal]::Zero
    if (-not [decimal]::TryParse(
        $Value,
        [Globalization.NumberStyles]::AllowDecimalPoint,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$number
    )) { throw 'price_validation' }
    if ($number -lt 0 -or $number -gt [decimal]999999.99) { throw 'price_validation' }
    return $number.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
}

function Resolve-OneConnectorMachineFile {
    param([Parameter(Mandatory)][ValidateSet('config.json', 'secrets.json')][string]$LeafName)

    $root = 'C:\ProgramData\StorePulse'
    $preferred = Join-Path $root $LeafName
    if (Test-Path -LiteralPath $preferred -PathType Leaf) { return $preferred }
    $matches = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $LeafName -ErrorAction Stop | Where-Object {
        $_.FullName -notlike "$root\MaintenanceRuns\*" -and $_.FullName -notlike "$root\diagnostics\*"
    })
    if ($matches.Count -ne 1) { throw 'machine_file_unavailable' }
    return $matches[0].FullName
}

function Get-ChildFailureStage {
    param([Parameter(Mandatory)][string]$ErrorCode)

    if ($ErrorCode -in @(
        'product_not_found',
        'initial_read_failed',
        'controlled_identity_mismatch',
        'controlled_description_mismatch',
        'current_price_conflict',
        'requested_price_unchanged'
    )) { return 'pre_write_validation' }
    if ($ErrorCode -in @('write_failed', 'write_outcome_unknown')) { return 'product_write' }
    if ($ErrorCode -in @('readback_failed', 'readback_mismatch')) { return 'product_readback' }
    if ($ErrorCode -like 'commander_tls_*' -or $ErrorCode -like 'commander_*certificate*' -or $ErrorCode -eq 'commander_ca_hash_mismatch' -or $ErrorCode -eq 'commander_ca_missing') { return 'product_transport' }
    return 'child_execution'
}

function ConvertFrom-ControlledPriceChildResult {
    param(
        [Parameter(Mandatory)][string]$Stdout,
        [Parameter(Mandatory)][int]$ExitCode,
        [Parameter(Mandatory)][string]$ExpectedPrice,
        [Parameter(Mandatory)][string]$RequestedPriceValue
    )

    $safeErrors = @(
        'invalid_input',
        'transport_failed',
        'product_not_found',
        'initial_read_failed',
        'controlled_identity_mismatch',
        'controlled_description_mismatch',
        'current_price_conflict',
        'requested_price_unchanged',
        'write_failed',
        'write_outcome_unknown',
        'readback_failed',
        'readback_mismatch',
        'commander_trust_not_configured',
        'commander_ca_missing',
        'commander_server_certificate_missing',
        'commander_certificate_invalid',
        'commander_ca_hash_mismatch',
        'commander_certificate_hash_mismatch',
        'commander_tls_hostname_invalid',
        'commander_tls_peer_mismatch',
        'output_too_large'
    )

    try { $result = $Stdout | ConvertFrom-Json -ErrorAction Stop } catch { throw 'child_response_invalid' }
    if ($null -eq $result -or $result -is [array] -or $result -isnot [pscustomobject]) { throw 'child_response_invalid' }

    $required = @(
        'ok',
        'target_upc',
        'target_modifier',
        'expected_current_price',
        'requested_price',
        'observed_current_price',
        'write_attempted',
        'write_succeeded',
        'readback_attempted',
        'observed_readback_price',
        'readback_matched',
        'error_code'
    )
    $keys = @($result.PSObject.Properties.Name)
    if ($keys.Count -ne $required.Count -or (($keys -join '|') -cne ($required -join '|'))) { throw 'child_response_invalid' }

    if (
        $result.ok -isnot [bool] -or
        $result.write_attempted -isnot [bool] -or
        $result.write_succeeded -isnot [bool] -or
        $result.readback_attempted -isnot [bool] -or
        $result.readback_matched -isnot [bool] -or
        $result.target_upc -cne $controlledUpc -or
        $result.target_modifier -cne $controlledModifier -or
        $result.expected_current_price -cne $ExpectedPrice -or
        $result.requested_price -cne $RequestedPriceValue
    ) { throw 'child_response_invalid' }

    foreach ($field in @('observed_current_price', 'observed_readback_price')) {
        $value = $result.$field
        if ($null -ne $value -and ($value -isnot [string] -or $value -notmatch '^\d+\.\d{2}$')) { throw 'child_response_invalid' }
    }

    if ($result.ok) {
        if (
            $ExitCode -ne 0 -or
            $null -ne $result.error_code -or
            -not $result.write_attempted -or
            -not $result.write_succeeded -or
            -not $result.readback_attempted -or
            -not $result.readback_matched -or
            $result.observed_current_price -cne $ExpectedPrice -or
            $result.observed_readback_price -cne $RequestedPriceValue
        ) { throw 'child_response_invalid' }
    } else {
        if (
            $ExitCode -ne 1 -or
            $result.error_code -isnot [string] -or
            $result.error_code -cnotin $safeErrors
        ) { throw 'child_response_invalid' }
    }

    return $result
}

function Invoke-ControlledPriceUpdateChild {
    param(
        [Parameter(Mandatory)][string]$NodePath,
        [Parameter(Mandatory)][string]$ChildPath,
        [Parameter(Mandatory)][string]$Cookie,
        [Parameter(Mandatory)][string]$ExpectedPrice,
        [Parameter(Mandatory)][string]$RequestedPriceValue
    )

    $process = $null
    $writer = $null
    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $NodePath
        $startInfo.Arguments = ('"{0}" "{1}" "{2}"' -f $ChildPath, $ExpectedPrice, $RequestedPriceValue)
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        foreach ($name in @('STOREPULSE_CONNECTOR_TOKEN', 'STOREPULSE_COMMANDER_USERNAME', 'STOREPULSE_COMMANDER_PASSWORD', 'COMMANDER_SESSION_TOKEN')) {
            [void]$startInfo.EnvironmentVariables.Remove($name)
        }

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        try {
            if (-not $process.Start()) { throw 'child_transport_failed' }
        } catch { throw 'child_transport_failed' }

        try {
            $payload = [ordered]@{ session_cookie = $Cookie } | ConvertTo-Json -Compress -ErrorAction Stop
            $utf8 = [System.Text.UTF8Encoding]::new($false)
            $writer = [System.IO.StreamWriter]::new($process.StandardInput.BaseStream, $utf8, 1024, $true)
            $writer.Write($payload)
            $writer.Flush()
            $writer.Dispose()
            $writer = $null
            $process.StandardInput.Close()
        } catch { throw 'child_stdin_failed' } finally {
            $payload = $null
            if ($null -ne $writer) { try { $writer.Dispose() } catch { } }
        }

        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) { throw 'child_timeout' }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if (
            [Text.Encoding]::UTF8.GetByteCount($stdout) -gt 8192 -or
            [Text.Encoding]::UTF8.GetByteCount($stderr) -gt 4096 -or
            -not [string]::IsNullOrEmpty($stderr)
        ) { throw 'child_transport_failed' }

        return ConvertFrom-ControlledPriceChildResult -Stdout $stdout -ExitCode $process.ExitCode -ExpectedPrice $ExpectedPrice -RequestedPriceValue $RequestedPriceValue
    } finally {
        if ($null -ne $writer) { try { $writer.Dispose() } catch { } }
        if ($null -ne $process) {
            try { if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) } } catch { }
            try { $process.Dispose() } catch { }
        }
    }
}

$connection = $null
$cookie = $null
$config = $null
$secrets = $null
$normalizedExpectedPrice = $null
$normalizedRequestedPrice = $null
$authenticationSucceeded = $false
$observedCurrentPrice = $null
$writeAttempted = $false
$writeSucceeded = $false
$readbackAttempted = $false
$observedReadbackPrice = $null
$readbackMatched = $false
$sessionDisposed = $true
$errorCode = $null
$failureStage = $null
$currentStage = 'runner_initialization'

try {
    $currentStage = 'write_authorization'
    if ($WriteAuthorization -cne $requiredAuthorization) { throw 'write_authorization_required' }

    $currentStage = 'price_validation'
    $normalizedExpectedPrice = Normalize-ControlledPrice -Value $ExpectedCurrentPrice
    $normalizedRequestedPrice = Normalize-ControlledPrice -Value $RequestedPrice
    if ($normalizedExpectedPrice -ceq $normalizedRequestedPrice) { throw 'requested_price_unchanged' }

    $currentStage = 'runner_initialization'
    foreach ($path in @($machineConfigModule, $machineSecretsModule, $currentShiftModule, $nodePath, $childPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'runner_initialization' }
    }

    . $machineConfigModule
    . $machineSecretsModule
    . $currentShiftModule

    $currentStage = 'machine_config_load'
    try { $config = Read-StorePulseMachineConfig -Path (Resolve-OneConnectorMachineFile -LeafName 'config.json') } catch { throw 'machine_config_load' }
    $currentStage = 'machine_secrets_load'
    try { $secrets = Read-StorePulseMachineSecrets -Path (Resolve-OneConnectorMachineFile -LeafName 'secrets.json') } catch { throw 'machine_secrets_load' }
    if (-not $config.commander_install_path -or -not $config.commander_ip -or -not $secrets.commander_username -or -not $secrets.commander_password) { throw 'authentication_input_invalid' }

    $currentStage = 'commander_connection_create'
    try {
        $connection = New-StorePulseCommanderConnection -CommanderInstallPath ([string]$config.commander_install_path) -CommanderIp ([string]$config.commander_ip) -Username ([string]$secrets.commander_username) -Password ([string]$secrets.commander_password)
    } catch { throw 'commander_connection_create' }

    $currentStage = 'commander_authentication'
    try { $cookie = Get-StorePulseCommanderSessionCookie -Connection $connection } catch { throw 'commander_authentication' }
    if ($cookie -isnot [string] -or [string]::IsNullOrWhiteSpace($cookie) -or $cookie.Length -gt 4096 -or $cookie -match '[\x00-\x1f\x7f-\x9f&=]') { throw 'commander_authentication' }
    $authenticationSucceeded = $true

    $currentStage = 'controlled_price_update'
    $child = Invoke-ControlledPriceUpdateChild -NodePath $nodePath -ChildPath $childPath -Cookie $cookie -ExpectedPrice $normalizedExpectedPrice -RequestedPriceValue $normalizedRequestedPrice
    $observedCurrentPrice = $child.observed_current_price
    $writeAttempted = $child.write_attempted
    $writeSucceeded = $child.write_succeeded
    $readbackAttempted = $child.readback_attempted
    $observedReadbackPrice = $child.observed_readback_price
    $readbackMatched = $child.readback_matched
    if (-not $child.ok) {
        $errorCode = [string]$child.error_code
        $failureStage = Get-ChildFailureStage -ErrorCode $errorCode
    }
} catch {
    if ($null -eq $errorCode) {
        $message = [string]$_.Exception.Message
        $allowed = @(
            'write_authorization_required',
            'price_validation',
            'requested_price_unchanged',
            'runner_initialization',
            'machine_config_load',
            'machine_secrets_load',
            'authentication_input_invalid',
            'commander_connection_create',
            'commander_authentication',
            'child_stdin_failed',
            'child_timeout',
            'child_transport_failed',
            'child_response_invalid'
        )
        $errorCode = if ($message -cin $allowed) { $message } else { 'runner_failure' }
        $failureStage = if ($errorCode -eq 'runner_failure') { $currentStage } else { $errorCode }
    }
} finally {
    $cookie = $null
    $secrets = $null
    $config = $null
    if ($null -ne $connection) {
        try {
            if ($connection.PSObject.Methods['Dispose']) { $connection.Dispose() }
            elseif ([Runtime.InteropServices.Marshal]::IsComObject($connection)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($connection) }
        } catch {
            $sessionDisposed = $false
            $errorCode = 'session_dispose_failed'
            $failureStage = 'session_dispose'
        }
    }
    $connection = $null
}

$ok = (
    $null -eq $errorCode -and
    $null -eq $failureStage -and
    $authenticationSucceeded -and
    $writeAttempted -and
    $writeSucceeded -and
    $readbackAttempted -and
    $readbackMatched -and
    $observedCurrentPrice -ceq $normalizedExpectedPrice -and
    $observedReadbackPrice -ceq $normalizedRequestedPrice -and
    $sessionDisposed
)

$result = New-ControlledPriceUpdateResult -Ok $ok -AuthenticationSucceeded $authenticationSucceeded -ExpectedPrice $normalizedExpectedPrice -RequestedPriceValue $normalizedRequestedPrice -ObservedCurrentPrice $observedCurrentPrice -WriteAttempted $writeAttempted -WriteSucceeded $writeSucceeded -ReadbackAttempted $readbackAttempted -ObservedReadbackPrice $observedReadbackPrice -ReadbackMatched $readbackMatched -SessionDisposed $sessionDisposed -ErrorCode $errorCode -FailureStage $failureStage
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
exit $(if ($ok) { 0 } else { 1 })
