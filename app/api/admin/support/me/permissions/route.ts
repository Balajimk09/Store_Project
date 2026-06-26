import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSupportPermissions } from '@/lib/support-auth';

export async function GET(request: NextRequest) {
  const auth = await getCurrentSupportPermissions(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    permissions: auth.permissions,
    role_code: auth.roleCode,
    is_superadmin: auth.isSuperadmin,
    support_access: auth.isSuperadmin || Boolean(auth.roleCode),
  });
}
