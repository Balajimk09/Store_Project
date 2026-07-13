[CmdletBinding()]
param(
    [string]$InstallPath = "",
    [string]$CommanderIp = "",
    [string]$CredentialTarget = "StorePulseCommander",
    [string]$SourceStoreNumber = "",
    [string]$WorkingRoot = "",
    [string]$ArchiveRoot = "",
    [string]$EnvPath = "",
    [string]$Endpoint = "",
    [string]$PeriodFilename = "",
    [ValidateRange(1, 1000)][int]$BatchSize = 500,
    [switch]$DryRun,
    [switch]$FetchOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptVersion = "2.0.0"
$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$NormalizerPath = Join-Path $ScriptDirectory "storepulse-normalize-transactions.ps1"
$UploaderPath = Join-Path $ScriptDirectory "storepulse-upload-finalized-business-day.ps1"
$testNormalizerPath = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_NORMALIZER_PATH", "Process")
$testUploaderPath = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_UPLOADER_PATH", "Process")
if (-not [string]::IsNullOrWhiteSpace($testNormalizerPath)) { $NormalizerPath = $testNormalizerPath }
if (-not [string]::IsNullOrWhiteSpace($testUploaderPath)) { $UploaderPath = $testUploaderPath }

function Import-DotEnv {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) { continue }
        $separatorIndex = $trimmed.IndexOf("=")
        if ($separatorIndex -lt 1) { continue }
        $name = $trimmed.Substring(0, $separatorIndex).Trim()
        $value = $trimmed.Substring($separatorIndex + 1).Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if (-not [string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Read-ConfigValue {
    param(
        [string]$Value,
        [string]$Name,
        [switch]$Required
    )
    if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value.Trim() }
    $envValue = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue.Trim() }
    if ($Required) { throw "$Name is required." }
    return ""
}

function Assert-StorePulseSafePathSegment {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][string]$Name,
        [int]$MaxLength = 64
    )
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name cannot be blank." }
    if ($Value.Length -gt $MaxLength) { throw "$Name is too long for a safe path segment." }
    if ($Value -eq "." -or $Value -eq "..") { throw "$Name cannot be a relative path segment." }
    if ($Value.EndsWith(".") -or $Value.EndsWith(" ")) { throw "$Name cannot end with a period or space." }
    if ($Value.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { throw "$Name contains invalid Windows filename characters." }
    if ($Value.Contains("\") -or $Value.Contains("/") -or $Value.Contains(":")) { throw "$Name contains path separator characters." }
    if ($Value -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') { throw "$Name cannot be a reserved Windows device name." }
    return $Value
}

function Assert-StorePulseBusinessDateSegment {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "Business date is not a safe path segment." }
    return (Assert-StorePulseSafePathSegment -Value $Value -Name "BusinessDate" -MaxLength 10)
}

function Assert-StorePulsePeriodNumberSegment {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^\d+$') { throw "Period number must contain digits only." }
    return (Assert-StorePulseSafePathSegment -Value $Value -Name "PeriodNumber" -MaxLength 32)
}

function Assert-StorePulseHashSegment {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^[a-fA-F0-9]{64}$') { throw "Source file hash must be a 64-character SHA-256 hex value." }
    return $Value.ToLowerInvariant()
}

function Assert-StorePulseSuccessfulFinalizationResult {
    param([Parameter(Mandatory)]$Result)
    $status = [string]$Result.status
    if ($status -ne "finalized" -and $status -ne "already_finalized") {
        throw "Finalization uploader did not report finalized or already_finalized status."
    }
    return $status
}

function New-StorePulseClosedDayRunDirectory {
    param(
        [Parameter(Mandatory)][string]$WorkingRoot,
        [Parameter(Mandatory)][string]$SafeStoreSegment,
        [Parameter(Mandatory)][string]$PeriodNumber
    )
    $safePeriod = Assert-StorePulsePeriodNumberSegment -Value $PeriodNumber
    $runStamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
    $runId = [guid]::NewGuid().ToString("N")
    return (Join-Path $WorkingRoot (Join-Path $SafeStoreSegment (Join-Path "day" (Join-Path $safePeriod (Join-Path "runs" ("{0}-{1}" -f $runStamp, $runId))))))
}

function Ensure-CredentialReader {
    if ("StorePulse.NativeCredential" -as [type]) { return }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace StorePulse
{
    public static class NativeCredential
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct CREDENTIAL
        {
            public UInt32 Flags;
            public UInt32 Type;
            public IntPtr TargetName;
            public IntPtr Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public UInt32 CredentialBlobSize;
            public IntPtr CredentialBlob;
            public UInt32 Persist;
            public UInt32 AttributeCount;
            public IntPtr Attributes;
            public IntPtr TargetAlias;
            public IntPtr UserName;
        }

        [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

        [DllImport("Advapi32.dll", SetLastError = true)]
        private static extern void CredFree(IntPtr buffer);

        public static string[] ReadGeneric(string target)
        {
            const UInt32 CRED_TYPE_GENERIC = 1;
            IntPtr credentialPtr;
            if (!CredRead(target, CRED_TYPE_GENERIC, 0, out credentialPtr))
            {
                int error = Marshal.GetLastWin32Error();
                throw new InvalidOperationException("Windows Credential Manager entry could not be read. Target=" + target + ", Win32Error=" + error);
            }
            try
            {
                CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPtr, typeof(CREDENTIAL));
                string username = credential.UserName == IntPtr.Zero ? string.Empty : Marshal.PtrToStringUni(credential.UserName);
                string password = credential.CredentialBlob == IntPtr.Zero ? string.Empty : Marshal.PtrToStringUni(credential.CredentialBlob, checked((int)credential.CredentialBlobSize / 2));
                return new[] { username, password };
            }
            finally
            {
                CredFree(credentialPtr);
            }
        }
    }
}
"@
}

function New-CommanderConnection {
    param(
        [Parameter(Mandatory)][string]$InstallPath,
        [Parameter(Mandatory)][string]$CommanderIp,
        [Parameter(Mandatory)][string]$CredentialTarget
    )
    $dllPath = Join-Path $InstallPath "SMTCommon.dll"
    if (-not (Test-Path -LiteralPath $dllPath -PathType Leaf)) {
        throw "SMTCommon.dll was not found at the configured InstallPath."
    }

    [System.AppDomain]::CurrentDomain.add_AssemblyResolve({
        param($sender, $eventArgs)
        $assemblyName = ([System.Reflection.AssemblyName]$eventArgs.Name).Name + ".dll"
        $dependencyPath = Join-Path $InstallPath $assemblyName
        if (Test-Path -LiteralPath $dependencyPath) {
            return [System.Reflection.Assembly]::LoadFrom($dependencyPath)
        }
        return $null
    }) | Out-Null
    [void][System.Reflection.Assembly]::LoadFrom($dllPath)

    Ensure-CredentialReader
    $storedCredential = [StorePulse.NativeCredential]::ReadGeneric($CredentialTarget)
    $username = $storedCredential[0]
    $plainPassword = $storedCredential[1]
    if ([string]::IsNullOrWhiteSpace($username)) { throw "Credential target does not contain a username." }
    if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw "Credential target does not contain a password." }

    $connection = New-Object SMTCommon.clsHTTPConnection
    $connection.CGIApplication = $connection.CGIDefault
    $connection.SiteIP = $CommanderIp
    $connection.SSL = $true
    $connection.User = $username
    $connection.PassWd = $plainPassword
    return $connection
}

function Invoke-Commander {
    param(
        [Parameter(Mandatory)]$Connection,
        [Parameter(Mandatory)][string]$Command,
        [hashtable]$Parameters = @{},
        [string]$Cookie = ""
    )
    foreach ($key in $Parameters.Keys) {
        $null = $Connection.SetParam($key, [string]$Parameters[$key])
    }
    $null = $Connection.SetParam("cmd", $Command)
    if (-not [string]::IsNullOrWhiteSpace($Cookie)) {
        $Connection.Cookie = $Cookie
    }
    $ok = $Connection.GetData()
    if (-not $ok) { throw "Commander request '$Command' returned False." }
    $xmlText = $Connection.getResponseXML()
    if ([string]::IsNullOrWhiteSpace($xmlText)) { throw "Commander request '$Command' returned an empty response." }
    return $xmlText
}

function Get-CommanderSessionCookie {
    param([Parameter(Mandatory)]$Connection)
    $loginXmlText = Invoke-Commander -Connection $Connection -Command "validate"
    $loginXml = [xml]$loginXmlText
    $cookieNode = $loginXml.SelectSingleNode("//*[local-name()='cookie']")
    if (-not $cookieNode -or [string]::IsNullOrWhiteSpace($cookieNode.InnerText)) {
        throw "Login response did not contain a session cookie."
    }
    return $cookieNode.InnerText.Trim()
}

function Get-NodeText {
    param([AllowNull()][System.Xml.XmlNode]$Node)
    if ($null -eq $Node) { return "" }
    return ([string]$Node.InnerText).Trim()
}

function Get-ValueByNames {
    param(
        [Parameter(Mandatory)][System.Xml.XmlNode]$Node,
        [Parameter(Mandatory)][string[]]$Names
    )
    foreach ($name in $Names) {
        $attribute = $Node.Attributes[$name]
        if ($null -ne $attribute -and -not [string]::IsNullOrWhiteSpace($attribute.Value)) { return $attribute.Value.Trim() }
        $child = $Node.SelectSingleNode("./*[translate(local-name(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')='$($name.ToLowerInvariant())']")
        if ($null -ne $child -and -not [string]::IsNullOrWhiteSpace($child.InnerText)) { return $child.InnerText.Trim() }
    }
    return ""
}

function Get-ClosedDayCandidates {
    param([Parameter(Mandatory)][xml]$PeriodListXml)
    if ($PeriodListXml.DocumentElement.LocalName -ne "periodList") {
        throw "Commander period list root must be periodList."
    }
    $candidates = @()
    $nodes = @($PeriodListXml.SelectNodes("//*"))
    foreach ($node in $nodes) {
        $filename = Get-ValueByNames -Node $node -Names @("filename", "fileName", "name")
        $period = Get-ValueByNames -Node $node -Names @("period", "periodID", "periodId")
        $isCurrent = (Get-ValueByNames -Node $node -Names @("current", "isCurrent", "iscurrent")).ToLowerInvariant()
        if ($period -ne "2") { continue }
        if ($filename -notmatch '^\d{4}-\d{2}-\d{2}\.(\d+)$') { continue }
        if ($filename -match 'current' -or $isCurrent -in @("true", "1", "yes")) { continue }
        $candidates += [PSCustomObject]@{
            filename = $filename
            period = $period
            period_number = $Matches[1]
        }
    }
    $deduped = @($candidates | Sort-Object filename -Unique)
    return @($deduped | Sort-Object filename)
}

function Select-ClosedDayPeriod {
    param(
        [Parameter(Mandatory)][array]$Candidates,
        [string]$PeriodFilename
    )
    if ($Candidates.Count -eq 0) { throw "No closed Day period candidates were found." }
    if (-not [string]::IsNullOrWhiteSpace($PeriodFilename)) {
        $match = @($Candidates | Where-Object { $_.filename -eq $PeriodFilename })
        if ($match.Count -ne 1) { throw "Requested PeriodFilename was not found as a closed Day period." }
        return $match[0]
    }
    return @($Candidates | Sort-Object filename)[-1]
}

function Parse-DateTimeOffsetStrict {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][string]$Name
    )
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($Value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) {
        throw "$Name is not a parseable DateTimeOffset."
    }
    return $parsed
}

function Validate-ClosedTransSet {
    param(
        [Parameter(Mandatory)][xml]$Xml,
        [Parameter(Mandatory)][string]$SourceStoreNumber,
        [Parameter(Mandatory)]$SelectedPeriod
    )
    $root = $Xml.DocumentElement
    if ($root.LocalName -ne "transSet") { throw "Closed transaction response root must be transSet." }
    $faultNode = $Xml.SelectSingleNode("//*[local-name()='fault']")
    if ($faultNode) { throw "Commander returned a fault node." }
    if ($root.GetAttribute("periodID") -ne "2") { throw "transSet periodID must be 2 for Day." }
    if ($root.GetAttribute("periodname").Trim().ToLowerInvariant() -ne "day") { throw "transSet periodname must be Day." }
    if ($root.GetAttribute("site") -ne $SourceStoreNumber) { throw "transSet site does not match SourceStoreNumber." }
    if ($root.GetAttribute("shortId") -ne $SelectedPeriod.period_number) { throw "transSet shortId does not match selected period filename." }

    $openedNodes = @($Xml.SelectNodes("//*[local-name()='openedTime']"))
    $closedNodes = @($Xml.SelectNodes("//*[local-name()='closedTime']"))
    if ($openedNodes.Count -ne 1) { throw "transSet must contain exactly one openedTime." }
    if ($closedNodes.Count -ne 1) { throw "transSet must contain exactly one closedTime." }
    $openedText = Get-NodeText -Node $openedNodes[0]
    $closedText = Get-NodeText -Node $closedNodes[0]
    $opened = Parse-DateTimeOffsetStrict -Value $openedText -Name "openedTime"
    $closed = Parse-DateTimeOffsetStrict -Value $closedText -Name "closedTime"
    if ($opened -ge $closed) { throw "openedTime must be earlier than closedTime." }

    $longId = $root.GetAttribute("longId")
    if (-not [string]::IsNullOrWhiteSpace($longId)) {
        $longIdNumber = 0
        if ([int]::TryParse($longId, [ref]$longIdNumber) -and $longIdNumber -lt [int]$SelectedPeriod.period_number) {
            throw "transSet longId is inconsistent with the selected closed period."
        }
    }

    $transactionNodes = @($Xml.SelectNodes("//*[local-name()='trans']"))
    $headerNodes = @($Xml.SelectNodes("//*[local-name()='trHeader']"))
    if ($transactionNodes.Count -eq 0 -or $headerNodes.Count -eq 0) {
        throw "transSet does not contain transaction/header content."
    }

    return [PSCustomObject]@{
        period_type = "day"
        period_number = $root.GetAttribute("shortId")
        source_period_label = $SelectedPeriod.filename
        period_open = $opened.ToString("o")
        period_close = $closed.ToString("o")
        business_date = $opened.Date.ToString("yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
        transaction_count = $transactionNodes.Count
    }
}

function Get-Sha256HexFromFile {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Copy-ToArchive {
    param(
        [Parameter(Mandatory)][string]$ArchiveRoot,
        [Parameter(Mandatory)][string]$SourceStoreNumber,
        [Parameter(Mandatory)][string]$BusinessDate,
        [Parameter(Mandatory)][string]$PeriodNumber,
        [Parameter(Mandatory)][string[]]$Paths
    )
    $safeStore = Assert-StorePulseSafePathSegment -Value $SourceStoreNumber -Name "SourceStoreNumber"
    $safeBusinessDate = Assert-StorePulseBusinessDateSegment -Value $BusinessDate
    $safePeriod = Assert-StorePulsePeriodNumberSegment -Value $PeriodNumber
    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Archive source file is missing: $([IO.Path]::GetFileName($path))."
        }
    }
    $sourceHash = Assert-StorePulseHashSegment -Value (Get-Sha256HexFromFile -Path $Paths[0])
    $destination = Join-Path $ArchiveRoot (Join-Path $safeStore (Join-Path "day" (Join-Path $safeBusinessDate (Join-Path $safePeriod $sourceHash))))
    $verificationName = "archive-verification.json"
    if (Test-Path -LiteralPath $destination) {
        foreach ($path in $Paths) {
            $existingPath = Join-Path $destination ([IO.Path]::GetFileName($path))
            if (-not (Test-Path -LiteralPath $existingPath -PathType Leaf)) {
                throw "Archive collision: existing archive is missing $([IO.Path]::GetFileName($path))."
            }
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $existingPath).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash) {
                throw "Archive collision: existing archive file differs for $([IO.Path]::GetFileName($path))."
            }
        }
        $existingVerification = Join-Path $destination $verificationName
        if (-not (Test-Path -LiteralPath $existingVerification -PathType Leaf)) {
            throw "Archive collision: existing archive is missing archive verification manifest."
        }
        return $destination
    }

    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $tempDestination = Join-Path $parent ((".tmp-{0}" -f ([guid]::NewGuid().ToString("N"))))
    New-Item -ItemType Directory -Path $tempDestination -Force | Out-Null
    $verificationFiles = @()
    foreach ($path in $Paths) {
        $fileName = [IO.Path]::GetFileName($path)
        $target = Join-Path $tempDestination $fileName
        Copy-Item -LiteralPath $path -Destination $target
        $sourceItem = Get-Item -LiteralPath $path
        $targetItem = Get-Item -LiteralPath $target
        if ($targetItem.Length -ne $sourceItem.Length) {
            throw "Archive copy size verification failed for $fileName."
        }
        $sourceFileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant() -ne $sourceFileHash) {
            throw "Archive copy hash verification failed for $fileName."
        }
        $verificationFiles += [ordered]@{
            filename = $fileName
            size = $sourceItem.Length
            sha256 = $sourceFileHash
        }
    }
    $verification = [ordered]@{
        created_at = (Get-Date).ToUniversalTime().ToString("o")
        source_file_hash = $sourceHash
        files = $verificationFiles
    }
    $verificationPath = Join-Path $tempDestination $verificationName
    $verification | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $verificationPath -Encoding UTF8
    Rename-Item -LiteralPath $tempDestination -NewName ([IO.Path]::GetFileName($destination))
    return $destination
}

if ([Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_DOT_SOURCE_ONLY", "Process") -eq "1") {
    return
}

if ([string]::IsNullOrWhiteSpace($EnvPath)) { $EnvPath = Join-Path $ScriptDirectory ".env" }
Import-DotEnv -Path $EnvPath

$InstallPath = Read-ConfigValue -Value $InstallPath -Name "STOREPULSE_COMMANDER_INSTALL_PATH" -Required
$CommanderIp = Read-ConfigValue -Value $CommanderIp -Name "STOREPULSE_COMMANDER_IP" -Required
$SourceStoreNumber = Read-ConfigValue -Value $SourceStoreNumber -Name "STOREPULSE_SOURCE_STORE_NUMBER" -Required
$WorkingRoot = Read-ConfigValue -Value $WorkingRoot -Name "STOREPULSE_CLOSED_DAY_WORKING_ROOT" -Required
$ArchiveRoot = Read-ConfigValue -Value $ArchiveRoot -Name "STOREPULSE_CLOSED_DAY_ARCHIVE_ROOT"
$safeStoreSegment = Assert-StorePulseSafePathSegment -Value $SourceStoreNumber -Name "SourceStoreNumber"

if (-not (Test-Path -LiteralPath $NormalizerPath -PathType Leaf)) { throw "Normalizer script was not found." }
if (-not (Test-Path -LiteralPath $UploaderPath -PathType Leaf)) { throw "Finalization uploader script was not found." }

$testPeriodListPath = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_PERIOD_LIST_PATH", "Process")
$testTransSetPath = [Environment]::GetEnvironmentVariable("STOREPULSE_PHASE2_TEST_TRANSSET_PATH", "Process")
$useSyntheticInputs = -not [string]::IsNullOrWhiteSpace($testPeriodListPath) -and -not [string]::IsNullOrWhiteSpace($testTransSetPath)

if ($useSyntheticInputs) {
    if (-not (Test-Path -LiteralPath $testPeriodListPath -PathType Leaf)) { throw "Synthetic test period list file was not found." }
    if (-not (Test-Path -LiteralPath $testTransSetPath -PathType Leaf)) { throw "Synthetic test transSet file was not found." }
    $periodListText = Get-Content -LiteralPath $testPeriodListPath -Raw
}
else {
    $connection = New-CommanderConnection -InstallPath $InstallPath -CommanderIp $CommanderIp -CredentialTarget $CredentialTarget
    $cookie = Get-CommanderSessionCookie -Connection $connection
    Write-Host "Commander authentication succeeded."

    $periodListText = Invoke-Commander -Connection $connection -Command "vperiodlist" -Cookie $cookie
}
$periodListXml = [xml]$periodListText
$candidate = Select-ClosedDayPeriod -Candidates (Get-ClosedDayCandidates -PeriodListXml $periodListXml) -PeriodFilename $PeriodFilename
Write-Host ("Selected closed Day period: {0}" -f $candidate.filename)

if ($useSyntheticInputs) {
    $transSetText = Get-Content -LiteralPath $testTransSetPath -Raw
}
else {
    $transSetText = Invoke-Commander -Connection $connection -Command "vtranssetz" -Parameters @{
        period = "2"
        filename = $candidate.filename
    } -Cookie $cookie
}
$transSetXml = [xml]$transSetText
$periodInfo = Validate-ClosedTransSet -Xml $transSetXml -SourceStoreNumber $SourceStoreNumber -SelectedPeriod $candidate
$safePeriodSegment = Assert-StorePulsePeriodNumberSegment -Value $periodInfo.period_number
$null = Assert-StorePulseBusinessDateSegment -Value $periodInfo.business_date

$workingDirectory = New-StorePulseClosedDayRunDirectory -WorkingRoot $WorkingRoot -SafeStoreSegment $safeStoreSegment -PeriodNumber $safePeriodSegment
New-Item -ItemType Directory -Path $workingDirectory | Out-Null

$safeLabel = $candidate.filename -replace '[^0-9A-Za-z_.-]', '_'
$sourceXmlPath = Join-Path $workingDirectory "$safeLabel.xml"
$normalizedPath = Join-Path $workingDirectory "$safeLabel.normalized.json"
$reconciliationPath = Join-Path $workingDirectory "$safeLabel.reconciliation.json"
$manifestPath = Join-Path $workingDirectory "$safeLabel.manifest.json"
$resultPath = Join-Path $workingDirectory "$safeLabel.finalization-result.json"

Set-Content -LiteralPath $sourceXmlPath -Value $transSetText -Encoding UTF8

$manifest = [ordered]@{
    script_version = $ScriptVersion
    source_system = "verifone_commander"
    source_store_number = $SourceStoreNumber
    source_period_filename = $candidate.filename
    period_type = $periodInfo.period_type
    period_number = $periodInfo.period_number
    period_open = $periodInfo.period_open
    period_close = $periodInfo.period_close
    business_date = $periodInfo.business_date
    source_xml_filename = [IO.Path]::GetFileName($sourceXmlPath)
    source_file_hash = Get-Sha256HexFromFile -Path $sourceXmlPath
    transaction_count = $periodInfo.transaction_count
    processing_status = if ($FetchOnly) { "fetched" } elseif ($DryRun) { "dry_run" } else { "ready" }
    created_at = (Get-Date).ToString("o")
}
$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

if ($FetchOnly) {
    Write-Host "FetchOnly complete. No normalization, upload, finalization, or archive was performed."
    return
}

if (Test-Path -LiteralPath $normalizedPath) { throw "Run-specific normalized output path already exists." }
& powershell -NoProfile -ExecutionPolicy Bypass -File $NormalizerPath `
    -XmlPath $sourceXmlPath `
    -OutputPath $normalizedPath `
    -ReconciliationPath $reconciliationPath `
    -BusinessDate $periodInfo.business_date `
    -PeriodType "day" `
    -PeriodNumber $periodInfo.period_number `
    -SourcePeriodLabel $candidate.filename `
    -PeriodOpen $periodInfo.period_open `
    -PeriodClose $periodInfo.period_close
$normalizerExitCode = $LASTEXITCODE
if ($normalizerExitCode -ne 0) { throw "Normalizer exited with code $normalizerExitCode." }
if (-not (Test-Path -LiteralPath $normalizedPath -PathType Leaf)) { throw "Normalizer did not produce normalized output." }
$normalizedJson = Get-Content -LiteralPath $normalizedPath -Raw | ConvertFrom-Json
if ($null -eq $normalizedJson) { throw "Normalizer output was not valid JSON." }

$uploaderArguments = @(
    "-JsonPath", $normalizedPath,
    "-XmlPath", $sourceXmlPath,
    "-SourceStoreNumber", $SourceStoreNumber,
    "-BusinessDate", $periodInfo.business_date,
    "-PeriodNumber", $periodInfo.period_number,
    "-SourcePeriodLabel", $candidate.filename,
    "-PeriodOpen", $periodInfo.period_open,
    "-PeriodClose", $periodInfo.period_close,
    "-PeriodType", "day",
    "-EnvPath", $EnvPath,
    "-ResultPath", $resultPath,
    "-BatchSize", $BatchSize
)
if (-not [string]::IsNullOrWhiteSpace($Endpoint)) {
    $uploaderArguments += @("-Endpoint", $Endpoint)
}
if ($DryRun) {
    $uploaderArguments += "-DryRun"
}

if (Test-Path -LiteralPath $resultPath) { throw "Run-specific finalization result path already exists." }
& powershell -NoProfile -ExecutionPolicy Bypass -File $UploaderPath @uploaderArguments
$uploaderExitCode = $LASTEXITCODE
if ($uploaderExitCode -ne 0) { throw "Finalization uploader exited with code $uploaderExitCode." }
if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { throw "Finalization uploader did not produce a result file." }

$result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
if ($DryRun) {
    Write-Host "DryRun complete. No StorePulse HTTP upload or archive was performed."
    return
}

$null = Assert-StorePulseSuccessfulFinalizationResult -Result $result

if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
    Write-Host "Finalization succeeded. ArchiveRoot is not configured, so files remain in working folder."
    return
}

$archiveDestination = Copy-ToArchive -ArchiveRoot $ArchiveRoot -SourceStoreNumber $SourceStoreNumber -BusinessDate $periodInfo.business_date -PeriodNumber $periodInfo.period_number -Paths @(
    $sourceXmlPath,
    $normalizedPath,
    $reconciliationPath,
    $manifestPath,
    $resultPath
)
Write-Host ("Finalization archive written to {0}" -f $archiveDestination)
