import type { SupabaseClient } from '@supabase/supabase-js';

type RawRecord = Record<string, unknown>;

export type CanonicalReportSourceMode = 'canonical' | 'legacy' | 'coverage_conflict' | 'unavailable';

export interface CanonicalReportCoverage {
  hasData: boolean;
  firstBusinessDate: string | null;
  lastBusinessDate: string | null;
  transactionCount: number;
}

export interface CanonicalReportSummary {
  grossSales: number;
  refundAmount: number;
  netSales: number;
  netTax: number;
  completedSaleCount: number;
  refundCount: number;
  averageTicket: number;
  paidOutCount: number;
  paidOutAmount: number;
  safeDropCount: number;
  safeDropAmount: number;
  noSaleCount: number;
  unclassifiedEventCount: number;
  totalHeaderCount: number;
}

export const EMPTY_CANONICAL_REPORT_SUMMARY: CanonicalReportSummary = {
  grossSales: 0,
  refundAmount: 0,
  netSales: 0,
  netTax: 0,
  completedSaleCount: 0,
  refundCount: 0,
  averageTicket: 0,
  paidOutCount: 0,
  paidOutAmount: 0,
  safeDropCount: 0,
  safeDropAmount: 0,
  noSaleCount: 0,
  unclassifiedEventCount: 0,
  totalHeaderCount: 0,
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toSafeCount(value: unknown): number {
  return Math.max(0, Math.trunc(toFiniteNumber(value)));
}

function toNullableDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function firstRpcRow(data: unknown): RawRecord | null {
  if (Array.isArray(data)) {
    const first = data[0];
    return typeof first === 'object' && first !== null ? first as RawRecord : null;
  }

  return typeof data === 'object' && data !== null ? data as RawRecord : null;
}

function friendlyRpcError(label: string, error: unknown): Error {
  console.error(label, error);
  return new Error(label);
}

export async function fetchCanonicalReportCoverage(
  client: SupabaseClient,
  storeId: string
): Promise<CanonicalReportCoverage> {
  if (!storeId) {
    throw new Error('Select a specific store to load canonical report coverage.');
  }

  const { data, error } = await client.rpc('get_canonical_report_coverage', {
    p_store_id: storeId,
  });

  if (error) {
    throw friendlyRpcError('Canonical report coverage could not be loaded.', error);
  }

  const row = firstRpcRow(data);

  return {
    hasData: Boolean(row?.has_data),
    firstBusinessDate: toNullableDateString(row?.first_business_date),
    lastBusinessDate: toNullableDateString(row?.last_business_date),
    transactionCount: toSafeCount(row?.transaction_count),
  };
}

export async function fetchCanonicalReportSummary(
  client: SupabaseClient,
  params: {
    storeId: string;
    startBusinessDate: string;
    endBusinessDate: string;
  }
): Promise<CanonicalReportSummary> {
  if (!params.storeId) {
    throw new Error('Select a specific store to load canonical report summary.');
  }

  const { data, error } = await client.rpc('get_canonical_report_summary', {
    p_store_id: params.storeId,
    p_start_business_date: params.startBusinessDate,
    p_end_business_date: params.endBusinessDate,
  });

  if (error) {
    throw friendlyRpcError('Canonical report summary could not be loaded.', error);
  }

  const row = firstRpcRow(data);
  if (!row) return EMPTY_CANONICAL_REPORT_SUMMARY;

  return {
    grossSales: toFiniteNumber(row.gross_sales),
    refundAmount: toFiniteNumber(row.refund_amount),
    netSales: toFiniteNumber(row.net_sales),
    netTax: toFiniteNumber(row.net_tax),
    completedSaleCount: toSafeCount(row.completed_sale_count),
    refundCount: toSafeCount(row.refund_count),
    averageTicket: toFiniteNumber(row.average_ticket),
    paidOutCount: toSafeCount(row.paid_out_count),
    paidOutAmount: toFiniteNumber(row.paid_out_amount),
    safeDropCount: toSafeCount(row.safe_drop_count),
    safeDropAmount: toFiniteNumber(row.safe_drop_amount),
    noSaleCount: toSafeCount(row.no_sale_count),
    unclassifiedEventCount: toSafeCount(row.unclassified_event_count),
    totalHeaderCount: toSafeCount(row.total_header_count),
  };
}

export function getCanonicalReportSourceLabel(sourceMode: CanonicalReportSourceMode, legacyReason?: 'historical' | 'upload'): string {
  if (sourceMode === 'canonical') return 'Canonical POS';
  if (sourceMode === 'coverage_conflict') return 'Coverage Conflict';
  if (sourceMode === 'legacy') return legacyReason === 'historical' ? 'Legacy Historical' : 'Legacy Upload';
  return 'Reporting Unavailable';
}
