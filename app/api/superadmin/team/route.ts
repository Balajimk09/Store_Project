import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import {
  auditStaffAction,
  cleanEmail,
  filterStaff,
  findAuthUserByEmail,
  isValidEmail,
  jsonError,
  loadStaffMembers,
  normalizeRoleCode,
  replaceUserPermissions,
  sendInvite,
  stringArray,
  syncSupportAccess,
  textOrNull,
  upsertStaffProfile,
  type StaffMutationBody,
} from '@/app/api/superadmin/team/_lib';

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  try {
    const page = Math.max(0, Number(request.nextUrl.searchParams.get('page') || 0));
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 50)));
    const staff = await loadStaffMembers();
    const filtered = filterStaff(staff, {
      search: request.nextUrl.searchParams.get('search') || '',
      department: request.nextUrl.searchParams.get('department') || '',
      role: request.nextUrl.searchParams.get('role') || '',
      status: request.nextUrl.searchParams.get('status') || '',
      supportAccess: request.nextUrl.searchParams.get('supportAccess') || '',
      superadmin: request.nextUrl.searchParams.get('superadmin') || '',
    }).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));

    const start = page * limit;
    return NextResponse.json({
      staff: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load company team.', 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  let body: StaffMutationBody;
  try {
    body = (await request.json()) as StaffMutationBody;
  } catch {
    return jsonError('Invalid request body.');
  }

  const email = cleanEmail(body.email);
  const fullName = textOrNull(body.full_name);

  if (!email) return jsonError('Email is required.');
  if (!isValidEmail(email)) return jsonError('Enter a valid email address.');
  if (!fullName) return jsonError('Full name is required.');
  if (!textOrNull(body.department)) return jsonError('Department is required.');

  try {
    const existingUser = await findAuthUserByEmail(email);
    const authUser = existingUser || (await sendInvite(email, fullName));
    const status = existingUser ? 'active' : 'invited';
    const profile = await upsertStaffProfile(authUser.id, email, body, auth.user.id, status);
    const permissionKeys = stringArray(body.permission_keys);
    await replaceUserPermissions(authUser.id, permissionKeys, auth.user.id);

    const supportEnabled = body.support_access_enabled === true;
    if (supportEnabled) {
      await syncSupportAccess({
        userId: authUser.id,
        email,
        enabled: true,
        roleCode: normalizeRoleCode(body.support_role_code),
        supportPermissionKeys: stringArray(body.support_permission_keys),
        actorUserId: auth.user.id,
      });
    }

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: existingUser ? 'staff.created' : 'staff.invited',
      targetUserId: authUser.id,
      targetEmail: email,
      newValues: profile,
      metadata: {
        department: textOrNull(body.department),
        role_job_title: textOrNull(body.job_title) || textOrNull(body.role_label),
        permission_count: permissionKeys.length,
        support_access_enabled: supportEnabled,
        linked_existing_auth_user: Boolean(existingUser),
      },
    });

    return NextResponse.json({
      user_id: authUser.id,
      message: existingUser ? 'Existing auth user linked as company staff.' : 'Staff invite sent.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save staff member.';
    return jsonError(message, message.includes('email settings') ? 502 : 500);
  }
}
