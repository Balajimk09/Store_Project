import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hasAdminPermission, requireAdminAccess, requirePermission } from '@/lib/admin-auth';
import { createAdminAuditLog } from '@/lib/audit-log';
import {
  getScopedStore,
  hasAnyStorePermission,
  pickExistingColumns,
  PRODUCT_EDIT_PERMISSIONS,
  PRODUCT_VIEW_PERMISSIONS,
  STORE_AUDIT_PERMISSIONS,
  STORE_DEACTIVATE_PERMISSIONS,
  STORE_EDIT_PERMISSIONS,
  STORE_VIEW_PERMISSIONS,
  TRANSACTION_VIEW_PERMISSIONS,
  UPLOAD_PERMISSIONS,
} from './_lib';
import { logAdminActivity } from '@/app/api/admin/_lib';

type RouteContext = { params: { storeId: string } };

const ALLOWED_UPDATE_FIELDS = [
  'owner_id',
  'allowed_user_count',
  'primary_owner_email',
  'primary_contacts',
  'custom_fields',
  'store_name',
  'store_code',
  'logo_url',
  'manager_name',
  'manager_phone',
  'manager_email',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip_code',
  'country',
  'timezone',
  'latitude',
  'longitude',
  'store_type',
  'pos_type',
  'register_count',
  'has_fuel',
  'fuel_brand',
  'phone_number',
  'business_legal_name',
  'dba_name',
  'ein_tax_id',
  'sales_tax_permit',
  'tobacco_license',
  'alcohol_license',
  'lottery_enabled',
  'atm_enabled',
  'money_order_enabled',
  'ebt_accepted',
  'operating_hours',
  'store_users',
  'plan',
  'subscription_status',
  'billing_status',
  'billing_provider',
  'billing_customer_id',
  'billing_subscription_id',
  'current_period_start',
  'current_period_end',
  'trial_ends_at',
  'cancel_at',
  'subscription_notes',
  'billing_custom_fields',
  'compliance_fields',
  'compliance_notes',
  'compliance_file_urls',
  'notes',
  'is_active',
  'status',
] as const;

function cleanValue(field: string, value: unknown) {
  if (field === 'store_name') {
    return typeof value === 'string' ? value.trim() : value;
  }

  if (
    field === 'has_fuel' ||
    field === 'lottery_enabled' ||
    field === 'atm_enabled' ||
    field === 'money_order_enabled' ||
    field === 'ebt_accepted' ||
    field === 'is_active'
  ) {
    return Boolean(value);
  }

  if (field === 'register_count' || field === 'allowed_user_count') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return value === undefined || value === '' ? null : value;
}

function buildUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const field of ALLOWED_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = cleanValue(field, body[field]);
    }
  }

  payload.updated_at = new Date().toISOString();
  return payload;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) return auth.response;

  if (!hasAnyStorePermission(auth, STORE_VIEW_PERMISSIONS)) {
    return NextResponse.json({ error: 'You do not have permission to view this store.' }, { status: 403 });
  }

  const { store, response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const supabaseAdmin = getSupabaseAdmin();
  const storeId = context.params.storeId;

  const [productsResult, transactionsResult, uploadsResult, ticketsResult, auditResult] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id, stock, reorder_level, cost_price, selling_price, is_active', { count: 'exact' })
      .eq('store_id', storeId)
      .limit(5000),
    supabaseAdmin
      .from('transactions')
      .select('id, total_amount, transaction_time', { count: 'exact' })
      .eq('store_id', storeId)
      .order('transaction_time', { ascending: false })
      .limit(5000),
    supabaseAdmin
      .from('upload_batches')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('support_tickets')
      .select('*')
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('admin_activity_logs')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const products = productsResult.error ? [] : productsResult.data || [];
  const transactions = transactionsResult.error ? [] : transactionsResult.data || [];
  const totalSales = transactions.reduce((sum, row) => {
    const value = typeof row.total_amount === 'number' ? row.total_amount : Number(row.total_amount || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const lowStockCount = products.filter((product) => {
    const stock = Number(product.stock || 0);
    const reorderLevel = Number(product.reorder_level || 0);
    return stock <= reorderLevel;
  }).length;

  return NextResponse.json({
    store,
    owner: { email: store?.primary_owner_email || null },
    metrics: {
      total_sales: totalSales,
      transaction_count: transactionsResult.error ? 0 : transactionsResult.count || transactions.length,
      product_count: productsResult.error ? 0 : productsResult.count || products.length,
      low_stock_count: lowStockCount,
      last_upload: uploadsResult.error ? null : uploadsResult.data?.[0] || null,
    },
    recent_uploads: uploadsResult.error ? [] : uploadsResult.data || [],
    recent_tickets: ticketsResult.error ? [] : ticketsResult.data || [],
    recent_audit_logs: auditResult.error ? [] : auditResult.data || [],
    permissions: {
      canView: true,
      canEditProfile: hasAnyStorePermission(auth, STORE_EDIT_PERMISSIONS),
      canDeactivate: hasAnyStorePermission(auth, STORE_DEACTIVATE_PERMISSIONS),
      canViewAudit: hasAnyStorePermission(auth, STORE_AUDIT_PERMISSIONS),
      canEditProducts: hasAnyStorePermission(auth, PRODUCT_EDIT_PERMISSIONS),
      canViewProducts: hasAnyStorePermission(auth, PRODUCT_VIEW_PERMISSIONS),
      canUpload: hasAnyStorePermission(auth, UPLOAD_PERMISSIONS),
      canViewTransactions: hasAnyStorePermission(auth, TRANSACTION_VIEW_PERMISSIONS),
      isSuperadmin: hasAdminPermission(auth.permissions, 'platform.superadmin'),
    },
    permissionKeys: auth.permissions,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json()) as Record<string, unknown>;
  const payload = buildUpdatePayload(body);
  const changedFields = Object.keys(payload).filter((key) => key !== 'updated_at');
  const isStatusOnly = changedFields.length > 0 && changedFields.every((key) => key === 'is_active' || key === 'status');

  if (
    (!isStatusOnly && !hasAnyStorePermission(auth, STORE_EDIT_PERMISSIONS)) ||
    (isStatusOnly && !hasAnyStorePermission(auth, STORE_DEACTIVATE_PERMISSIONS))
  ) {
    return NextResponse.json({ error: 'You do not have permission to update this store.' }, { status: 403 });
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'store_name') &&
    typeof payload.store_name === 'string' &&
    !payload.store_name
  ) {
    return NextResponse.json({ error: 'Store name is required.' }, { status: 400 });
  }

  if (Object.keys(payload).length === 1) {
    return NextResponse.json({ error: 'No supported fields to update.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { store: oldStore, response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const existingPayload = {
    ...pickExistingColumns(payload, oldStore, ALLOWED_UPDATE_FIELDS),
    updated_at: new Date().toISOString(),
  };

  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .update(existingPayload)
    .eq('id', context.params.storeId)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changedActiveOnly =
    Object.prototype.hasOwnProperty.call(payload, 'is_active') &&
    Object.keys(payload).filter((key) => key !== 'updated_at').every((key) => key === 'is_active' || key === 'status');
  const action = changedActiveOnly
    ? store.is_active === false
      ? 'store.deactivated_by_admin'
      : 'store.reactivated_by_admin'
    : 'store.profile_updated';
  const verb = changedActiveOnly
    ? store.is_active === false
      ? 'Deactivated'
      : 'Activated'
    : 'Updated';

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action,
    targetStoreId: store.id,
    targetTable: 'stores',
    targetRecordId: store.id,
    oldValues: oldStore || null,
    newValues: store,
    metadata: {},
    reason: `${verb} store "${store.store_name}"`,
  });

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action,
    description: `${verb} store "${store.store_name}" through Store 360.`,
    relatedType: 'store',
    relatedId: store.id,
    storeId: store.id,
    metadata: { changedFields },
  });

  return NextResponse.json({ ok: true, store, message: 'Store updated successfully.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: oldStore } = await supabaseAdmin
    .from('stores')
    .select('*')
    .eq('id', context.params.storeId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from('stores')
    .delete()
    .eq('id', context.params.storeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action: 'stores.deleted',
    targetStoreId: context.params.storeId,
    targetTable: 'stores',
    targetRecordId: context.params.storeId,
    oldValues: oldStore || null,
    metadata: {},
    reason: `Deleted store "${oldStore?.store_name || context.params.storeId}"`,
  });

  return NextResponse.json({ message: 'Store deleted successfully.' });
}
