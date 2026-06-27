import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { parseCsvText } from '@/lib/csv';
import { detectPeriod, type DetectedPeriod } from '@/lib/pos/period-detect';
import { normalizeUpc } from '@/lib/pos/upc-normalize';
import { parseVerifoneHtml, type PosReportType } from '@/lib/pos/verifone-html';

export const runtime = 'nodejs';

const VERIFONE_SOURCE_SYSTEM = 'verifone_commander';
const MANUAL_SOURCE_SYSTEM = 'manual_template';

type SourceSystem = typeof VERIFONE_SOURCE_SYSTEM | typeof MANUAL_SOURCE_SYSTEM;
type SupabaseRouteClient = ReturnType<typeof createRouteClient>;
type ParsedStatus = 'success' | 'failed' | 'skipped';
type CellValue = string | number | null;
type ParsedRow = Record<string, CellValue>;

type UploadItem = {
  fileName: string;
  extension: string;
  content: string | Buffer;
};

type ExtractedUploadItems = {
  uploadItems: UploadItem[];
  ignoredUnsupportedFiles: number;
  unsupportedTopLevelFiles: string[];
};

type ImportSummaryError = { fileName: string; message: string; code?: string | null; step?: string };

type ImportSummary = {
  totalFiles: number;
  parsedFiles: number;
  skippedDuplicates: number;
  skippedFiles: number;
  failedFiles: number;
  ignoredUnsupportedFiles: number;
  rowsInsertedByReportType: Record<string, number>;
  skipped: Array<{ fileName: string; message: string }>;
  errors: ImportSummaryError[];
};

class DuplicateRowConflictError extends Error {
  code = '23505';

  constructor(message: string) {
    super(message);
    this.name = 'DuplicateRowConflictError';
  }
}

type ManualTemplate = {
  reportType: Exclude<PosReportType, 'unknown'>;
  headers: string[];
  mapRow: (row: Record<string, string>) => ParsedRow;
};

const SUPPORTED_EXTENSIONS = new Set(['html', 'htm', 'xml', 'csv', 'xlsx', 'xls']);

const REPORT_TABLES: Partial<Record<PosReportType, string>> = {
  plu_sales: 'pos_plu_sales',
  department_sales: 'pos_department_sales',
  category_sales: 'pos_category_sales',
  tax_summary: 'pos_tax_summary',
  payment_summary: 'pos_payment_summary',
  fuel_dcr_summary: 'pos_fuel_dcr_summary',
  deal_sales: 'pos_deal_sales',
  cashier_summary: 'pos_cashier_summary',
};

const NETWORK_JOURNAL_SKIP_MESSAGE =
  'Network Journal reports are stored for audit but skipped because sensitive payment detail parsing is not supported in Phase 1.';

function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Route handlers do not need to persist refreshed auth cookies for this upload endpoint.
        },
      },
    }
  );
}

function jsonError(message: string, status = 400, details?: string, step?: string) {
  return NextResponse.json({ ok: false, success: false, error: message, details, step }, { status });
}

function hashContent(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function sanitizeTextContent(content: string) {
  return content.replace(/\u0000/g, '');
}

function storageContentFromUpload(content: string | Buffer) {
  return Buffer.isBuffer(content) ? content.toString('base64') : sanitizeTextContent(content);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [record.message, record.details, record.hint, record.code ? `Code: ${record.code}` : null]
      .filter(Boolean)
      .map(String)
      .join(' ');
  }
  return String(error || 'Unknown error');
}

function errorCode(error: unknown) {
  if (error instanceof DuplicateRowConflictError) return error.code;
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown };
    return typeof record.code === 'string' ? record.code : null;
  }
  return null;
}

function isDuplicateRowConflict(error: unknown) {
  return error instanceof DuplicateRowConflictError || errorCode(error) === '23505';
}

function fileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function normalizeTemplateHeader(header: string) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function nullableText(value: string | null | undefined) {
  const text = String(value || '').trim();
  return text || null;
}

function parseNullableNumber(value: string | number | null | undefined) {
  const cleaned = String(value ?? '').replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferPaymentType(paymentName: string | null | undefined) {
  const text = String(paymentName || '').toLowerCase();
  if (text.includes('debit')) return 'debit';
  if (/(visa|mastercard|amex|american express|discover|credit)/.test(text)) return 'credit';
  if (/(mobile|direct pay|apple|google)/.test(text)) return 'mobile';
  if (text.includes('ebt')) return 'ebt';
  if (/(wex|voyager|fleet)/.test(text)) return 'fleet';
  if (text.includes('cash')) return 'cash';
  return 'unknown';
}

function normalizeDealType(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['combo', 'mix_match', 'discount', 'unknown'].includes(normalized)) return normalized;
  return 'unknown';
}

const MANUAL_TEMPLATES: ManualTemplate[] = [
  {
    reportType: 'plu_sales',
    headers: ['plu_raw', 'description', 'unit_price', 'customer_count', 'items_sold', 'total_sales', 'sales_percent', 'reason_code', 'promotion_id'],
    mapRow: (row) => {
      const pluRaw = row.plu_raw || '';
      const normalized = normalizeUpc(pluRaw);
      return {
        plu_raw: nullableText(pluRaw),
        plu_normalized: normalized || null,
        upc_normalized: normalized || null,
        description: nullableText(row.description),
        unit_price: parseNullableNumber(row.unit_price),
        customer_count: parseNullableNumber(row.customer_count),
        items_sold: parseNullableNumber(row.items_sold),
        total_sales: parseNullableNumber(row.total_sales),
        sales_percent: parseNullableNumber(row.sales_percent),
        reason_code: nullableText(row.reason_code),
        promotion_id: nullableText(row.promotion_id),
      };
    },
  },
  {
    reportType: 'department_sales',
    headers: ['department_number', 'department_name', 'customer_count', 'items_sold', 'sales_percent', 'gross_sales', 'refunds', 'discounts', 'net_sales', 'cashier_name', 'register_number'],
    mapRow: (row) => ({
      department_number: nullableText(row.department_number),
      department_name: nullableText(row.department_name),
      customer_count: parseNullableNumber(row.customer_count),
      items_sold: parseNullableNumber(row.items_sold),
      sales_percent: parseNullableNumber(row.sales_percent),
      gross_sales: parseNullableNumber(row.gross_sales),
      refunds: parseNullableNumber(row.refunds),
      discounts: parseNullableNumber(row.discounts),
      net_sales: parseNullableNumber(row.net_sales),
      cashier_name: nullableText(row.cashier_name),
      register_number: nullableText(row.register_number),
    }),
  },
  {
    reportType: 'category_sales',
    headers: ['category_number', 'category_name', 'customer_count', 'items_sold', 'sales_percent', 'net_sales', 'cashier_name', 'register_number'],
    mapRow: (row) => ({
      category_number: nullableText(row.category_number),
      category_name: nullableText(row.category_name),
      customer_count: parseNullableNumber(row.customer_count),
      items_sold: parseNullableNumber(row.items_sold),
      sales_percent: parseNullableNumber(row.sales_percent),
      net_sales: parseNullableNumber(row.net_sales),
      cashier_name: nullableText(row.cashier_name),
      register_number: nullableText(row.register_number),
    }),
  },
  {
    reportType: 'tax_summary',
    headers: ['tax_name', 'tax_rate', 'actual_rate', 'taxable_sales', 'non_taxable_sales', 'refund_taxes', 'sales_taxes', 'total_taxes', 'register_number'],
    mapRow: (row) => ({
      tax_name: nullableText(row.tax_name),
      tax_rate: parseNullableNumber(row.tax_rate),
      actual_rate: parseNullableNumber(row.actual_rate),
      taxable_sales: parseNullableNumber(row.taxable_sales),
      non_taxable_sales: parseNullableNumber(row.non_taxable_sales),
      refund_taxes: parseNullableNumber(row.refund_taxes),
      sales_taxes: parseNullableNumber(row.sales_taxes),
      total_taxes: parseNullableNumber(row.total_taxes),
      register_number: nullableText(row.register_number),
    }),
  },
  {
    reportType: 'deal_sales',
    headers: ['deal_type', 'promotion_id', 'description', 'customer_count', 'match_count', 'combo_count', 'total_sales'],
    mapRow: (row) => ({
      deal_type: normalizeDealType(row.deal_type),
      promotion_id: nullableText(row.promotion_id),
      description: nullableText(row.description),
      customer_count: parseNullableNumber(row.customer_count),
      match_count: parseNullableNumber(row.match_count),
      combo_count: parseNullableNumber(row.combo_count),
      total_sales: parseNullableNumber(row.total_sales),
    }),
  },
  {
    reportType: 'payment_summary',
    headers: ['payment_number', 'payment_name', 'payment_type', 'payment_group', 'charge_count', 'charge_amount', 'correction_count', 'correction_amount', 'register_number'],
    mapRow: (row) => {
      const paymentName = nullableText(row.payment_name);
      const paymentType = nullableText(row.payment_type) || inferPaymentType(paymentName);
      return {
        payment_number: nullableText(row.payment_number),
        payment_name: paymentName,
        payment_type: paymentType,
        payment_group: nullableText(row.payment_group),
        charge_count: parseNullableNumber(row.charge_count),
        charge_amount: parseNullableNumber(row.charge_amount),
        correction_count: parseNullableNumber(row.correction_count),
        correction_amount: parseNullableNumber(row.correction_amount),
        register_number: nullableText(row.register_number),
      };
    },
  },
  {
    reportType: 'fuel_dcr_summary',
    headers: ['dcr_number', 'sale_count', 'amount', 'volume', 'pump_percent', 'all_dcr_percent', 'all_fuel_percent'],
    mapRow: (row) => ({
      dcr_number: nullableText(row.dcr_number),
      sale_count: parseNullableNumber(row.sale_count),
      amount: parseNullableNumber(row.amount),
      volume: parseNullableNumber(row.volume),
      pump_percent: parseNullableNumber(row.pump_percent),
      all_dcr_percent: parseNullableNumber(row.all_dcr_percent),
      all_fuel_percent: parseNullableNumber(row.all_fuel_percent),
    }),
  },
  {
    reportType: 'cashier_summary',
    headers: ['cashier_number', 'cashier_name', 'register_number', 'transaction_count', 'customer_count', 'item_count', 'gross_sales', 'net_sales', 'refunds', 'discounts', 'void_count', 'void_amount', 'no_sale_count', 'safe_drop_amount', 'paid_in_amount', 'paid_out_amount', 'over_short_amount'],
    mapRow: (row) => ({
      cashier_number: nullableText(row.cashier_number),
      cashier_name: nullableText(row.cashier_name),
      register_number: nullableText(row.register_number),
      transaction_count: parseNullableNumber(row.transaction_count),
      customer_count: parseNullableNumber(row.customer_count),
      item_count: parseNullableNumber(row.item_count),
      gross_sales: parseNullableNumber(row.gross_sales),
      net_sales: parseNullableNumber(row.net_sales),
      refunds: parseNullableNumber(row.refunds),
      discounts: parseNullableNumber(row.discounts),
      void_count: parseNullableNumber(row.void_count),
      void_amount: parseNullableNumber(row.void_amount),
      no_sale_count: parseNullableNumber(row.no_sale_count),
      safe_drop_amount: parseNullableNumber(row.safe_drop_amount),
      paid_in_amount: parseNullableNumber(row.paid_in_amount),
      paid_out_amount: parseNullableNumber(row.paid_out_amount),
      over_short_amount: parseNullableNumber(row.over_short_amount),
    }),
  },
];

async function extractUploadItems(files: File[]) {
  const uploadItems: UploadItem[] = [];
  let ignoredUnsupportedFiles = 0;
  const unsupportedTopLevelFiles: string[] = [];

  for (const file of files) {
    const extension = fileExtension(file.name);

    if (extension === 'zip') {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      for (const entry of entries) {
        const entryExtension = fileExtension(entry.name);
        if (!SUPPORTED_EXTENSIONS.has(entryExtension)) {
          ignoredUnsupportedFiles += 1;
          continue;
        }

        uploadItems.push({
          fileName: entry.name,
          extension: entryExtension,
          content: ['xlsx', 'xls'].includes(entryExtension) ? Buffer.from(await entry.async('uint8array')) : await entry.async('text'),
        });
      }
      continue;
    }

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      unsupportedTopLevelFiles.push(file.name);
      continue;
    }

    uploadItems.push({
      fileName: file.name,
      extension,
      content: ['xlsx', 'xls'].includes(extension) ? Buffer.from(await file.arrayBuffer()) : await file.text(),
    });
  }

  return { uploadItems, ignoredUnsupportedFiles, unsupportedTopLevelFiles };
}

async function resolvePeriod(client: SupabaseRouteClient, input: {
  storeId: string;
  ownerId: string;
  sourceSystem: SourceSystem;
  sourceStoreNumber: string | null;
  periodLabel: string | null;
  periodType: DetectedPeriod['periodType'];
  periodNumber: string | null;
  periodOpen: string | null;
  periodClose: string | null;
  periodHash: string;
}) {
  const insertResult = await client
    .from('pos_report_periods')
    .upsert(
      {
        store_id: input.storeId,
        owner_id: input.ownerId,
        source_system: input.sourceSystem,
        source_store_number: input.sourceStoreNumber,
        source_period_label: input.periodLabel,
        period_type: input.periodType,
        period_number: input.periodNumber,
        period_open: input.periodOpen,
        period_close: input.periodClose,
        period_hash: input.periodHash,
      },
      { onConflict: 'store_id,period_hash', ignoreDuplicates: true }
    );

  if (insertResult.error) throw insertResult.error;

  const { data, error } = await client
    .from('pos_report_periods')
    .select('id')
    .eq('store_id', input.storeId)
    .eq('period_hash', input.periodHash)
    .maybeSingle();

  if (error) throw error;
  const id = typeof data?.id === 'string' ? data.id : null;
  if (!id) throw new Error('Could not resolve POS report period.');
  return id;
}

function manualPeriodInput(input: { storeId: string; ownerId: string; fileHash: string; periodClose: string }) {
  return {
    storeId: input.storeId,
    ownerId: input.ownerId,
    sourceSystem: MANUAL_SOURCE_SYSTEM as SourceSystem,
    sourceStoreNumber: null,
    periodLabel: 'Manual Template Upload',
    periodType: 'unknown' as const,
    periodNumber: null,
    periodOpen: null,
    periodClose: input.periodClose,
    periodHash: createHash('sha256')
      .update([input.storeId, MANUAL_SOURCE_SYSTEM, input.fileHash].join('|'))
      .digest('hex'),
  };
}

function htmlPeriodInput(storeId: string, ownerId: string, period: DetectedPeriod) {
  return {
    storeId,
    ownerId,
    sourceSystem: VERIFONE_SOURCE_SYSTEM as SourceSystem,
    sourceStoreNumber: period.sourceStoreNumber,
    periodLabel: period.periodLabel,
    periodType: period.periodType,
    periodNumber: period.periodNumber,
    periodOpen: period.periodOpen,
    periodClose: period.periodClose,
    periodHash: period.periodHash,
  };
}

async function createReportFile(client: SupabaseRouteClient, input: {
  storeId: string;
  ownerId: string;
  uploadBatchId: string;
  reportPeriodId: string | null;
  sourceSystem: SourceSystem;
  fileName: string;
  fileHash: string;
  reportTitle: string;
  reportType: PosReportType;
  rawContent: string;
  parsedStatus: ParsedStatus;
  errorMessage?: string | null;
}) {
  const { data, error } = await client
    .from('pos_report_files')
    .insert({
      store_id: input.storeId,
      owner_id: input.ownerId,
      upload_batch_id: input.uploadBatchId,
      report_period_id: input.reportPeriodId,
      source_system: input.sourceSystem,
      file_name: input.fileName,
      file_hash: input.fileHash,
      report_title: input.reportTitle,
      report_type: input.reportType,
      raw_content: input.rawContent,
      parsed_status: input.parsedStatus,
      error_message: input.errorMessage || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = typeof data?.id === 'string' ? data.id : null;
  if (!id) throw new Error('Could not create POS report file record.');
  return id;
}

async function updateReportFileStatus(client: SupabaseRouteClient, reportFileId: string, parsedStatus: ParsedStatus, errorMessage: string) {
  const { error } = await client
    .from('pos_report_files')
    .update({
      parsed_status: parsedStatus,
      error_message: errorMessage,
    })
    .eq('id', reportFileId);

  if (error) throw error;
}

async function insertRowsForReport(client: SupabaseRouteClient, tableName: string, input: {
  storeId: string;
  reportPeriodId: string;
  reportFileId: string;
  ownerId: string;
  sourceSystem: SourceSystem;
  sourceStoreNumber: string | null;
  periodOpen: string | null;
  periodClose: string | null;
  rows: ParsedRow[];
}) {
  if (input.rows.length === 0) return 0;

  const rows = input.rows.map((row) => ({
    ...row,
    store_id: input.storeId,
    owner_id: input.ownerId,
    report_period_id: input.reportPeriodId,
    report_file_id: input.reportFileId,
    source_system: input.sourceSystem,
    source_store_number: input.sourceStoreNumber,
    period_open: input.periodOpen,
    period_close: input.periodClose,
  }));

  const { error } = await client.from(tableName).insert(rows);
  if (error) {
    if (errorCode(error) === '23505') {
      // TODO: Proper bulk ON CONFLICT DO NOTHING may need a DB RPC because some unique indexes use expressions.
      throw new DuplicateRowConflictError(formatError(error));
    }
    throw error;
  }
  return rows.length;
}

async function createUploadBatch(client: SupabaseRouteClient, input: {
  storeId: string;
  ownerId: string;
  fileName: string;
  totalRows: number;
  sourceSystem: SourceSystem;
  sourceFormat: string | null;
}) {
  const { data, error } = await client
    .from('upload_batches')
    .insert({
      store_id: input.storeId,
      owner_id: input.ownerId,
      upload_type: 'pos_report',
      file_name: input.fileName,
      source_system: input.sourceSystem,
      source_format: input.sourceFormat,
      total_rows: input.totalRows,
      valid_rows: 0,
      invalid_rows: 0,
      import_notes: null,
    })
    .select('id')
    .single();

  if (error) throw error;
  const id = typeof data?.id === 'string' ? data.id : null;
  if (!id) throw new Error('Could not create upload batch.');
  return id;
}

async function updateUploadBatch(client: SupabaseRouteClient, batchId: string, summary: ImportSummary) {
  const { error } = await client
    .from('upload_batches')
    .update({
      valid_rows: summary.parsedFiles,
      invalid_rows: summary.failedFiles + summary.skippedDuplicates + summary.skippedFiles + summary.ignoredUnsupportedFiles,
      import_notes: skippedImportNotes(summary),
    })
    .eq('id', batchId);

  if (error) throw error;
}

function worksheetRows(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
}

function rowsFromUploadItem(item: UploadItem) {
  if (item.extension === 'csv') {
    return parseCsvText(String(item.content));
  }
  if (item.extension === 'xlsx' || item.extension === 'xls') {
    return worksheetRows(Buffer.isBuffer(item.content) ? item.content : Buffer.from(String(item.content)));
  }
  return [];
}

function matchManualTemplate(headers: string[]) {
  const headerSet = new Set(headers.map(normalizeTemplateHeader));
  return MANUAL_TEMPLATES.find((template) =>
    template.headers.map(normalizeTemplateHeader).every((header) => headerSet.has(header))
  ) || null;
}

function parseManualRows(item: UploadItem) {
  const rows = rowsFromUploadItem(item);
  if (rows.length === 0) return { template: null, rows: [] as ParsedRow[], rawText: '' };

  const normalizedHeaders = rows[0].map((header) => normalizeTemplateHeader(String(header || '')));
  const template = matchManualTemplate(normalizedHeaders);
  const rawText = rows.map((row) => row.map((cell) => String(cell ?? '')).join(',')).join('\n');
  if (!template) return { template: null, rows: [] as ParsedRow[], rawText };

  const parsedRows = rows.slice(1).flatMap((row) => {
    if (row.every((cell) => String(cell ?? '').trim() === '')) return [];
    const record: Record<string, string> = {};
    normalizedHeaders.forEach((header, index) => {
      record[header] = String(row[index] ?? '').trim();
    });
    return [template.mapRow(record)];
  });

  return { template, rows: parsedRows, rawText };
}

function addSkipped(summary: ImportSummary, fileName: string, message: string) {
  summary.skippedFiles += 1;
  summary.skipped.push({ fileName, message });
}

function isNetworkJournalReport(fileName: string, html: string) {
  const text = `${fileName} ${html.slice(0, 4000)}`
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return text.includes('network journal');
}

function skippedImportNotes(summary: ImportSummary) {
  const notes = summary.skipped.map((item) => `${item.fileName}: ${item.message}`);

  if (summary.skippedDuplicates > 0) {
    notes.push(`${summary.skippedDuplicates} duplicate file(s) skipped.`);
  }

  if (summary.ignoredUnsupportedFiles > 0) {
    notes.push(`${summary.ignoredUnsupportedFiles} unsupported ZIP entr${summary.ignoredUnsupportedFiles === 1 ? 'y was' : 'ies were'} ignored.`);
  }

  return notes.join('\n') || null;
}

export async function POST(request: NextRequest) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return jsonError('You must be signed in to import POS reports.', 401);

  const formData = await request.formData();
  const storeId = String(formData.get('storeId') || '');
  if (!storeId) return jsonError('Select a specific store to import POS reports.');

  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id, owner_id, store_name')
    .eq('id', storeId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (storeError) return jsonError(formatError(storeError), 500);
  if (!store) return jsonError('Store not found or you do not have access.', 404);

  const files = formData.getAll('files').filter((item): item is File => item instanceof File);
  if (files.length === 0) return jsonError('Select at least one POS report file.');

  let extracted: ExtractedUploadItems;
  try {
    extracted = await extractUploadItems(files);
  } catch (error) {
    return jsonError('Could not read uploaded files.', 400, formatError(error), 'extract_files');
  }

  if (extracted.unsupportedTopLevelFiles.length > 0) {
    return jsonError(
      'Unsupported POS report file type.',
      400,
      `Unsupported file(s): ${extracted.unsupportedTopLevelFiles.join(', ')}`,
      'validate_files'
    );
  }

  if (extracted.uploadItems.length === 0 && extracted.ignoredUnsupportedFiles === 0) {
    return jsonError('No supported POS report files were found.', 400, undefined, 'validate_files');
  }

  let batchId: string;
  try {
    const sourceFormat = files.some((file) => fileExtension(file.name) === 'zip') ? 'zip' : null;
    batchId = await createUploadBatch(client, {
      storeId,
      ownerId: user.id,
      fileName: files.length === 1 ? files[0].name : `${files.length} POS upload files`,
      totalRows: extracted.uploadItems.length,
      sourceSystem: VERIFONE_SOURCE_SYSTEM,
      sourceFormat,
    });
  } catch (error) {
    return jsonError('Could not create POS import batch.', 500, formatError(error), 'create_upload_batch');
  }

  const summary: ImportSummary = {
    totalFiles: extracted.uploadItems.length,
    parsedFiles: 0,
    skippedDuplicates: 0,
    skippedFiles: 0,
    failedFiles: 0,
    ignoredUnsupportedFiles: extracted.ignoredUnsupportedFiles,
    rowsInsertedByReportType: {},
    skipped: [],
    errors: [],
  };

  for (const uploadItem of extracted.uploadItems) {
    const fileHash = hashContent(uploadItem.content);
    const rawContent = storageContentFromUpload(uploadItem.content);
    const sanitizedUploadItem: UploadItem = Buffer.isBuffer(uploadItem.content)
      ? uploadItem
      : { ...uploadItem, content: rawContent };
    let currentReportFileId: string | null = null;

    try {
      const { data: duplicate, error: duplicateError } = await client
        .from('pos_report_files')
        .select('id, parsed_status')
        .eq('store_id', storeId)
        .eq('file_hash', fileHash)
        .eq('parsed_status', 'success')
        .maybeSingle();

      if (duplicateError) throw duplicateError;
      if (duplicate) {
        summary.skippedDuplicates += 1;
        continue;
      }

      if (uploadItem.extension === 'xml') {
        await createReportFile(client, {
          storeId,
          ownerId: user.id,
          uploadBatchId: batchId,
          reportPeriodId: null,
          sourceSystem: VERIFONE_SOURCE_SYSTEM,
          fileName: uploadItem.fileName,
          fileHash,
          reportTitle: 'XML Report',
          reportType: 'unknown',
          rawContent,
          parsedStatus: 'skipped',
          errorMessage: 'XML parser not yet configured',
        });
        addSkipped(summary, uploadItem.fileName, 'XML parser not yet configured');
        continue;
      }

      if (uploadItem.extension === 'html' || uploadItem.extension === 'htm') {
        const html = rawContent;

        if (isNetworkJournalReport(uploadItem.fileName, html)) {
          await createReportFile(client, {
            storeId,
            ownerId: user.id,
            uploadBatchId: batchId,
            reportPeriodId: null,
            sourceSystem: VERIFONE_SOURCE_SYSTEM,
            fileName: uploadItem.fileName,
            fileHash,
            reportTitle: 'Network Journal Report',
            reportType: 'unknown',
            rawContent: html,
            parsedStatus: 'skipped',
            errorMessage: NETWORK_JOURNAL_SKIP_MESSAGE,
          });
          addSkipped(summary, uploadItem.fileName, NETWORK_JOURNAL_SKIP_MESSAGE);
          continue;
        }

        const period = detectPeriod(html, storeId, VERIFONE_SOURCE_SYSTEM);
        const parsed = parseVerifoneHtml(html);

        if (parsed.reportType === 'unknown' || parsed.unsupported) {
          await createReportFile(client, {
            storeId,
            ownerId: user.id,
            uploadBatchId: batchId,
            reportPeriodId: null,
            sourceSystem: VERIFONE_SOURCE_SYSTEM,
            fileName: uploadItem.fileName,
            fileHash,
            reportTitle: parsed.title,
            reportType: parsed.reportType,
            rawContent: html,
            parsedStatus: 'skipped',
            errorMessage: parsed.reportType === 'cashier_summary' ? 'Cashier report detected but not parsed in Phase 1.' : 'Unknown report type.',
          });
          addSkipped(summary, uploadItem.fileName, parsed.reportType === 'cashier_summary' ? 'Cashier report detected but not parsed in Phase 1.' : 'Unknown report type.');
          continue;
        }

        const tableName = REPORT_TABLES[parsed.reportType];
        if (!tableName) {
          await createReportFile(client, {
            storeId,
            ownerId: user.id,
            uploadBatchId: batchId,
            reportPeriodId: null,
            sourceSystem: VERIFONE_SOURCE_SYSTEM,
            fileName: uploadItem.fileName,
            fileHash,
            reportTitle: parsed.title,
            reportType: parsed.reportType,
            rawContent: html,
            parsedStatus: 'skipped',
            errorMessage: 'Report type is detected but unsupported.',
          });
          addSkipped(summary, uploadItem.fileName, 'Report type is detected but unsupported.');
          continue;
        }

        const reportPeriodId = await resolvePeriod(client, htmlPeriodInput(storeId, user.id, period));
        const reportFileId = await createReportFile(client, {
          storeId,
          ownerId: user.id,
          uploadBatchId: batchId,
          reportPeriodId,
          sourceSystem: VERIFONE_SOURCE_SYSTEM,
          fileName: uploadItem.fileName,
          fileHash,
          reportTitle: parsed.title,
          reportType: parsed.reportType,
          rawContent: html,
          parsedStatus: 'success',
        });
        currentReportFileId = reportFileId;

        const inserted = await insertRowsForReport(client, tableName, {
          storeId,
          reportPeriodId,
          reportFileId,
          ownerId: user.id,
          sourceSystem: VERIFONE_SOURCE_SYSTEM,
          sourceStoreNumber: period.sourceStoreNumber,
          periodOpen: period.periodOpen,
          periodClose: period.periodClose,
          rows: parsed.rows,
        });

        summary.parsedFiles += 1;
        summary.rowsInsertedByReportType[parsed.reportType] = (summary.rowsInsertedByReportType[parsed.reportType] || 0) + inserted;
        continue;
      }

      const manualParsed = parseManualRows(sanitizedUploadItem);
      if (!manualParsed.template) {
        await createReportFile(client, {
          storeId,
          ownerId: user.id,
          uploadBatchId: batchId,
          reportPeriodId: null,
          sourceSystem: MANUAL_SOURCE_SYSTEM,
          fileName: uploadItem.fileName,
          fileHash,
          reportTitle: 'Manual Template Upload',
          reportType: 'unknown',
          rawContent: manualParsed.rawText || rawContent,
          parsedStatus: 'skipped',
          errorMessage: 'Headers do not match any known POS import template',
        });
        addSkipped(summary, uploadItem.fileName, 'Headers do not match any known POS import template');
        continue;
      }

      if (manualParsed.rows.length === 0) {
        await createReportFile(client, {
          storeId,
          ownerId: user.id,
          uploadBatchId: batchId,
          reportPeriodId: null,
          sourceSystem: MANUAL_SOURCE_SYSTEM,
          fileName: uploadItem.fileName,
          fileHash,
          reportTitle: 'Manual Template Upload',
          reportType: manualParsed.template.reportType,
          rawContent: manualParsed.rawText || rawContent,
          parsedStatus: 'failed',
          errorMessage: 'No rows could be parsed from this template.',
        });
        summary.failedFiles += 1;
        summary.errors.push({ fileName: uploadItem.fileName, message: 'No rows could be parsed from this template.' });
        continue;
      }

      const periodClose = new Date().toISOString();
      const reportPeriodId = await resolvePeriod(client, manualPeriodInput({ storeId, ownerId: user.id, fileHash, periodClose }));
      const reportFileId = await createReportFile(client, {
        storeId,
        ownerId: user.id,
        uploadBatchId: batchId,
        reportPeriodId,
        sourceSystem: MANUAL_SOURCE_SYSTEM,
        fileName: uploadItem.fileName,
        fileHash,
        reportTitle: 'Manual Template Upload',
        reportType: manualParsed.template.reportType,
        rawContent: manualParsed.rawText || rawContent,
        parsedStatus: 'success',
      });
      currentReportFileId = reportFileId;

      const tableName = REPORT_TABLES[manualParsed.template.reportType];
      if (!tableName) throw new Error('Manual template report type is unsupported.');
      const inserted = await insertRowsForReport(client, tableName, {
        storeId,
        reportPeriodId,
        reportFileId,
        ownerId: user.id,
        sourceSystem: MANUAL_SOURCE_SYSTEM,
        sourceStoreNumber: null,
        periodOpen: null,
        periodClose,
        rows: manualParsed.rows,
      });

      summary.parsedFiles += 1;
      summary.rowsInsertedByReportType[manualParsed.template.reportType] = (summary.rowsInsertedByReportType[manualParsed.template.reportType] || 0) + inserted;
    } catch (error) {
      console.error('[POS Import File Error]', uploadItem.fileName, error);

      if (isDuplicateRowConflict(error)) {
        const message = 'Skipped because parsed rows already exist for this store and report period.';
        if (currentReportFileId) {
          try {
            await updateReportFileStatus(client, currentReportFileId, 'skipped', message);
          } catch (statusError) {
            console.error('[POS Import Report File Status Error]', uploadItem.fileName, statusError);
          }
        }
        summary.skippedDuplicates += 1;
        summary.skipped.push({ fileName: uploadItem.fileName, message });
        continue;
      }

      if (currentReportFileId) {
        try {
          await updateReportFileStatus(client, currentReportFileId, 'failed', formatError(error));
        } catch (statusError) {
          console.error('[POS Import Report File Status Error]', uploadItem.fileName, statusError);
        }
      }

      summary.failedFiles += 1;
      summary.errors.push({
        fileName: uploadItem.fileName,
        message: formatError(error),
        code: errorCode(error),
        step: 'process_file',
      });
      continue;
    }
  }

  if (summary.parsedFiles === 0 && summary.failedFiles > 0 && summary.failedFiles === extracted.uploadItems.length) {
    return jsonError(
      'POS import failed for every file.',
      500,
      summary.errors.map((item) => `${item.fileName}: ${item.message}`).join('\n'),
      'process_files'
    );
  }

  try {
    await updateUploadBatch(client, batchId, summary);
  } catch (error) {
    return jsonError('Could not update POS import batch summary.', 500, formatError(error), 'update_upload_batch');
  }

  return NextResponse.json({ ok: true, success: true, batchId, summary });
}

export async function GET(request: NextRequest) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return jsonError('You must be signed in.', 401);

  const storeId = request.nextUrl.searchParams.get('storeId') || '';
  if (!storeId) return jsonError('Select a specific store to import POS reports.');

  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (storeError) return jsonError(formatError(storeError), 500);
  if (!store) return jsonError('Store not found or you do not have access.', 404);

  const [batchesResult, filesResult] = await Promise.all([
    client.from('upload_batches').select('*').eq('store_id', storeId).eq('upload_type', 'pos_report').order('created_at', { ascending: false }).limit(10),
    client.from('pos_report_files').select('id, file_name, report_title, report_type, parsed_status, error_message, created_at').eq('store_id', storeId).order('created_at', { ascending: false }).limit(25),
  ]);

  if (batchesResult.error) return jsonError(formatError(batchesResult.error), 500);
  if (filesResult.error) return jsonError(formatError(filesResult.error), 500);

  return NextResponse.json({
    batches: batchesResult.data || [],
    files: filesResult.data || [],
  });
}
