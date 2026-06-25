import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import {
  auditStaffAction,
  jsonError,
  loadStaffMembers,
  replaceUserPermissions,
  stringArray,
} from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    userId: string;
  };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const permissionKeys = stringArray(body.permission_keys);
  const userId = context.params.userId;

  try {
    const staff = await loadStaffMembers();
    const target = staff.find((member) => member.user_id === userId);
    if (!target) return jsonError('Staff member not found.', 404);

    const result = await replaceUserPermissions(userId, permissionKeys, auth.user.id);

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.permissions_updated',
      targetUserId: userId,
      targetEmail: target.email,
      oldValues: { permissions: result.oldPermissions },
      newValues: { permissions: result.newPermissions },
      metadata: {
        permission_count: permissionKeys.length,
      },
    });

    return NextResponse.json({ message: 'Permissions updated.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update permissions.', 500);
  }
}

export const PUT = POST;
