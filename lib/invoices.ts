import type { Product } from '@/lib/mock-data';

export type ReceivingLineStatus = 'Matched' | 'New Product' | 'Needs Review';
export type InvoiceSourceKind = 'pdf' | 'image' | 'csv' | 'unknown';

export type ReceivingLine = {
  id: string;
  upc: string;
  name: string;
  department: string;
  vendor: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  status: ReceivingLineStatus;
};

export type ReceivingHistoryItem = {
  id: string;
  date: string;
  fileName: string;
  receiptName?: string;
  invoiceNumber?: string;
  vendor: string;
  itemCount: number;
  totalAmount: number;
  lines?: ReceivingLine[];
  sourceUrl?: string;
  sourcePath?: string;
  sourceKind?: InvoiceSourceKind;
};

export type InventoryReceiptItemRow = {
  id: string;
  upc: string | null;
  item_name: string | null;
  department: string | null;
  vendor: string | null;
  quantity: number | string | null;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  match_status: string | null;
};

export type InventoryReceiptRow = {
  id: string;
  receipt_date: string | null;
  created_at: string;
  file_name: string;
  receipt_name: string | null;
  invoice_number: string | null;
  vendor: string | null;
  item_count: number | string | null;
  total_amount: number | string | null;
  source_path: string | null;
  source_kind: InvoiceSourceKind | null;
  inventory_receipt_items?: InventoryReceiptItemRow[] | null;
};

function safeNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

export function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findProductMatch(products: Product[], upc: string, name: string) {
  return products.find((product) => {
    const sameUpc = Boolean(upc) && product.upc === upc;
    const sameName = Boolean(name) && product.name.toLowerCase() === name.toLowerCase();
    return sameUpc || sameName;
  });
}

export function parseReceivingCsv(text: string, products: Product[]): ReceivingLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);

  const findValue = (cells: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? cells[index]?.trim() || '' : '';
  };

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);

    const upc = findValue(cells, ['upc', 'barcode', 'itemcode', 'sku']);
    const name = findValue(cells, ['productname', 'itemname', 'item', 'description', 'product', 'name']);
    const department = findValue(cells, ['department', 'category']);
    const vendor = findValue(cells, ['vendor', 'supplier']);
    const quantity = safeNumber(findValue(cells, ['quantity', 'qty', 'receivedquantity', 'units', 'cases']), 0);
    const unitCost = safeNumber(findValue(cells, ['unitcost', 'cost', 'costprice', 'price']), 0);
    const totalCost = safeNumber(findValue(cells, ['totalcost', 'extendedcost', 'total', 'amount']), quantity * unitCost);

    const matched = findProductMatch(products, upc, name);
    const status: ReceivingLineStatus = matched ? 'Matched' : upc || name ? 'New Product' : 'Needs Review';

    return {
      id: `CSV-${Date.now()}-${index}`,
      upc,
      name: name || matched?.name || '',
      department: department || matched?.department || matched?.category || 'General Merchandise',
      vendor: vendor || matched?.vendor || '',
      quantity,
      unitCost: unitCost || matched?.costPrice || 0,
      totalCost,
      status,
    };
  });
}
