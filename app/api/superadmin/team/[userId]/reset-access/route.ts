import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import {
  auditStaffAction,
  jsonError,
  loadStaffMembers,
} from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    userId: string;
  };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const userId = context.params.userId;

  try {
    const staff = await loadStaffMembers();
    const target = staff.find((member) => member.user_id === userId);
    if (!target) return jsonError('Staff member not found.', 404);

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.reset_access_disabled',
      targetUserId: userId,
      targetEmail: target.email,
      metadata: {
        target_user_id: userId,
        target_email: target.email,
        replacement_action: 'staff.password_overridden',
      },
      reason: 'Reset access email is disabled for Company Team MVP.',
    });

    return NextResponse.json(
      { error: 'Reset access emails are disabled. Use Set Password instead.' },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process reset access request.';
    return jsonError(message, 500);
  }
}
