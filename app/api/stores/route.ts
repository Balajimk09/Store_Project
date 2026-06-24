import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requirePermission } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();

  const { data: stores, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ownerIds = [...new Set((stores || []).map((s) => s.owner_id).filter(Boolean))];

  const { data: authData } = ownerIds.length
    ? await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })
    : { data: null };

  const { data: profiles } = ownerIds.length
    ? await supabaseAdmin
        .from('user_profiles')
        .select('user_id, full_name, email')
        .in('user_id', ownerIds)
    : { data: [] };

  const authById = new Map((authData?.users || []).map((u) => [u.id, u]));
  const profileById = new Map((profiles || []).map((p) => [p.user_id, p]));

  const result = (stores || []).map((store) => ({
    ...store,
    owner_email: authById.get(store.owner_id)?.email ?? null,
    owner_name: profileById.get(store.owner_id)?.full_name ?? null,
  }));

  return NextResponse.json({ stores: result });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = await request.json();

  if (!body.store_name?.trim()) {
    return NextResponse.json({ error: 'Store name is required.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .insert({
      owner_id: body.owner_id || null,
      store_name: body.store_name.trim(),
      store_code: body.store_code || null,
      logo_url: body.logo_url || null,
      manager_name: body.manager_name || null,
      manager_phone: body.manager_phone || null,
      manager_email: body.manager_email || null,
      address_line1: body.address_line1 || null,
      address_line2: body.address_line2 || null,
      city: body.city || null,
      state: body.state || null,
      zip_code: body.zip_code || null,
      country: body.country || 'United States',
      timezone: body.timezone || 'America/Chicago',
      latitude: body.latitude || null,
      longitude: body.longitude || null,
      store_type: body.store_type || 'Convenience Store',
      pos_type: body.pos_type || null,
      register_count: body.register_count || 1,
      has_fuel: body.has_fuel || false,
      fuel_brand: body.fuel_brand || null,
      phone_number: body.phone_number || null,
      business_legal_name: body.business_legal_name || null,
      dba_name: body.dba_name || null,
      ein_tax_id: body.ein_tax_id || null,
      sales_tax_permit: body.sales_tax_permit || null,
      tobacco_license: body.tobacco_license || null,
      alcohol_license: body.alcohol_license || null,
      lottery_enabled: body.lottery_enabled || false,
      atm_enabled: body.atm_enabled || false,
      money_order_enabled: body.money_order_enabled || false,
      ebt_accepted: body.ebt_accepted || false,
      operating_hours: body.operating_hours || null,
      plan: body.plan || 'starter',
      subscription_status: body.subscription_status || 'trialing',
      billing_status: body.billing_status || 'trial',
      billing_provider: body.billing_provider || null,
      billing_customer_id: body.billing_customer_id || null,
      billing_subscription_id: body.billing_subscription_id || null,
      current_period_start: body.current_period_start || null,
      current_period_end: body.current_period_end || null,
      trial_ends_at: body.trial_ends_at || null,
      cancel_at: body.cancel_at || null,
      subscription_notes: body.subscription_notes || null,
      notes: body.notes || null,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ store, message: 'Store created successfully.' });
}