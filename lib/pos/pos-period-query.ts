import type { SupabaseClient } from '@supabase/supabase-js';

type PosReportPeriodType = 'day' | 'month' | 'year';

interface PosReportPeriodIdRow {
  id: string;
}

function formatQueryError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return 'Unknown query error.';
}

async function getPeriodIdsForType(
  supabase: SupabaseClient,
  storeId: string,
  periodType: PosReportPeriodType,
  start: string,
  end: string
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from('pos_report_periods')
    .select('id')
    .eq('store_id', storeId)
    .eq('period_type', periodType)
    .lte('period_open', end)
    .gte('period_close', start);

  if (error) {
    console.error('Failed to query POS report periods.', {
      periodType,
      message: formatQueryError(error),
    });
    return null;
  }

  const rows = (data ?? []) as PosReportPeriodIdRow[];
  return rows.map((row) => row.id).filter(Boolean);
}

export async function getPosReportPeriodIds(
  supabase: SupabaseClient,
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<string[]> {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const periodTypes: PosReportPeriodType[] = ['day', 'month', 'year'];

  for (const periodType of periodTypes) {
    const periodIds = await getPeriodIdsForType(supabase, storeId, periodType, start, end);
    if (periodIds === null) return [];
    if (periodIds.length > 0) return periodIds;
  }

  return [];
}

export async function getPosDataForPeriods<T>(
  supabase: SupabaseClient,
  table: string,
  periodIds: string[],
  storeId: string,
  columns: string
): Promise<T[]> {
  if (periodIds.length === 0) return [];

  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq('store_id', storeId)
    .in('report_period_id', periodIds);

  if (error) {
    console.error('Failed to query POS data for periods.', {
      table,
      message: formatQueryError(error),
    });
    return [];
  }

  return (data ?? []) as T[];
}

// Example: Merchandise tab
// const periodIds = await getPosReportPeriodIds(
//   supabase, storeId, startDate, endDate
// )
// const deptRows = await getPosDataForPeriods(
//   supabase, 'pos_department_sales',
//   periodIds, storeId,
//   'department_number, department_name, net_sales'
// )
//
// periodIds will only ever contain one period_type
// (day, month, or year - never mixed, never shift).
// This prevents double-counting across aggregation
// levels.
//
// Phase 1 limitation: if a date range spans some
// days that have day-level periods and some that
// only have month-level periods, the waterfall
// returns day-level ids and silently misses the
// month-only gaps. This undercount is acceptable
// for Phase 1. Full gap-filling is future work.
