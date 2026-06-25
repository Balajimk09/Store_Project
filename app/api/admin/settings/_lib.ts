import { NextRequest, NextResponse } from 'next/server';
import { createAdminAuditLog } from '@/lib/audit-log';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type SettingsTableConfig = {
  table: string;
  idField: string;
  select: string;
  order: { column: string; ascending?: boolean }[];
  createAction: string;
  updateAction: string;
  deleteAction: string;
  softDeleteField?: string;
};

export type RouteContext = { params: Record<string, string> };

export const configs = {
  plans: {
    table: 'platform_plans',
    idField: 'planId',
    select: '*',
    order: [{ column: 'sort_order', ascending: true }],
    createAction: 'plans.created',
    updateAction: 'plans.updated',
    deleteAction: 'plans.deleted',
    softDeleteField: 'is_active',
  },
  features: {
    table: 'platform_feature_flags',
    idField: 'featureId',
    select: '*',
    order: [
      { column: 'category', ascending: true },
      { column: 'feature_name', ascending: true },
    ],
    createAction: 'features.created',
    updateAction: 'features.updated',
    deleteAction: 'features.deleted',
    softDeleteField: 'is_active',
  },
  posTypes: {
    table: 'platform_pos_types',
    idField: 'posId',
    select: '*',
    order: [{ column: 'pos_name', ascending: true }],
    createAction: 'pos_types.created',
    updateAction: 'pos_types.updated',
    deleteAction: 'pos_types.deleted',
    softDeleteField: 'is_active',
  },
  paymentMethods: {
    table: 'platform_payment_methods',
    idField: 'methodId',
    select: '*',
    order: [{ column: 'sort_order', ascending: true }],
    createAction: 'payment_methods.created',
    updateAction: 'payment_methods.updated',
    deleteAction: 'payment_methods.deleted',
    softDeleteField: 'is_active',
  },
  revenueRules: {
    table: 'platform_revenue_rules',
    idField: 'ruleId',
    select: '*',
    order: [
      { column: 'rule_type', ascending: true },
      { column: 'rule_name', ascending: true },
    ],
    createAction: 'revenue_rules.created',
    updateAction: 'revenue_rules.updated',
    deleteAction: 'revenue_rules.deleted',
    softDeleteField: 'is_active',
  },
  notificationTemplates: {
    table: 'platform_notification_templates',
    idField: 'templateId',
    select: '*',
    order: [{ column: 'template_key', ascending: true }],
    createAction: 'notification_templates.created',
    updateAction: 'notification_templates.updated',
    deleteAction: 'notification_templates.deleted',
    softDeleteField: 'is_enabled',
  },
  announcements: {
    table: 'platform_announcements',
    idField: 'announcementId',
    select: '*',
    order: [{ column: 'created_at', ascending: false }],
    createAction: 'announcements.created',
    updateAction: 'announcements.updated',
    deleteAction: 'announcements.deleted',
  },
} satisfies Record<string, SettingsTableConfig>;

function cleanBody(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (key === 'id' || key === 'created_at') continue;
    if (value === undefined) continue;
    payload[key] = value === '' ? null : value;
  }

  payload.updated_at = new Date().toISOString();
  return payload;
}

export async function requireSettingsAuth(request: NextRequest) {
  return requirePermission(request, 'platform.superadmin');
}

export async function listRows(request: NextRequest, config: SettingsTableConfig) {
  const auth = await requireSettingsAuth(request);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin.from(config.table).select(config.select);
  for (const order of config.order) {
    query = query.order(order.column, { ascending: order.ascending ?? true });
  }
  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data || [] });
}

export async function createRow(request: NextRequest, config: SettingsTableConfig) {
  const auth = await requireSettingsAuth(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const payload = cleanBody(body);
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from(config.table)
    .insert(payload)
    .select(config.select)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const createdRecord = data as unknown as Record<string, unknown>;

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action: config.createAction,
    targetTable: config.table,
    targetRecordId:
      typeof createdRecord.id === 'string'
        ? createdRecord.id
        : null,
    newValues: createdRecord,
    metadata: {},
  });

  return NextResponse.json({ data, message: 'Created successfully.' });
}

export async function updateRow(
  request: NextRequest,
  context: RouteContext,
  config: SettingsTableConfig
) {
  const auth = await requireSettingsAuth(request);
  if (!auth.ok) return auth.response;

  const rowId = context.params[config.idField];
  const body = (await request.json()) as Record<string, unknown>;
  const payload = cleanBody(body);
  const supabaseAdmin = getSupabaseAdmin();

  const { data: oldValues } = await supabaseAdmin
    .from(config.table)
    .select('*')
    .eq('id', rowId)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from(config.table)
    .update(payload)
    .eq('id', rowId)
    .select(config.select)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action: config.updateAction,
    targetTable: config.table,
    targetRecordId: rowId,
    oldValues: (oldValues as Record<string, unknown> | null) || null,
    newValues: (data as unknown as Record<string, unknown>) || null,
    metadata: {},
  });

  return NextResponse.json({ data, message: 'Updated successfully.' });
}

export async function deleteRow(
  request: NextRequest,
  context: RouteContext,
  config: SettingsTableConfig,
  options?: { preventLastActivePlan?: boolean }
) {
  const auth = await requireSettingsAuth(request);
  if (!auth.ok) return auth.response;

  const rowId = context.params[config.idField];
  const supabaseAdmin = getSupabaseAdmin();

  if (options?.preventLastActivePlan) {
    const { count, error: countError } = await supabaseAdmin
      .from(config.table)
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
    if ((count || 0) <= 1) {
      return NextResponse.json({ error: 'At least one active plan is required.' }, { status: 400 });
    }
  }

  const { data: oldValues } = await supabaseAdmin
    .from(config.table)
    .select('*')
    .eq('id', rowId)
    .maybeSingle();

  const query = config.softDeleteField
    ? supabaseAdmin
        .from(config.table)
        .update({ [config.softDeleteField]: false, updated_at: new Date().toISOString() })
        .eq('id', rowId)
    : supabaseAdmin.from(config.table).delete().eq('id', rowId);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action: config.deleteAction,
    targetTable: config.table,
    targetRecordId: rowId,
    oldValues: (oldValues as Record<string, unknown> | null) || null,
    metadata: {},
  });

  return NextResponse.json({ message: 'Deleted successfully.' });
}
