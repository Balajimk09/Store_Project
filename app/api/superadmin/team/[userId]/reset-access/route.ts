import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import {
  auditStaffAction,
  jsonError,
  loadStaffMembers,
  sendResetEmail,
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

    await sendResetEmail(target.email);

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.reset_access_sent',
      targetUserId: userId,
      targetEmail: target.email,
      metadata: {
        target_user_id: userId,
        target_email: target.email,
      },
      reason: 'Reset access email sent from Company Team.',
    });

    return NextResponse.json({ message: 'Reset access email sent.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send reset access email.';
    return jsonError(message, message.includes('email settings') ? 502 : 500);
  }
}
