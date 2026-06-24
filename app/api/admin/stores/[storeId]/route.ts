import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requirePermission } from '@/lib/admin-auth';

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const payload = buildUpdatePayload(body);

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

  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .update(payload)
    .eq('id', context.params.storeId)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ store, message: 'Store updated successfully.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin
    .from('stores')
    .delete()
    .eq('id', context.params.storeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: 'Store deleted successfully.' });
}
