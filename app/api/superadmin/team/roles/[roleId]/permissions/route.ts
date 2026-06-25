import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, ensurePermissionKeysExist, jsonError, stringArray } from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    roleId: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const permissionKeys = stringArray(body.permission_keys);
  const supabaseAdmin = getSupabaseAdmin();
  await ensurePermissionKeysExist(permissionKeys);

  const { data: oldRows } = await supabaseAdmin
    .from('platform_role_permissions')
    .select('permission_key')
    .eq('role_id', context.params.roleId);

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
    oldValues: { permissions: oldRows || [] },
    newValues: { permissions: permissionKeys },
  });

  return NextResponse.json({ message: 'Role permissions updated.' });
}

export const POST = PATCH;
