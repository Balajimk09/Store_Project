import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  auditStaffAction,
  boolValue,
  getAuthUserById,
  jsonError,
  loadStaffMembers,
  setAuthUserPassword,
  textOrNull,
  validateTemporaryPassword,
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
    const password = validateTemporaryPassword(body.password);
    const requirePasswordChange = boolValue(body.requirePasswordChange, true);
    const reason = textOrNull(body.reason);
    const [authUser, staff] = await Promise.all([getAuthUserById(userId), loadStaffMembers()]);
    const target = staff.find((member) => member.user_id === userId);

    if (!authUser && !target) return jsonError('Staff member not found.', 404);

    await setAuthUserPassword(userId, password);

    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin
      .from('user_profiles')
      .update({ must_change_password: requirePasswordChange, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.password_overridden',
      targetUserId: userId,
      targetEmail: target?.email || authUser?.email || null,
      metadata: {
        reason,
        require_password_change: requirePasswordChange,
      },
      reason,
    });

    return NextResponse.json({
      ok: true,
      message: 'Temporary password has been set.',
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to set temporary password.', 500);
  }
}
