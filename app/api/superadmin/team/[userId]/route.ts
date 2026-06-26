import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  auditStaffAction,
  boolValue,
  getAuthUserById,
  jsonError,
  loadStaffMembers,
  replaceCatalogUserPermissions,
  stringArray,
  syncSupportAccess,
  textOrNull,
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
  } catch (error) {
    return jsonError('Invalid request body.');
  }

  const userId = context.params.userId;

  try {
    const [authUser, staff] = await Promise.all([getAuthUserById(userId), loadStaffMembers()]);
    const existing = staff.find((member) => member.user_id === userId) || null;
    const email = existing?.email || authUser?.email || '';

    if (!email) return jsonError('Staff member not found.', 404);

    const profile = await upsertStaffProfile(userId, email, body, existing?.status || 'active');
    let permissionCount = existing?.permission_count || 0;

    if (Object.prototype.hasOwnProperty.call(body, 'permission_keys')) {
      const permissionResult = await replaceCatalogUserPermissions({
        userId,
        selectedCatalogPermissionKeys: stringArray(body.permission_keys),
        actorUserId: auth.user.id,
        currentUserId: auth.user.id,
      });
      permissionCount = permissionResult.finalPermissions.length;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'support_access_enabled')) {
      await syncSupportAccess({
        userId,
        email,
        enabled: boolValue(body.support_access_enabled),
        roleCode: textOrNull(body.support_role_code) || existing?.support_role_code || 'agent',
        supportPermissionKeys: stringArray(body.support_permission_keys),
        actorUserId: auth.user.id,
      });
    }

    const updatedStaff = (await loadStaffMembers()).find((member) => member.user_id === userId) || null;

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
        permission_count: permissionCount,
        support_access_updated: Object.prototype.hasOwnProperty.call(body, 'support_access_enabled'),
      },
    });

    return NextResponse.json({ staff: updatedStaff, message: 'Staff member updated.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update staff member.', 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const userId = context.params.userId;
  if (userId === auth.user.id) {
    return jsonError('You cannot delete your own platform superadmin account.', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    const [authUser, staff] = await Promise.all([getAuthUserById(userId), loadStaffMembers()]);
    const existing = staff.find((member) => member.user_id === userId) || null;
    const email = existing?.email || authUser?.email || null;
    if (!email && !authUser) return jsonError('Staff member not found.', 404);

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.deleted',
      targetUserId: userId,
      targetEmail: email,
      oldValues: existing ? { staff: existing } : { auth_user_email: email },
      metadata: {
        target_user_id: userId,
        target_email: email,
      },
      reason: 'Deleted from Company Team.',
    });

    await supabaseAdmin.from('user_permissions').delete().eq('user_id', userId);
    await supabaseAdmin.from('support_agent_permissions').delete().eq('user_id', userId);
    await supabaseAdmin.from('user_profiles').delete().eq('user_id', userId);

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteUserError) throw new Error(deleteUserError.message);

    return NextResponse.json({ message: 'Staff member deleted.' });
  } catch (error) {
    await supabaseAdmin
      .from('user_profiles')
      .update({ status: 'inactive', is_company_staff: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    await supabaseAdmin
      .from('support_agent_permissions')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    return NextResponse.json({
      message: 'Hard delete could not complete because related records exist. Staff was deactivated instead.',
    });
  }
}
