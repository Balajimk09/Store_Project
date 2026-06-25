import { NextRequest, NextResponse } from 'next/server';
import { createAdminAuditLog } from '@/lib/audit-log';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type SeedConfig = {
  table: string;
  conflict: string;
  rows: Record<string, unknown>[];
};

const seeds: Record<string, SeedConfig> = {
  plans: {
    table: 'platform_plans',
    conflict: 'plan_code',
    rows: [
      {
        plan_name: 'Starter',
        plan_code: 'starter',
        monthly_price: 49,
        yearly_price: 470,
        trial_days: 14,
        max_users_per_store: 2,
        max_products: 1000,
        features: ['products', 'reports', 'csv_upload'],
        sort_order: 1,
      },
      {
        plan_name: 'Professional',
        plan_code: 'professional',
        monthly_price: 99,
        yearly_price: 950,
        trial_days: 14,
        max_users_per_store: 5,
        max_products: 5000,
        features: [
          'products',
          'reports',
          'csv_upload',
          'ai_assistant',
          'fuel',
          'cashier_audit',
          'vendor_management',
        ],
        sort_order: 2,
      },
      {
        plan_name: 'Enterprise',
        plan_code: 'enterprise',
        monthly_price: 199,
        yearly_price: 1900,
        trial_days: 14,
        max_users_per_store: 20,
        max_products: 50000,
        features: [
          'products',
          'reports',
          'csv_upload',
          'ai_assistant',
          'fuel',
          'cashier_audit',
          'vendor_management',
          'vendor_analytics',
          'api_access',
        ],
        sort_order: 3,
      },
      {
        plan_name: 'Custom',
        plan_code: 'custom',
        monthly_price: 0,
        yearly_price: 0,
        trial_days: 30,
        features: [],
        sort_order: 4,
      },
    ],
  },
  features: {
    table: 'platform_feature_flags',
    conflict: 'feature_key',
    rows: [
      {
        feature_name: 'Products',
        feature_key: 'products',
        description: 'Product and inventory management',
        category: 'core',
        available_on_plans: ['starter', 'professional', 'enterprise', 'custom'],
      },
      {
        feature_name: 'Reports',
        feature_key: 'reports',
        description: 'Sales and business reports',
        category: 'core',
        available_on_plans: ['starter', 'professional', 'enterprise', 'custom'],
      },
      {
        feature_name: 'AI Assistant',
        feature_key: 'ai_assistant',
        description: 'AI-powered business insights',
        category: 'ai',
        available_on_plans: ['professional', 'enterprise', 'custom'],
      },
      {
        feature_name: 'Vendor Management',
        feature_key: 'vendor_management',
        description: 'Vendor ordering tools',
        category: 'operations',
        available_on_plans: ['professional', 'enterprise', 'custom'],
      },
      {
        feature_name: 'Vendor Analytics',
        feature_key: 'vendor_analytics',
        description: 'Vendor performance insights',
        category: 'analytics',
        available_on_plans: ['enterprise', 'custom'],
      },
    ],
  },
  pos_types: {
    table: 'platform_pos_types',
    conflict: 'pos_code',
    rows: [
      { pos_name: 'Verifone Commander', pos_code: 'verifone', supports_csv: true, supports_xlsx: true },
      { pos_name: 'Gilbarco Passport', pos_code: 'gilbarco', supports_csv: true, supports_xlsx: true },
      { pos_name: 'Clover', pos_code: 'clover', supports_csv: true, supports_xlsx: true },
      { pos_name: 'Square', pos_code: 'square', supports_csv: true, supports_xlsx: true },
      { pos_name: 'Other / Manual Upload', pos_code: 'other', supports_csv: true, supports_xlsx: true, is_default: true },
    ],
  },
  payment_methods: {
    table: 'platform_payment_methods',
    conflict: 'method_code',
    rows: [
      { method_name: 'Cash', method_code: 'cash', method_type: 'cash', sort_order: 1 },
      { method_name: 'Check', method_code: 'check', method_type: 'check', sort_order: 2 },
      { method_name: 'COD', method_code: 'cod', method_type: 'cash', is_default: true, sort_order: 3 },
      { method_name: 'ACH / Bank Transfer', method_code: 'ach', method_type: 'ach', sort_order: 5 },
      { method_name: 'AutoPay', method_code: 'autopay', method_type: 'autopay', sort_order: 6 },
      { method_name: 'Custom', method_code: 'custom', method_type: 'custom', sort_order: 9 },
    ],
  },
  notification_templates: {
    table: 'platform_notification_templates',
    conflict: 'template_key',
    rows: [
      {
        template_name: 'Welcome Email',
        template_key: 'welcome_email',
        channel: 'email',
        subject: 'Welcome to {{platform_name}}!',
        body: 'Hi {{store_name}}, welcome to {{platform_name}}.',
        variables: ['platform_name', 'store_name', 'owner_name'],
      },
      {
        template_name: 'Vendor Order Reminder',
        template_key: 'vendor_order_reminder',
        channel: 'email',
        subject: 'Vendor order day: {{vendor_name}}',
        body: 'Today is your order day for {{vendor_name}}.',
        variables: ['store_name', 'vendor_name', 'order_day'],
        is_enabled: false,
      },
      {
        template_name: 'Vendor Delivery Reminder',
        template_key: 'vendor_delivery_reminder',
        channel: 'email',
        subject: 'Vendor delivery expected: {{vendor_name}}',
        body: 'Today is your expected delivery day for {{vendor_name}}.',
        variables: ['store_name', 'vendor_name', 'delivery_day', 'expected_invoice_amount'],
        is_enabled: false,
      },
    ],
  },
  platform_settings: {
    table: 'platform_settings',
    conflict: 'setting_key',
    rows: [
      {
        setting_key: 'platform.name',
        setting_value: 'StorePulse AI',
        category: 'platform_identity',
        label: 'Platform Name',
        value_type: 'string',
        sort_order: 1,
      },
      {
        setting_key: 'platform.maintenance_mode',
        setting_value: false,
        category: 'platform_identity',
        label: 'Maintenance Mode',
        value_type: 'boolean',
        sort_order: 10,
      },
      {
        setting_key: 'store.default_plan',
        setting_value: 'starter',
        category: 'store_defaults',
        label: 'Default Plan for New Stores',
        value_type: 'string',
        sort_order: 1,
      },
      {
        setting_key: 'security.require_strong_password',
        setting_value: true,
        category: 'security',
        label: 'Require Strong Password',
        value_type: 'boolean',
        sort_order: 5,
      },
      {
        setting_key: 'vendors.default_order_frequency',
        setting_value: 'weekly',
        category: 'vendors',
        label: 'Default Order Frequency',
        value_type: 'string',
        sort_order: 6,
      },
    ],
  },
};

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as { type?: string };
  const config = body.type ? seeds[body.type] : null;

  if (!config) {
    return NextResponse.json({ error: 'Unsupported seed type.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from(config.table)
    .upsert(config.rows, { onConflict: config.conflict, ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action: 'settings.seeded',
    targetTable: config.table,
    metadata: { type: body.type, attempted: config.rows.length },
    reason: `Seeded ${body.type}`,
  });

  return NextResponse.json({
    inserted: config.rows.length,
    skipped: 0,
    message: `Seeded ${body.type}. Existing records were left unchanged.`,
  });
}
