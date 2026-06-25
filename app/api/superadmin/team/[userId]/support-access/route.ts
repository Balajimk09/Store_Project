import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import {
  auditStaffAction,
  boolValue,
  jsonError,
  loadStaffMembers,
  normalizeRoleCode,
  stringArray,
  syncSupportAccess,
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
  const userId = context.params.userId;

  try {
    const staff = await loadStaffMembers();
    const target = staff.find((member) => member.user_id === userId);
    if (!target) return jsonError('Staff member not found.', 404);

    const enabled = boolValue(body.enabled, false);
    const roleCode = normalizeRoleCode(body.role_code);
    const result = await syncSupportAccess({
      userId,
      email: target.email,
      enabled,
      roleCode,
      supportPermissionKeys: stringArray(body.support_permission_keys),
      actorUserId: auth.user.id,
    });

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.support_access_updated',
      targetUserId: userId,
      targetEmail: target.email,
      oldValues: result.oldRow ? { support_access: result.oldRow } : null,
      newValues: result.newRow ? { support_access: result.newRow } : null,
      metadata: {
        support_access_enabled: enabled,
        support_role_code: roleCode,
      },
    });

    return NextResponse.json({ message: enabled ? 'Support access enabled.' : 'Support access disabled.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update support access.', 500);
  }
}

export const PATCH = POST;
