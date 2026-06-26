import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getEffectiveStaffAccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  let access;
  try {
    access = await getEffectiveStaffAccess(auth.user.id);
  } catch {
    return NextResponse.json({ error: 'Unable to verify admin access.' }, { status: 403 });
  }

  if (access.disabledReason) {
    return NextResponse.json(
      { error: 'Your account has been deactivated.', reason: 'disabled' },
      { status: 403 }
    );
  }

  if (!access.isSuperadmin && !access.isCompanyStaff && !access.isSupportAgent) {
    return NextResponse.json({ error: 'You do not have admin access.' }, { status: 403 });
  }

  return NextResponse.json({
    profile: {
      userId: access.userId,
      email: access.email,
      fullName: access.fullName,
      status: access.status,
      isCompanyStaff: access.isCompanyStaff,
      isSupportAgent: access.isSupportAgent,
      departmentName: access.departmentName,
      roleName: access.roleName,
      roleCode: access.roleCode,
      supportAccess: access.isSupportAgent,
    },
    permissions: access.permissions,
    user: {
      id: access.userId,
      email: access.email || undefined,
    },
    permissionKeys: access.permissions,
    isSuperadmin: access.isSuperadmin,
    isCompanyStaff: access.isCompanyStaff,
    supportAccess: {
      isActive: access.isSupportAgent,
      roleCode: access.roleCode,
      permissions: access.permissions,
    },
    roleCode: access.roleCode,
  });
}
