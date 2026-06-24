import { NextRequest, NextResponse } from 'next/server';
import { createAdminAuditLog } from '@/lib/audit-log';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type VendorSource = 'store' | 'global';
type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly';

type StoreDisplayRow = {
  id: string;
  store_name: string | null;
  business_legal_name: string | null;
  dba_name: string | null;
  primary_owner_email: string | null;
};

type StoreVendorDbRow = {
  id: string;
  store_id: string;
  vendor_name: string;
  sales_rep_name: string | null;
  phone: string | null;
  email: string | null;
  website?: string | null;
  category?: string | null;
  notes: string | null;
  is_active: boolean | null;
  order_days?: string[] | null;
  delivery_days?: string[] | null;
  expected_invoice_amount?: number | string | null;
  payment_terms?: string | null;
  schedule_frequency?: ScheduleFrequency | null;
  notification_enabled?: boolean | null;
  created_at?: string | null;
  updated_at: string | null;
};

type GlobalVendorDbRow = Omit<StoreVendorDbRow, 'store_id'> & {
  created_by?: string | null;
  website: string | null;
  category: string | null;
  order_days: string[] | null;
  delivery_days: string[] | null;
  expected_invoice_amount: number | string | null;
  payment_terms: string | null;
  schedule_frequency: ScheduleFrequency | null;
  notification_enabled: boolean | null;
  created_at: string | null;
};

type VendorRow = {
  id: string;
  source: VendorSource;
  store_id: string | null;
  store_name: string | null;
  vendor_name: string;
  sales_rep_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  is_active: boolean;
  order_days: string[];
  delivery_days: string[];
  expected_invoice_amount: number | null;
  payment_terms: string | null;
  schedule_frequency: ScheduleFrequency | null;
  notification_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const VALID_WEEKDAYS = new Set<string>(WEEKDAYS);
const VALID_SCHEDULE_FREQUENCIES = new Set<string>(['weekly', 'biweekly', 'monthly']);

const STORE_VENDOR_SELECT_WITH_OPTIONAL_COLUMNS =
  'id, store_id, vendor_name, sales_rep_name, phone, email, website, category, notes, is_active, order_days, delivery_days, expected_invoice_amount, payment_terms, schedule_frequency, notification_enabled, created_at, updated_at';
const STORE_VENDOR_SELECT_BASE =
  'id, store_id, vendor_name, sales_rep_name, phone, email, notes, is_active, updated_at';
const GLOBAL_VENDOR_SELECT =
  'id, vendor_name, sales_rep_name, phone, email, website, category, notes, is_active, order_days, delivery_days, expected_invoice_amount, payment_terms, schedule_frequency, notification_enabled, created_by, created_at, updated_at';
const STORES_DISPLAY_SELECT =
  'id, store_name, business_legal_name, dba_name, primary_owner_email';

function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function activeParam(value: string | null) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function typeParam(value: string | null): VendorSource | '' {
  return value === 'store' || value === 'global' ? value : '';
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'active', '1'].includes(normalized)) return true;
    if (['false', 'no', 'inactive', '0'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeWeekdays(value: unknown) {
  const rawDays = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[|,]/)
      : [];

  return rawDays
    .map((day) => (typeof day === 'string' ? day.trim() : ''))
    .filter((day): day is string => VALID_WEEKDAYS.has(day));
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scheduleFrequencyOrDefault(value: unknown): ScheduleFrequency {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (VALID_SCHEDULE_FREQUENCIES.has(normalized)) {
      return normalized as ScheduleFrequency;
    }
  }

  return 'weekly';
}

function storeDisplayName(store: StoreDisplayRow | undefined) {
  return (
    store?.store_name ||
    store?.business_legal_name ||
    store?.dba_name ||
    store?.primary_owner_email ||
    'Unknown Store'
  );
}

function normalizeAmount(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStoreVendor(
  row: StoreVendorDbRow,
  storeNames: Map<string, string> = new Map()
): VendorRow {
  return {
    id: row.id,
    source: 'store',
    store_id: row.store_id,
    store_name: storeNames.get(row.store_id) || 'Unknown Store',
    vendor_name: row.vendor_name,
    sales_rep_name: row.sales_rep_name,
    phone: row.phone,
    email: row.email,
    website: row.website || null,
    category: row.category || null,
    notes: row.notes,
    is_active: row.is_active !== false,
    order_days: Array.isArray(row.order_days) ? row.order_days : [],
    delivery_days: Array.isArray(row.delivery_days) ? row.delivery_days : [],
    expected_invoice_amount: normalizeAmount(row.expected_invoice_amount),
    payment_terms: row.payment_terms || null,
    schedule_frequency: scheduleFrequencyOrDefault(row.schedule_frequency),
    notification_enabled: row.notification_enabled !== false,
    created_at: row.created_at || null,
    updated_at: row.updated_at,
  };
}

function normalizeGlobalVendor(row: GlobalVendorDbRow): VendorRow {
  return {
    id: row.id,
    source: 'global',
    store_id: null,
    store_name: null,
    vendor_name: row.vendor_name,
    sales_rep_name: row.sales_rep_name,
    phone: row.phone,
    email: row.email,
    website: row.website,
    category: row.category,
    notes: row.notes,
    is_active: row.is_active !== false,
    order_days: Array.isArray(row.order_days) ? row.order_days : [],
    delivery_days: Array.isArray(row.delivery_days) ? row.delivery_days : [],
    expected_invoice_amount: normalizeAmount(row.expected_invoice_amount),
    payment_terms: row.payment_terms,
    schedule_frequency: scheduleFrequencyOrDefault(row.schedule_frequency),
    notification_enabled: row.notification_enabled !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function applySearch<T extends { or: (filters: string) => T }>(
  query: T,
  search: string,
  includeCategory: boolean
) {
  if (!search) return query;

  const escaped = search.replace(/[%_,]/g, '\\$&');
  const fields = ['vendor_name', 'email', 'phone', 'sales_rep_name'];
  if (includeCategory) fields.push('category');

  return query.or(fields.map((field) => `${field}.ilike.%${escaped}%`).join(','));
}

async function loadStoreNames(storeIds: string[]) {
  const uniqueStoreIds = Array.from(new Set(storeIds.filter(Boolean)));
  const storeNames = new Map<string, string>();

  if (uniqueStoreIds.length === 0) return storeNames;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select(STORES_DISPLAY_SELECT)
    .in('id', uniqueStoreIds);

  if (error) throw new Error(error.message);

  for (const store of (data || []) as StoreDisplayRow[]) {
    storeNames.set(store.id, storeDisplayName(store));
  }

  return storeNames;
}

function buildVendorPayload(body: Record<string, unknown>) {
  return {
    vendor_name: textOrNull(body.vendor_name),
    sales_rep_name: textOrNull(body.sales_rep_name),
    phone: textOrNull(body.phone),
    email: textOrNull(body.email),
    website: textOrNull(body.website),
    category: textOrNull(body.category),
    notes: textOrNull(body.notes),
    is_active: booleanValue(body.is_active, true),
    order_days: normalizeWeekdays(body.order_days),
    delivery_days: normalizeWeekdays(body.delivery_days),
    expected_invoice_amount: numberOrNull(body.expected_invoice_amount),
    payment_terms: textOrNull(body.payment_terms),
    schedule_frequency: scheduleFrequencyOrDefault(body.schedule_frequency),
    notification_enabled: booleanValue(body.notification_enabled, true),
  };
}

async function fetchStoreVendors(input: {
  search: string;
  storeId: string | null;
  active: boolean | null;
  page?: number;
  limit?: number;
  paginate: boolean;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const from = input.page && input.limit ? input.page * input.limit : 0;
  const to = input.limit ? from + input.limit - 1 : 9999;

  const runQuery = async (select: string, includeCategorySearch: boolean) => {
    let query = supabaseAdmin
      .from('store_vendors')
      .select(select, { count: 'exact' })
      .order('vendor_name', { ascending: true });

    if (input.storeId) query = query.eq('store_id', input.storeId);
    if (input.active !== null) query = query.eq('is_active', input.active);
    query = applySearch(query, input.search, includeCategorySearch);
    if (input.paginate) query = query.range(from, to);

    return query;
  };

  const withOptionalColumns = await runQuery(STORE_VENDOR_SELECT_WITH_OPTIONAL_COLUMNS, true);
  const result = withOptionalColumns.error
    ? await runQuery(STORE_VENDOR_SELECT_BASE, false)
    : withOptionalColumns;

  if (result.error) throw new Error(result.error.message);

  const rows = (result.data || []) as unknown as StoreVendorDbRow[];
  const storeNames = await loadStoreNames(rows.map((row) => row.store_id));

  return {
    vendors: rows.map((row) => normalizeStoreVendor(row, storeNames)),
    total: result.count || 0,
  };
}

async function fetchGlobalVendors(input: {
  search: string;
  active: boolean | null;
  page?: number;
  limit?: number;
  paginate: boolean;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const from = input.page && input.limit ? input.page * input.limit : 0;
  const to = input.limit ? from + input.limit - 1 : 9999;

  let query = supabaseAdmin
    .from('global_vendors')
    .select(GLOBAL_VENDOR_SELECT, { count: 'exact' })
    .order('vendor_name', { ascending: true });

  if (input.active !== null) query = query.eq('is_active', input.active);
  query = applySearch(query, input.search, true);
  if (input.paginate) query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    vendors: ((data || []) as unknown as GlobalVendorDbRow[]).map(normalizeGlobalVendor),
    total: count || 0,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const page = numberParam(searchParams.get('page'), 0);
  const limit = Math.min(numberParam(searchParams.get('limit'), 50), 100);
  const search = (searchParams.get('search') || '').trim();
  const storeId = textOrNull(searchParams.get('store_id'));
  const active = activeParam(searchParams.get('is_active'));
  const type = typeParam(searchParams.get('type'));

  try {
    if (type === 'store') {
      const result = await fetchStoreVendors({
        search,
        storeId,
        active,
        page,
        limit,
        paginate: true,
      });
      return NextResponse.json({ vendors: result.vendors, total: result.total, page, limit });
    }

    if (type === 'global') {
      const result = await fetchGlobalVendors({ search, active, page, limit, paginate: true });
      return NextResponse.json({ vendors: result.vendors, total: result.total, page, limit });
    }

    const [globalResult, storeResult] = await Promise.all([
      fetchGlobalVendors({ search, active, paginate: false }),
      fetchStoreVendors({ search, storeId, active, paginate: false }),
    ]);
    const vendors = [...globalResult.vendors, ...storeResult.vendors].sort((a, b) =>
      a.vendor_name.localeCompare(b.vendor_name)
    );
    const total = vendors.length;
    const start = page * limit;

    return NextResponse.json({
      vendors: vendors.slice(start, start + limit),
      total,
      page,
      limit,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load vendors.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const type = typeParam(textOrNull(body.type));
  const vendorName = textOrNull(body.vendor_name);

  if (!vendorName) {
    return NextResponse.json({ error: 'Vendor name is required.' }, { status: 400 });
  }

  if (!type) {
    return NextResponse.json({ error: 'Vendor type is required.' }, { status: 400 });
  }

  const payload = buildVendorPayload(body);
  const supabaseAdmin = getSupabaseAdmin();

  try {
    if (type === 'global') {
      const { data, error } = await supabaseAdmin
        .from('global_vendors')
        .insert({ ...payload, created_by: auth.user.id })
        .select(GLOBAL_VENDOR_SELECT)
        .single();

      if (error) throw new Error(error.message);

      const vendor = normalizeGlobalVendor(data as unknown as GlobalVendorDbRow);
      await createAdminAuditLog({
        actorUserId: auth.user.id,
        action: 'vendors.created',
        targetTable: 'global_vendors',
        targetRecordId: vendor.id,
        newValues: vendor,
        metadata: { source: 'global' },
        reason: `Created global vendor "${vendor.vendor_name}"`,
      });

      return NextResponse.json({ vendor, message: 'Vendor created successfully.' });
    }

    const storeId = textOrNull(body.store_id);
    if (!storeId) {
      return NextResponse.json({ error: 'Store is required for store vendors.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('store_vendors')
      .insert({ ...payload, store_id: storeId })
      .select(STORE_VENDOR_SELECT_WITH_OPTIONAL_COLUMNS)
      .single();

    if (error) throw new Error(error.message);

    const storeNames = await loadStoreNames([storeId]);
    const vendor = normalizeStoreVendor(data as unknown as StoreVendorDbRow, storeNames);
    await createAdminAuditLog({
      actorUserId: auth.user.id,
      action: 'vendors.created',
      targetStoreId: vendor.store_id,
      targetTable: 'store_vendors',
      targetRecordId: vendor.id,
      newValues: vendor,
      metadata: { source: 'store' },
      reason: `Created store vendor "${vendor.vendor_name}"`,
    });

    return NextResponse.json({ vendor, message: 'Vendor created successfully.' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create vendor.' },
      { status: 500 }
    );
  }
}
