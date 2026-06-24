import { NextRequest, NextResponse } from 'next/server';
import { createAdminAuditLog } from '@/lib/audit-log';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type RouteContext = { params: { vendorId: string } };
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

const STORE_VENDOR_SELECT =
  'id, store_id, vendor_name, sales_rep_name, phone, email, website, category, notes, is_active, order_days, delivery_days, expected_invoice_amount, payment_terms, schedule_frequency, notification_enabled, created_at, updated_at';
const GLOBAL_VENDOR_SELECT =
  'id, vendor_name, sales_rep_name, phone, email, website, category, notes, is_active, order_days, delivery_days, expected_invoice_amount, payment_terms, schedule_frequency, notification_enabled, created_at, updated_at';
const STORES_DISPLAY_SELECT =
  'id, store_name, business_legal_name, dba_name, primary_owner_email';

const UPDATE_FIELDS = [
  'vendor_name',
  'sales_rep_name',
  'phone',
  'email',
  'website',
  'category',
  'notes',
  'is_active',
  'order_days',
  'delivery_days',
  'expected_invoice_amount',
  'payment_terms',
  'schedule_frequency',
  'notification_enabled',
] as const;

function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sourceParam(value: string | null): VendorSource | null {
  return value === 'store' || value === 'global' ? value : null;
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

function normalizeAmount(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

async function loadStoreName(storeId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select(STORES_DISPLAY_SELECT)
    .eq('id', storeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return storeDisplayName((data as StoreDisplayRow | null) || undefined);
}

function normalizeStoreVendor(row: StoreVendorDbRow, storeName: string) {
  return {
    id: row.id,
    source: 'store' as const,
    store_id: row.store_id,
    store_name: storeName,
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

function normalizeGlobalVendor(row: GlobalVendorDbRow) {
  return {
    id: row.id,
    source: 'global' as const,
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

function cleanUpdateValue(field: (typeof UPDATE_FIELDS)[number], value: unknown) {
  if (field === 'is_active' || field === 'notification_enabled') {
    return booleanValue(value, true);
  }

  if (field === 'order_days' || field === 'delivery_days') {
    return normalizeWeekdays(value);
  }

  if (field === 'expected_invoice_amount') {
    return numberOrNull(value);
  }

  if (field === 'schedule_frequency') {
    return scheduleFrequencyOrDefault(value);
  }

  if (field === 'vendor_name') {
    return textOrNull(value) || '';
  }

  return textOrNull(value);
}

function buildUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const field of UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = cleanUpdateValue(field, body[field]);
    }
  }

  payload.updated_at = new Date().toISOString();
  return payload;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const source = sourceParam(textOrNull(body.source));

  if (!source) {
    return NextResponse.json({ error: 'Vendor source is required.' }, { status: 400 });
  }

  const payload = buildUpdatePayload(body);
  if (
    Object.prototype.hasOwnProperty.call(payload, 'vendor_name') &&
    typeof payload.vendor_name === 'string' &&
    !payload.vendor_name
  ) {
    return NextResponse.json({ error: 'Vendor name is required.' }, { status: 400 });
  }

  if (Object.keys(payload).length === 1) {
    return NextResponse.json({ error: 'No supported fields to update.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  try {
    if (source === 'global') {
      const { data: oldVendor } = await supabaseAdmin
        .from('global_vendors')
        .select('*')
        .eq('id', context.params.vendorId)
        .maybeSingle();

      const { data, error } = await supabaseAdmin
        .from('global_vendors')
        .update(payload)
        .eq('id', context.params.vendorId)
        .select(GLOBAL_VENDOR_SELECT)
        .single();

      if (error) throw new Error(error.message);

      const vendor = normalizeGlobalVendor(data as unknown as GlobalVendorDbRow);

      await createAdminAuditLog({
        actorUserId: auth.user.id,
        action: 'vendors.updated',
        targetTable: 'global_vendors',
        targetRecordId: vendor.id,
        oldValues: (oldVendor as Record<string, unknown> | null) || null,
        newValues: vendor,
        metadata: { source },
        reason: `Updated global vendor "${vendor.vendor_name}"`,
      });

      return NextResponse.json({ vendor, message: 'Vendor updated successfully.' });
    }

    const { data: oldVendor } = await supabaseAdmin
      .from('store_vendors')
      .select('*')
      .eq('id', context.params.vendorId)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from('store_vendors')
      .update(payload)
      .eq('id', context.params.vendorId)
      .select(STORE_VENDOR_SELECT)
      .single();

    if (error) throw new Error(error.message);

    const row = data as unknown as StoreVendorDbRow;
    const storeName = await loadStoreName(row.store_id);
    const vendor = normalizeStoreVendor(row, storeName);

    await createAdminAuditLog({
      actorUserId: auth.user.id,
      action: 'vendors.updated',
      targetStoreId: vendor.store_id,
      targetTable: 'store_vendors',
      targetRecordId: vendor.id,
      oldValues: (oldVendor as Record<string, unknown> | null) || null,
      newValues: vendor,
      metadata: { source },
      reason: `Updated store vendor "${vendor.vendor_name}"`,
    });

    return NextResponse.json({ vendor, message: 'Vendor updated successfully.' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update vendor.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const source = sourceParam(new URL(request.url).searchParams.get('source'));
  if (!source) {
    return NextResponse.json({ error: 'Vendor source is required.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const table = source === 'global' ? 'global_vendors' : 'store_vendors';

  try {
    const { data: oldVendor } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq('id', context.params.vendorId)
      .maybeSingle();

    const { error } = await supabaseAdmin.from(table).delete().eq('id', context.params.vendorId);
    if (error) throw new Error(error.message);

    const oldVendorRecord = (oldVendor as Record<string, unknown> | null) || null;
    const oldVendorStoreId =
      source === 'store' && typeof oldVendorRecord?.store_id === 'string'
        ? oldVendorRecord.store_id
        : null;
    const oldVendorName =
      typeof oldVendorRecord?.vendor_name === 'string'
        ? oldVendorRecord.vendor_name
        : context.params.vendorId;

    await createAdminAuditLog({
      actorUserId: auth.user.id,
      action: 'vendors.deleted',
      targetStoreId: oldVendorStoreId,
      targetTable: table,
      targetRecordId: context.params.vendorId,
      oldValues: oldVendorRecord,
      metadata: { source },
      reason: `Deleted ${source} vendor "${oldVendorName}"`,
    });

    return NextResponse.json({ message: 'Deleted.' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete vendor.' },
      { status: 500 }
    );
  }
}
