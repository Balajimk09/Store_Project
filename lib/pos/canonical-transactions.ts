import type { SupabaseClient } from '@supabase/supabase-js';

export const CANONICAL_TRANSACTION_PAGE_SIZE = 50;
export const CANONICAL_CHILD_CHUNK_SIZE = 100;
export const CANONICAL_CHILD_ROW_PAGE_SIZE = 1000;

export type CanonicalTransactionSource = 'canonical' | 'legacy' | 'legacy-fallback';

export interface CanonicalPosTransactionHeader {
  id: string;
  store_id: string;
  owner_id: string;
  source_system: string;
  source_unique_id: string;
  canonical_record: boolean;
  store_number: string | null;
  transaction_time: string;
  business_date: string | null;
  register_number: string | null;
  physical_register_id: string | null;
  transaction_sequence: string | null;
  transaction_serial: string | null;
  terminal_message_serial: string | null;
  cashier: string | null;
  till: string | null;
  duration_seconds: number;
  transaction_type: string;
  subtotal: number;
  tax_total: number;
  total: number;
  current_total: number;
  cash_back_amount: number;
  cash_back_fee: number;
  has_cash_back: boolean;
  has_item_voids: boolean;
  item_void_count: number;
  has_rounding_adjustment: boolean;
  rounding_adjustment_count: number;
  was_recalled: boolean;
  recalled_from_ticket: string | null;
  is_fuel_transaction: boolean;
  fuel_transaction_type: string | null;
  original_ticket: string | null;
  original_source_unique_id: string | null;
  shadow_source_unique_ids: string[];
  item_count: number;
  payment_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface CanonicalPosTransactionLine {
  id: string;
  transaction_id: string;
  line_number: number;
  line_type: string;
  upc: string | null;
  description: string | null;
  department: string | null;
  network_code: string | null;
  modifier: string | null;
  quantity: number | null;
  sign: number | null;
  signed_quantity: number | null;
  selling_unit: number | null;
  unit_price: number | null;
  line_total: number | null;
  tax_base: number | null;
  tax_rate: number | null;
  void_line_index: string | null;
  is_voided: boolean;
  is_refund: boolean;
  is_fuel: boolean;
  created_at: string;
  updated_at: string;
}

export interface CanonicalPosTransactionPayment {
  id: string;
  transaction_id: string;
  payment_number: number;
  payment_code: string | null;
  amount: number;
  direction: string | null;
  card_type: string | null;
  card_last_four: string | null;
  entry_method: string | null;
  host: string | null;
  is_change: boolean;
  is_refund: boolean;
  created_at: string;
  updated_at: string;
}

export interface CanonicalPosTransactionRelationship {
  id: string;
  transaction_id: string;
  related_transaction_id: string | null;
  related_source_unique_id: string | null;
  related_ticket: string | null;
  relationship_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CanonicalTransactionTicket {
  header: CanonicalPosTransactionHeader;
  lines: CanonicalPosTransactionLine[];
  payments: CanonicalPosTransactionPayment[];
  relationships: CanonicalPosTransactionRelationship[];
}

export interface CanonicalTransactionFilters {
  search: string;
  dateFrom: string;
  dateTo: string;
  transactionType: string;
  register: string;
  cashier: string;
  paymentMethod: string;
  fuelOnly: boolean;
  hasItemVoids: boolean;
  recalledOnly: boolean;
}

export interface CanonicalTransactionPageResult {
  tickets: CanonicalTransactionTicket[];
  page: number;
  pageSize: number;
  totalHeaders: number;
  paymentFilterAppliedToVisiblePage: boolean;
}

export interface CanonicalCashEventSummary {
  eventType: 'paid_out' | 'safe_drop' | 'no_sale';
  label: string;
  amount: number;
}

type RawRecord = Record<string, unknown>;

const HEADER_SELECT = [
  'id',
  'store_id',
  'owner_id',
  'source_system',
  'source_unique_id',
  'canonical_record',
  'store_number',
  'transaction_time',
  'business_date',
  'register_number',
  'physical_register_id',
  'transaction_sequence',
  'transaction_serial',
  'terminal_message_serial',
  'cashier',
  'till',
  'duration_seconds',
  'transaction_type',
  'subtotal',
  'tax_total',
  'total',
  'current_total',
  'cash_back_amount',
  'cash_back_fee',
  'has_cash_back',
  'has_item_voids',
  'item_void_count',
  'has_rounding_adjustment',
  'rounding_adjustment_count',
  'was_recalled',
  'recalled_from_ticket',
  'is_fuel_transaction',
  'fuel_transaction_type',
  'original_ticket',
  'original_source_unique_id',
  'shadow_source_unique_ids',
  'item_count',
  'payment_count',
  'first_seen_at',
  'last_seen_at',
  'created_at',
  'updated_at',
].join(',');

const LINE_SELECT = [
  'id',
  'transaction_id',
  'line_number',
  'line_type',
  'upc',
  'description',
  'department',
  'network_code',
  'modifier',
  'quantity',
  'sign',
  'signed_quantity',
  'selling_unit',
  'unit_price',
  'line_total',
  'tax_base',
  'tax_rate',
  'void_line_index',
  'is_voided',
  'is_refund',
  'is_fuel',
  'created_at',
  'updated_at',
].join(',');

const PAYMENT_SELECT = [
  'id',
  'transaction_id',
  'payment_number',
  'payment_code',
  'amount',
  'direction',
  'card_type',
  'card_last_four',
  'entry_method',
  'host',
  'is_change',
  'is_refund',
  'created_at',
  'updated_at',
].join(',');

const RELATIONSHIP_SELECT = [
  'id',
  'transaction_id',
  'related_transaction_id',
  'related_source_unique_id',
  'related_ticket',
  'relationship_type',
  'metadata',
  'created_at',
].join(',');

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return toFiniteNumber(value, 0);
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function toMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

export function normalizeMoney(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
}

export function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[%_,()'"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveSafeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    // Store timezone data can be user-entered; fall back explicitly instead of using the browser locale.
    return 'UTC';
  }
}

export function mapCanonicalHeader(row: RawRecord): CanonicalPosTransactionHeader {
  return {
    id: toStringValue(row.id),
    store_id: toStringValue(row.store_id),
    owner_id: toStringValue(row.owner_id),
    source_system: toStringValue(row.source_system),
    source_unique_id: toStringValue(row.source_unique_id),
    canonical_record: toBoolean(row.canonical_record),
    store_number: toNullableString(row.store_number),
    transaction_time: toStringValue(row.transaction_time),
    business_date: toNullableString(row.business_date),
    register_number: toNullableString(row.register_number),
    physical_register_id: toNullableString(row.physical_register_id),
    transaction_sequence: toNullableString(row.transaction_sequence),
    transaction_serial: toNullableString(row.transaction_serial),
    terminal_message_serial: toNullableString(row.terminal_message_serial),
    cashier: toNullableString(row.cashier),
    till: toNullableString(row.till),
    duration_seconds: toFiniteNumber(row.duration_seconds),
    transaction_type: toStringValue(row.transaction_type, 'unknown'),
    subtotal: toFiniteNumber(row.subtotal),
    tax_total: toFiniteNumber(row.tax_total),
    total: toFiniteNumber(row.total),
    current_total: toFiniteNumber(row.current_total),
    cash_back_amount: toFiniteNumber(row.cash_back_amount),
    cash_back_fee: toFiniteNumber(row.cash_back_fee),
    has_cash_back: toBoolean(row.has_cash_back),
    has_item_voids: toBoolean(row.has_item_voids),
    item_void_count: Math.max(0, Math.trunc(toFiniteNumber(row.item_void_count))),
    has_rounding_adjustment: toBoolean(row.has_rounding_adjustment),
    rounding_adjustment_count: Math.max(0, Math.trunc(toFiniteNumber(row.rounding_adjustment_count))),
    was_recalled: toBoolean(row.was_recalled),
    recalled_from_ticket: toNullableString(row.recalled_from_ticket),
    is_fuel_transaction: toBoolean(row.is_fuel_transaction),
    fuel_transaction_type: toNullableString(row.fuel_transaction_type),
    original_ticket: toNullableString(row.original_ticket),
    original_source_unique_id: toNullableString(row.original_source_unique_id),
    shadow_source_unique_ids: toStringArray(row.shadow_source_unique_ids),
    item_count: Math.max(0, Math.trunc(toFiniteNumber(row.item_count))),
    payment_count: Math.max(0, Math.trunc(toFiniteNumber(row.payment_count))),
    first_seen_at: toStringValue(row.first_seen_at),
    last_seen_at: toStringValue(row.last_seen_at),
    created_at: toStringValue(row.created_at),
    updated_at: toStringValue(row.updated_at),
  };
}

export function mapCanonicalLine(row: RawRecord): CanonicalPosTransactionLine {
  return {
    id: toStringValue(row.id),
    transaction_id: toStringValue(row.transaction_id),
    line_number: Math.trunc(toFiniteNumber(row.line_number)),
    line_type: toStringValue(row.line_type, 'unknown'),
    upc: toNullableString(row.upc),
    description: toNullableString(row.description),
    department: toNullableString(row.department),
    network_code: toNullableString(row.network_code),
    modifier: toNullableString(row.modifier),
    quantity: toNullableFiniteNumber(row.quantity),
    sign: toNullableFiniteNumber(row.sign),
    signed_quantity: toNullableFiniteNumber(row.signed_quantity),
    selling_unit: toNullableFiniteNumber(row.selling_unit),
    unit_price: toNullableFiniteNumber(row.unit_price),
    line_total: toNullableFiniteNumber(row.line_total),
    tax_base: toNullableFiniteNumber(row.tax_base),
    tax_rate: toNullableFiniteNumber(row.tax_rate),
    void_line_index: toNullableString(row.void_line_index),
    is_voided: toBoolean(row.is_voided),
    is_refund: toBoolean(row.is_refund),
    is_fuel: toBoolean(row.is_fuel),
    created_at: toStringValue(row.created_at),
    updated_at: toStringValue(row.updated_at),
  };
}

export function mapCanonicalPayment(row: RawRecord): CanonicalPosTransactionPayment {
  return {
    id: toStringValue(row.id),
    transaction_id: toStringValue(row.transaction_id),
    payment_number: Math.trunc(toFiniteNumber(row.payment_number)),
    payment_code: toNullableString(row.payment_code),
    amount: toFiniteNumber(row.amount),
    direction: toNullableString(row.direction),
    card_type: toNullableString(row.card_type),
    card_last_four: toNullableString(row.card_last_four),
    entry_method: toNullableString(row.entry_method),
    host: toNullableString(row.host),
    is_change: toBoolean(row.is_change),
    is_refund: toBoolean(row.is_refund),
    created_at: toStringValue(row.created_at),
    updated_at: toStringValue(row.updated_at),
  };
}

export function mapCanonicalRelationship(row: RawRecord): CanonicalPosTransactionRelationship {
  return {
    id: toStringValue(row.id),
    transaction_id: toStringValue(row.transaction_id),
    related_transaction_id: toNullableString(row.related_transaction_id),
    related_source_unique_id: toNullableString(row.related_source_unique_id),
    related_ticket: toNullableString(row.related_ticket),
    relationship_type: toStringValue(row.relationship_type, 'unknown'),
    metadata: toMetadata(row.metadata),
    created_at: toStringValue(row.created_at),
  };
}

export function isChangePayment(payment: CanonicalPosTransactionPayment): boolean {
  return payment.is_change || payment.payment_code?.trim().toLowerCase() === 'change' || payment.direction === 'cash_out';
}

export function getPaymentDirectionLabel(direction: string | null): string {
  switch (direction) {
    case 'cash_paid_out':
      return 'Cash Paid Out';
    case 'cash_to_safe':
      return 'Cash to Safe';
    case 'received_from_customer':
      return 'Received from Customer';
    case 'refund_to_customer':
      return 'Refunded to Customer';
    case 'cash_out':
      return 'Cash Out / Change';
    default:
      return direction ? humanizeIdentifier(direction) : '—';
  }
}

export function getCanonicalCashEventSummary(ticket: CanonicalTransactionTicket): CanonicalCashEventSummary | null {
  const type = ticket.header.transaction_type;
  const paidOutPayments = ticket.payments.filter((payment) => payment.direction === 'cash_paid_out');
  const safeDropPayments = ticket.payments.filter((payment) => payment.direction === 'cash_to_safe');

  // Reporting semantics: paid_out is excluded from sales/payment-method mix and belongs in cash-management payout reporting.
  if (type === 'paid_out' || paidOutPayments.length > 0) {
    const sourcePayments = paidOutPayments.length ? paidOutPayments : ticket.payments;
    return {
      eventType: 'paid_out',
      label: 'Paid Out',
      amount: normalizeMoney(sourcePayments.reduce((sum, payment) => sum + Math.abs(payment.amount), 0)),
    };
  }

  // Reporting semantics: safe_drop is excluded from sales/payment-method mix and belongs in drawer-to-safe reporting.
  if (type === 'safe_drop' || safeDropPayments.length > 0) {
    const sourcePayments = safeDropPayments.length ? safeDropPayments : ticket.payments;
    return {
      eventType: 'safe_drop',
      label: 'Safe Drop',
      amount: normalizeMoney(sourcePayments.reduce((sum, payment) => sum + Math.abs(payment.amount), 0)),
    };
  }

  // Reporting semantics: no_sale is excluded from sales and belongs in cashier-exception reporting.
  if (type === 'no_sale' && !ticket.payments.some((payment) => !isChangePayment(payment))) {
    return {
      eventType: 'no_sale',
      label: 'No cash movement',
      amount: 0,
    };
  }

  return null;
}

export function normalizePaymentLabel(payment: CanonicalPosTransactionPayment): string {
  const code = payment.payment_code?.trim();
  const codeLower = code?.toLowerCase() ?? '';
  const card = payment.card_type?.trim() || payment.host?.trim();

  if (card && codeLower.includes('credit')) return `${card} Credit`;
  if (card && codeLower.includes('debit')) return `${card} Debit`;
  if (codeLower === 'cash') return 'Cash';
  if (codeLower === 'debit') return card ? `${card} Debit` : 'Debit';
  if (codeLower === 'credit') return card ? `${card} Credit` : 'Credit';
  if (codeLower.includes('ebt')) return 'EBT';
  if (codeLower.includes('mobile') || codeLower.includes('apple') || codeLower.includes('google')) return 'Mobile';
  if (codeLower.includes('house')) return 'In-House';
  return card || code || 'Other';
}

function isCanonicalTransactionTicket(value: CanonicalPosTransactionPayment[] | CanonicalTransactionTicket): value is CanonicalTransactionTicket {
  return !Array.isArray(value);
}

export function buildPaymentSummary(paymentsOrTicket: CanonicalPosTransactionPayment[] | CanonicalTransactionTicket, includeAmounts = false): string {
  const cashEvent = isCanonicalTransactionTicket(paymentsOrTicket) ? getCanonicalCashEventSummary(paymentsOrTicket) : null;
  if (cashEvent) {
    if (cashEvent.eventType === 'no_sale') return cashEvent.label;
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cashEvent.amount);
    return `${cashEvent.label} ${formatted}`;
  }

  const payments = isCanonicalTransactionTicket(paymentsOrTicket) ? paymentsOrTicket.payments : paymentsOrTicket;
  const totals = new Map<string, number>();

  payments.forEach((payment) => {
    const label = normalizePaymentLabel(payment);
    const current = totals.get(label) ?? 0;
    if (isChangePayment(payment)) {
      const cashCurrent = totals.get('Cash') ?? 0;
      totals.set('Cash', normalizeMoney(cashCurrent - Math.abs(payment.amount)));
      return;
    }
    totals.set(label, normalizeMoney(current + payment.amount));
  });

  const entries = Array.from(totals.entries())
    .filter(([, amount]) => Math.abs(amount) > 0.004)
    .sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) return 'No payment';
  if (!includeAmounts) return entries.map(([label]) => label).join(' + ');

  return entries
    .map(([label, amount]) => `${label} ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)}`)
    .join(' + ');
}

export function getCanonicalTicketId(header: CanonicalPosTransactionHeader): string {
  return header.transaction_sequence || header.transaction_serial || header.source_unique_id;
}

export function getCanonicalRegister(header: CanonicalPosTransactionHeader): string {
  return header.register_number || header.physical_register_id || header.till || 'Unknown';
}

export function getCanonicalCashier(header: CanonicalPosTransactionHeader): string {
  return header.cashier || 'Unknown Cashier';
}

export function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getTransactionTypeDisplay(transactionType: string): {
  label: string;
  tone: 'sale' | 'refund' | 'void' | 'fuel' | 'review' | 'neutral' | 'cash-warning' | 'cash-neutral';
  indicator: string | null;
} {
  switch (transactionType) {
    case 'completed_sale':
      return { label: 'Sale', tone: 'sale', indicator: null };
    case 'completed_sale_with_item_void':
      return { label: 'Sale with Item Void', tone: 'sale', indicator: 'Item void' };
    case 'completed_recalled_sale':
      return { label: 'Recalled Sale', tone: 'sale', indicator: 'Recalled' };
    case 'fuel_pay_at_pump':
      return { label: 'Fuel Pay at Pump', tone: 'fuel', indicator: 'Fuel' };
    case 'fuel_prepay_completed':
      return { label: 'Fuel Prepay Completed', tone: 'fuel', indicator: 'Fuel' };
    case 'refund':
      return { label: 'Refund', tone: 'refund', indicator: null };
    case 'void':
      return { label: 'Voided Ticket', tone: 'void', indicator: null };
    case 'paid_out':
      return { label: 'Paid Out', tone: 'cash-warning', indicator: 'Paid Out' };
    case 'safe_drop':
      return { label: 'Safe Drop', tone: 'cash-neutral', indicator: 'Safe Drop' };
    case 'no_sale':
      return { label: 'No Sale', tone: 'review', indicator: 'No Sale' };
    case 'zero_value_event':
      // Reporting semantics: zero_value_event is excluded from sales and belongs in unclassified/review reporting.
      return { label: 'Unclassified Event', tone: 'review', indicator: 'Unclassified Event' };
    default:
      return { label: humanizeIdentifier(transactionType || 'unknown'), tone: 'neutral', indicator: 'Unclassified' };
  }
}

export function localDateBoundaryToUtcIso(dateValue: string, timeZone: string, addDays = 0): string | null {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  const safeTimeZone = resolveSafeTimeZone(timeZone);
  const baseUtc = new Date(Date.UTC(year, month - 1, day + addDays, 0, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(baseUtc);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const zonedAsUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  const offsetMs = zonedAsUtc - baseUtc.getTime();
  return new Date(baseUtc.getTime() - offsetMs).toISOString();
}

export async function fetchCanonicalAvailability(client: SupabaseClient, storeId: string): Promise<boolean> {
  const { error, count } = await client
    .from('pos_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('canonical_record', true);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function fetchCanonicalTransactionPage(
  client: SupabaseClient,
  params: {
    storeId: string;
    page: number;
    pageSize?: number;
    filters: CanonicalTransactionFilters;
    timeZone: string;
  }
): Promise<CanonicalTransactionPageResult> {
  const pageSize = params.pageSize ?? CANONICAL_TRANSACTION_PAGE_SIZE;
  const from = Math.max(0, params.page) * pageSize;
  const to = from + pageSize - 1;
  const safeTimeZone = resolveSafeTimeZone(params.timeZone);
  const fromIso = localDateBoundaryToUtcIso(params.filters.dateFrom, safeTimeZone);
  const toIso = localDateBoundaryToUtcIso(params.filters.dateTo, safeTimeZone, 1);

  let query = client
    .from('pos_transactions')
    .select(HEADER_SELECT, { count: 'exact' })
    .eq('store_id', params.storeId)
    .eq('canonical_record', true)
    .order('transaction_time', { ascending: false })
    .range(from, to);

  if (fromIso) query = query.gte('transaction_time', fromIso);
  if (toIso) query = query.lt('transaction_time', toIso);
  if (params.filters.transactionType !== 'all') query = query.eq('transaction_type', params.filters.transactionType);
  if (params.filters.register.trim()) query = query.ilike('register_number', `%${params.filters.register.trim()}%`);
  if (params.filters.cashier.trim()) query = query.ilike('cashier', `%${params.filters.cashier.trim()}%`);
  if (params.filters.fuelOnly) query = query.eq('is_fuel_transaction', true);
  if (params.filters.hasItemVoids) query = query.eq('has_item_voids', true);
  if (params.filters.recalledOnly) query = query.eq('was_recalled', true);

  const search = sanitizeSearchTerm(params.filters.search);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(
      [
        `source_unique_id.ilike.${pattern}`,
        `transaction_sequence.ilike.${pattern}`,
        `transaction_serial.ilike.${pattern}`,
        `cashier.ilike.${pattern}`,
        `register_number.ilike.${pattern}`,
      ].join(',')
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const headers = ((data ?? []) as unknown as RawRecord[]).map(mapCanonicalHeader);
  const ids = headers.map((header) => header.id);

  const [lines, payments, relationships] = await Promise.all([
    fetchCanonicalLines(client, params.storeId, ids),
    fetchCanonicalPayments(client, params.storeId, ids),
    fetchCanonicalRelationships(client, params.storeId, ids),
  ]);

  const linesByTransaction = groupByTransaction(lines);
  const paymentsByTransaction = groupByTransaction(payments);
  const relationshipsByTransaction = groupByTransaction(relationships);
  const paymentFilter = params.filters.paymentMethod.trim().toLowerCase();

  const tickets = headers
    .map((header) => ({
      header,
      lines: (linesByTransaction.get(header.id) ?? []).sort((a, b) => a.line_number - b.line_number),
      payments: (paymentsByTransaction.get(header.id) ?? []).sort((a, b) => a.payment_number - b.payment_number),
      relationships: relationshipsByTransaction.get(header.id) ?? [],
    }))
    .filter((ticket) => {
      if (!paymentFilter || paymentFilter === 'all') return true;
      return ticket.payments.some((payment) => !isChangePayment(payment) && normalizePaymentLabel(payment).toLowerCase().includes(paymentFilter));
    });

  return {
    tickets,
    page: params.page,
    pageSize,
    totalHeaders: count ?? headers.length,
    paymentFilterAppliedToVisiblePage: Boolean(paymentFilter && paymentFilter !== 'all'),
  };
}

async function fetchCanonicalLines(client: SupabaseClient, storeId: string, transactionIds: string[]): Promise<CanonicalPosTransactionLine[]> {
  if (!transactionIds.length) return [];
  const rows: CanonicalPosTransactionLine[] = [];
  for (const chunk of chunkIds(transactionIds, CANONICAL_CHILD_CHUNK_SIZE)) {
    for (let start = 0, iteration = 0; iteration < 200; start += CANONICAL_CHILD_ROW_PAGE_SIZE, iteration += 1) {
      const { data, error } = await client
        .from('pos_transaction_lines')
        .select(LINE_SELECT)
        .eq('store_id', storeId)
        .in('transaction_id', chunk)
        .order('transaction_id', { ascending: true })
        .order('line_number', { ascending: true })
        .range(start, start + CANONICAL_CHILD_ROW_PAGE_SIZE - 1);
      if (error) throw error;
      const pageRows = ((data ?? []) as unknown as RawRecord[]).map(mapCanonicalLine);
      rows.push(...pageRows);
      if (pageRows.length < CANONICAL_CHILD_ROW_PAGE_SIZE) break;
    }
  }
  return rows;
}

async function fetchCanonicalPayments(client: SupabaseClient, storeId: string, transactionIds: string[]): Promise<CanonicalPosTransactionPayment[]> {
  if (!transactionIds.length) return [];
  const rows: CanonicalPosTransactionPayment[] = [];
  for (const chunk of chunkIds(transactionIds, CANONICAL_CHILD_CHUNK_SIZE)) {
    for (let start = 0, iteration = 0; iteration < 200; start += CANONICAL_CHILD_ROW_PAGE_SIZE, iteration += 1) {
      const { data, error } = await client
        .from('pos_transaction_payments')
        .select(PAYMENT_SELECT)
        .eq('store_id', storeId)
        .in('transaction_id', chunk)
        .order('transaction_id', { ascending: true })
        .order('payment_number', { ascending: true })
        .range(start, start + CANONICAL_CHILD_ROW_PAGE_SIZE - 1);
      if (error) throw error;
      const pageRows = ((data ?? []) as unknown as RawRecord[]).map(mapCanonicalPayment);
      rows.push(...pageRows);
      if (pageRows.length < CANONICAL_CHILD_ROW_PAGE_SIZE) break;
    }
  }
  return rows;
}

async function fetchCanonicalRelationships(client: SupabaseClient, storeId: string, transactionIds: string[]): Promise<CanonicalPosTransactionRelationship[]> {
  if (!transactionIds.length) return [];
  const rows: CanonicalPosTransactionRelationship[] = [];
  for (const chunk of chunkIds(transactionIds, CANONICAL_CHILD_CHUNK_SIZE)) {
    for (let start = 0, iteration = 0; iteration < 200; start += CANONICAL_CHILD_ROW_PAGE_SIZE, iteration += 1) {
      const { data, error } = await client
        .from('pos_transaction_relationships')
        .select(RELATIONSHIP_SELECT)
        .eq('store_id', storeId)
        .in('transaction_id', chunk)
        .order('transaction_id', { ascending: true })
        .order('created_at', { ascending: true })
        .range(start, start + CANONICAL_CHILD_ROW_PAGE_SIZE - 1);
      if (error) throw error;
      const pageRows = ((data ?? []) as unknown as RawRecord[]).map(mapCanonicalRelationship);
      rows.push(...pageRows);
      if (pageRows.length < CANONICAL_CHILD_ROW_PAGE_SIZE) break;
    }
  }
  return rows;
}

function groupByTransaction<T extends { transaction_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  rows.forEach((row) => {
    const existing = grouped.get(row.transaction_id) ?? [];
    existing.push(row);
    grouped.set(row.transaction_id, existing);
  });
  return grouped;
}
