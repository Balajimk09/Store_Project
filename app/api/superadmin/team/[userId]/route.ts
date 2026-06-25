import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import {
  auditStaffAction,
  getAuthUserById,
  jsonError,
  loadStaffMembers,
  upsertStaffProfile,
  type StaffMutationBody,
} from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    userId: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  let body: StaffMutationBody;
  try {
    body = (await request.json()) as StaffMutationBody;
  } catch {
    return jsonError('Invalid request body.');
  }

  const userId = context.params.userId;

  try {
    const [authUser, staff] = await Promise.all([getAuthUserById(userId), loadStaffMembers()]);
    const existing = staff.find((member) => member.user_id === userId) || null;
    const email = existing?.email || authUser?.email || '';

    if (!email) return jsonError('Staff member not found.', 404);

    const profile = await upsertStaffProfile(userId, email, body, existing?.status || 'active');

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.updated',
      targetUserId: userId,
      targetEmail: email,
      oldValues: existing ? { staff: existing } : null,
      newValues: profile,
      metadata: {
        changed_fields: Object.keys(body),
        platform_department_id: profile.platform_department_id,
        platform_role_id: profile.platform_role_id,
        role_job_title: profile.job_title || profile.role_label,
      },
    });

    return NextResponse.json({ message: 'Staff member updated.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update staff member.', 500);
  }
}
