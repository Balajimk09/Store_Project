import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import {
  auditStaffAction,
  cleanEmail,
  createAuthUserWithPassword,
  filterStaff,
  findAuthUserByEmail,
  isValidEmail,
  jsonError,
  loadTeamConfig,
  loadStaffMembers,
  replaceCatalogUserPermissions,
  stringArray,
  syncSupportAccess,
  textOrNull,
  upsertStaffProfile,
  validateTemporaryPassword,
  type StaffMutationBody,
} from '@/app/api/superadmin/team/_lib';

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  try {
    const config = await loadTeamConfig();
    const page = Math.max(0, Number(request.nextUrl.searchParams.get('page') || 0));
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 50)));
    const staff = await loadStaffMembers(config);
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

  try {
    const existingUser = await findAuthUserByEmail(email);
    const password = existingUser ? null : validateTemporaryPassword(body.temporary_password);
    const authUser = existingUser || (await createAuthUserWithPassword(email, fullName, password || ''));
    const profileBody: StaffMutationBody = { ...body, status: 'active' };
    if (existingUser) {
      delete profileBody.require_password_change;
    } else {
      profileBody.require_password_change = body.require_password_change !== false;
    }
    const profile = await upsertStaffProfile(authUser.id, email, profileBody, 'active');
    const permissionKeys = stringArray(body.permission_keys);
    const permissionResult = await replaceCatalogUserPermissions({
      userId: authUser.id,
      selectedCatalogPermissionKeys: permissionKeys,
      actorUserId: auth.user.id,
      currentUserId: auth.user.id,
    });

    const supportEnabled = body.support_access_enabled === true;
    if (supportEnabled) {
      await syncSupportAccess({
        userId: authUser.id,
        email,
        enabled: true,
        roleCode: textOrNull(body.support_role_code) || 'agent',
        supportPermissionKeys: stringArray(body.support_permission_keys),
        actorUserId: auth.user.id,
      });
    }

    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'staff.created',
      targetUserId: authUser.id,
      targetEmail: email,
      newValues: profile,
      metadata: {
        platform_department_id: textOrNull(body.platform_department_id),
        platform_role_id: textOrNull(body.platform_role_id),
        role_job_title: textOrNull(body.job_title) || textOrNull(body.custom_role_name),
        permission_count: permissionResult.finalPermissions.length,
        legacy_permission_count: permissionResult.legacyPermissions.length,
        support_access_enabled: supportEnabled,
        linked_existing_auth_user: Boolean(existingUser),
        password_set: Boolean(password),
        require_password_change: body.require_password_change !== false,
      },
    });

    return NextResponse.json({
      ok: true,
      user_id: authUser.id,
      staffId: authUser.id,
      authUserId: authUser.id,
      passwordSet: Boolean(password),
      message: existingUser
        ? 'Existing auth user linked as company staff.'
        : 'Staff account created. Share the temporary password with the staff member manually.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save staff member.';
    return jsonError(message, message.includes('email settings') ? 502 : 500);
  }
}
