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
    if (userId === auth.user.id && target.permission_keys.includes('platform.superadmin')) {
      return jsonError('You cannot deactivate your own platform superadmin account.', 400);
    }

    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .update({ status: 'inactive', is_company_staff: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (profileError) throw new Error(profileError.message);

    const { error: supportError } = await supabaseAdmin
      .from('support_agent_permissions')
      .update({ is_active: false, updated_by: auth.user.id, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (supportError) throw new Error(supportError.message);

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.deactivated',
      targetUserId: userId,
      targetEmail: target.email,
      oldValues: { staff: target },
      newValues: { status: 'inactive', support_access_enabled: false },
      metadata: {
        department: target.department,
        role_job_title: target.job_title || target.role_label,
        support_access_enabled: false,
      },
      reason: 'Deactivated from Company Team.',
    });

    return NextResponse.json({ message: 'Staff member deactivated.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to deactivate staff member.', 500);
  }
}
