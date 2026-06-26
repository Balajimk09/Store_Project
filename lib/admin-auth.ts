import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type AdminAuthResult =
  | {
      ok: true;
      user: {
        id: string;
        email?: string;
      };
    }
  | {
      ok: false;
      response: NextResponse;
    };

export type AdminAccessProfile = {
  user_id?: string;
  email?: string | null;
  full_name?: string | null;
  status?: string | null;
  is_company_staff?: boolean | null;
  [key: string]: unknown;
};

export type AdminAccessResult =
  | {
      ok: true;
      user: {
        id: string;
        email?: string;
      };
      profile: AdminAccessProfile | null;
      permissions: string[];
      supportAccess: {
        isActive: boolean;
        roleCode: string | null;
        permissions: string[];
      };
      isSuperadmin: boolean;
      isCompanyStaff: boolean;
    }
  | {
      ok: false;
      response: NextResponse;
    };

type PermissionRow = {
  permission_key?: string | null;
};

type SupportAccessRow = {
  is_active?: boolean | null;
  role_code?: string | null;
  permissions?: unknown;
};

type RoleRow = {
  id?: string | null;
  name?: string | null;
  code?: string | null;
};

type DepartmentRow = {
  id?: string | null;
  name?: string | null;
};

export type EffectiveStaffAccess = {
  userId: string;
  email: string | null;
  fullName: string | null;
  isSuperadmin: boolean;
  isCompanyStaff: boolean;
  isSupportAgent: boolean;
  status: string | null;
  roleCode: string | null;
  roleName: string | null;
  departmentName: string | null;
  permissions: string[];
  disabledReason: string | null;
};

const INACTIVE_STAFF_STATUSES = new Set(['inactive', 'suspended', 'disabled', 'removed']);

function getBearerToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.replace('Bearer ', '').trim();
}

export async function getAuthenticatedUser(request: NextRequest): Promise<AdminAuthResult> {
  const token = getBearerToken(request);

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing authorization token.' },
        { status: 401 }
      ),
    };
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid or expired session.' },
        { status: 401 }
      ),
    };
  }

  return {
    ok: true,
    user: {
      id: data.user.id,
      email: data.user.email || undefined,
    },
  };
}

export function hasAdminPermission(permissions: string[], key: string) {
  return permissions.includes('platform.superadmin') || permissions.includes('ALL') || permissions.includes(key);
}

export function hasPermission(access: EffectiveStaffAccess, permissionKey: string) {
  return access.isSuperadmin || access.permissions.includes(permissionKey);
}

export function hasAnyPermission(access: EffectiveStaffAccess, permissionKeys: string[]) {
  return permissionKeys.some((permissionKey) => hasPermission(access, permissionKey));
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePermissionArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((permission): permission is string => typeof permission === 'string' && Boolean(permission.trim()));
}

export async function getEffectiveStaffAccess(userId: string): Promise<EffectiveStaffAccess> {
  const supabaseAdmin = getSupabaseAdmin();

  const [authUserResult, profileResult, directPermissionsResult, supportResult] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('user_permissions').select('permission_key').eq('user_id', userId),
    supabaseAdmin
      .from('support_agent_permissions')
      .select('permissions, role_code, is_active')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (authUserResult.error) throw new Error(authUserResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);
  if (directPermissionsResult.error) throw new Error(directPermissionsResult.error.message);
  if (supportResult.error) throw new Error(supportResult.error.message);

  const profile = (profileResult.data || null) as AdminAccessProfile | null;
  const support = supportResult.data as SupportAccessRow | null;
  const permissions = new Set<string>();

  for (const row of (directPermissionsResult.data || []) as PermissionRow[]) {
    if (row.permission_key) permissions.add(row.permission_key);
  }

  const roleId = normalizeString(profile?.platform_role_id);
  let role: RoleRow | null = null;
  if (roleId) {
    const { data, error } = await supabaseAdmin.from('platform_roles').select('id, name, code').eq('id', roleId).maybeSingle();
    if (error) throw new Error(error.message);
    role = (data || null) as RoleRow | null;

    const { data: rolePermissionRows, error: rolePermissionError } = await supabaseAdmin
      .from('platform_role_permissions')
      .select('permission_key')
      .eq('role_id', roleId);
    if (rolePermissionError) throw new Error(rolePermissionError.message);
    for (const row of (rolePermissionRows || []) as PermissionRow[]) {
      if (row.permission_key) permissions.add(row.permission_key);
    }
  }

  const departmentId = normalizeString(profile?.platform_department_id);
  let department: DepartmentRow | null = null;
  if (departmentId) {
    const { data, error } = await supabaseAdmin.from('platform_departments').select('id, name').eq('id', departmentId).maybeSingle();
    if (error) throw new Error(error.message);
    department = (data || null) as DepartmentRow | null;
  }

  const supportPermissions = support?.is_active ? normalizePermissionArray(support.permissions) : [];
  supportPermissions.forEach((permission) => permissions.add(permission));

  const status = normalizeString(profile?.status);
  const normalizedStatus = status?.toLowerCase() || null;
  const disabledReason = normalizedStatus && INACTIVE_STAFF_STATUSES.has(normalizedStatus) ? normalizedStatus : null;
  const isSuperadmin = permissions.has('platform.superadmin');
  const isSupportAgent = support?.is_active === true;
  const isCompanyStaff = profile?.is_company_staff === true && !disabledReason;
  const fullName = normalizeString(profile?.full_name) || normalizeString(authUserResult.data.user?.user_metadata?.full_name);

  return {
    userId,
    email: normalizeString(profile?.email) || authUserResult.data.user?.email || null,
    fullName,
    isSuperadmin,
    isCompanyStaff,
    isSupportAgent,
    status,
    roleCode: role?.code || support?.role_code || null,
    roleName: role?.name || null,
    departmentName: department?.name || null,
    permissions: Array.from(permissions).sort(),
    disabledReason,
  };
}

export async function getAdminPermissionKeys(userId: string) {
  return (await getEffectiveStaffAccess(userId)).permissions;
}

export async function requireAdminAccess(request: NextRequest): Promise<AdminAccessResult> {
  const authResult = await getAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult;
  }

  let access: EffectiveStaffAccess;
  try {
    access = await getEffectiveStaffAccess(authResult.user.id);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unable to verify admin access.' }, { status: 403 }),
    };
  }

  if (access.disabledReason) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Your account has been deactivated.', reason: 'disabled' }, { status: 403 }),
    };
  }

  if (!access.isSuperadmin && !access.isSupportAgent && !access.isCompanyStaff) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'You do not have admin access.' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user: authResult.user,
    profile: {
      user_id: access.userId,
      email: access.email,
      full_name: access.fullName,
      status: access.status,
      is_company_staff: access.isCompanyStaff,
    },
    permissions: access.permissions,
    supportAccess: {
      isActive: access.isSupportAgent,
      roleCode: access.roleCode,
      permissions: access.permissions,
    },
    isSuperadmin: access.isSuperadmin,
    isCompanyStaff: access.isCompanyStaff,
  };
}

export async function requireAdminPermission(request: NextRequest, permissionKey: string): Promise<AdminAccessResult> {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) return auth;
  if (hasAdminPermission(auth.permissions, permissionKey)) return auth;
  return {
    ok: false,
    response: NextResponse.json({ error: 'You do not have permission to access this resource.' }, { status: 403 }),
  };
}

export async function requireAnyAdminPermission(request: NextRequest, permissionKeys: string[]): Promise<AdminAccessResult> {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) return auth;
  if (permissionKeys.length === 0 || permissionKeys.some((permissionKey) => hasAdminPermission(auth.permissions, permissionKey))) {
    return auth;
  }
  return {
    ok: false,
    response: NextResponse.json({ error: 'You do not have access to this section.' }, { status: 403 }),
  };
}

export async function requirePermission(
  request: NextRequest,
  permissionKey = 'platform.superadmin'
): Promise<AdminAuthResult> {
  const authResult = await getAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult;
  }

  let access: EffectiveStaffAccess;
  try {
    access = await getEffectiveStaffAccess(authResult.user.id);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You do not have permission to access this resource.' },
        { status: 403 }
      ),
    };
  }

  if (access.disabledReason || !hasPermission(access, permissionKey)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You do not have permission to access this resource.' },
        { status: 403 }
      ),
    };
  }

  return authResult;
}

export async function requireSuperadmin(request: NextRequest): Promise<AdminAuthResult> {
  return requirePermission(request, 'platform.superadmin');
}

export async function logAdminAction(input: {
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  targetStoreId?: string | null;
  targetTable?: string | null;
  targetRecordId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  reason?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();

  await supabaseAdmin.from('admin_audit_logs').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    target_user_id: input.targetUserId || null,
    target_store_id: input.targetStoreId || null,
    target_table: input.targetTable || null,
    target_record_id: input.targetRecordId || null,
    old_values: input.oldValues || null,
    new_values: input.newValues || null,
    metadata: input.metadata || {},
    reason: input.reason || null,
  });
}
