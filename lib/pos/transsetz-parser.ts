import { XMLParser } from 'fast-xml-parser';
import { normalizeUpc } from './upc-normalize';

const SOURCE_SYSTEM = 'verifone_commander';

type XmlRecord = Record<string, unknown>;

interface BasePosRow {
  store_id: string;
  owner_id: string;
  report_period_id: string;
  report_file_id: string;
  source_system: string;
  source_store_number: string | null;
}

interface PluSaleRow extends BasePosRow {
  plu_raw: string | null;
  plu_normalized: string | null;
  upc_normalized: string | null;
  description: string | null;
  unit_price: number | null;
  customer_count: number | null;
  items_sold: number | null;
  total_sales: number | null;
  sales_percent: number | null;
  reason_code: string | null;
  promotion_id: string | null;
}

interface DeptSaleRow extends BasePosRow {
  department_number: string | null;
  department_name: string | null;
  customer_count: number | null;
  items_sold: number | null;
  sales_percent: number | null;
  gross_sales: number | null;
  refunds: number | null;
  discounts: number | null;
  net_sales: number | null;
  cashier_name: string | null;
  register_number: string | null;
}

interface TaxSummaryRow extends BasePosRow {
  tax_name: string | null;
  tax_rate: number | null;
  actual_rate: number | null;
  taxable_sales: number | null;
  non_taxable_sales: number | null;
  refund_taxes: number | null;
  sales_taxes: number | null;
  total_taxes: number | null;
  register_number: string | null;
}

interface PaymentSummaryRow extends BasePosRow {
  payment_number: string | null;
  payment_name: string | null;
  payment_type: string | null;
  payment_group: string | null;
  charge_count: number | null;
  charge_amount: number | null;
  correction_count: number | null;
  correction_amount: number | null;
  register_number: string | null;
}

interface CashierSummaryRow extends BasePosRow {
  cashier_number: string | null;
  cashier_name: string | null;
  register_number: string | null;
  transaction_count: number | null;
  customer_count: number | null;
  item_count: number | null;
  gross_sales: number | null;
  net_sales: number | null;
  refunds: number | null;
  discounts: number | null;
  void_count: number | null;
  void_amount: number | null;
  no_sale_count: number | null;
  safe_drop_amount: number | null;
  paid_in_amount: number | null;
  paid_out_amount: number | null;
  over_short_amount: number | null;
}

interface TransSetParseResult {
  periodType: string;
  periodId: string;
  periodShortId: string;
  openedTime: string | null;
  closedTime: string | null;
  pluSales: PluSaleRow[];
  departmentSales: DeptSaleRow[];
  taxSummary: TaxSummaryRow[];
  paymentSummary: PaymentSummaryRow[];
  cashierSummary: CashierSummaryRow[];
  stats: {
    totalTransactions: number;
    salesCount: number;
    networkSalesCount: number;
    voidCount: number;
    refundCount: number;
    nosaleCount: number;
    safedropCount: number;
    journalCount: number;
    skippedCount: number;
  };
}

interface PluAggregate {
  pluRaw: string;
  description: string | null;
  unitPrice: number | null;
  itemsSold: number;
  totalSales: number;
  transactionIds: Set<string>;
}

interface DepartmentAggregate {
  departmentNumber: string | null;
  departmentName: string | null;
  itemsSold: number;
  grossSales: number;
  refunds: number;
  netSales: number;
  transactionIds: Set<string>;
}

interface TaxAggregate {
  taxName: string;
  taxRate: number | null;
  taxableSales: number;
  refundTaxes: number;
  salesTaxes: number;
  transactionIds: Set<string>;
}

interface PaymentAggregate {
  paymentNumber: string | null;
  paymentName: string;
  paymentType: string | null;
  paymentGroup: string | null;
  chargeCount: number;
  chargeAmount: number;
  correctionCount: number;
  correctionAmount: number;
  registerCounts: Map<string, number>;
}

interface CashierAggregate {
  cashierNumber: string | null;
  cashierName: string | null;
  registerNumber: string | null;
  transactionCount: number;
  customerCount: number;
  itemCount: number;
  grossSales: number;
  refunds: number;
  discounts: number;
  voidCount: number;
  voidAmount: number;
  noSaleCount: number;
  safeDropAmount: number;
}

interface CashierInfo {
  key: string;
  cashierNumber: string | null;
  cashierName: string | null;
  registerNumber: string | null;
}

interface ParseContext {
  baseRow: BasePosRow;
  pluAggregates: Map<string, PluAggregate>;
  departmentAggregates: Map<string, DepartmentAggregate>;
  taxAggregates: Map<string, TaxAggregate>;
  paymentAggregates: Map<string, PaymentAggregate>;
  cashierAggregates: Map<string, CashierAggregate>;
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): XmlRecord | null {
  return isRecord(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  if (isRecord(value)) {
    return textValue(value['#text']);
  }
  return null;
}

function childText(node: XmlRecord | null, key: string): string | null {
  if (!node) return null;
  return textValue(node[key]);
}

function attrText(node: XmlRecord | null, key: string): string | null {
  if (!node) return null;
  return textValue(node[`@_${key}`]);
}

function numberValue(value: unknown): number | null {
  const text = textValue(value);
  if (!text) return null;
  const normalized = text.replace(/[$,%\s,]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function childNumber(node: XmlRecord | null, key: string): number | null {
  if (!node) return null;
  return numberValue(node[key]);
}

function signedAmount(value: number | null, isRefund: boolean): number {
  if (value === null) return 0;
  return isRefund ? -Math.abs(value) : value;
}

function absAmount(value: number | null): number {
  return value === null ? 0 : Math.abs(value);
}

function addToMapCount(map: Map<string, number>, key: string | null): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mostCommonKey(map: Map<string, number>): string | null {
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of map.entries()) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

function inferPaymentType(paymentName: string | null, fallback: string | null): string | null {
  if (fallback && fallback !== 'generic') return fallback;
  const text = String(paymentName || '').toLowerCase();
  if (text.includes('debit')) return 'debit';
  if (text.includes('credit') || text.includes('visa') || text.includes('mastercard')) return 'credit';
  if (text.includes('cash')) return 'cash';
  if (text.includes('house') || text.includes('in-house')) return 'in_house';
  return fallback;
}

function transactionId(transaction: XmlRecord, fallbackIndex: number): string {
  const header = asRecord(transaction.trHeader);
  return childText(header, 'uniqueID')
    || childText(header, 'trUniqueSN')
    || childText(asRecord(header?.trTickNum), 'trSeq')
    || `transaction-${fallbackIndex}`;
}

function getCashierInfo(transaction: XmlRecord): CashierInfo | null {
  const header = asRecord(transaction.trHeader);
  const cashierNode = asRecord(header?.cashier) ?? asRecord(transaction.cashier);
  if (!cashierNode) return null;

  const cashierNumber = attrText(cashierNode, 'empNum') || attrText(cashierNode, 'sysid');
  const cashierName = textValue(cashierNode);
  const registerNumber = attrText(cashierNode, 'posNum')
    || childText(header, 'physicalRegisterID')
    || childText(header, 'posNum')
    || childText(asRecord(header?.trTickNum), 'posNum');
  const key = attrText(cashierNode, 'sysid') || cashierNumber || cashierName || 'unknown';

  return {
    key,
    cashierNumber,
    cashierName,
    registerNumber,
  };
}

function getCashierAggregate(context: ParseContext, cashier: CashierInfo): CashierAggregate {
  const existing = context.cashierAggregates.get(cashier.key);
  if (existing) {
    if (!existing.cashierName) existing.cashierName = cashier.cashierName;
    if (!existing.cashierNumber) existing.cashierNumber = cashier.cashierNumber;
    if (!existing.registerNumber) existing.registerNumber = cashier.registerNumber;
    return existing;
  }

  const aggregate: CashierAggregate = {
    cashierNumber: cashier.cashierNumber,
    cashierName: cashier.cashierName,
    registerNumber: cashier.registerNumber,
    transactionCount: 0,
    customerCount: 0,
    itemCount: 0,
    grossSales: 0,
    refunds: 0,
    discounts: 0,
    voidCount: 0,
    voidAmount: 0,
    noSaleCount: 0,
    safeDropAmount: 0,
  };
  context.cashierAggregates.set(cashier.key, aggregate);
  return aggregate;
}

function transactionLines(transaction: XmlRecord): XmlRecord[] {
  const linesNode = asRecord(transaction.trLines);
  return asArray(linesNode?.trLine).map(asRecord).filter((line): line is XmlRecord => line !== null);
}

function transactionPaylines(transaction: XmlRecord): XmlRecord[] {
  const paylinesNode = asRecord(transaction.trPaylines);
  return asArray(paylinesNode?.trPayline).map(asRecord).filter((line): line is XmlRecord => line !== null);
}

function lineDepartment(line: XmlRecord): { number: string | null; name: string | null } {
  const department = asRecord(line.trlDept);
  return {
    number: attrText(department, 'number'),
    name: textValue(department),
  };
}

function aggregatePluLine(context: ParseContext, line: XmlRecord, txId: string, isRefund: boolean): void {
  const lineType = attrText(line, 'type');
  if (lineType !== 'plu') return;

  const upc = childText(line, 'trlUPC');
  const modifier = childText(line, 'trlModifier');
  const pluRaw = upc || modifier;
  if (!pluRaw) return;

  const quantity = Math.abs(childNumber(line, 'trlQty') ?? 0);
  const lineTotal = signedAmount(childNumber(line, 'trlLineTot'), isRefund);
  const key = `${context.baseRow.store_id}|${context.baseRow.report_period_id}|${pluRaw}`;
  const aggregate = context.pluAggregates.get(key) ?? {
    pluRaw,
    description: childText(line, 'trlDesc'),
    unitPrice: childNumber(line, 'trlUnitPrice'),
    itemsSold: 0,
    totalSales: 0,
    transactionIds: new Set<string>(),
  };

  aggregate.description = aggregate.description || childText(line, 'trlDesc');
  aggregate.unitPrice = aggregate.unitPrice ?? childNumber(line, 'trlUnitPrice');
  aggregate.itemsSold += isRefund ? -quantity : quantity;
  aggregate.totalSales += lineTotal;
  aggregate.transactionIds.add(txId);
  context.pluAggregates.set(key, aggregate);
}

function aggregateDepartmentLine(context: ParseContext, line: XmlRecord, txId: string, isRefund: boolean): number {
  const lineType = attrText(line, 'type');
  if (lineType !== 'plu' && lineType !== 'dept') return 0;

  const department = lineDepartment(line);
  if (!department.number && !department.name) return 0;

  const quantity = Math.abs(childNumber(line, 'trlQty') ?? 0);
  const lineTotal = signedAmount(childNumber(line, 'trlLineTot'), isRefund);
  const key = `${context.baseRow.store_id}|${context.baseRow.report_period_id}|${department.number || department.name || 'unknown'}`;
  const aggregate = context.departmentAggregates.get(key) ?? {
    departmentNumber: department.number,
    departmentName: department.name,
    itemsSold: 0,
    grossSales: 0,
    refunds: 0,
    netSales: 0,
    transactionIds: new Set<string>(),
  };

  aggregate.departmentNumber = aggregate.departmentNumber || department.number;
  aggregate.departmentName = aggregate.departmentName || department.name;
  aggregate.itemsSold += isRefund ? -quantity : quantity;
  if (lineTotal < 0) {
    aggregate.refunds += Math.abs(lineTotal);
  } else {
    aggregate.grossSales += lineTotal;
  }
  aggregate.netSales += lineTotal;
  aggregate.transactionIds.add(txId);
  context.departmentAggregates.set(key, aggregate);
  return isRefund ? -quantity : quantity;
}

function taxEntries(taxContainer: XmlRecord | null): XmlRecord[] {
  return asArray(taxContainer?.taxAmt).map(asRecord).filter((entry): entry is XmlRecord => entry !== null);
}

function matchingTaxValue(container: XmlRecord | null, key: 'taxRate' | 'taxNet', taxAmt: XmlRecord): number | null {
  const sysid = attrText(taxAmt, 'sysid');
  const category = attrText(taxAmt, 'cat');
  const entries = asArray(container?.[key]).map(asRecord).filter((entry): entry is XmlRecord => entry !== null);
  const match = entries.find((entry) => attrText(entry, 'sysid') === sysid && attrText(entry, 'cat') === category)
    ?? entries.find((entry) => attrText(entry, 'cat') === category)
    ?? entries[0];
  return numberValue(match);
}

function aggregateTaxes(context: ParseContext, transaction: XmlRecord, txId: string, isRefund: boolean): void {
  const trTax = asRecord(asRecord(transaction.trValue)?.trTax);
  if (!trTax) return;

  const positiveTaxAmts = asRecord(trTax.taxAmts);
  const negativeTaxAmts = asRecord(trTax.negTaxAmts);
  const taxContainer = isRefund && negativeTaxAmts ? negativeTaxAmts : positiveTaxAmts;
  if (!taxContainer) return;

  for (const taxAmt of taxEntries(taxContainer)) {
    const taxName = attrText(taxAmt, 'cat');
    if (!taxName) continue;

    const taxableSales = signedAmount(numberValue(taxAmt), isRefund);
    const taxNet = signedAmount(matchingTaxValue(taxContainer, 'taxNet', taxAmt), isRefund);
    const taxRate = matchingTaxValue(taxContainer, 'taxRate', taxAmt);
    const key = `${context.baseRow.store_id}|${context.baseRow.report_period_id}|${taxName}`;
    const aggregate = context.taxAggregates.get(key) ?? {
      taxName,
      taxRate,
      taxableSales: 0,
      refundTaxes: 0,
      salesTaxes: 0,
      transactionIds: new Set<string>(),
    };

    aggregate.taxRate = aggregate.taxRate ?? taxRate;
    aggregate.taxableSales += taxableSales;
    if (taxNet < 0) {
      aggregate.refundTaxes += Math.abs(taxNet);
    } else {
      aggregate.salesTaxes += taxNet;
    }
    aggregate.transactionIds.add(txId);
    context.taxAggregates.set(key, aggregate);
  }
}

function aggregatePayments(context: ParseContext, transaction: XmlRecord, isRefund: boolean): void {
  const header = asRecord(transaction.trHeader);
  const fallbackRegister = childText(header, 'physicalRegisterID')
    || childText(header, 'posNum')
    || childText(asRecord(header?.trTickNum), 'posNum');

  for (const payline of transactionPaylines(transaction)) {
    const paycode = asRecord(payline.trpPaycode);
    const paymentName = textValue(paycode);
    if (!paymentName || paymentName.toLowerCase() === 'change') continue;

    const amount = childNumber(payline, 'trpAmt') ?? 0;
    const paylineType = attrText(payline, 'type');
    const isCorrection = isRefund || paylineType === 'cancel' || amount < 0;
    const key = `${context.baseRow.store_id}|${context.baseRow.report_period_id}|${paymentName}`;
    const aggregate = context.paymentAggregates.get(key) ?? {
      paymentNumber: attrText(paycode, 'mop'),
      paymentName,
      paymentType: inferPaymentType(paymentName, attrText(paycode, 'nacstendercode')),
      paymentGroup: attrText(paycode, 'cat'),
      chargeCount: 0,
      chargeAmount: 0,
      correctionCount: 0,
      correctionAmount: 0,
      registerCounts: new Map<string, number>(),
    };

    if (isCorrection) {
      aggregate.correctionCount += 1;
      aggregate.correctionAmount += absAmount(amount);
    } else {
      aggregate.chargeCount += 1;
      aggregate.chargeAmount += amount;
    }

    addToMapCount(aggregate.registerCounts, fallbackRegister);
    context.paymentAggregates.set(key, aggregate);
  }
}

function processSaleTransaction(
  context: ParseContext,
  transaction: XmlRecord,
  txId: string,
  isRefund: boolean
): void {
  const trValue = asRecord(transaction.trValue);
  const cashier = getCashierInfo(transaction);
  const cashierAggregate = cashier ? getCashierAggregate(context, cashier) : null;
  let itemCount = 0;

  for (const line of transactionLines(transaction)) {
    aggregatePluLine(context, line, txId, isRefund);
    itemCount += aggregateDepartmentLine(context, line, txId, isRefund);
  }

  aggregateTaxes(context, transaction, txId, isRefund);
  aggregatePayments(context, transaction, isRefund);

  if (cashierAggregate) {
    const totalWithTax = childNumber(trValue, 'trTotWTax') ?? 0;
    if (isRefund) {
      cashierAggregate.refunds += Math.abs(totalWithTax);
    } else {
      cashierAggregate.transactionCount += 1;
      cashierAggregate.customerCount += 1;
      cashierAggregate.grossSales += Math.max(totalWithTax, 0);
    }
    cashierAggregate.itemCount += itemCount;
  }
}

function processVoidTransaction(context: ParseContext, transaction: XmlRecord): void {
  const cashier = getCashierInfo(transaction);
  if (!cashier) return;
  const aggregate = getCashierAggregate(context, cashier);
  aggregate.voidCount += 1;
  aggregate.voidAmount += absAmount(childNumber(asRecord(transaction.trValue), 'trTotWTax'));
}

function processNoSaleTransaction(context: ParseContext, transaction: XmlRecord): void {
  const cashier = getCashierInfo(transaction);
  if (!cashier) return;
  getCashierAggregate(context, cashier).noSaleCount += 1;
}

function processSafeDropTransaction(context: ParseContext, transaction: XmlRecord): void {
  const cashier = getCashierInfo(transaction);
  if (!cashier) return;
  getCashierAggregate(context, cashier).safeDropAmount += absAmount(childNumber(asRecord(transaction.trValue), 'trCurrTot'));
}

function withBase<T extends object>(baseRow: BasePosRow, row: T): BasePosRow & T {
  return { ...baseRow, ...row };
}

function buildRows(context: ParseContext) {
  const pluSales: PluSaleRow[] = Array.from(context.pluAggregates.values()).map((aggregate) => {
    const normalized = normalizeUpc(aggregate.pluRaw);
    const hasUpc = /^\d+$/.test(aggregate.pluRaw);
    return withBase(context.baseRow, {
      plu_raw: aggregate.pluRaw,
      plu_normalized: normalized || null,
      upc_normalized: hasUpc ? normalized || null : null,
      description: aggregate.description,
      unit_price: aggregate.unitPrice,
      customer_count: aggregate.transactionIds.size,
      items_sold: aggregate.itemsSold,
      total_sales: aggregate.totalSales,
      sales_percent: null,
      reason_code: null,
      promotion_id: null,
    });
  });

  const departmentSales: DeptSaleRow[] = Array.from(context.departmentAggregates.values()).map((aggregate) => (
    withBase(context.baseRow, {
      department_number: aggregate.departmentNumber,
      department_name: aggregate.departmentName,
      customer_count: aggregate.transactionIds.size,
      items_sold: aggregate.itemsSold,
      sales_percent: null,
      gross_sales: aggregate.grossSales,
      refunds: aggregate.refunds,
      discounts: 0,
      net_sales: aggregate.netSales,
      cashier_name: null,
      register_number: null,
    })
  ));

  const taxSummary: TaxSummaryRow[] = Array.from(context.taxAggregates.values()).map((aggregate) => (
    withBase(context.baseRow, {
      tax_name: aggregate.taxName,
      tax_rate: aggregate.taxRate,
      actual_rate: aggregate.taxRate,
      taxable_sales: aggregate.taxableSales,
      non_taxable_sales: 0,
      refund_taxes: aggregate.refundTaxes,
      sales_taxes: aggregate.salesTaxes,
      total_taxes: aggregate.salesTaxes - aggregate.refundTaxes,
      register_number: 'All Registers',
    })
  ));

  const paymentSummary: PaymentSummaryRow[] = Array.from(context.paymentAggregates.values()).map((aggregate) => (
    withBase(context.baseRow, {
      payment_number: aggregate.paymentNumber,
      payment_name: aggregate.paymentName,
      payment_type: aggregate.paymentType,
      payment_group: aggregate.paymentGroup,
      charge_count: aggregate.chargeCount,
      charge_amount: aggregate.chargeAmount,
      correction_count: aggregate.correctionCount,
      correction_amount: aggregate.correctionAmount,
      register_number: mostCommonKey(aggregate.registerCounts),
    })
  ));

  const cashierSummary: CashierSummaryRow[] = Array.from(context.cashierAggregates.values()).map((aggregate) => (
    withBase(context.baseRow, {
      cashier_number: aggregate.cashierNumber,
      cashier_name: aggregate.cashierName,
      register_number: aggregate.registerNumber,
      transaction_count: aggregate.transactionCount,
      customer_count: aggregate.customerCount,
      item_count: aggregate.itemCount,
      gross_sales: aggregate.grossSales,
      net_sales: aggregate.grossSales - aggregate.refunds,
      refunds: aggregate.refunds,
      discounts: aggregate.discounts,
      void_count: aggregate.voidCount,
      void_amount: aggregate.voidAmount,
      no_sale_count: aggregate.noSaleCount,
      safe_drop_amount: aggregate.safeDropAmount,
      paid_in_amount: 0,
      paid_out_amount: 0,
      over_short_amount: 0,
    })
  ));

  return {
    pluSales,
    departmentSales,
    taxSummary,
    paymentSummary,
    cashierSummary,
  };
}

export function parseTransSet(
  rawXml: string,
  storeId: string,
  ownerId: string,
  reportPeriodId: string,
  reportFileId: string,
  sourceStoreNumber: string
): TransSetParseResult {
  let parsed: unknown;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      isArray: (_name, jPath) => typeof jPath === 'string' && [
        'transSet.trans',
        'transSet.trans.trHeader.period',
        'transSet.trans.trLines.trLine',
        'transSet.trans.trPaylines.trPayline',
        'transSet.trans.trValue.trTax.taxAmts.taxAmt',
        'transSet.trans.trValue.trTax.taxAmts.taxRate',
        'transSet.trans.trValue.trTax.taxAmts.taxNet',
        'transSet.trans.trValue.trTax.taxAmts.taxAttribute',
        'transSet.trans.trValue.trTax.negTaxAmts.taxAmt',
        'transSet.trans.trValue.trTax.negTaxAmts.taxRate',
        'transSet.trans.trValue.trTax.negTaxAmts.taxNet',
        'transSet.trans.trValue.trTax.negTaxAmts.taxAttribute',
      ].includes(jPath),
    });
    parsed = parser.parse(rawXml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse transSet XML: ${message}. XML starts with: ${rawXml.slice(0, 200)}`);
  }

  const root = asRecord(asRecord(parsed)?.transSet);
  if (!root) {
    throw new Error(`Could not parse transSet XML: missing transSet root. XML starts with: ${rawXml.slice(0, 200)}`);
  }

  const baseRow: BasePosRow = {
    store_id: storeId,
    owner_id: ownerId,
    report_period_id: reportPeriodId,
    report_file_id: reportFileId,
    source_system: SOURCE_SYSTEM,
    source_store_number: sourceStoreNumber || attrText(root, 'site'),
  };
  const context: ParseContext = {
    baseRow,
    pluAggregates: new Map<string, PluAggregate>(),
    departmentAggregates: new Map<string, DepartmentAggregate>(),
    taxAggregates: new Map<string, TaxAggregate>(),
    paymentAggregates: new Map<string, PaymentAggregate>(),
    cashierAggregates: new Map<string, CashierAggregate>(),
  };
  const transactions = asArray(root.trans).map(asRecord).filter((transaction): transaction is XmlRecord => transaction !== null);
  const stats = {
    totalTransactions: transactions.length,
    salesCount: 0,
    networkSalesCount: 0,
    voidCount: 0,
    refundCount: 0,
    nosaleCount: 0,
    safedropCount: 0,
    journalCount: 0,
    skippedCount: 0,
  };

  transactions.forEach((transaction, index) => {
    const type = attrText(transaction, 'type') || 'unknown';
    const txId = transactionId(transaction, index);
    try {
      if (type === 'sale') {
        stats.salesCount += 1;
        processSaleTransaction(context, transaction, txId, false);
        return;
      }
      if (type === 'network sale') {
        stats.networkSalesCount += 1;
        processSaleTransaction(context, transaction, txId, false);
        return;
      }
      if (type === 'refund network sale') {
        stats.refundCount += 1;
        processSaleTransaction(context, transaction, txId, true);
        return;
      }
      if (type === 'void') {
        stats.voidCount += 1;
        processVoidTransaction(context, transaction);
        return;
      }
      if (type === 'nosale') {
        stats.nosaleCount += 1;
        processNoSaleTransaction(context, transaction);
        return;
      }
      if (type === 'safedrop') {
        stats.safedropCount += 1;
        processSafeDropTransaction(context, transaction);
        return;
      }
      if (type === 'journal') {
        stats.journalCount += 1;
        stats.skippedCount += 1;
        return;
      }

      stats.skippedCount += 1;
    } catch {
      stats.skippedCount += 1;
    }
  });

  return {
    periodType: attrText(root, 'periodname') || '',
    periodId: attrText(root, 'periodID') || '',
    periodShortId: attrText(root, 'shortId') || '',
    openedTime: childText(root, 'openedTime'),
    closedTime: childText(root, 'closedTime'),
    ...buildRows(context),
    stats,
  };
}
