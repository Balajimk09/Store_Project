[CmdletBinding()]
param(
    [string]$XmlPath = "$env:USERPROFILE\OneDrive\Desktop\StorePulse-current-shift-vendor-library.xml",
    [string]$OutputPath = "$env:USERPROFILE\OneDrive\Desktop\StorePulse-normalized-transactions.json",
    [string]$ReconciliationPath = "C:\StorePulse\connector\StorePulse-current-shift-reconciliation.json",
    [string]$BusinessDate = "",
    [string]$PeriodType = "",
    [string]$PeriodNumber = "",
    [string]$SourcePeriodLabel = "",
    [string]$PeriodOpen = "",
    [string]$PeriodClose = "",
    [switch]$ValidateDay734
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Production-compatible candidate: reads the current-shift XML and writes
# the standard normalized JSON by default. This script itself never uploads data.
$xmlPath = $XmlPath
$outputPath = $OutputPath
$reconciliationPath = $ReconciliationPath

function Resolve-BusinessDate {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }

    $trimmed = $Value.Trim()
    if ($trimmed -notmatch '^\d{4}-\d{2}-\d{2}$') {
        throw "BusinessDate must use YYYY-MM-DD format."
    }

    $parsed = [datetime]::MinValue
    $ok = [datetime]::TryParseExact(
        $trimmed,
        "yyyy-MM-dd",
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::None,
        [ref]$parsed
    )

    if (-not $ok) {
        throw "BusinessDate must be a real calendar date."
    }

    return $parsed.ToString("yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
}

$explicitBusinessDate = Resolve-BusinessDate -Value $BusinessDate

if (-not (Test-Path -LiteralPath $xmlPath)) {
    throw "Source XML not found: $xmlPath"
}

$outputDirectory = Split-Path -Parent $outputPath
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$reconciliationDirectory = Split-Path -Parent $reconciliationPath
if (-not [string]::IsNullOrWhiteSpace($reconciliationDirectory)) {
    New-Item -ItemType Directory -Path $reconciliationDirectory -Force | Out-Null
}

[xml]$xml = Get-Content -LiteralPath $xmlPath -Raw

$periodMetadata = [ordered]@{}
if (-not [string]::IsNullOrWhiteSpace($PeriodType)) {
    $periodMetadata["period_type"] = $PeriodType.Trim()
}
if (-not [string]::IsNullOrWhiteSpace($PeriodNumber)) {
    $periodMetadata["period_number"] = $PeriodNumber.Trim()
}
if (-not [string]::IsNullOrWhiteSpace($SourcePeriodLabel)) {
    $periodMetadata["source_period_label"] = $SourcePeriodLabel.Trim()
}
if (-not [string]::IsNullOrWhiteSpace($PeriodOpen)) {
    $periodMetadata["period_open"] = $PeriodOpen.Trim()
}
if (-not [string]::IsNullOrWhiteSpace($PeriodClose)) {
    $periodMetadata["period_close"] = $PeriodClose.Trim()
}

function Get-Text {
    param(
        [Parameter(Mandatory)][System.Xml.XmlNode]$Node,
        [Parameter(Mandatory)][string]$Name
    )

    $match = $Node.SelectSingleNode(".//*[local-name()='$Name']")
    if ($null -ne $match) { return $match.InnerText.Trim() }
    return ""
}

function Get-DirectText {
    param(
        [Parameter(Mandatory)][System.Xml.XmlNode]$Node,
        [Parameter(Mandatory)][string]$Name
    )

    $match = $Node.SelectSingleNode("./*[local-name()='$Name']")
    if ($null -ne $match) { return $match.InnerText.Trim() }
    return ""
}

function Get-DecimalValue {
    param(
        [Parameter(Mandatory)][System.Xml.XmlNode]$Node,
        [Parameter(Mandatory)][string]$Name
    )

    $value = Get-Text -Node $Node -Name $Name
    if ([string]::IsNullOrWhiteSpace($value)) { return [decimal]0 }

    $parsed = [decimal]0
    $ok = [decimal]::TryParse(
        $value,
        [System.Globalization.NumberStyles]::Any,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed
    )

    if (-not $ok) {
        throw "Unable to parse decimal '$value' for '$Name'."
    }

    return $parsed
}

function Round-Money {
    param([AllowNull()]$Value)

    if ($null -eq $Value) { return [decimal]0 }

    return [math]::Round(
        [decimal]$Value,
        2,
        [System.MidpointRounding]::AwayFromZero
    )
}

function Get-HeaderNode {
    param([Parameter(Mandatory)][System.Xml.XmlNode]$Transaction)
    return $Transaction.SelectSingleNode("./*[local-name()='trHeader']")
}

function Get-HeaderField {
    param(
        [Parameter(Mandatory)][System.Xml.XmlNode]$Transaction,
        [Parameter(Mandatory)][string]$Name
    )

    $header = Get-HeaderNode -Transaction $Transaction
    if ($null -eq $header) { return "" }
    return Get-Text -Node $header -Name $Name
}

function Get-TicketParts {
    param(
        [Parameter(Mandatory)][System.Xml.XmlNode]$Transaction,
        [Parameter(Mandatory)][ValidateSet("trTickNum","trOriginalTickNum","trRecall")]
        [string]$NodeName
    )

    $header = Get-HeaderNode -Transaction $Transaction
    if ($null -eq $header) { return $null }

    $node = $header.SelectSingleNode("./*[local-name()='$NodeName']")
    if ($null -eq $node) { return $null }

    $register = Get-DirectText -Node $node -Name "posNum"
    $sequence = Get-DirectText -Node $node -Name "trSeq"

    if (
        [string]::IsNullOrWhiteSpace($register) -or
        [string]::IsNullOrWhiteSpace($sequence)
    ) {
        return $null
    }

    return [PSCustomObject]@{
        register = $register
        sequence = $sequence
        key      = "$register$sequence"
    }
}

function Get-PaymentDirection {
    param(
        [decimal]$TransactionTotal,
        [string]$PaymentCode,
        [string]$SourceTransactionType
    )

    $normalizedPaymentCode = ([string]$PaymentCode).Trim().ToLowerInvariant()
    $normalizedSourceType = ([string]$SourceTransactionType).Trim().ToLowerInvariant()

    if ($normalizedPaymentCode -eq "change") { return "cash_out" }
    if ($normalizedSourceType -eq "payout") { return "cash_paid_out" }
    if ($normalizedSourceType -eq "safedrop") { return "cash_to_safe" }
    if ($TransactionTotal -lt 0) { return "refund_to_customer" }
    return "received_from_customer"
}

function Test-TruthyAttribute {
    param(
        [Parameter(Mandatory)][System.Xml.XmlNode]$Node,
        [Parameter(Mandatory)][string]$Name
    )

    $value = ([string]$Node.GetAttribute($Name)).Trim().ToLowerInvariant()
    return $value -in @("true", "1", "yes")
}

function Test-ErrorCorrectTransaction {
    param([Parameter(Mandatory)][System.Xml.XmlNode]$Transaction)

    $sourceType = ([string]$Transaction.GetAttribute("type")).Trim().ToLowerInvariant()
    if ($sourceType -ne "journal") { return $false }

    $journalTextNodes = @(
        $Transaction.SelectNodes(
            "./*[local-name()='trJournal']/*[local-name()='trjText']"
        )
    )

    foreach ($journalText in $journalTextNodes) {
        $signal = (
            ([string]$journalText.GetAttribute("type")) + " " +
            ([string]$journalText.InnerText)
        ).Trim()

        if ($signal -match "(?i)ERROR[\s_-]*CORRECT") {
            return $true
        }
    }

    return $false
}

function Get-AbsoluteLineAmount {
    param([System.Xml.XmlNode[]]$Lines)

    [decimal]$total = 0

    foreach ($line in @($Lines)) {
        if ($null -eq $line) { continue }
        $total += [math]::Abs(
            [decimal](Get-DecimalValue -Node $line -Name "trlLineTot")
        )
    }

    return Round-Money $total
}

function Get-PaymentAmountTotal {
    param([System.Xml.XmlNode[]]$Payments)

    [decimal]$total = 0

    foreach ($payment in @($Payments)) {
        if ($null -eq $payment) { continue }
        $total += Get-DecimalValue -Node $payment -Name "trpAmt"
    }

    return Round-Money $total
}

$allTransactions = @($xml.SelectNodes("//*[local-name()='trans']"))

# Economic records used by the existing fuel-prepay relationship logic.
$saleLikeTransactions = @(
    $allTransactions |
    Where-Object {
        $_.SelectSingleNode("./*[local-name()='trLines']") -or
        $_.SelectSingleNode("./*[local-name()='trPaylines']") -or
        $_.SelectSingleNode("./*[local-name()='trValue']")
    }
)

# Add source-native exception records that do not contain trLines/trPaylines/
# trValue. This deliberately includes only known generic source signals rather
# than all 2,000+ journal records.
$normalizableTransactions = @(
    $allTransactions |
    Where-Object {
        $sourceType = ([string]$_.GetAttribute("type")).Trim().ToLowerInvariant()

        $hasEconomicPayload =
            $_.SelectSingleNode("./*[local-name()='trLines']") -or
            $_.SelectSingleNode("./*[local-name()='trPaylines']") -or
            $_.SelectSingleNode("./*[local-name()='trValue']")

        $hasEconomicPayload -or
        $sourceType -eq "nosale" -or
        (Test-ErrorCorrectTransaction -Transaction $_)
    }
)

$recordsByTicketKey = @{}

foreach ($transaction in $saleLikeTransactions) {
    $ticket = Get-TicketParts -Transaction $transaction -NodeName "trTickNum"
    if ($null -eq $ticket) { continue }

    if (-not $recordsByTicketKey.ContainsKey($ticket.key)) {
        $recordsByTicketKey[$ticket.key] =
            [System.Collections.Generic.List[System.Xml.XmlNode]]::new()
    }

    $recordsByTicketKey[$ticket.key].Add($transaction)
}

$linkedFuelCompletionRecords = @(
    $saleLikeTransactions |
    Where-Object {
        $original = Get-TicketParts -Transaction $_ -NodeName "trOriginalTickNum"

        $hasFuelLine = $null -ne $_.SelectSingleNode(
            ".//*[local-name()='trLine']" +
            "[.//*[local-name()='trlDept' and text()='MANUAL FUEL DEPT']]"
        )

        $null -ne $original -and $hasFuelLine
    }
)

$nonCanonicalUniqueIds =
    [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

$fuelRelationships = @{}

foreach ($fuelCompletion in $linkedFuelCompletionRecords) {
    $finalUniqueId = Get-HeaderField -Transaction $fuelCompletion -Name "uniqueID"
    $original = Get-TicketParts -Transaction $fuelCompletion -NodeName "trOriginalTickNum"

    $originalCandidates = @()
    if ($null -ne $original -and $recordsByTicketKey.ContainsKey($original.key)) {
        $originalCandidates = @($recordsByTicketKey[$original.key])
    }

    $serializedOriginal = @(
        $originalCandidates |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace(
                (Get-HeaderField -Transaction $_ -Name "trUniqueSN")
            )
        }
    ) | Select-Object -First 1

    $shadowRecords = @(
        $originalCandidates |
        Where-Object {
            [string]::IsNullOrWhiteSpace(
                (Get-HeaderField -Transaction $_ -Name "trUniqueSN")
            )
        }
    )

    $originalUniqueId = $null

    if ($null -ne $serializedOriginal) {
        $originalUniqueId =
            Get-HeaderField -Transaction $serializedOriginal -Name "uniqueID"

        if (-not [string]::IsNullOrWhiteSpace($originalUniqueId)) {
            [void]$nonCanonicalUniqueIds.Add($originalUniqueId)
        }
    }

    $shadowUniqueIds = @(
        foreach ($shadow in $shadowRecords) {
            $shadowId = Get-HeaderField -Transaction $shadow -Name "uniqueID"

            if (-not [string]::IsNullOrWhiteSpace($shadowId)) {
                [void]$nonCanonicalUniqueIds.Add($shadowId)
                $shadowId
            }
        }
    )

    $fuelRelationships[$finalUniqueId] = [PSCustomObject]@{
        original_ticket           = if ($null -ne $original) { $original.key } else { $null }
        original_source_unique_id = $originalUniqueId
        shadow_source_unique_ids  = $shadowUniqueIds
    }
}

$normalizedTransactions = @(
    foreach ($transaction in $normalizableTransactions) {
        $uniqueId = Get-HeaderField -Transaction $transaction -Name "uniqueID"
        $sourceTransactionType = ([string]$transaction.GetAttribute("type")).Trim().ToLowerInvariant()

        if ([string]::IsNullOrWhiteSpace($uniqueId)) {
            Write-Warning "Skipping transaction without uniqueID."
            continue
        }

        if ($nonCanonicalUniqueIds.Contains($uniqueId)) {
            continue
        }

        $subtotal = Get-DecimalValue -Node $transaction -Name "trTotNoTax"
        $taxTotal = Get-DecimalValue -Node $transaction -Name "trTotTax"
        $total = Get-DecimalValue -Node $transaction -Name "trTotWTax"
        $currentTotal = Get-DecimalValue -Node $transaction -Name "trCurrTot"

        $lineNodes = @($transaction.SelectNodes(".//*[local-name()='trLine']"))
        $paymentNodes = @($transaction.SelectNodes(".//*[local-name()='trPayline']"))

        $fuelLines = @(
            $lineNodes |
            Where-Object {
                (Get-Text -Node $_ -Name "trlDept") -eq "MANUAL FUEL DEPT"
            }
        )

        $fuelDepositLines = @(
            $lineNodes |
            Where-Object {
                (Get-Text -Node $_ -Name "trlDept") -eq "FUEL DEPOSIT"
            }
        )

        $voidLines = @(
            $lineNodes |
            Where-Object {
                $null -ne $_.SelectSingleNode(".//*[local-name()='trlVoidLineIx']")
            }
        )

        $roundingLines = @(
            $lineNodes |
            Where-Object {
                $department = Get-Text -Node $_ -Name "trlDept"
                $description = Get-Text -Node $_ -Name "trlDesc"

                $department -match "ROUND" -or
                $description -match "^Ending in"
            }
        )

        $original = Get-TicketParts -Transaction $transaction -NodeName "trOriginalTickNum"
        $recall = Get-TicketParts -Transaction $transaction -NodeName "trRecall"
        $ticket = Get-TicketParts -Transaction $transaction -NodeName "trTickNum"

        $hasFuelLine = $fuelLines.Count -gt 0
        $hasFuelDeposit = $fuelDepositLines.Count -gt 0
        $hasItemVoids = $voidLines.Count -gt 0
        $hasRecall = $null -ne $recall
        $isSuspended = Test-TruthyAttribute -Node $transaction -Name "suspended"
        $isSourceRecalled = Test-TruthyAttribute -Node $transaction -Name "recalled"
        $isErrorCorrect = Test-ErrorCorrectTransaction -Transaction $transaction

        # Source-native exception classification must run before amount/fuel
        # heuristics. This prevents full voids, suspended tickets and no-sales
        # from becoming completed sales or zero-value events.
        $transactionType =
            if ($sourceTransactionType -eq "void") {
                "void_ticket"
            }
            elseif ($isSuspended) {
                "suspended_ticket"
            }
            elseif ($sourceTransactionType -eq "nosale") {
                "no_sale"
            }
            elseif ($isErrorCorrect) {
                "error_correct"
            }
            elseif ($sourceTransactionType -eq "payout") {
                "paid_out"
            }
            elseif ($sourceTransactionType -eq "safedrop") {
                "safe_drop"
            }
            elseif (
                $sourceTransactionType -eq "refund sale" -or
                $total -lt 0
            ) {
                "refund"
            }
            elseif ($hasFuelLine) {
                if ($null -ne $original) {
                    "fuel_prepay_completed"
                }
                else {
                    "fuel_pay_at_pump"
                }
            }
            elseif ($hasRecall) {
                "completed_recalled_sale"
            }
            elseif ($hasItemVoids) {
                "completed_sale_with_item_void"
            }
            elseif ($total -eq 0) {
                "zero_value_event"
            }
            else {
                "completed_sale"
            }

        $completedSaleTypes = @(
            "completed_sale",
            "completed_sale_with_item_void",
            "completed_recalled_sale",
            "fuel_pay_at_pump",
            "fuel_prepay_completed"
        )

        $isCompletedSale = $transactionType -in $completedSaleTypes
        $containsFuelActivity = ($hasFuelLine -or $hasFuelDeposit)
        $isCompletedFuelTransaction = $transactionType -in @(
            "fuel_pay_at_pump",
            "fuel_prepay_completed"
        )

        $reportableItemVoidCount =
            if ($isCompletedSale) { $voidLines.Count } else { 0 }

        $reportableItemVoidAmount =
            if ($isCompletedSale) {
                Get-AbsoluteLineAmount -Lines $voidLines
            }
            else {
                [decimal]0
            }

        $errorCorrectAmount =
            if ($isErrorCorrect) {
                Get-AbsoluteLineAmount -Lines $lineNodes
            }
            else {
                [decimal]0
            }

        $exceptionAmount =
            if ($transactionType -in @("void_ticket", "suspended_ticket")) {
                Round-Money ([math]::Abs([decimal]$subtotal))
            }
            elseif ($transactionType -eq "error_correct") {
                Round-Money $errorCorrectAmount
            }
            elseif ($transactionType -in @("paid_out", "safe_drop")) {
                Round-Money ([math]::Abs([decimal]$currentTotal))
            }
            else {
                [decimal]0
            }

        $exceptionTaxAmount =
            if ($transactionType -in @("void_ticket", "suspended_ticket")) {
                Round-Money ([math]::Abs([decimal]$taxTotal))
            }
            else {
                [decimal]0
            }

        $exceptionTotal =
            if ($transactionType -in @("void_ticket", "suspended_ticket")) {
                Round-Money ([math]::Abs([decimal]$total))
            }
            elseif ($transactionType -in @("error_correct", "paid_out", "safe_drop")) {
                Round-Money $exceptionAmount
            }
            else {
                [decimal]0
            }

        $cashBackAmount = Get-DecimalValue -Node $transaction -Name "trCshBkAmt"
        $cashBackFee = Get-DecimalValue -Node $transaction -Name "trCshBkFee"

        $items = @(
            foreach ($line in $lineNodes) {
                $quantity = Get-DecimalValue -Node $line -Name "trlQty"
                $sign = Get-DecimalValue -Node $line -Name "trlSign"
                if ($sign -eq 0) { $sign = [decimal]1 }

                $department = Get-Text -Node $line -Name "trlDept"
                $description = Get-Text -Node $line -Name "trlDesc"
                $voidLineIndex = Get-Text -Node $line -Name "trlVoidLineIx"
                $lineTotal = Get-DecimalValue -Node $line -Name "trlLineTot"

                $lineType =
                    if (
                        $department -match "ROUND" -or
                        $description -match "^Ending in"
                    ) {
                        "rounding_adjustment"
                    }
                    elseif (-not [string]::IsNullOrWhiteSpace($voidLineIndex)) {
                        "item_void"
                    }
                    elseif ($department -eq "MANUAL FUEL DEPT") {
                        "fuel"
                    }
                    elseif ($department -eq "FUEL DEPOSIT") {
                        "fuel_deposit"
                    }
                    elseif ($lineTotal -lt 0) {
                        "negative_adjustment"
                    }
                    else {
                        "merchandise"
                    }

                [PSCustomObject]@{
                    line_type       = $lineType
                    source_line_type = ([string]$line.GetAttribute("type")).Trim()
                    affects_sales   = $isCompletedSale
                    is_reportable_fuel = (
                        $isCompletedFuelTransaction -and
                        $lineType -eq "fuel"
                    )
                    is_reportable_item_void = (
                        $isCompletedSale -and
                        $lineType -eq "item_void"
                    )
                    upc             = Get-Text -Node $line -Name "trlUPC"
                    description     = $description
                    department      = $department
                    network_code    = Get-Text -Node $line -Name "trlNetwCode"
                    modifier        = Get-Text -Node $line -Name "trlModifier"
                    quantity        = $quantity
                    sign            = $sign
                    signed_quantity = $quantity * $sign
                    selling_unit    = Get-DecimalValue -Node $line -Name "trlSellUnit"
                    unit_price      = Round-Money (Get-DecimalValue -Node $line -Name "trlUnitPrice")
                    line_total      = Round-Money $lineTotal
                    tax_base        = Round-Money (Get-DecimalValue -Node $line -Name "trlTax")
                    tax_rate        = Get-DecimalValue -Node $line -Name "trlRate"
                    void_line_index = if ([string]::IsNullOrWhiteSpace($voidLineIndex)) {
                        $null
                    } else {
                        $voidLineIndex
                    }
                }
            }
        )

        $payments = @(
            foreach ($payment in $paymentNodes) {
                $paymentCode = Get-Text -Node $payment -Name "trpPaycode"
                $paymentAmount = Get-DecimalValue -Node $payment -Name "trpAmt"
                $maskedAccount = Get-Text -Node $payment -Name "trpcAccount"

                $lastFour = $null
                if (
                    -not [string]::IsNullOrWhiteSpace($maskedAccount) -and
                    $maskedAccount.Length -ge 4
                ) {
                    $lastFour = $maskedAccount.Substring($maskedAccount.Length - 4)
                }

                [PSCustomObject]@{
                    payment_code  = $paymentCode
                    amount        = Round-Money $paymentAmount
                    direction     = Get-PaymentDirection `
                        -TransactionTotal $total `
                        -PaymentCode $paymentCode `
                        -SourceTransactionType $sourceTransactionType
                    card_type     = Get-Text -Node $payment -Name "trpcCCName"
                    card_last_four = $lastFour
                    entry_method  = Get-Text -Node $payment -Name "trpcEntryMeth"
                    host          = Get-Text -Node $payment -Name "trpcHostID"
                }
            }
        )

        $fuelRelationship = $null
        if ($fuelRelationships.ContainsKey($uniqueId)) {
            $fuelRelationship = $fuelRelationships[$uniqueId]
        }

        $cashier = Get-HeaderField -Transaction $transaction -Name "cashier"
        if ([string]::IsNullOrWhiteSpace($cashier)) {
            $cashier = Get-HeaderField -Transaction $transaction -Name "originalCashier"
        }

        $registerNumber =
            if ($null -ne $ticket) {
                $ticket.register
            }
            else {
                Get-HeaderField -Transaction $transaction -Name "posNum"
            }

        $record = [PSCustomObject]@{
            source_system             = "verifone_commander"
            source_unique_id          = $uniqueId
            source_transaction_type   = $sourceTransactionType
            source_suspended          = $isSuspended
            source_recalled           = $isSourceRecalled
            canonical_record          = $true
            store_number              = Get-HeaderField -Transaction $transaction -Name "storeNumber"
            transaction_time          = Get-HeaderField -Transaction $transaction -Name "date"
            register_number           = $registerNumber
            physical_register_id      = Get-HeaderField -Transaction $transaction -Name "physicalRegisterID"
            transaction_sequence      = if ($null -ne $ticket) { $ticket.sequence } else { "" }
            transaction_serial        = Get-HeaderField -Transaction $transaction -Name "trUniqueSN"
            terminal_message_serial   = Get-HeaderField -Transaction $transaction -Name "termMsgSN"
            cashier                   = $cashier
            till                      = Get-HeaderField -Transaction $transaction -Name "till"
            duration_seconds          = Get-HeaderField -Transaction $transaction -Name "duration"
            transaction_type          = $transactionType
            is_completed_sale          = $isCompletedSale
            affects_sales              = ($isCompletedSale -or $transactionType -eq "refund")
            event_category             =
                if ($isCompletedSale) { "sale" }
                elseif ($transactionType -eq "refund") { "refund" }
                elseif ($transactionType -in @("paid_out", "safe_drop")) { "cash_management" }
                elseif ($transactionType -in @("void_ticket", "suspended_ticket", "no_sale", "error_correct")) { "cashier_exception" }
                else { "other" }
            subtotal                  = Round-Money $subtotal
            tax_total                 = Round-Money $taxTotal
            total                     = Round-Money $total
            current_total             = Round-Money $currentTotal
            exception_amount          = Round-Money $exceptionAmount
            exception_tax_amount      = Round-Money $exceptionTaxAmount
            exception_total           = Round-Money $exceptionTotal
            cash_back_amount          = Round-Money $cashBackAmount
            cash_back_fee             = Round-Money $cashBackFee
            has_cash_back             = ($cashBackAmount -ne 0 -or $cashBackFee -ne 0)
            has_item_voids            = $hasItemVoids
            item_void_count           = $voidLines.Count
            reportable_item_void_count  = $reportableItemVoidCount
            reportable_item_void_amount = Round-Money $reportableItemVoidAmount
            error_correct_amount      = Round-Money $errorCorrectAmount
            has_rounding_adjustment   = $roundingLines.Count -gt 0
            rounding_adjustment_count = $roundingLines.Count
            was_recalled              = $hasRecall
            recalled_from_ticket      = if ($hasRecall) { $recall.key } else { $null }
            contains_fuel_activity      = $containsFuelActivity
            is_fuel_transaction       = $isCompletedFuelTransaction
            fuel_transaction_type     =
                if ($transactionType -eq "fuel_pay_at_pump") {
                    "pay_at_pump"
                }
                elseif ($transactionType -eq "fuel_prepay_completed") {
                    "prepay_completed"
                }
                else {
                    $null
                }
            original_ticket =
                if ($null -ne $fuelRelationship) {
                    $fuelRelationship.original_ticket
                }
                elseif ($null -ne $original) {
                    $original.key
                }
                else {
                    $null
                }
            original_source_unique_id =
                if ($null -ne $fuelRelationship) {
                    $fuelRelationship.original_source_unique_id
                }
                else {
                    $null
                }
            shadow_source_unique_ids =
                if ($null -ne $fuelRelationship) {
                    @($fuelRelationship.shadow_source_unique_ids)
                }
                else {
                    @()
                }
            item_count    = $items.Count
            payment_count = $payments.Count
            items         = $items
            payments      = $payments
        }

        if ($null -ne $explicitBusinessDate) {
            $record | Add-Member -MemberType NoteProperty -Name "business_date" -Value $explicitBusinessDate
        }

        if ($periodMetadata.Count -gt 0) {
            $record | Add-Member -MemberType NoteProperty -Name "metadata" -Value ([PSCustomObject]$periodMetadata)
        }

        $record
    }
)

$normalizedTransactions |
    ConvertTo-Json -Depth 15 |
    Set-Content -LiteralPath $outputPath -Encoding UTF8


$completedSaleTypes = @(
    "completed_sale",
    "completed_sale_with_item_void",
    "completed_recalled_sale",
    "fuel_pay_at_pump",
    "fuel_prepay_completed"
)

$completedSales = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -in $completedSaleTypes }
)

$refunds = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -eq "refund" }
)

$voidTickets = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -eq "void_ticket" }
)

$suspendedTickets = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -eq "suspended_ticket" }
)

$noSales = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -eq "no_sale" }
)

$errorCorrects = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -eq "error_correct" }
)

$paidOuts = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -eq "paid_out" }
)

$safeDrops = @(
    $normalizedTransactions |
    Where-Object { $_.transaction_type -eq "safe_drop" }
)

$cashBackTransactions = @(
    $completedSales |
    Where-Object { $_.has_cash_back }
)

[decimal]$grossSales = 0
[decimal]$grossSubtotal = 0
[decimal]$grossTax = 0
foreach ($record in $completedSales) {
    $grossSales += [decimal]$record.total
    $grossSubtotal += [decimal]$record.subtotal
    $grossTax += [decimal]$record.tax_total
}

[decimal]$refundTotal = 0
[decimal]$refundSubtotal = 0
[decimal]$refundTax = 0
foreach ($record in $refunds) {
    $refundTotal += [decimal]$record.total
    $refundSubtotal += [decimal]$record.subtotal
    $refundTax += [decimal]$record.tax_total
}

[decimal]$voidAmount = 0
[decimal]$voidTax = 0
[decimal]$voidTotal = 0
foreach ($record in $voidTickets) {
    $voidAmount += [decimal]$record.exception_amount
    $voidTax += [decimal]$record.exception_tax_amount
    $voidTotal += [decimal]$record.exception_total
}

[decimal]$suspendedAmount = 0
[decimal]$suspendedTax = 0
[decimal]$suspendedTotal = 0
foreach ($record in $suspendedTickets) {
    $suspendedAmount += [decimal]$record.exception_amount
    $suspendedTax += [decimal]$record.exception_tax_amount
    $suspendedTotal += [decimal]$record.exception_total
}

[decimal]$errorCorrectAmount = 0
foreach ($record in $errorCorrects) {
    $errorCorrectAmount += [decimal]$record.error_correct_amount
}

[decimal]$paidOutAmount = 0
foreach ($record in $paidOuts) {
    $paidOutAmount += [decimal]$record.exception_amount
}

[decimal]$safeDropAmount = 0
foreach ($record in $safeDrops) {
    $safeDropAmount += [decimal]$record.exception_amount
}

[decimal]$cashBackAmount = 0
[decimal]$cashBackFee = 0
foreach ($record in $cashBackTransactions) {
    $cashBackAmount += [decimal]$record.cash_back_amount
    $cashBackFee += [decimal]$record.cash_back_fee
}

[int]$reportableItemVoidCount = 0
[decimal]$reportableItemVoidAmount = 0
foreach ($record in $completedSales) {
    $reportableItemVoidCount += [int]$record.reportable_item_void_count
    $reportableItemVoidAmount += [decimal]$record.reportable_item_void_amount
}

[int]$fuelLineCount = 0
[decimal]$fuelSalesAmount = 0
[decimal]$fuelVolume = 0
foreach ($record in $completedSales) {
    foreach ($item in @($record.items)) {
        if ($null -eq $item) { continue }
        if ($item.line_type -ne "fuel") { continue }

        $fuelLineCount++
        $fuelSalesAmount += [decimal]$item.line_total
        $fuelVolume += [decimal]$item.signed_quantity
    }
}

$paymentSummaryMap = @{}
foreach ($record in $completedSales) {
    foreach ($payment in @($record.payments)) {
        if ($null -eq $payment) { continue }

        $key = "{0}|{1}" -f $payment.payment_code, $payment.card_type

        if (-not $paymentSummaryMap.ContainsKey($key)) {
            $paymentSummaryMap[$key] = [PSCustomObject]@{
                payment_code = $payment.payment_code
                card_type    = $payment.card_type
                count        = 0
                amount       = [decimal]0
            }
        }

        $entry = $paymentSummaryMap[$key]
        $entry.count++
        $entry.amount += [decimal]$payment.amount
    }
}

$paymentSummary = @(
    $paymentSummaryMap.Values |
    Sort-Object payment_code, card_type |
    ForEach-Object {
        [PSCustomObject]@{
            payment_code = $_.payment_code
            card_type    = $_.card_type
            count        = $_.count
            amount       = Round-Money $_.amount
        }
    }
)

[decimal]$tenderGross = 0
[int]$cashPositiveCount = 0
$paymentCodeSummaryMap = @{}

foreach ($entry in $paymentSummary) {
    $tenderGross += [decimal]$entry.amount

    $paymentCode = ([string]$entry.payment_code).Trim().ToUpperInvariant()

    if (-not $paymentCodeSummaryMap.ContainsKey($paymentCode)) {
        $paymentCodeSummaryMap[$paymentCode] = [PSCustomObject]@{
            payment_code = $paymentCode
            count = 0
            amount = [decimal]0
        }
    }

    $codeEntry = $paymentCodeSummaryMap[$paymentCode]
    $codeEntry.count += [int]$entry.count
    $codeEntry.amount += [decimal]$entry.amount
}

$paymentCodeSummary = @(
    $paymentCodeSummaryMap.Values |
    Sort-Object payment_code |
    ForEach-Object {
        [PSCustomObject]@{
            payment_code = $_.payment_code
            count = $_.count
            amount = Round-Money $_.amount
        }
    }
)

foreach ($record in $completedSales) {
    foreach ($payment in @($record.payments)) {
        if ($null -eq $payment) { continue }

        if (
            ([string]$payment.payment_code).Trim().ToUpperInvariant() -eq "CASH" -and
            [decimal]$payment.amount -gt 0
        ) {
            $cashPositiveCount++
        }
    }
}

[decimal]$cashTenderAmount = 0
[decimal]$changeAmount = 0
[int]$creditCount = 0
[decimal]$creditAmount = 0
[int]$debitCount = 0
[decimal]$debitAmount = 0
[int]$mobileCount = 0
[decimal]$mobileAmount = 0
[int]$inHouseCount = 0
[decimal]$inHouseAmount = 0

foreach ($entry in $paymentCodeSummary) {
    switch ($entry.payment_code) {
        "CASH" {
            $cashTenderAmount = [decimal]$entry.amount
        }
        "CHANGE" {
            $changeAmount = [decimal]$entry.amount
        }
        "CREDIT" {
            $creditCount = [int]$entry.count
            $creditAmount = [decimal]$entry.amount
        }
        "DEBIT" {
            $debitCount = [int]$entry.count
            $debitAmount = [decimal]$entry.amount
        }
        "MOBILE" {
            $mobileCount = [int]$entry.count
            $mobileAmount = [decimal]$entry.amount
        }
        "IN-HOUSE" {
            $inHouseCount = [int]$entry.count
            $inHouseAmount = [decimal]$entry.amount
        }
    }
}

$cashMopSales = Round-Money (
    $cashTenderAmount + $changeAmount + $cashBackAmount
)

# Register MOP gross reports cashback inside the Cash tender amount.
# Completed-sale payment totals are net of cashback, so add it once here.
$tenderGross = Round-Money (
    $tenderGross + $cashBackAmount
)

$paymentOutTotal = Round-Money (
    $paidOutAmount + $safeDropAmount + $cashBackAmount
)

$totalToAccountFor = Round-Money (
    $tenderGross - [math]::Abs([decimal]$refundTotal) - $paymentOutTotal
)

$reconciliation = [ordered]@{
    source_xml_path = $xmlPath
    normalized_output_path = $outputPath
    raw_transaction_count = $allTransactions.Count
    normalizable_transaction_count = $normalizableTransactions.Count
    noncanonical_fuel_record_count = $nonCanonicalUniqueIds.Count
    normalized_record_count = $normalizedTransactions.Count
    completed_sale_count = $completedSales.Count
    gross_sales = Round-Money $grossSales
    gross_subtotal = Round-Money $grossSubtotal
    gross_tax = Round-Money $grossTax
    refund_count = $refunds.Count
    refund_total = Round-Money $refundTotal
    refund_subtotal = Round-Money $refundSubtotal
    refund_tax = Round-Money $refundTax
    net_sales = Round-Money ($grossSales + $refundTotal)
    net_tax = Round-Money ($grossTax + $refundTax)
    void_ticket_count = $voidTickets.Count
    void_ticket_amount = Round-Money $voidAmount
    void_ticket_tax = Round-Money $voidTax
    void_ticket_total = Round-Money $voidTotal
    suspended_ticket_count = $suspendedTickets.Count
    suspended_ticket_amount = Round-Money $suspendedAmount
    suspended_ticket_tax = Round-Money $suspendedTax
    suspended_ticket_total = Round-Money $suspendedTotal
    no_sale_count = $noSales.Count
    error_correct_count = $errorCorrects.Count
    error_correct_amount = Round-Money $errorCorrectAmount
    item_void_count = $reportableItemVoidCount
    item_void_amount = Round-Money $reportableItemVoidAmount
    paid_out_count = $paidOuts.Count
    paid_out_amount = Round-Money $paidOutAmount
    safe_drop_count = $safeDrops.Count
    safe_drop_amount = Round-Money $safeDropAmount
    cash_back_count = $cashBackTransactions.Count
    cash_back_amount = Round-Money $cashBackAmount
    cash_back_fee = Round-Money $cashBackFee
    payment_out_total = $paymentOutTotal
    cash_mop_sales_count = $cashPositiveCount
    cash_mop_sales_amount = $cashMopSales
    credit_count = $creditCount
    credit_amount = Round-Money $creditAmount
    debit_count = $debitCount
    debit_amount = Round-Money $debitAmount
    mobile_count = $mobileCount
    mobile_amount = Round-Money $mobileAmount
    in_house_count = $inHouseCount
    in_house_amount = Round-Money $inHouseAmount
    total_to_account_for = $totalToAccountFor
    fuel_line_count = $fuelLineCount
    fuel_sales_amount = Round-Money $fuelSalesAmount
    fuel_volume = [math]::Round([decimal]$fuelVolume, 3, [System.MidpointRounding]::AwayFromZero)
    tender_gross = Round-Money $tenderGross
    positive_cash_tender_count = $cashPositiveCount
    payment_code_summary = $paymentCodeSummary
    payment_summary = $paymentSummary
    transaction_type_summary = @(
        $normalizedTransactions |
        Group-Object transaction_type |
        Sort-Object Name |
        ForEach-Object {
            [PSCustomObject]@{
                transaction_type = $_.Name
                count = $_.Count
            }
        }
    )
}

$reconciliation |
    ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $reconciliationPath -Encoding UTF8

Write-Host ""
Write-Host "Dry-run normalization summary"
Write-Host "-----------------------------"
Write-Host ("Raw trans records:             {0}" -f $allTransactions.Count)
Write-Host ("Economic source records:       {0}" -f $saleLikeTransactions.Count)
Write-Host ("Normalizable source records:   {0}" -f $normalizableTransactions.Count)
Write-Host ("Linked fuel completions:       {0}" -f $linkedFuelCompletionRecords.Count)
Write-Host ("Non-canonical fuel records:    {0}" -f $nonCanonicalUniqueIds.Count)
Write-Host ("Candidate normalized records:  {0}" -f $normalizedTransactions.Count)

Write-Host ""
Write-Host "Transaction types"
Write-Host "-----------------"

$normalizedTransactions |
    Group-Object transaction_type |
    Sort-Object Name |
    Select-Object @{Name="TransactionType";Expression={$_.Name}}, Count |
    Format-Table -AutoSize

Write-Host ""
Write-Host "Register reconciliation"
Write-Host "-----------------------"
Write-Host ("Completed sales:           {0}" -f $completedSales.Count)
Write-Host ("Header gross sales:         {0:C2}" -f (Round-Money $grossSales))
Write-Host ("Refunds:                    {0} / {1:C2}" -f $refunds.Count, (Round-Money ([math]::Abs([decimal]$refundTotal))))
Write-Host ("Header net sales:           {0:C2}" -f (Round-Money ($grossSales + $refundTotal)))
Write-Host ("Gross tax:                  {0:C2}" -f (Round-Money $grossTax))
Write-Host ("Net tax:                    {0:C2}" -f (Round-Money ($grossTax + $refundTax)))
Write-Host ("Void tickets:               {0} / {1:C2}" -f $voidTickets.Count, (Round-Money $voidAmount))
Write-Host ("Suspended tickets:          {0} / {1:C2}" -f $suspendedTickets.Count, (Round-Money $suspendedAmount))
Write-Host ("No sales:                   {0}" -f $noSales.Count)
Write-Host ("Error corrects:             {0} / {1:C2}" -f $errorCorrects.Count, (Round-Money $errorCorrectAmount))
Write-Host ("Item voids:                 {0} / {1:C2}" -f $reportableItemVoidCount, (Round-Money $reportableItemVoidAmount))
Write-Host ("Paid outs:                  {0} / {1:C2}" -f $paidOuts.Count, (Round-Money $paidOutAmount))
Write-Host ("Safe drops:                 {0} / {1:C2}" -f $safeDrops.Count, (Round-Money $safeDropAmount))
Write-Host ("Cashback:                   {0} / {1:C2}" -f $cashBackTransactions.Count, (Round-Money $cashBackAmount))
Write-Host ("Cashback fees:                  {0:C2}" -f (Round-Money $cashBackFee))
Write-Host ("Payment out total:             {0:C2}" -f $paymentOutTotal)
Write-Host ("Cash MOP sales:             {0} / {1:C2}" -f $cashPositiveCount, $cashMopSales)
Write-Host ("Credit:                     {0} / {1:C2}" -f $creditCount, (Round-Money $creditAmount))
Write-Host ("Debit:                      {0} / {1:C2}" -f $debitCount, (Round-Money $debitAmount))
Write-Host ("Mobile:                     {0} / {1:C2}" -f $mobileCount, (Round-Money $mobileAmount))
Write-Host ("In-House:                   {0} / {1:C2}" -f $inHouseCount, (Round-Money $inHouseAmount))
Write-Host ("Fuel sales:                 {0} lines / {1:C2} / {2:N3} volume" -f $fuelLineCount, (Round-Money $fuelSalesAmount), $fuelVolume)
Write-Host ("Tender gross:                  {0:C2}" -f (Round-Money $tenderGross))
Write-Host ("Total to account for:          {0:C2}" -f $totalToAccountFor)

Write-Host ""
Write-Host "Completed-sale payment summary"
Write-Host "------------------------------"
$paymentSummary | Format-Table payment_code, card_type, count, amount -AutoSize

$missingUniqueIds = @(
    $normalizedTransactions |
    Where-Object { [string]::IsNullOrWhiteSpace($_.source_unique_id) }
)

$duplicateUniqueIds = @(
    $normalizedTransactions |
    Group-Object source_unique_id |
    Where-Object { $_.Count -gt 1 }
)

if ($missingUniqueIds.Count -gt 0) {
    throw "Validation failed: candidate records are missing unique IDs."
}

if ($duplicateUniqueIds.Count -gt 0) {
    throw "Validation failed: duplicate candidate source unique IDs found."
}

if ($ValidateDay734) {
    Write-Host ""
    Write-Host "Day 734 exact validation"
    Write-Host "------------------------"

    $expected = [ordered]@{
        normalized_record_count = 507
        gross_sales = [decimal]8505.17
        gross_tax = [decimal]139.68
        refund_count = 1
        refund_total = [decimal]-1.73
        net_sales = [decimal]8503.44
        net_tax = [decimal]139.54
        void_ticket_count = 14
        void_ticket_amount = [decimal]161.58
        suspended_ticket_count = 2
        suspended_ticket_amount = [decimal]10.27
        no_sale_count = 9
        error_correct_count = 13
        error_correct_amount = [decimal]44.44
        item_void_count = 18
        item_void_amount = [decimal]78.35
        paid_out_count = 4
        paid_out_amount = [decimal]1643.00
        safe_drop_count = 3
        safe_drop_amount = [decimal]236.01
        cash_back_count = 2
        cash_back_amount = [decimal]30.00
        cash_back_fee = [decimal]4.00
        payment_out_total = [decimal]1909.01
        cash_mop_sales_count = 205
        cash_mop_sales_amount = [decimal]1905.31
        credit_count = 131
        credit_amount = [decimal]3250.37
        debit_count = 126
        debit_amount = [decimal]2956.04
        mobile_count = 7
        mobile_amount = [decimal]413.99
        in_house_count = 1
        in_house_amount = [decimal]13.46
        total_to_account_for = [decimal]6628.43
        fuel_line_count = 157
        fuel_sales_amount = [decimal]5483.54
        fuel_volume = [decimal]1507.245
        tender_gross = [decimal]8539.17
        positive_cash_tender_count = 205
    }

    $failures = [System.Collections.Generic.List[string]]::new()

    foreach ($key in $expected.Keys) {
        $actualValue = $reconciliation[$key]
        $expectedValue = $expected[$key]

        if ([decimal]$actualValue -ne [decimal]$expectedValue) {
            $failures.Add(
                "$key expected=$expectedValue actual=$actualValue"
            )
        }
    }

    if ($failures.Count -gt 0) {
        $failures | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
        throw "Day 734 exact validation failed."
    }

    Write-Host "PASS: Day 734 candidate matches every checked register total." -ForegroundColor Green
}

Write-Host ""
Write-Host "PASS: Normalized transaction JSON created." -ForegroundColor Green
Write-Host "Normalized JSON:"
Write-Host $outputPath
Write-Host "Reconciliation JSON:"
Write-Host $reconciliationPath
Write-Host "This normalizer does not upload data; the existing uploader handles that step."
