import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logAdminAction, requirePermission } from '@/lib/admin-auth';

type RouteContext = {
  params: {
    userId: string;
  };
};

type PermissionBody = {
  permissions: Array<{
    permission_key: string;
    can_delegate?: boolean;
  }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'team.assign_permissions');

  if (!auth.ok) {
    return auth.response;
  }

  const targetUserId = context.params.userId;
  const body = (await request.json()) as PermissionBody;
  const selectedPermissions = body.permissions || [];

  const supabaseAdmin = getSupabaseAdmin();

  const { data: oldPermissions } = await supabaseAdmin
    .from('user_permissions')
    .select('permission_key, can_delegate')
    .eq('user_id', targetUserId);

  const { error: deleteError } = await supabaseAdmin
    .from('user_permissions')
    .delete()
    .eq('user_id', targetUserId);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message },
      { status: 500 }
    );
  }

  if (selectedPermissions.length > 0) {
    const permissionRows = selectedPermissions.map((permission) => ({
      user_id: targetUserId,
      permission_key: permission.permission_key,
      can_delegate: Boolean(permission.can_delegate),
      granted_by: auth.user.id,
    }));

    const { error: insertError } = await supabaseAdmin
      .from('user_permissions')
      .insert(permissionRows);

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    action: 'team.assign_permissions',
    targetUserId,
    targetTable: 'user_permissions',
    targetRecordId: targetUserId,
    oldValues: {
      permissions: oldPermissions || [],
    },
    newValues: {
      permissions: selectedPermissions,
    },
    reason: 'Updated permissions from Superadmin Users page.',
  });

  return NextResponse.json({
    message: 'Permissions updated successfully.',
  });
}