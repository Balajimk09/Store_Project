import { NextRequest, NextResponse } from 'next/server';
import { createAdminAuditLog } from '@/lib/audit-log';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();

  const [
    settings,
    plans,
    featureFlags,
    posTypes,
    paymentMethods,
    revenueRules,
    notificationTemplates,
    announcements,
  ] = await Promise.all([
    supabaseAdmin
      .from('platform_settings')
      .select('*')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabaseAdmin.from('platform_plans').select('*').order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('platform_feature_flags')
      .select('*')
      .order('category', { ascending: true })
      .order('feature_name', { ascending: true }),
    supabaseAdmin.from('platform_pos_types').select('*').order('pos_name', { ascending: true }),
    supabaseAdmin
      .from('platform_payment_methods')
      .select('*')
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('platform_revenue_rules')
      .select('*')
      .order('rule_type', { ascending: true })
      .order('rule_name', { ascending: true }),
    supabaseAdmin
      .from('platform_notification_templates')
      .select('*')
      .order('template_key', { ascending: true }),
    supabaseAdmin
      .from('platform_announcements')
      .select('*')
      .order('created_at', { ascending: false }),
  ]);

  const firstError = [
    settings.error,
    plans.error,
    featureFlags.error,
    posTypes.error,
    paymentMethods.error,
    revenueRules.error,
    notificationTemplates.error,
    announcements.error,
  ].find(Boolean);

  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  return NextResponse.json({
    settings: settings.data || [],
    plans: plans.data || [],
    feature_flags: featureFlags.data || [],
    pos_types: posTypes.data || [],
    payment_methods: paymentMethods.data || [],
    revenue_rules: revenueRules.data || [],
    notification_templates: notificationTemplates.data || [],
    announcements: announcements.data || [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const settingKey = textOrNull(body.setting_key);
  const category = textOrNull(body.category);
  const label = textOrNull(body.label);

  if (!settingKey || !category || !label) {
    return NextResponse.json(
      { error: 'setting_key, category, and label are required.' },
      { status: 400 }
    );
  }

  const payload = {
    setting_key: settingKey,
    setting_value:
      Object.prototype.hasOwnProperty.call(body, 'setting_value') ? body.setting_value : null,
    category,
    label,
    description: textOrNull(body.description),
    value_type: textOrNull(body.value_type) || 'string',
    is_sensitive: Boolean(body.is_sensitive),
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('platform_settings')
    .upsert(payload, { onConflict: 'setting_key' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action: 'settings.updated',
    targetTable: 'platform_settings',
    targetRecordId: data.id,
    newValues: data,
    metadata: { setting_key: settingKey },
  });

  return NextResponse.json({ setting: data, message: 'Setting saved successfully.' });
}
