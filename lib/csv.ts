import type {
  Transaction,
  PaymentType,
  TransactionType,
  Product,
  CardNetwork,
  ExceptionReason,
} from '@/lib/mock-data';

export const REQUIRED_COLUMNS = [
  'transaction_id',
  'store_id',
  'transaction_time',
  'register_id',
  'cashier_id',
  'upc',
  'item_name',
  'category',
  'quantity',
  'unit_price',
  'discount_amount',
  'total_amount',
  'payment_type',
  'transaction_type',
] as const;

export const TRANSACTION_OPTIONAL_COLUMNS = [
  'card_network',
  'exception_reason',
  'fuel_grade',
] as const;

export const SAMPLE_CSV = `transaction_id,store_id,transaction_time,register_id,cashier_id,upc,item_name,category,quantity,unit_price,discount_amount,total_amount,payment_type,transaction_type,card_network,exception_reason,fuel_grade
TX0001,4127,2026-06-19T08:14:00,1,C001,0120000010101,Coca-Cola 20oz,Beverages,1,2.49,0,2.49,CREDIT,SALE,Visa,,
TX0002,4127,2026-06-19T08:22:00,1,C001,0284000900001,Doritos Cool Ranch,Snacks,2,2.79,0,5.58,CASH,SALE,Cash,,
TX0003,4127,2026-06-19T09:05:00,2,C002,0123456789001,Marlboro Red,Tobacco,1,9.49,0,9.49,CREDIT,SALE,Mastercard,,
TX0004,4127,2026-06-19T09:30:00,2,C002,0048000011111,Snickers Bar,Candy,1,1.79,0,1.79,CREDIT,REFUND,Visa,REFUND,
TX0005,4127,2026-06-19T10:12:00,1,C001,0820001000011,Bud Light 24oz,Beer,1,3.49,0,3.49,CASH,VOID,Cash,VOID_TICKET,
TX0006,4127,2026-06-19T10:45:00,3,C004,0200000000099,Regular Unleaded,Fuel,9.2,3.49,0,32.11,CREDIT,SALE,Visa,,Regular`;

const PAYMENT_MAP: Record<string, PaymentType> = {
  CASH: 'Cash',
  CARD: 'Credit',
  CREDIT: 'Credit',
  CREDITCARD: 'Credit',
  CREDIT_CARD: 'Credit',
  DEBIT: 'Debit',
  DEBITCARD: 'Debit',
  DEBIT_CARD: 'Debit',
  EBT: 'EBT',
  MOBILE: 'Mobile',
  NONE: 'Cash',
  OTHER: 'Cash',
};

const TYPE_MAP: Record<string, TransactionType> = {
  SALE: 'Sale',
  SALES: 'Sale',
  REFUND: 'Refund',
  VOID: 'Void',
  NO_SALE: 'No-Sale',
  NO_SALES: 'No-Sale',
  NOSALE: 'No-Sale',
};

const CARD_NETWORK_MAP: Record<string, CardNetwork> = {
  AMEX: 'AMEX',
  AMERICANEXPRESS: 'AMEX',
  AMERICAN_EXPRESS: 'AMEX',
  DISCOVER: 'Discover',
  DISC: 'Discover',
  MASTERCARD: 'Mastercard',
  MASTER_CARD: 'Mastercard',
  MC: 'Mastercard',
  VISA: 'Visa',
  VOYAGER: 'Voyager',
  WEX: 'WEX',
  DEBIT: 'Debit',
  EBT: 'EBT',
  CASH: 'Cash',
  MOBILE: 'Mobile',
  OTHER: 'Other',
};

const EXCEPTION_REASON_MAP: Record<string, ExceptionReason> = {
  REFUND: 'REFUND',
  VOID_LINE: 'VOID_LINE',
  VOIDLINE: 'VOID_LINE',
  VOID_TICKET: 'VOID_TICKET',
  VOIDTICKET: 'VOID_TICKET',
  ERROR_CORRECT: 'ERROR_CORRECT',
  ERRORCORRECT: 'ERROR_CORRECT',
  NO_SALE: 'NO_SALE',
  NOSALE: 'NO_SALE',
  SAFE_DROP: 'SAFE_DROP',
  SAFEDROP: 'SAFE_DROP',
  OTHER: 'OTHER',
};

export interface ParsedRow {
  row: number;
  raw: Record<string, string>;
  valid: boolean;
  errors: string[];
  transaction?: Transaction;
}

export interface ParseResult {
  ok: boolean;
  missingColumns: string[];
  unknownColumns: string[];
  rows: ParsedRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  transactions: Transaction[];
}

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        current.push(field);
        field = '';
      } else if (char === '\n') {
        current.push(field);
        rows.push(current);
        current = [];
        field = '';
      } else if (char === '\r') {
        // skip
      } else {
        field += char;
      }
    }
  }

  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }

  return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

function toNumber(value: string | undefined, fallback = 0): number {
  if (value == null) return fallback;

  const numberValue = parseFloat(String(value).replace(/[$,\s]/g, ''));

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeUpc(value: string | undefined): string {
  if (!value) return '';

  const raw = String(value).trim();

  if (!raw) return '';

  if (/^\d+(\.\d+)?e\+\d+$/i.test(raw)) {
    return Number(raw).toLocaleString('fullwide', {
      useGrouping: false,
      maximumFractionDigits: 0,
    });
  }

  return raw.replace(/[^\d]/g, '');
}

function toBoolean(value: string | undefined, fallback = true): boolean {
  if (value == null || String(value).trim() === '') return fallback;

  const normalized = String(value).trim().toLowerCase();

  if (['true', 'yes', 'y', '1', 'taxable', 'active'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'non-taxable', 'inactive'].includes(normalized)) return false;

  return fallback;
}

function normalizeLookup(value: string | undefined) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
    .trim();
}

function fallbackCardNetwork(paymentType?: PaymentType): CardNetwork | undefined {
  if (paymentType === 'Credit') return 'Visa';
  if (paymentType === 'Debit') return 'Debit';
  if (paymentType === 'Cash') return 'Cash';
  if (paymentType === 'EBT') return 'EBT';
  if (paymentType === 'Mobile') return 'Mobile';

  return undefined;
}

function fallbackExceptionReason(type?: TransactionType): ExceptionReason | undefined {
  if (type === 'Refund') return 'REFUND';
  if (type === 'Void') return 'VOID_TICKET';
  if (type === 'No-Sale') return 'NO_SALE';

  return undefined;
}

export function parseTransactionsCsv(text: string): ParseResult {
  const rows = parseCsvText(text);

  if (rows.length === 0) {
    return {
      ok: false,
      missingColumns: [...REQUIRED_COLUMNS],
      unknownColumns: [],
      rows: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      transactions: [],
    };
  }

  const header = rows[0].map((heading) => heading.trim().toLowerCase());
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !header.includes(column));

  const knownColumns = new Set<string>([
    ...REQUIRED_COLUMNS,
    ...TRANSACTION_OPTIONAL_COLUMNS,
  ]);

  const unknownColumns = header.filter((column) => !knownColumns.has(column));

  const result: ParsedRow[] = [];
  const transactions: Transaction[] = [];

  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    const raw: Record<string, string> = {};

    header.forEach((heading, index) => {
      raw[heading] = rawRow[index] ?? '';
    });

    const errors: string[] = [];

    if (missingColumns.length > 0) {
      result.push({
        row: i,
        raw,
        valid: false,
        errors: ['Required columns missing'],
      });
      continue;
    }

    const txnTimeRaw = raw['transaction_time'];
    const txnTime = txnTimeRaw ? new Date(txnTimeRaw) : new Date(NaN);

    if (Number.isNaN(txnTime.getTime())) {
      errors.push('Invalid transaction_time');
    }

    const txnTypeRaw = normalizeLookup(raw['transaction_type']);
    const txnType = TYPE_MAP[txnTypeRaw];

    if (!txnType) {
      errors.push(`Unknown transaction_type "${raw['transaction_type']}"`);
    }

    const paymentRaw = normalizeLookup(raw['payment_type']);
    const paymentType = PAYMENT_MAP[paymentRaw];

    if (!paymentType) {
      errors.push(`Unknown payment_type "${raw['payment_type']}"`);
    }

    const cardNetworkRaw = normalizeLookup(raw['card_network']);
    const cardNetwork = CARD_NETWORK_MAP[cardNetworkRaw] || fallbackCardNetwork(paymentType);

    const exceptionReasonRaw = normalizeLookup(raw['exception_reason']);
    const exceptionReason =
      EXCEPTION_REASON_MAP[exceptionReasonRaw] || fallbackExceptionReason(txnType);

    const fuelGrade = (raw['fuel_grade'] || '').trim() || undefined;

    const quantity = toNumber(raw['quantity'], 1);
    const unitPrice = toNumber(raw['unit_price'], 0);
    const discountAmount = toNumber(raw['discount_amount'], 0);
    const totalAmount = toNumber(raw['total_amount'], 0);

    let amount = totalAmount;

    if (txnType === 'Refund') amount = -Math.abs(totalAmount);
    if (txnType === 'Void') amount = -Math.abs(totalAmount);
    if (txnType === 'No-Sale') amount = 0;

    const cashierId = (raw['cashier_id'] || '').trim() || 'UNKNOWN';
    const cashierNameBase = cashierId;
    const item = (raw['item_name'] || '').trim() || 'Unknown Item';
    const category = (raw['category'] || '').trim() || 'Unknown';
    const upc = normalizeUpc(raw['upc']) || '0000000000000';
    const txnId = (raw['transaction_id'] || '').trim() || `TX${String(i).padStart(6, '0')}`;
    const register = parseInt(raw['register_id'] || '1', 10) || 1;

    if (errors.length > 0) {
      result.push({
        row: i,
        raw,
        valid: false,
        errors,
      });
      continue;
    }

    const iso = txnTime.toISOString();

    const transaction: Transaction = {
      id: txnId,
      timestamp: iso,
      hour: txnTime.getHours(),
      date: iso.split('T')[0],
      item,
      category,
      cashierId,
      cashierName: cashierNameBase,
      register,
      paymentType: paymentType!,
      amount: +amount.toFixed(2),
      type: txnType!,
      upc,
      quantity,
      unitPrice,
      discountAmount,
      cardNetwork,
      exceptionReason,
      fuelGrade,
    };

    transactions.push(transaction);

    result.push({
      row: i,
      raw,
      valid: true,
      errors: [],
      transaction,
    });
  }

  return {
    ok: missingColumns.length === 0,
    missingColumns,
    unknownColumns,
    rows: result,
    totalRows: result.length,
    validRows: transactions.length,
    invalidRows: result.length - transactions.length,
    transactions,
  };
}

export function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'storepulse-sample-transactions.csv';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export const PRODUCT_REQUIRED_COLUMNS = [
  'upc',
  'item_name',
  'category',
  'brand',
  'cost_price',
  'selling_price',
] as const;

export const PRODUCT_OPTIONAL_COLUMNS = [
  'stock',
  'reorder_level',
  'vendor',
  'department',
  'sku',
  'plu',
  'product_code',
  'tax_rate',
  'tax_category',
  'taxable',
  'ebt_eligible',
  'age_verification',
  'minimum_age',
  'age_restriction_type',
  'is_active',
  'notes',
] as const;

export const SAMPLE_PRODUCTS_CSV = `upc,item_name,category,brand,cost_price,selling_price,stock,reorder_level,vendor,department,sku,plu,product_code,tax_rate,tax_category,taxable,ebt_eligible,age_verification,minimum_age,age_restriction_type,is_active,notes
0120000010101,Coca-Cola 20oz,Beverages,Coca-Cola,1.25,2.49,142,48,Coke Distributing,Beverages,COKE20,,COKE-20OZ,8.5,standard,true,true,,,,true,Top seller
0284000900001,Doritos Cool Ranch,Snacks,Frito-Lay,1.10,2.79,38,40,Frito-Lay,Snacks,DORITOSCR,,DORITOS-CR,8.5,standard,true,true,,,,true,
0123456789001,Marlboro Red,Tobacco,Philip Morris,5.80,9.49,96,40,PM USA,Tobacco,MARLRED,,MARL-RED,12,tobacco,true,false,true,21,Tobacco,true,Age restricted
0820001000011,Bud Light 24oz,Beer,Anheuser-Busch,1.65,3.49,12,40,AB Distributing,Beer,BUD24,,BUD-24OZ,10,alcohol,true,false,true,21,Alcohol,true,Age restricted
0200000000099,Regular Unleaded,Fuel,Store Brand,3.02,3.49,8400,2000,Shell Wholesale,Fuel,FUELREG,,FUEL-REG,0,fuel,false,false,,,,true,
0048000011111,Snickers Bar,Candy,Mars,0.65,1.79,9,50,Mars Wrigley,Candy,SNICKERS,,SNICKERS,8.5,standard,true,true,,,,true,`;

export interface ParsedProductRow {
  row: number;
  raw: Record<string, string>;
  valid: boolean;
  errors: string[];
  product?: Product;
  margin?: number;
  presentFields?: string[];
}

export interface ProductParseResult {
  ok: boolean;
  missingColumns: string[];
  unknownColumns: string[];
  rows: ParsedProductRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  products: Product[];
}

export type ProductImportMode =
  | 'add_update'
  | 'update_by_upc'
  | 'update_by_plu'
  | 'update_by_product_code';

export interface ProductParseOptions {
  mode?: ProductImportMode;
}

export function computeMargin(sellPrice: number, costPrice: number): number {
  if (sellPrice <= 0) return 0;

  return +(((sellPrice - costPrice) / sellPrice) * 100).toFixed(1);
}

export function normalizeHeader(header: string): string {
  return String(header || '').trim().toLowerCase().replace(/\s+/g, '_');
}

const COLUMN_ALIASES: Record<string, string> = {
  item: 'item_name',
  description: 'item_name',
  product_name: 'item_name',
  product: 'item_name',
  name: 'item_name',
  price: 'selling_price',
  sell_price: 'selling_price',
  retail_price: 'selling_price',
  retail: 'selling_price',
  sale_price: 'selling_price',
  cost: 'cost_price',
  unit_cost: 'cost_price',
  wholesale: 'cost_price',
  dept: 'department',
  dept_name: 'department',
  department_name: 'department',
  cat: 'category',
  category_name: 'category',
  item_category: 'category',
  barcode: 'upc',
  ean: 'upc',
  gtin: 'upc',
  item_upc: 'upc',
  plu_code: 'plu',
  plu_number: 'plu',
  item_plu: 'plu',
  code: 'product_code',
  item_code: 'product_code',
  prod_code: 'product_code',
  vendor_name: 'vendor',
  supplier: 'vendor',
  qty: 'stock',
  quantity: 'stock',
  on_hand: 'stock',
  reorder: 'reorder_level',
  min_stock: 'reorder_level',
  tax: 'tax_rate',
  tax_pct: 'tax_rate',
  taxable_yn: 'taxable',
  ebt: 'ebt_eligible',
  food_stamp: 'ebt_eligible',
  active: 'is_active',
  age_restrict: 'age_verification',
  age_required: 'age_verification',
  min_age: 'minimum_age',
  restrict_type: 'age_restriction_type',
};

function canonicalHeader(header: string): string {
  const normalized = normalizeHeader(header);
  return COLUMN_ALIASES[normalized] || normalized;
}

export function parseProductsCsv(text: string, options: ProductParseOptions = {}): ProductParseResult {
  const mode = options.mode || 'add_update';
  const rows = parseCsvText(text);

  if (rows.length === 0) {
    return {
      ok: false,
      missingColumns: [],
      unknownColumns: [],
      rows: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      products: [],
    };
  }

  const header = rows[0].map((heading) => canonicalHeader(heading));
  const missingColumns =
    mode === 'update_by_upc'
      ? header.includes('upc') ? [] : ['upc']
      : mode === 'update_by_plu'
        ? header.includes('plu') ? [] : ['plu']
        : mode === 'update_by_product_code'
          ? header.includes('product_code') ? [] : ['product_code']
          : [];
  const known = new Set<string>([...PRODUCT_REQUIRED_COLUMNS, ...PRODUCT_OPTIONAL_COLUMNS]);
  const unknownColumns = header.filter((column) => !known.has(column));

  const result: ParsedProductRow[] = [];
  const products: Product[] = [];

  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];

    if (rawRow.every((value) => String(value ?? '').trim() === '')) {
      continue;
    }

    const raw: Record<string, string> = {};

    header.forEach((heading, index) => {
      raw[heading] = String(rawRow[index] ?? '').trim();
    });

    const errors: string[] = [];
    const presentFields = header.filter((heading) => String(raw[heading] ?? '').trim() !== '');

    if (missingColumns.length > 0) {
      result.push({
        row: i,
        raw,
        valid: false,
        errors: ['Required columns missing'],
      });
      continue;
    }

    const plu = (raw['plu'] || '').trim() || undefined;
    const productCode = (raw['product_code'] || '').trim() || undefined;
    const sku = (raw['sku'] || '').trim() || undefined;
    const upcRaw = (raw['upc'] || '').trim();
    const upc =
      upcRaw ||
      (mode === 'add_update' && plu ? plu : '') ||
      (mode === 'add_update' && sku ? sku : '') ||
      (mode === 'add_update' && productCode ? productCode : '') ||
      (mode === 'add_update' ? `PLU-${Date.now()}-${i}` : '');
    const name = (raw['item_name'] || '').trim();

    if (mode === 'add_update') {
      if (!name) errors.push('Missing item_name');
      if (!upcRaw && !plu && !productCode && !sku) errors.push('Missing identifier');
    }

    if (mode === 'update_by_upc' && !upcRaw) errors.push('Missing UPC');
    if (mode === 'update_by_plu' && !plu) errors.push('Missing PLU');
    if (mode === 'update_by_product_code' && !productCode) errors.push('Missing product_code');

    const costPrice = toNumber(raw['cost_price'], 0);
    const sellPrice = toNumber(raw['selling_price'], 0);

    if (raw['cost_price'] && Number.isNaN(toNumber(raw['cost_price'], NaN))) errors.push('Invalid cost_price');
    if (raw['selling_price'] && Number.isNaN(toNumber(raw['selling_price'], NaN))) errors.push('Invalid selling_price');

    const stockRaw = raw['stock'];
    const stock = stockRaw == null || stockRaw.trim() === '' ? 0 : toNumber(stockRaw, NaN);

    if (stockRaw != null && stockRaw.trim() !== '' && Number.isNaN(stock)) {
      errors.push('Invalid stock value');
    }

    const reorderRaw = raw['reorder_level'];
    const reorderLevel = reorderRaw == null || reorderRaw.trim() === '' ? 10 : toNumber(reorderRaw, NaN);

    if (reorderRaw != null && reorderRaw.trim() !== '' && Number.isNaN(reorderLevel)) {
      errors.push('Invalid reorder_level');
    }

    const taxRateRaw = raw['tax_rate'];
    const taxRate = taxRateRaw == null || taxRateRaw.trim() === '' ? 0 : toNumber(taxRateRaw, NaN);

    if (taxRateRaw != null && taxRateRaw.trim() !== '' && Number.isNaN(taxRate)) {
      errors.push('Invalid tax_rate');
    }

    if (errors.length > 0) {
      result.push({
        row: i,
        raw,
        valid: false,
        errors,
      });
      continue;
    }

    const category = (raw['category'] || '').trim() || 'Uncategorized';
    const department = (raw['department'] || raw['category'] || '').trim() || category;
    const brand = (raw['brand'] || '').trim() || 'Unknown';
    const vendor = (raw['vendor'] || '').trim() || undefined;
    const taxCategory = (raw['tax_category'] || '').trim() || 'standard';
    const taxable = toBoolean(raw['taxable'], true);
    const ebtEligible = toBoolean(raw['ebt_eligible'], false);
    const ageVerification = toBoolean(raw['age_verification'], false);
    let minimumAge: number | undefined;
    const minimumAgeRaw = raw['minimum_age'];
    if (minimumAgeRaw && minimumAgeRaw.trim()) {
      minimumAge = Math.floor(Number(minimumAgeRaw)) || undefined;
    }
    if (ageVerification && minimumAge === undefined) {
      minimumAge = 21;
    }
    const ageRestrictionType = (raw['age_restriction_type'] || '').trim() || undefined;
    const isActive = toBoolean(raw['is_active'], true);
    const notes = (raw['notes'] || '').trim() || undefined;

    const finalCost = Number.isNaN(costPrice) ? 0 : costPrice;
    const finalSell = Number.isNaN(sellPrice) ? 0 : sellPrice;
    const finalStock = stockRaw == null || stockRaw.trim() === '' ? 0 : Number.isNaN(stock) ? 0 : stock;
    const finalReorder =
      reorderRaw == null || reorderRaw.trim() === ''
        ? 10
        : Number.isNaN(reorderLevel)
          ? 10
          : reorderLevel;
    const finalTaxRate =
      taxRateRaw == null || taxRateRaw.trim() === ''
        ? 0
        : Number.isNaN(taxRate)
          ? 0
          : taxRate;

    const product: Product = {
      upc,
      name,
      category,
      department,
      brand,
      costPrice: finalCost,
      sellPrice: finalSell,
      stock: finalStock,
      reorderLevel: finalReorder,
      vendor,
      sku,
      plu,
      productCode,
      taxRate: finalTaxRate,
      taxCategory,
      taxable,
      ebtEligible,
      ageVerification,
      minimumAge,
      ageRestrictionType,
      isActive,
      notes,
    };

    products.push(product);

    result.push({
      row: i,
      raw,
      valid: true,
      errors: [],
      product,
      margin: computeMargin(finalSell, finalCost),
      presentFields,
    });
  }

  return {
    ok: missingColumns.length === 0,
    missingColumns,
    unknownColumns,
    rows: result,
    totalRows: result.length,
    validRows: products.length,
    invalidRows: result.length - products.length,
    products,
  };
}

export function downloadSampleProductsCsv() {
  const blob = new Blob([SAMPLE_PRODUCTS_CSV], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'storepulse-sample-pricebook.csv';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
