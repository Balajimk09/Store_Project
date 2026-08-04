[CmdletBinding()]
param()

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
$childPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'research\commander-four-product-read-child.mjs'
$snapshotDirectory = 'C:\ProgramData\StorePulse\catalog-pilot'
$snapshotPath = Join-Path $snapshotDirectory 'commander-four-product-read-snapshot.json'
$selectedProducts = @(
    [ordered]@{ upc = '00000000000017'; modifier = '000' },
    [ordered]@{ upc = '00000000000024'; modifier = '000' },
    [ordered]@{ upc = '00000000034524'; modifier = '000' },
    [ordered]@{ upc = '00999999999993'; modifier = '000' }
)

function New-FourProductReadResult {
    param(
        [bool]$Ok = $false,
        [int]$ReceivedProductCount = 0,
        [bool]$SnapshotWritten = $false,
        [AllowNull()]$ErrorCode = $null,
        [AllowNull()]$FailureStage = $null
    )

    [ordered]@{
        ok = $Ok
        read_only = $true
        selection_count = 4
        received_product_count = $ReceivedProductCount
        snapshot_written = $SnapshotWritten
        error_code = $ErrorCode
        failure_stage = $FailureStage
    }
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

function ConvertFrom-FourProductReadChildResult {
    param(
        [Parameter(Mandatory)][string]$Stdout,
        [Parameter(Mandatory)][int]$ExitCode
    )

    $childSafeErrorCodes = @(
        'invalid_input',
        'transport_failed',
        'product_response_invalid',
        'product_read_failed',
        'output_too_large',
        'commander_trust_not_configured',
        'commander_certificate_invalid',
        'commander_ca_hash_mismatch',
        'commander_certificate_hash_mismatch'
    )

    try { $result = $Stdout | ConvertFrom-Json -ErrorAction Stop } catch { throw 'child_response_invalid' }
    if ($null -eq $result -or $result -is [array] -or $result -isnot [pscustomobject]) { throw 'child_response_invalid' }

    $keys = @($result.PSObject.Properties.Name)
    $missingKeys = @(@('ok', 'product', 'error_code') | Where-Object { $_ -cnotin $keys })
    if ($keys.Count -ne 3 -or $missingKeys.Count -ne 0) { throw 'child_response_invalid' }
    if ($result.ok -isnot [bool]) { throw 'child_response_invalid' }

    if ($result.ok) {
        if ($ExitCode -ne 0 -or $null -eq $result.product -or $null -ne $result.error_code) { throw 'child_response_invalid' }
        return [ordered]@{ success = $true; product = $result.product; error_code = $null }
    }

    if (
        $ExitCode -ne 1 -or
        $null -ne $result.product -or
        $result.error_code -isnot [string] -or
        $result.error_code.Length -lt 1 -or
        $result.error_code.Length -gt 128 -or
        $result.error_code -cnotin $childSafeErrorCodes
    ) { throw 'child_response_invalid' }

    return [ordered]@{ success = $false; product = $null; error_code = $result.error_code }
}

function Invoke-FourProductReadChild {
    param(
        [Parameter(Mandatory)][string]$NodePath,
        [Parameter(Mandatory)][string]$ChildPath,
        [Parameter(Mandatory)][string]$IdentityKey,
        [Parameter(Mandatory)][string]$Cookie
    )

    $process = $null
    $writer = $null
    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $NodePath
        $startInfo.Arguments = ('"{0}" "{1}"' -f $ChildPath, $IdentityKey)
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
        } catch {
            throw 'child_transport_failed'
        }

        try {
            $payload = [ordered]@{
                session_cookie = $Cookie
            } | ConvertTo-Json -Compress -ErrorAction Stop
            $utf8 = [System.Text.UTF8Encoding]::new($false)
            $writer = [System.IO.StreamWriter]::new(
                $process.StandardInput.BaseStream,
                $utf8,
                1024,
                $true
            )
            $writer.Write($payload)
            $writer.Flush()
            $writer.Dispose()
            $writer = $null
            $process.StandardInput.Close()
        } catch {
            throw 'child_stdin_failed'
        } finally {
            $payload = $null
            if ($null -ne $writer) {
                try { $writer.Dispose() } catch { }
            }
        }

        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { throw 'child_timeout' }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if ([Text.Encoding]::UTF8.GetByteCount($stdout) -gt 8192 -or [Text.Encoding]::UTF8.GetByteCount($stderr) -gt 4096 -or -not [string]::IsNullOrEmpty($stderr)) { throw 'child_transport_failed' }

        $childResult = ConvertFrom-FourProductReadChildResult -Stdout $stdout -ExitCode $process.ExitCode
        if (-not $childResult.success) { throw ('child_safe_failure:{0}' -f $childResult.error_code) }
        $product = $childResult.product
        $productFields = @('upc', 'modifier', 'description', 'price', 'department')
        $identityParts = $IdentityKey -split '/', 2
        $actualProductFields = if ($null -eq $product) { @() } else { @($product.PSObject.Properties.Name) }
        if (
            $null -eq $product -or
            $actualProductFields.Count -ne $productFields.Count -or
            (($actualProductFields -join '|') -cne ($productFields -join '|')) -or
            $product.upc -ne $identityParts[0] -or
            $product.modifier -ne $identityParts[1] -or
            $product.upc -isnot [string] -or
            $product.modifier -isnot [string] -or
            $product.description -isnot [string] -or
            $product.price -isnot [string] -or
            $product.department -isnot [string] -or
            $product.description.Length -lt 1 -or
            $product.description.Length -gt 512 -or
            $product.description -match '[\x00-\x1f\x7f-\x9f]' -or
            $product.price -notmatch '^\d+\.\d{2}$' -or
            $product.department -notmatch '^\d{1,64}$'
        ) { throw 'child_response_invalid' }
        return [ordered]@{ upc = $product.upc; modifier = $product.modifier; description = $product.description; price = $product.price; department = $product.department }
    } finally {
        if ($null -ne $writer) {
            try { $writer.Dispose() } catch { }
        }
        if ($null -ne $process) {
            try { if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) } } catch { }
            try { $process.Dispose() } catch { }
        }
    }
}

function Assert-NormalizedFourProductSet {
    param([Parameter(Mandatory)][array]$Products)

    $expectedKeys = @(
        '00000000000017/000'
        '00000000000024/000'
        '00000000034524/000'
        '00999999999993/000'
    )

    if ($Products.Count -ne 4) { throw 'product_identity_set_invalid' }

    $actualKeys = @(
        $Products | ForEach-Object {
            '{0}/{1}' -f ([string]$_.upc), ([string]$_.modifier)
        }
    )

    if ($actualKeys.Count -ne 4) { throw 'product_identity_set_invalid' }

    # Check for duplicates in actual
    $uniqueActual = @($actualKeys | Sort-Object -Unique)
    if ($uniqueActual.Count -ne 4) { throw 'product_identity_set_invalid' }

    # Every expected key must appear in actual
    foreach ($key in $expectedKeys) {
        if ($actualKeys -notcontains $key) {
            throw 'product_identity_set_invalid'
        }
    }

    # Every actual key must appear in expected
    foreach ($key in $actualKeys) {
        if ($expectedKeys -notcontains $key) {
            throw 'product_identity_set_invalid'
        }
    }
}

function Write-SanitizedFourProductSnapshot {
    param([Parameter(Mandatory)][array]$Products)

    $tempPath = $null
    try {
        if (Test-Path -LiteralPath $snapshotPath) { throw 'snapshot_precondition_failed' }
        Assert-NormalizedFourProductSet -Products $Products
        [IO.Directory]::CreateDirectory($snapshotDirectory) | Out-Null
        $snapshot = [ordered]@{
            products = @($Products)
        }
        $json = $snapshot | ConvertTo-Json -Depth 4 -Compress -ErrorAction Stop
        $tempPath = Join-Path $snapshotDirectory ('commander-four-product-read-{0}.tmp' -f [guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($tempPath, $json, [Text.UTF8Encoding]::new($false))
        $validated = Get-Content -LiteralPath $tempPath -Raw | ConvertFrom-Json -ErrorAction Stop
        if (@($validated.PSObject.Properties.Name).Count -ne 1 -or @($validated.PSObject.Properties.Name)[0] -cne 'products') { throw 'snapshot_validation_failed' }
        Assert-NormalizedFourProductSet -Products @($validated.products)
        [IO.File]::Move($tempPath, $snapshotPath)
        if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) { throw 'snapshot_validation_failed' }
        $tempPath = $null
        return $true
    } finally {
        if ($null -ne $tempPath -and (Test-Path -LiteralPath $tempPath)) {
            Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        }
    }
}

$connection = $null
$cookie = $null
$config = $null
$secrets = $null
$products = @()
$receivedProductCount = 0
$snapshotWritten = $false
$sessionDisposed = $true
$errorCode = $null
$failureStage = $null

try {
    foreach ($path in @($machineConfigModule, $machineSecretsModule, $currentShiftModule, $nodePath, $childPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'runner_initialization' }
    }
    . $machineConfigModule
    . $machineSecretsModule
    . $currentShiftModule

    try { $config = Read-StorePulseMachineConfig -Path (Resolve-OneConnectorMachineFile -LeafName 'config.json') } catch { throw 'machine_config_load' }
    try { $secrets = Read-StorePulseMachineSecrets -Path (Resolve-OneConnectorMachineFile -LeafName 'secrets.json') } catch { throw 'machine_secrets_load' }
    if (-not $config.commander_install_path -or -not $config.commander_ip -or -not $secrets.commander_username -or -not $secrets.commander_password) { throw 'authentication_input_invalid' }

    try {
        $connection = New-StorePulseCommanderConnection -CommanderInstallPath ([string]$config.commander_install_path) -CommanderIp ([string]$config.commander_ip) -Username ([string]$secrets.commander_username) -Password ([string]$secrets.commander_password)
    } catch { throw 'commander_connection_create' }
    try { $cookie = Get-StorePulseCommanderSessionCookie -Connection $connection } catch { throw 'commander_authentication' }
    if ($cookie -isnot [string] -or [string]::IsNullOrWhiteSpace($cookie) -or $cookie.Length -gt 4096 -or $cookie -match '[\x00-\x1f\x7f-\x9f&=]') { throw 'commander_authentication' }

    foreach ($identity in $selectedProducts) {
        $product = Invoke-FourProductReadChild -NodePath $nodePath -ChildPath $childPath -IdentityKey ('{0}/{1}' -f $identity.upc, $identity.modifier) -Cookie $cookie
        $products += $product
        $receivedProductCount = @($products | ForEach-Object { '{0}/{1}' -f $_.upc, $_.modifier } | Sort-Object -Unique).Count
    }
    Assert-NormalizedFourProductSet -Products $products
    $receivedProductCount = 4
} catch {
    $exceptionMessage = $_.Exception.Message
    if ($exceptionMessage -match '^child_safe_failure:(.+)$') {
        $errorCode = $Matches[1]
        $failureStage = 'child_safe_failure'
    } else {
        $errorCode = if ($exceptionMessage -match '^(runner_initialization|machine_config_load|machine_secrets_load|authentication_input_invalid|commander_connection_create|commander_authentication|child_stdin_failed|child_timeout|child_transport_failed|child_response_invalid|child_product_failed|product_identity_set_invalid)$') { $exceptionMessage } else { 'runner_failure' }
        $failureStage = $errorCode
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
            if ($null -eq $errorCode) { $errorCode = 'session_dispose_failed'; $failureStage = 'session_dispose' }
        }
    }
    $connection = $null
}

if ($null -eq $errorCode -and $sessionDisposed -and $receivedProductCount -eq 4) {
    try { $snapshotWritten = Write-SanitizedFourProductSnapshot -Products $products } catch { $errorCode = 'snapshot_write_failed'; $failureStage = 'snapshot_write' }
}

$ok = $null -eq $errorCode -and $failureStage -eq $null -and $sessionDisposed -and $receivedProductCount -eq 4 -and $snapshotWritten
$result = New-FourProductReadResult -Ok $ok -ReceivedProductCount $receivedProductCount -SnapshotWritten $snapshotWritten -ErrorCode $errorCode -FailureStage $failureStage
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
exit $(if ($ok) { 0 } else { 1 })
