import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
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
  const supabaseAdmin = getSupabaseAdmin();

  try {
    const staff = await loadStaffMembers();
    const target = staff.find((member) => member.user_id === userId);
    if (!target) return jsonError('Staff member not found.', 404);

    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update({ status: 'active', is_company_staff: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) throw new Error(error.message);

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.reactivated',
      targetUserId: userId,
      targetEmail: target.email,
      oldValues: { staff: target },
      newValues: { status: 'active' },
      metadata: {
        department: target.department,
        role_job_title: target.job_title || target.role_label,
      },
      reason: 'Reactivated from Company Team.',
    });

    return NextResponse.json({ message: 'Staff member reactivated.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to reactivate staff member.', 500);
  }
}
