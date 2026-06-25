import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, boolValue, jsonError, numberValue, textOrNull } from '@/app/api/superadmin/team/_lib';

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const permissionKey = textOrNull(body.permission_key);
  const label = textOrNull(body.label);
  if (!permissionKey) return jsonError('Permission key is required.');
  if (!label) return jsonError('Permission label is required.');

  const payload = {
    permission_key: permissionKey,
    label,
    group_id: textOrNull(body.group_id),
    group_name: textOrNull(body.group_name) || 'Custom',
    module_key: textOrNull(body.module_key),
    description: textOrNull(body.description),
    is_system_permission: permissionKey === 'platform.superadmin' || boolValue(body.is_system_permission, false),
    is_dangerous: permissionKey === 'platform.superadmin' || boolValue(body.is_dangerous, false),
    is_active: boolValue(body.is_active, true),
    sort_order: numberValue(body.sort_order),
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from('platform_permissions').insert(payload).select('*').single();
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_permission.created',
    targetTable: 'platform_permissions',
    targetRecordId: String((data as { id?: string }).id || ''),
    newValues: data as Record<string, unknown>,
  });

  return NextResponse.json({ permission: data, message: 'Permission created.' });
}
