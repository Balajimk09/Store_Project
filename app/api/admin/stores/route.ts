import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requirePermission } from '@/lib/admin-auth';

function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arrayOrEmpty(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function cleanCreatePayload(body: Record<string, unknown>) {
  return {
    owner_id: textOrNull(body.owner_id),
    allowed_user_count: numberOrDefault(body.allowed_user_count, 1),
    primary_owner_email: textOrNull(body.primary_owner_email),
    primary_contacts: arrayOrEmpty(body.primary_contacts),
    custom_fields: arrayOrEmpty(body.custom_fields),
    store_name: textOrNull(body.store_name),
    store_code: textOrNull(body.store_code),
    logo_url: textOrNull(body.logo_url),
    manager_name: textOrNull(body.manager_name),
    manager_phone: textOrNull(body.manager_phone),
    manager_email: textOrNull(body.manager_email),
    address_line1: textOrNull(body.address_line1),
    address_line2: textOrNull(body.address_line2),
    city: textOrNull(body.city),
    state: textOrNull(body.state),
    zip_code: textOrNull(body.zip_code),
    country: textOrNull(body.country) || 'United States',
    timezone: textOrNull(body.timezone) || 'America/Chicago',
    latitude: body.latitude || null,
    longitude: body.longitude || null,
    store_type: textOrNull(body.store_type) || 'Convenience Store',
    pos_type: textOrNull(body.pos_type),
    register_count: numberOrDefault(body.register_count, 1),
    has_fuel: Boolean(body.has_fuel),
    fuel_brand: textOrNull(body.fuel_brand),
    phone_number: textOrNull(body.phone_number),
    business_legal_name: textOrNull(body.business_legal_name),
    dba_name: textOrNull(body.dba_name),
    ein_tax_id: textOrNull(body.ein_tax_id),
    sales_tax_permit: textOrNull(body.sales_tax_permit),
    tobacco_license: textOrNull(body.tobacco_license),
    alcohol_license: textOrNull(body.alcohol_license),
    lottery_enabled: Boolean(body.lottery_enabled),
    atm_enabled: Boolean(body.atm_enabled),
    money_order_enabled: Boolean(body.money_order_enabled),
    ebt_accepted: Boolean(body.ebt_accepted),
    operating_hours: body.operating_hours || null,
    store_users: arrayOrEmpty(body.store_users),
    plan: textOrNull(body.plan) || 'starter',
    subscription_status: textOrNull(body.subscription_status) || 'trialing',
    billing_status: textOrNull(body.billing_status) || 'trial',
    billing_provider: textOrNull(body.billing_provider),
    billing_customer_id: textOrNull(body.billing_customer_id),
    billing_subscription_id: textOrNull(body.billing_subscription_id),
    current_period_start: textOrNull(body.current_period_start),
    current_period_end: textOrNull(body.current_period_end),
    trial_ends_at: textOrNull(body.trial_ends_at),
    cancel_at: textOrNull(body.cancel_at),
    subscription_notes: textOrNull(body.subscription_notes),
    billing_custom_fields: arrayOrEmpty(body.billing_custom_fields),
    compliance_fields: arrayOrEmpty(body.compliance_fields),
    compliance_notes: textOrNull(body.compliance_notes),
    compliance_file_urls: arrayOrEmpty(body.compliance_file_urls),
    notes: textOrNull(body.notes),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();

  const { data: stores, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stores: stores || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;

  if (!textOrNull(body.store_name)) {
    return NextResponse.json({ error: 'Store name is required.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .insert(cleanCreatePayload(body))
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ store, message: 'Store created successfully.' });
}
