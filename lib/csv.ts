import type { Transaction, PaymentType, TransactionType, Product } from '@/lib/mock-data';

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

export const SAMPLE_CSV = `transaction_id,store_id,transaction_time,register_id,cashier_id,upc,item_name,category,quantity,unit_price,discount_amount,total_amount,payment_type,transaction_type
TX0001,4127,2026-06-19T08:14:00,1,C001,0120000010101,Coca-Cola 20oz,Beverages,1,2.49,0,2.49,CARD,SALE
TX0002,4127,2026-06-19T08:22:00,1,C001,0284000900001,Doritos Cool Ranch,Snacks,2,2.79,0,5.58,CASH,SALE
TX0003,4127,2026-06-19T09:05:00,2,C002,0123456789001,Marlboro Red,Tobacco,1,9.49,0,9.49,CARD,SALE
TX0004,4127,2026-06-19T09:30:00,2,C002,0048000011111,Snickers Bar,Candy,1,1.79,0,1.79,CARD,REFUND
TX0005,4127,2026-06-19T10:12:00,1,C001,0820001000011,Bud Light 24oz,Beer,1,3.49,0,3.49,CASH,VOID
TX0006,4127,2026-06-19T10:45:00,3,C004,0200000000099,Regular Unleaded,Fuel,9.2,3.49,0,32.11,CARD,SALE`;

const PAYMENT_MAP: Record<string, PaymentType> = {
  CASH: 'Cash',
  CARD: 'Credit',
  CREDIT: 'Credit',
  DEBIT: 'Debit',
  EBT: 'EBT',
  MOBILE: 'Mobile',
  NONE: 'Cash',
  OTHER: 'Cash',
};

const TYPE_MAP: Record<string, TransactionType> = {
  SALE: 'Sale',
  REFUND: 'Refund',
  VOID: 'Void',
  NO_SALE: 'No-Sale',
  NO_SALES: 'No-Sale',
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
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = '';
      } else if (ch === '\n') {
        current.push(field);
        rows.push(current);
        current = [];
        field = '';
      } else if (ch === '\r') {
        // skip
      } else {
        field += ch;
      }
    }
  }

  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function toNumber(value: string | undefined, fallback = 0): number {
  if (value == null) return fallback;

  const n = parseFloat(String(value).replace(/[$,\s]/g, ''));

  return Number.isFinite(n) ? n : fallback;
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

  if (['true', 'yes', 'y', '1', 'taxable', 'active'].includes(normalized)) {
    return true;
  }

  if (['false', 'no', 'n', '0', 'non-taxable', 'inactive'].includes(normalized)) {
    return false;
  }

  return fallback;
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

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  const unknownColumns = header.filter(
    (c) => !REQUIRED_COLUMNS.includes(c as (typeof REQUIRED_COLUMNS)[number])
  );

  const result: ParsedRow[] = [];
  const transactions: Transaction[] = [];

  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    const raw: Record<string, string> = {};

    header.forEach((h, idx) => {
      raw[h] = rawRow[idx] ?? '';
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

    if (isNaN(txnTime.getTime())) {
      errors.push('Invalid transaction_time');
    }

    const txnTypeRaw = (raw['transaction_type'] || '').toUpperCase().trim();
    const txnType = TYPE_MAP[txnTypeRaw];

    if (!txnType) {
      errors.push(`Unknown transaction_type "${raw['transaction_type']}"`);
    }

    const paymentRaw = (raw['payment_type'] || '').toUpperCase().trim();
    const paymentType = PAYMENT_MAP[paymentRaw];

    if (!paymentType) {
      errors.push(`Unknown payment_type "${raw['payment_type']}"`);
    }

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

// ---------- Product / Pricebook CSV parsing ----------

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
  'tax_rate',
  'tax_category',
  'taxable',
  'is_active',
  'notes',
] as const;

export const SAMPLE_PRODUCTS_CSV = `upc,item_name,category,brand,cost_price,selling_price,stock,reorder_level,vendor,department,sku,tax_rate,tax_category,taxable,is_active,notes
0120000010101,Coca-Cola 20oz,Beverages,Coca-Cola,1.25,2.49,142,48,Coke Distributing,Beverages,COKE20,8.5,standard,true,true,Top seller
0284000900001,Doritos Cool Ranch,Snacks,Frito-Lay,1.10,2.79,38,40,Frito-Lay,Snacks,DORITOSCR,8.5,standard,true,true,
0123456789001,Marlboro Red,Tobacco,Philip Morris,5.80,9.49,96,40,PM USA,Tobacco,MARLRED,12,tobacco,true,true,Age restricted
0820001000011,Bud Light 24oz,Beer,Anheuser-Busch,1.65,3.49,12,40,AB Distributing,Beer,BUD24,10,alcohol,true,true,Age restricted
0200000000099,Regular Unleaded,Fuel,Store Brand,3.02,3.49,8400,2000,Shell Wholesale,Fuel,FUELREG,0,fuel,false,true,
0048000011111,Snickers Bar,Candy,Mars,0.65,1.79,9,50,Mars Wrigley,Candy,SNICKERS,8.5,standard,true,true,`;

export interface ParsedProductRow {
  row: number;
  raw: Record<string, string>;
  valid: boolean;
  errors: string[];
  product?: Product;
  margin?: number;
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

export function computeMargin(sellPrice: number, costPrice: number): number {
  if (sellPrice <= 0) return 0;

  return +(((sellPrice - costPrice) / sellPrice) * 100).toFixed(1);
}

export function parseProductsCsv(text: string): ProductParseResult {
  const rows = parseCsvText(text);

  if (rows.length === 0) {
    return {
      ok: false,
      missingColumns: [...PRODUCT_REQUIRED_COLUMNS],
      unknownColumns: [],
      rows: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      products: [],
    };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missingColumns = PRODUCT_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  const known = new Set<string>([...PRODUCT_REQUIRED_COLUMNS, ...PRODUCT_OPTIONAL_COLUMNS]);
  const unknownColumns = header.filter((c) => !known.has(c));

  const result: ParsedProductRow[] = [];
  const products: Product[] = [];

  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    const raw: Record<string, string> = {};

    header.forEach((h, idx) => {
      raw[h] = rawRow[idx] ?? '';
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

    const upc = normalizeUpc(raw['upc']);
    const name = (raw['item_name'] || '').trim();

    if (!upc) errors.push('Missing UPC');
    if (!name) errors.push('Missing item_name');

    const costPrice = toNumber(raw['cost_price'], NaN);
    const sellPrice = toNumber(raw['selling_price'], NaN);

    if (Number.isNaN(costPrice)) errors.push('Invalid cost_price');
    if (Number.isNaN(sellPrice)) errors.push('Invalid selling_price');

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
    const sku = (raw['sku'] || '').trim() || undefined;
    const taxCategory = (raw['tax_category'] || '').trim() || 'standard';
    const taxable = toBoolean(raw['taxable'], true);
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
      taxRate: finalTaxRate,
      taxCategory,
      taxable,
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