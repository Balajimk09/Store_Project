import { normalizeUpc } from '@/lib/pos/upc-normalize';

export type PosReportType =
  | 'plu_sales'
  | 'department_sales'
  | 'category_sales'
  | 'tax_summary'
  | 'payment_summary'
  | 'fuel_dcr_summary'
  | 'deal_sales'
  | 'cashier_summary'
  | 'unknown';

export type ParsedReport = {
  title: string;
  reportType: PosReportType;
  rows: Array<Record<string, string | number | null>>;
  unsupported?: boolean;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function cellText(value: string) {
  return stripTags(value).trim();
}

function normalizeNumber(value: string | null | undefined) {
  const cleaned = String(value || '').replace(/[$,%(),]/g, '').trim();
  if (!cleaned) return null;
  const negative = /\(.+\)/.test(String(value || '')) || String(value || '').trim().startsWith('-');
  const parsed = Number(cleaned.replace(/-/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function normalizeInteger(value: string | null | undefined, context: { reportType: PosReportType; fieldName: string }) {
  const raw = String(value || '').trim();
  const cleaned = raw.replace(/[$,()]/g, '').trim();
  if (!cleaned) return null;
  const negative = /\(.+\)/.test(raw) || raw.startsWith('-');
  const unsigned = cleaned.replace(/-/g, '');

  if (!/^\d+$/.test(unsigned)) {
    console.warn('[POS Parser Warning]', {
      reportType: context.reportType,
      fieldName: context.fieldName,
      badValue: raw,
      reason: 'Expected integer value; storing null.',
    });
    return null;
  }

  const parsed = Number(unsigned);
  if (!Number.isSafeInteger(parsed)) {
    console.warn('[POS Parser Warning]', {
      reportType: context.reportType,
      fieldName: context.fieldName,
      badValue: raw,
      reason: 'Integer value is out of safe range; storing null.',
    });
    return null;
  }

  return negative ? -parsed : parsed;
}

function nullableText(value: string | null | undefined) {
  const text = String(value || '').trim();
  return text || null;
}

function extractTitle(html: string) {
  const explicitTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const heading = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
  const reportLine = stripTags(html).match(/([A-Za-z /-]*(?:Report|Tracking|Indicators)[A-Za-z /-]*)/i)?.[1];
  return stripTags(explicitTitle || heading || reportLine || 'Unknown Report');
}

export function detectReportType(title: string, html = ''): PosReportType {
  const text = `${title} ${stripTags(html).slice(0, 800)}`.toLowerCase();
  if (text.includes('plu report all cashiers')) return 'plu_sales';
  if (text.includes('department report all cashiers') || text.includes('department report by cashier')) return 'department_sales';
  if (text.includes('category report by cashier')) return 'category_sales';
  if (text.includes('tax report by register')) return 'tax_summary';
  if (text.includes('deal report')) return 'deal_sales';
  if (text.includes('network report by register') || text.includes('mobile payment report')) return 'payment_summary';
  if (text.includes('dcr statistical report')) return 'fuel_dcr_summary';
  if (text.includes('cashier tracking') || text.includes('cashier transaction indicators') || text.includes('cashier fuel indicators')) return 'cashier_summary';
  return 'unknown';
}

function extractTableRows(html: string) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) => cellText(cellMatch[1]));
    return cells;
  });
  return rows.filter((row) => row.some((cell) => !/^[-\s]*$/.test(cell)));
}

function dataRows(html: string) {
  return extractTableRows(html).filter((row) => row.some((cell) => /\d/.test(cell)) && !row.join(' ').toLowerCase().includes('total '));
}

function cleanReasonCode(value: string | null | undefined) {
  const text = String(value || '')
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text || null;
}

function isHeaderOrTotal(cells: string[], headerName: string) {
  const col0 = (cells[0] || '').trim().toLowerCase();
  const col1 = (cells[1] || '').trim().toLowerCase();
  if (!col0 && !col1) return true;
  if (col0 === headerName.toLowerCase()) return true;
  if (col0 === 'total') return true;
  if (col1 === 'total') return true;
  return false;
}

function parsePluRows(html: string) {
  return extractTableRows(html)
    .map((row) => row.map((cell) => (cell || '').trim()))
    .filter((row) => /^\d/.test(row[0] || ''))
    .map((row) => {
      const pluRaw = row[0] || '';
      const normalized = normalizeUpc(pluRaw);
      return {
        plu_raw: nullableText(pluRaw),
        plu_normalized: normalized || null,
        upc_normalized: normalized || null,
        description: nullableText(row[2]),
        unit_price: normalizeNumber(row[4]),
        customer_count: normalizeInteger(row[6], { reportType: 'plu_sales', fieldName: 'customer_count' }),
        items_sold: normalizeNumber(row[8]),
        total_sales: normalizeNumber(row[10]),
        sales_percent: normalizeNumber(row[12]),
        reason_code: cleanReasonCode(row[14]),
        promotion_id: nullableText(row[16]),
      };
    })
    .filter((row) => row.plu_raw || row.description);
}

function parseDepartmentRows(html: string) {
  const results: Array<Record<string, string | number | null>> = [];
  let inAllCashiersSection = false;

  for (const row of extractTableRows(html)) {
    const cells = row.map((cell) => (cell || '').trim());
    const col0 = cells[0] || '';
    const col0Lower = col0.trim().toLowerCase();

    if (col0Lower === 'all cashiers') {
      inAllCashiersSection = true;
      continue;
    }

    if (col0Lower.startsWith('cashier')) {
      inAllCashiersSection = false;
      continue;
    }

    if (!inAllCashiersSection) continue;
    if (isHeaderOrTotal(cells, 'department')) continue;

    const knownSkippedDepartmentRows = new Set([
      '',
      'dept#',
      'department',
      'description',
      'total',
      'totals',
      'neg',
      'other',
    ]);

    if (knownSkippedDepartmentRows.has(col0Lower)) continue;
    if (!/^\d+$/.test(col0)) {
      console.warn('[POS Parser] Unexpected department row skipped:', col0);
      continue;
    }

    results.push({
      department_number: nullableText(cells[0]),
      department_name: nullableText(cells[2]),
      customer_count: normalizeInteger(cells[4], { reportType: 'department_sales', fieldName: 'customer_count' }),
      items_sold: normalizeNumber(cells[6]),
      sales_percent: normalizeNumber(cells[8]),
      gross_sales: normalizeNumber(cells[10]),
      refunds: normalizeNumber(cells[12]),
      discounts: normalizeNumber(cells[14]),
      net_sales: normalizeNumber(cells[16]),
    });
  }

  return results.filter((row) => row.department_number || row.department_name);
}

function parseCategoryRows(html: string) {
  const results: Array<Record<string, string | number | null>> = [];
  let inAllCashiersSection = false;

  for (const row of extractTableRows(html)) {
    const cells = row.map((cell) => (cell || '').trim());
    const col0 = cells[0] || '';
    const normalizedCol0 = col0.toLowerCase();

    if (normalizedCol0 === 'all cashiers') {
      inAllCashiersSection = true;
      continue;
    }

    if (normalizedCol0.startsWith('cashier')) {
      inAllCashiersSection = false;
      continue;
    }

    if (!inAllCashiersSection) continue;
    if (isHeaderOrTotal(cells, 'category')) continue;
    if (normalizedCol0 === 'cat#' || normalizedCol0 === 'description') continue;
    if (normalizedCol0 === 'totals' || normalizedCol0 === 'total') continue;
    if (!col0) continue;
    if (!/^\d+$/.test(col0)) continue;

    results.push({
      category_number: nullableText(cells[0]),
      category_name: nullableText(cells[2]),
      customer_count: normalizeInteger(cells[4], { reportType: 'category_sales', fieldName: 'customer_count' }),
      items_sold: normalizeNumber(cells[6]),
      sales_percent: normalizeNumber(cells[8]),
      net_sales: normalizeNumber(cells[10]),
    });
  }

  return results.filter((row) => row.category_number || row.category_name);
}

function parseTaxRows(html: string) {
  const results: Array<Record<string, string | number | null>> = [];
  const seen = new Set<string>();
  let inAllRegistersSection = false;

  for (const row of extractTableRows(html)) {
    const cells = row.map((cell) => (cell || '').trim());
    const col0 = cells[0] || '';
    const normalizedCol0 = col0.toLowerCase();

    if (normalizedCol0 === 'all registers') {
      inAllRegistersSection = true;
      continue;
    }

    if (normalizedCol0 === 'all dcrs' || normalizedCol0.startsWith('register ')) {
      inAllRegistersSection = false;
      continue;
    }

    if (!inAllRegistersSection) continue;
    if (isHeaderOrTotal(cells, 'tax')) continue;
    if (normalizedCol0 === 'name') continue;
    if (normalizedCol0 === 'totals' || normalizedCol0 === 'total') continue;
    if (normalizedCol0.startsWith('receipt')) continue;
    if (!col0) continue;
    if (col0.startsWith('*')) continue;

    const taxRate = normalizeNumber(cells[2]);
    if (taxRate === null) continue;

    const taxName = nullableText(cells[0]);
    const registerNumber = 'All Registers';
    const dedupeKey = `${taxName || ''}|${registerNumber || ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    results.push({
      register_number: registerNumber,
      tax_name: taxName,
      tax_rate: taxRate,
      actual_rate: normalizeNumber(cells[4]),
      taxable_sales: normalizeNumber(cells[6]),
      non_taxable_sales: normalizeNumber(cells[8]),
      refund_taxes: normalizeNumber(cells[10]),
      sales_taxes: normalizeNumber(cells[12]),
      total_taxes: normalizeNumber(cells[14]),
    });
  }

  return results.filter((row) => row.tax_name);
}

function paymentType(name: string | null) {
  const text = String(name || '').toLowerCase();
  if (text.includes('debit')) return 'debit';
  if (/(visa|mastercard|amex|american express|discover|credit)/.test(text)) return 'credit';
  if (/(mobile|direct pay|apple|google)/.test(text)) return 'mobile';
  if (text.includes('ebt')) return 'ebt';
  if (/(wex|voyager|fleet)/.test(text)) return 'fleet';
  if (text.includes('cash')) return 'cash';
  return 'unknown';
}

function parsePaymentRows(html: string) {
  return dataRows(html)
    .filter((row) => row.length >= 4)
    .map((row) => {
      const paymentName = nullableText(row[2]);
      return {
        register_number: nullableText(row.find((cell) => /register/i.test(cell))?.replace(/\D/g, '') || null),
        payment_number: nullableText(row[0]),
        payment_name: paymentName,
        payment_type: paymentType(paymentName),
        charge_count: normalizeInteger(row[4], { reportType: 'payment_summary', fieldName: 'charge_count' }),
        charge_amount: normalizeNumber(row[6]),
        correction_count: normalizeInteger(row[8], { reportType: 'payment_summary', fieldName: 'correction_count' }),
        correction_amount: normalizeNumber(row[10]),
      };
    })
    .filter((row) => row.payment_number || row.payment_name);
}

function parseDcrRows(html: string) {
  return dataRows(html)
    .filter((row) => row.length >= 5)
    .map((row) => ({
      dcr_number: nullableText(row[0]),
      sale_count: normalizeInteger(row[2], { reportType: 'fuel_dcr_summary', fieldName: 'sale_count' }),
      amount: normalizeNumber(row[4]),
      volume: normalizeNumber(row[6]),
      pump_percent: normalizeNumber(row[8]),
      all_dcr_percent: normalizeNumber(row[10]),
      all_fuel_percent: normalizeNumber(row[12]),
    }))
    .filter((row) => row.dcr_number);
}

function parseDealNumber(value: string | null | undefined) {
  const cleaned = String(value || '').replace(/[$,%(),]/g, '').trim();
  if (!cleaned) return null;
  const negative = /\(.+\)/.test(String(value || '')) || String(value || '').trim().startsWith('-');
  const parsed = Number(cleaned.replace(/-/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function parseDealRows(html: string) {
  const results: Array<Record<string, string | number | null>> = [];
  let currentDealType: 'combo' | 'mix_match' | 'unknown' = 'unknown';

  for (const row of extractTableRows(html)) {
    const cells = row.map((cell) => (cell || '').trim());
    const col0 = cells[0] || '';
    const col1 = cells[1] || '';
    const rowText = col0.toLowerCase();

    if (rowText.includes('combo deal')) {
      currentDealType = 'combo';
      continue;
    }

    if (rowText.includes('mix-match deal') || rowText.includes('mix match deal')) {
      currentDealType = 'mix_match';
      continue;
    }

    if (col0.toLowerCase() === 'promotion id') continue;
    if (col0.toLowerCase() === 'total') continue;
    if (col0 === '' && col1.toLowerCase() === 'total') continue;
    if (col1.toLowerCase() === 'total') continue;
    if (!col0) continue;
    if (!/^\d+$/.test(col0)) continue;

    const customerCount = normalizeInteger(cells[2], { reportType: 'deal_sales', fieldName: 'customer_count' });
    const matchOrComboCount = normalizeInteger(cells[3], { reportType: 'deal_sales', fieldName: currentDealType === 'mix_match' ? 'match_count' : 'combo_count' });
    const totalSales = parseDealNumber(cells[4]);

    if (totalSales === null && customerCount === null) continue;

    results.push({
      deal_type: currentDealType,
      promotion_id: col0,
      description: nullableText(col1),
      customer_count: customerCount,
      match_count: currentDealType === 'mix_match' ? matchOrComboCount : null,
      combo_count: currentDealType === 'combo' ? matchOrComboCount : null,
      total_sales: totalSales,
    });
  }

  return results;
}

export function parseVerifoneHtml(html: string): ParsedReport {
  const title = extractTitle(html);
  const reportType = detectReportType(title, html);
  if (reportType === 'unknown') return { title, reportType, rows: [], unsupported: true };
  if (reportType === 'cashier_summary') return { title, reportType, rows: [], unsupported: true };

  if (reportType === 'plu_sales') return { title, reportType, rows: parsePluRows(html) };
  if (reportType === 'department_sales') return { title, reportType, rows: parseDepartmentRows(html) };
  if (reportType === 'category_sales') return { title, reportType, rows: parseCategoryRows(html) };
  if (reportType === 'tax_summary') return { title, reportType, rows: parseTaxRows(html) };
  if (reportType === 'payment_summary') return { title, reportType, rows: parsePaymentRows(html) };
  if (reportType === 'fuel_dcr_summary') return { title, reportType, rows: parseDcrRows(html) };
  if (reportType === 'deal_sales') return { title, reportType, rows: parseDealRows(html) };
  return { title, reportType: 'unknown', rows: [], unsupported: true };
}
