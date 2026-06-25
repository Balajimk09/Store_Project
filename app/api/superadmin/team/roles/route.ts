import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, boolValue, cleanCode, ensurePermissionKeysExist, jsonError, numberValue, stringArray, textOrNull } from '@/app/api/superadmin/team/_lib';

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = textOrNull(body.name);
  const code = cleanCode(body.code || name);
  if (!name) return jsonError('Role name is required.');
  if (!code) return jsonError('Role code is required.');

  const payload = {
    name,
    code,
    description: textOrNull(body.description),
    department_id: textOrNull(body.department_id),
    is_system_role: boolValue(body.is_system_role, false),
    is_superadmin_role: boolValue(body.is_superadmin_role, false),
    grants_support_access: boolValue(body.grants_support_access, false),
    is_active: boolValue(body.is_active, true),
    sort_order: numberValue(body.sort_order),
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from('platform_roles').insert(payload).select('*').single();
  if (error) return jsonError(error.message, 500);

  const roleId = String((data as { id?: string }).id || '');
  const permissionKeys = stringArray(body.permission_keys);
  if (permissionKeys.length) {
    await ensurePermissionKeysExist(permissionKeys);
    const { error: permissionError } = await supabaseAdmin
      .from('platform_role_permissions')
      .insert(permissionKeys.map((permissionKey) => ({ role_id: roleId, permission_key: permissionKey })));
    if (permissionError) return jsonError(permissionError.message, 500);
  }

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_role.created',
    targetTable: 'platform_roles',
    targetRecordId: roleId,
    newValues: { ...(data as Record<string, unknown>), permission_keys: permissionKeys },
  });

  return NextResponse.json({ role: data, message: 'Role created.' });
}
