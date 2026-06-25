import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, boolValue, cleanCode, ensurePermissionKeysExist, jsonError, numberValue, stringArray, textOrNull } from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    roleId: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
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
  const { data: oldRow } = await supabaseAdmin.from('platform_roles').select('*').eq('id', context.params.roleId).maybeSingle();
  const { data, error } = await supabaseAdmin
    .from('platform_roles')
    .update(payload)
    .eq('id', context.params.roleId)
    .select('*')
    .single();
  if (error) return jsonError(error.message, 500);

  if (Object.prototype.hasOwnProperty.call(body, 'permission_keys')) {
    const permissionKeys = stringArray(body.permission_keys);
    await ensurePermissionKeysExist(permissionKeys);
    const { error: deleteError } = await supabaseAdmin.from('platform_role_permissions').delete().eq('role_id', context.params.roleId);
    if (deleteError) return jsonError(deleteError.message, 500);
    if (permissionKeys.length) {
      const { error: insertError } = await supabaseAdmin
        .from('platform_role_permissions')
        .insert(permissionKeys.map((permissionKey) => ({ role_id: context.params.roleId, permission_key: permissionKey })));
      if (insertError) return jsonError(insertError.message, 500);
    }
    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'platform_role.permissions_updated',
      targetTable: 'platform_role_permissions',
      targetRecordId: context.params.roleId,
      newValues: { permission_keys: permissionKeys },
    });
  }

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: boolValue(body.is_active, true) ? 'platform_role.updated' : 'platform_role.deactivated',
    targetTable: 'platform_roles',
    targetRecordId: context.params.roleId,
    oldValues: (oldRow || null) as Record<string, unknown> | null,
    newValues: data as Record<string, unknown>,
  });

  return NextResponse.json({ role: data, message: 'Role updated.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { count } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('platform_role_id', context.params.roleId);

  if ((count || 0) > 0) {
    const { error } = await supabaseAdmin
      .from('platform_roles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', context.params.roleId);
    if (error) return jsonError(error.message, 500);
    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'platform_role.deactivated',
      targetTable: 'platform_roles',
      targetRecordId: context.params.roleId,
      metadata: { staff_count: count || 0 },
    });
    return NextResponse.json({ message: 'Role is in use, so it was deactivated instead of deleted.' });
  }

  const { error } = await supabaseAdmin.from('platform_roles').delete().eq('id', context.params.roleId);
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_role.deleted',
    targetTable: 'platform_roles',
    targetRecordId: context.params.roleId,
  });

  return NextResponse.json({ message: 'Role deleted.' });
}
