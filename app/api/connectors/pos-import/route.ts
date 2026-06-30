import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { parseCsvText } from '@/lib/csv';
import { detectPeriod, type DetectedPeriod } from '@/lib/pos/period-detect';
import { normalizeUpc } from '@/lib/pos/upc-normalize';
import { parseVerifoneHtml, type PosReportType } from '@/lib/pos/verifone-html';

export const runtime = 'nodejs';

const VERIFONE_SOURCE_SYSTEM = 'verifone_commander' as const;
const NETWORK_JOURNAL_SKIP_MESSAGE =
  'Network Journal reports are stored for audit but skipped because sensitive payment detail parsing is not supported in Phase 1.';

type SourceSystem = typeof VERIFONE_SOURCE_SYSTEM;
type ConnectorStatus = 'active' | 'disabled';
type ParsedStatus = 'success' | 'failed' | 'skipped';
type FileResultStatus = 'success' | 'skipped' | 'duplicate' | 'failed';
type CellValue = string | number | null;
type ParsedRow = Record<string, CellValue>;
type ConnectorSupabaseClient = SupabaseClient;

type ConnectorRow = {
  id: string;
  store_id: string;
  connector_name: string;
  source_system: string;
  status: ConnectorStatus;
};

type StoreOwnerRow = {
  id: string;
  owner_id: string;
};

type UploadItem = {
  fileName: string;
  extension: string;
  content: string | Buffer;
};

type FileResult = {
  fileName: string;
  reportType: PosReportType | null;
  status: FileResultStatus;
  rowsInserted: number | null;
  message: string | null;
};

type ExtractedUploadItems = {
  uploadItems: UploadItem[];
  skippedFiles: FileResult[];
};

type ManualTemplate = {
  reportType: Exclude<PosReportType, 'unknown'>;
  headers: string[];
  mapRow: (row: Record<string, string>) => ParsedRow;
};

class DuplicateRowConflictError extends Error {
  code = '23505';

  constructor(message: string) {
    super(message);
    this.name = 'DuplicateRowConflictError';
  }
}

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

function jsonError(reason: 'unauthorized' | 'invalid_request' | 'server_error', status: number) {
  return NextResponse.json({ ok: false, reason }, { status });
}

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Connector POS Import] Missing required Supabase server environment.');
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
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

function safeMessage(message: string) {
  return message.replace(/\s+/g, ' ').slice(0, 240);
}

function fileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
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
      return {
        payment_number: nullableText(row.payment_number),
        payment_name: paymentName,
        payment_type: nullableText(row.payment_type) || inferPaymentType(paymentName),
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

async function extractUploadItems(files: File[]): Promise<ExtractedUploadItems> {
  const uploadItems: UploadItem[] = [];
  const skippedFiles: FileResult[] = [];

  for (const file of files) {
    const extension = fileExtension(file.name);

    if (extension === 'zip') {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      for (const entry of entries) {
        const entryExtension = fileExtension(entry.name);
        if (!SUPPORTED_EXTENSIONS.has(entryExtension)) {
          skippedFiles.push({
            fileName: entry.name,
            reportType: null,
            status: 'skipped',
            rowsInserted: null,
            message: 'Unsupported file type.',
          });
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
      skippedFiles.push({
        fileName: file.name,
        reportType: null,
        status: 'skipped',
        rowsInserted: null,
        message: 'Unsupported file type.',
      });
      continue;
    }

    uploadItems.push({
      fileName: file.name,
      extension,
      content: ['xlsx', 'xls'].includes(extension) ? Buffer.from(await file.arrayBuffer()) : await file.text(),
    });
  }

  return { uploadItems, skippedFiles };
}

async function resolvePeriod(client: ConnectorSupabaseClient, input: {
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

function connectorPeriodInput(input: { storeId: string; ownerId: string; fileHash: string; periodClose: string }) {
  return {
    storeId: input.storeId,
    ownerId: input.ownerId,
    sourceSystem: VERIFONE_SOURCE_SYSTEM,
    sourceStoreNumber: null,
    periodLabel: 'Connector Template Upload',
    periodType: 'unknown' as const,
    periodNumber: null,
    periodOpen: null,
    periodClose: input.periodClose,
    periodHash: hashText([input.storeId, VERIFONE_SOURCE_SYSTEM, input.fileHash].join('|')),
  };
}

function htmlPeriodInput(storeId: string, ownerId: string, period: DetectedPeriod) {
  return {
    storeId,
    ownerId,
    sourceSystem: VERIFONE_SOURCE_SYSTEM,
    sourceStoreNumber: period.sourceStoreNumber,
    periodLabel: period.periodLabel,
    periodType: period.periodType,
    periodNumber: period.periodNumber,
    periodOpen: period.periodOpen,
    periodClose: period.periodClose,
    periodHash: period.periodHash,
  };
}

async function createReportFile(client: ConnectorSupabaseClient, input: {
  storeId: string;
  ownerId: string;
  uploadBatchId: string;
  reportPeriodId: string | null;
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
      source_system: VERIFONE_SOURCE_SYSTEM,
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

async function updateReportFileStatus(client: ConnectorSupabaseClient, reportFileId: string, parsedStatus: ParsedStatus, errorMessage: string) {
  const { error } = await client
    .from('pos_report_files')
    .update({
      parsed_status: parsedStatus,
      error_message: errorMessage,
    })
    .eq('id', reportFileId);

  if (error) throw error;
}

async function insertRowsForReport(client: ConnectorSupabaseClient, tableName: string, input: {
  storeId: string;
  reportPeriodId: string;
  reportFileId: string;
  ownerId: string;
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
    source_system: VERIFONE_SOURCE_SYSTEM,
    source_store_number: input.sourceStoreNumber,
    period_open: input.periodOpen,
    period_close: input.periodClose,
  }));

  const { error } = await client.from(tableName).insert(rows);
  if (error) {
    if (errorCode(error) === '23505') {
      throw new DuplicateRowConflictError(safeMessage(String(error.message || 'Duplicate rows.')));
    }
    throw error;
  }
  return rows.length;
}

async function createUploadBatch(client: ConnectorSupabaseClient, input: {
  storeId: string;
  ownerId: string;
  fileName: string;
  totalRows: number;
  sourceFormat: string | null;
}) {
  const { data, error } = await client
    .from('upload_batches')
    .insert({
      store_id: input.storeId,
      owner_id: input.ownerId,
      upload_type: 'pos_report',
      file_name: input.fileName,
      source_system: VERIFONE_SOURCE_SYSTEM,
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

async function updateUploadBatch(client: ConnectorSupabaseClient, batchId: string, results: FileResult[]) {
  const validRows = results.filter((result) => result.status === 'success').length;
  const invalidRows = results.filter((result) => result.status !== 'success').length;
  const notes = results
    .filter((result) => result.status !== 'success' && result.message)
    .map((result) => `${result.fileName}: ${result.message}`)
    .join('\n') || null;

  const { error } = await client
    .from('upload_batches')
    .update({
      valid_rows: validRows,
      invalid_rows: invalidRows,
      import_notes: notes,
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

function isNetworkJournalReport(fileName: string, html: string) {
  const text = `${fileName} ${html.slice(0, 4000)}`
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return text.includes('network journal');
}

async function duplicateExists(client: ConnectorSupabaseClient, storeId: string, fileHash: string) {
  const { data, error } = await client
    .from('pos_report_files')
    .select('id')
    .eq('store_id', storeId)
    .eq('file_hash', fileHash)
    .eq('parsed_status', 'success')
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function processUploadItem(client: ConnectorSupabaseClient, input: {
  item: UploadItem;
  storeId: string;
  ownerId: string;
  uploadBatchId: string;
}): Promise<FileResult> {
  const { item, storeId, ownerId, uploadBatchId } = input;
  const fileHash = hashContent(item.content);
  const rawContent = storageContentFromUpload(item.content);
  const sanitizedItem: UploadItem = Buffer.isBuffer(item.content) ? item : { ...item, content: rawContent };
  let currentReportFileId: string | null = null;

  try {
    if (await duplicateExists(client, storeId, fileHash)) {
      return {
        fileName: item.fileName,
        reportType: null,
        status: 'duplicate',
        rowsInserted: null,
        message: 'File already imported for this store.',
      };
    }

    if (item.extension === 'xml') {
      await createReportFile(client, {
        storeId,
        ownerId,
        uploadBatchId,
        reportPeriodId: null,
        fileName: item.fileName,
        fileHash,
        reportTitle: 'XML Report',
        reportType: 'unknown',
        rawContent,
        parsedStatus: 'skipped',
        errorMessage: 'XML parser not yet configured',
      });
      return {
        fileName: item.fileName,
        reportType: 'unknown',
        status: 'skipped',
        rowsInserted: null,
        message: 'XML parser not yet configured.',
      };
    }

    if (item.extension === 'html' || item.extension === 'htm') {
      const html = rawContent;

      if (isNetworkJournalReport(item.fileName, html)) {
        await createReportFile(client, {
          storeId,
          ownerId,
          uploadBatchId,
          reportPeriodId: null,
          fileName: item.fileName,
          fileHash,
          reportTitle: 'Network Journal Report',
          reportType: 'unknown',
          rawContent: html,
          parsedStatus: 'skipped',
          errorMessage: NETWORK_JOURNAL_SKIP_MESSAGE,
        });
        return {
          fileName: item.fileName,
          reportType: 'unknown',
          status: 'skipped',
          rowsInserted: null,
          message: NETWORK_JOURNAL_SKIP_MESSAGE,
        };
      }

      const period = detectPeriod(html, storeId, VERIFONE_SOURCE_SYSTEM);
      const parsed = parseVerifoneHtml(html);

      if (parsed.reportType === 'unknown' || parsed.unsupported) {
        const message = parsed.reportType === 'cashier_summary'
          ? 'Cashier report detected but not parsed in Phase 1.'
          : 'Unknown report type.';
        await createReportFile(client, {
          storeId,
          ownerId,
          uploadBatchId,
          reportPeriodId: null,
          fileName: item.fileName,
          fileHash,
          reportTitle: parsed.title,
          reportType: parsed.reportType,
          rawContent: html,
          parsedStatus: 'skipped',
          errorMessage: message,
        });
        return {
          fileName: item.fileName,
          reportType: parsed.reportType,
          status: 'skipped',
          rowsInserted: null,
          message,
        };
      }

      const tableName = REPORT_TABLES[parsed.reportType];
      if (!tableName) {
        await createReportFile(client, {
          storeId,
          ownerId,
          uploadBatchId,
          reportPeriodId: null,
          fileName: item.fileName,
          fileHash,
          reportTitle: parsed.title,
          reportType: parsed.reportType,
          rawContent: html,
          parsedStatus: 'skipped',
          errorMessage: 'Report type is detected but unsupported.',
        });
        return {
          fileName: item.fileName,
          reportType: parsed.reportType,
          status: 'skipped',
          rowsInserted: null,
          message: 'Report type is detected but unsupported.',
        };
      }

      const reportPeriodId = await resolvePeriod(client, htmlPeriodInput(storeId, ownerId, period));
      const reportFileId = await createReportFile(client, {
        storeId,
        ownerId,
        uploadBatchId,
        reportPeriodId,
        fileName: item.fileName,
        fileHash,
        reportTitle: parsed.title,
        reportType: parsed.reportType,
        rawContent: html,
        parsedStatus: 'success',
      });
      currentReportFileId = reportFileId;

      const rowsInserted = await insertRowsForReport(client, tableName, {
        storeId,
        reportPeriodId,
        reportFileId,
        ownerId,
        sourceStoreNumber: period.sourceStoreNumber,
        periodOpen: period.periodOpen,
        periodClose: period.periodClose,
        rows: parsed.rows,
      });

      return {
        fileName: item.fileName,
        reportType: parsed.reportType,
        status: 'success',
        rowsInserted,
        message: rowsInserted === 0 ? '0 rows found in recognized report.' : null,
      };
    }

    const manualParsed = parseManualRows(sanitizedItem);
    if (!manualParsed.template) {
      await createReportFile(client, {
        storeId,
        ownerId,
        uploadBatchId,
        reportPeriodId: null,
        fileName: item.fileName,
        fileHash,
        reportTitle: 'Connector Template Upload',
        reportType: 'unknown',
        rawContent: manualParsed.rawText || rawContent,
        parsedStatus: 'skipped',
        errorMessage: 'Headers do not match any known POS import template',
      });
      return {
        fileName: item.fileName,
        reportType: 'unknown',
        status: 'skipped',
        rowsInserted: null,
        message: 'Headers do not match any known POS import template.',
      };
    }

    if (manualParsed.rows.length === 0) {
      await createReportFile(client, {
        storeId,
        ownerId,
        uploadBatchId,
        reportPeriodId: null,
        fileName: item.fileName,
        fileHash,
        reportTitle: 'Connector Template Upload',
        reportType: manualParsed.template.reportType,
        rawContent: manualParsed.rawText || rawContent,
        parsedStatus: 'failed',
        errorMessage: 'No rows could be parsed from this template.',
      });
      return {
        fileName: item.fileName,
        reportType: manualParsed.template.reportType,
        status: 'failed',
        rowsInserted: null,
        message: 'No rows could be parsed from this template.',
      };
    }

    const periodClose = new Date().toISOString();
    const reportPeriodId = await resolvePeriod(client, connectorPeriodInput({ storeId, ownerId, fileHash, periodClose }));
    const reportFileId = await createReportFile(client, {
      storeId,
      ownerId,
      uploadBatchId,
      reportPeriodId,
      fileName: item.fileName,
      fileHash,
      reportTitle: 'Connector Template Upload',
      reportType: manualParsed.template.reportType,
      rawContent: manualParsed.rawText || rawContent,
      parsedStatus: 'success',
    });
    currentReportFileId = reportFileId;

    const tableName = REPORT_TABLES[manualParsed.template.reportType];
    if (!tableName) throw new Error('Manual template report type is unsupported.');
    const rowsInserted = await insertRowsForReport(client, tableName, {
      storeId,
      reportPeriodId,
      reportFileId,
      ownerId,
      sourceStoreNumber: null,
      periodOpen: null,
      periodClose,
      rows: manualParsed.rows,
    });

    return {
      fileName: item.fileName,
      reportType: manualParsed.template.reportType,
      status: 'success',
      rowsInserted,
      message: rowsInserted === 0 ? '0 rows found in recognized report.' : null,
    };
  } catch (error) {
    console.error('[Connector POS Import File Error]', item.fileName, error);

    if (isDuplicateRowConflict(error)) {
      const message = 'Parsed rows already exist for this store and report period.';
      if (currentReportFileId) {
        try {
          await updateReportFileStatus(client, currentReportFileId, 'skipped', message);
        } catch (statusError) {
          console.error('[Connector POS Import Report File Status Error]', item.fileName, statusError);
        }
      }
      return {
        fileName: item.fileName,
        reportType: null,
        status: 'duplicate',
        rowsInserted: null,
        message,
      };
    }

    if (currentReportFileId) {
      try {
        await updateReportFileStatus(client, currentReportFileId, 'failed', 'File import failed.');
      } catch (statusError) {
        console.error('[Connector POS Import Report File Status Error]', item.fileName, statusError);
      }
    }

    return {
      fileName: item.fileName,
      reportType: null,
      status: 'failed',
      rowsInserted: null,
      message: 'File import failed.',
    };
  }
}

async function updateConnector(client: ConnectorSupabaseClient, connectorId: string, values: Record<string, string | null>) {
  const { error } = await client
    .from('store_pos_connectors')
    .update(values)
    .eq('id', connectorId);

  if (error) {
    console.error('[Connector POS Import] Could not update connector status.');
  }
}

export async function POST(request: Request) {
  const client = createServiceSupabaseClient();
  if (!client) return jsonError('server_error', 500);

  const rawToken = getBearerToken(request);
  if (!rawToken) return jsonError('unauthorized', 401);

  const tokenHash = hashText(rawToken);
  const { data: connectorRow, error: connectorError } = await client
    .from('store_pos_connectors')
    .select('id, store_id, connector_name, source_system, status')
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle<ConnectorRow>();

  if (connectorError) {
    console.error('[Connector POS Import] Connector lookup failed.');
    return jsonError('unauthorized', 401);
  }

  if (!connectorRow) return jsonError('unauthorized', 401);

  const now = new Date().toISOString();
  await updateConnector(client, connectorRow.id, { last_seen_at: now });

  try {
    const { data: store, error: storeError } = await client
      .from('stores')
      .select('id, owner_id')
      .eq('id', connectorRow.store_id)
      .maybeSingle<StoreOwnerRow>();

    if (storeError || !store?.owner_id) {
      console.error('[Connector POS Import] Store ownership lookup failed.');
      await updateConnector(client, connectorRow.id, { last_error: 'Store lookup failed.' });
      return jsonError('server_error', 500);
    }

    const contentType = request.headers.get('content-type') || '';
    let files: File[] = [];
    if (contentType) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return jsonError('invalid_request', 400);
      }

      files = formData.getAll('files').filter((item): item is File => item instanceof File);
    }

    if (files.length === 0) {
      return NextResponse.json({
        ok: true,
        connectorName: connectorRow.connector_name,
        storeId: connectorRow.store_id,
        filesReceived: 0,
        results: [] satisfies FileResult[],
      });
    }

    let extracted: ExtractedUploadItems;
    try {
      extracted = await extractUploadItems(files);
    } catch {
      return jsonError('invalid_request', 400);
    }

    const results: FileResult[] = [...extracted.skippedFiles];
    let batchId: string | null = null;

    if (extracted.uploadItems.length > 0) {
      const sourceFormat = files.some((file) => fileExtension(file.name) === 'zip') ? 'zip' : null;
      batchId = await createUploadBatch(client, {
        storeId: connectorRow.store_id,
        ownerId: store.owner_id,
        fileName: files.length === 1 ? files[0].name : `${files.length} connector POS upload files`,
        totalRows: extracted.uploadItems.length,
        sourceFormat,
      });

      for (const item of extracted.uploadItems) {
        const result = await processUploadItem(client, {
          item,
          storeId: connectorRow.store_id,
          ownerId: store.owner_id,
          uploadBatchId: batchId,
        });
        results.push(result);
      }

      await updateUploadBatch(client, batchId, results);
    }

    if (results.some((result) => result.status === 'success')) {
      await updateConnector(client, connectorRow.id, { last_upload_at: new Date().toISOString(), last_error: null });
    }

    return NextResponse.json({
      ok: true,
      connectorName: connectorRow.connector_name,
      storeId: connectorRow.store_id,
      filesReceived: files.length,
      results,
    });
  } catch (error) {
    console.error('[Connector POS Import] System error.', error);
    await updateConnector(client, connectorRow.id, { last_error: 'Connector import failed.' });
    return jsonError('server_error', 500);
  }
}
