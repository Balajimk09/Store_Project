import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createAdminAuditLog } from '@/lib/audit-log';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type JsonRecord = Record<string, unknown>;

export type PlatformDepartment = {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
  staff_count: number;
  role_count: number;
};

export type PlatformRole = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  department_id: string | null;
  department_name: string | null;
  is_system_role: boolean;
  is_superadmin_role: boolean;
  grants_support_access: boolean;
  is_active: boolean;
  sort_order: number;
  permission_keys: string[];
  staff_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type PlatformPermissionGroup = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  permission_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type PlatformPermission = {
  id: string;
  permission_key: string;
  label: string;
  group_id: string | null;
  group_name: string;
  module_key: string | null;
  description: string | null;
  is_system_permission: boolean;
  is_dangerous: boolean;
  is_active: boolean;
  sort_order: number;
  assigned_user_count: number;
  assigned_role_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type TeamConfig = {
  departments: PlatformDepartment[];
  roles: PlatformRole[];
  permissionGroups: PlatformPermissionGroup[];
  permissions: PlatformPermission[];
  tablesMissing: boolean;
  warning?: string;
};

export type StaffMember = {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  username: string | null;
  role_label: string | null;
  account_type: string | null;
  platform_department_id: string | null;
  department: string | null;
  department_code: string | null;
  platform_role_id: string | null;
  role_name: string | null;
  role_code: string | null;
  custom_role_name: string | null;
  job_title: string | null;
  employee_id: string | null;
  start_date: string | null;
  notes: string | null;
  status: string;
  is_company_staff: boolean;
  last_sign_in_at: string | null;
  permission_count: number;
  permission_keys: string[];
  catalog_permission_keys: string[];
  legacy_permission_keys: string[];
  has_support_access: boolean;
  support_role_code: string | null;
  support_permissions: string[];
  created_at: string | null;
};

export type StaffMutationBody = {
  email?: unknown;
  full_name?: unknown;
  phone?: unknown;
  platform_department_id?: unknown;
  platform_role_id?: unknown;
  custom_role_name?: unknown;
  job_title?: unknown;
  employee_id?: unknown;
  start_date?: unknown;
  notes?: unknown;
  status?: unknown;
  support_access_enabled?: unknown;
  support_role_code?: unknown;
  permission_keys?: unknown;
  support_permission_keys?: unknown;
  temporary_password?: unknown;
  require_password_change?: unknown;
};

const MISSING_CONFIG_WARNING = 'Run the SQL migration to enable dynamic departments, roles, and permissions.';
const VALID_STATUSES = new Set(['active', 'invited', 'inactive', 'suspended', 'disabled']);

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function boolValue(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'active', '1', 'enabled'].includes(normalized)) return true;
    if (['false', 'no', 'inactive', '0', 'disabled'].includes(normalized)) return false;
  }
  return fallback;
}

export function numberValue(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

export function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function cleanEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function safeString(row: JsonRecord | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function safeBoolean(row: JsonRecord | null | undefined, key: string, fallback = false) {
  const value = row?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function safeNumber(row: JsonRecord | null | undefined, key: string, fallback = 0) {
  const value = row?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message || '';
  return error?.code === '42P01' || message.includes('does not exist') || message.includes('schema cache');
}

export async function findAuthUserByEmail(email: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

export async function getAuthUserMap() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return new Map(data.users.map((user) => [user.id, user]));
}

export async function getAuthUserById(userId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user || null;
}

async function selectTable(table: string, orderColumn = 'sort_order') {
  const supabaseAdmin = getSupabaseAdmin();
  const query = supabaseAdmin.from(table).select('*');
  const { data, error } = await query.order(orderColumn, { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return { rows: [] as JsonRecord[], missing: true };
    throw new Error(error.message);
  }

  return { rows: (data || []) as JsonRecord[], missing: false };
}

export async function loadTeamConfig(): Promise<TeamConfig> {
  const [departmentResult, roleResult, groupResult, permissionResult, rolePermissionResult] = await Promise.all([
    selectTable('platform_departments'),
    selectTable('platform_roles'),
    selectTable('platform_permission_groups'),
    selectTable('platform_permissions'),
    selectTable('platform_role_permissions', 'created_at'),
  ]);

  const tablesMissing =
    departmentResult.missing || roleResult.missing || groupResult.missing || permissionResult.missing || rolePermissionResult.missing;

  const staff = tablesMissing ? [] : await loadStaffProfilesForCounts();
  const staffByDepartment = countBy(staff, 'platform_department_id');
  const staffByRole = countBy(staff, 'platform_role_id');
  const rolesByDepartment = countBy(roleResult.rows, 'department_id');
  const permissionsByGroup = countBy(permissionResult.rows, 'group_id');
  const userPermissionCounts = tablesMissing ? new Map<string, number>() : await countUserPermissions();
  const rolePermissionCounts = countBy(rolePermissionResult.rows, 'permission_key');
  const rolePermissionsByRole = new Map<string, string[]>();

  for (const row of rolePermissionResult.rows) {
    const roleId = safeString(row, 'role_id');
    const permissionKey = safeString(row, 'permission_key');
    if (!roleId || !permissionKey) continue;
    rolePermissionsByRole.set(roleId, [...(rolePermissionsByRole.get(roleId) || []), permissionKey]);
  }

  const departments = departmentResult.rows.map((row) => normalizeDepartment(row, staffByDepartment, rolesByDepartment));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const groups = groupResult.rows.map((row) => normalizePermissionGroup(row, permissionsByGroup));

  const roles = roleResult.rows.map((row) =>
    normalizeRole(row, departmentById, rolePermissionsByRole.get(safeString(row, 'id') || '') || [], staffByRole)
  );

  const permissions = permissionResult.rows.map((row) => normalizePermission(row, userPermissionCounts, rolePermissionCounts));

  return {
    departments,
    roles,
    permissionGroups: groups,
    permissions,
    tablesMissing,
    warning: tablesMissing ? MISSING_CONFIG_WARNING : undefined,
  };
}

function countBy(rows: JsonRecord[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = safeString(row, key);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

async function loadStaffProfilesForCounts() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, platform_department_id, platform_role_id')
    .eq('is_company_staff', true);
  if (error) return [];
  return (data || []) as JsonRecord[];
}

async function countUserPermissions() {
  const supabaseAdmin = getSupabaseAdmin();
  const counts = new Map<string, number>();
  const { data } = await supabaseAdmin.from('user_permissions').select('permission_key');
  for (const row of (data || []) as JsonRecord[]) {
    const key = safeString(row, 'permission_key');
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function normalizeDepartment(row: JsonRecord, staffByDepartment: Map<string, number>, rolesByDepartment: Map<string, number>): PlatformDepartment {
  const id = safeString(row, 'id') || '';
  return {
    id,
    name: safeString(row, 'name') || '',
    code: safeString(row, 'code') || '',
    color: safeString(row, 'color') || 'gray',
    description: safeString(row, 'description'),
    is_active: safeBoolean(row, 'is_active', true),
    sort_order: safeNumber(row, 'sort_order'),
    created_at: safeString(row, 'created_at'),
    updated_at: safeString(row, 'updated_at'),
    staff_count: staffByDepartment.get(id) || 0,
    role_count: rolesByDepartment.get(id) || 0,
  };
}

function normalizeRole(
  row: JsonRecord,
  departmentById: Map<string, PlatformDepartment>,
  permissionKeys: string[],
  staffByRole: Map<string, number>
): PlatformRole {
  const id = safeString(row, 'id') || '';
  const departmentId = safeString(row, 'department_id');
  return {
    id,
    name: safeString(row, 'name') || '',
    code: safeString(row, 'code') || '',
    description: safeString(row, 'description'),
    department_id: departmentId,
    department_name: departmentId ? departmentById.get(departmentId)?.name || null : null,
    is_system_role: safeBoolean(row, 'is_system_role'),
    is_superadmin_role: safeBoolean(row, 'is_superadmin_role'),
    grants_support_access: safeBoolean(row, 'grants_support_access'),
    is_active: safeBoolean(row, 'is_active', true),
    sort_order: safeNumber(row, 'sort_order'),
    permission_keys: permissionKeys,
    staff_count: staffByRole.get(id) || 0,
    created_at: safeString(row, 'created_at'),
    updated_at: safeString(row, 'updated_at'),
  };
}

function normalizePermissionGroup(row: JsonRecord, permissionsByGroup: Map<string, number>): PlatformPermissionGroup {
  const id = safeString(row, 'id') || '';
  return {
    id,
    name: safeString(row, 'name') || '',
    code: safeString(row, 'code') || '',
    description: safeString(row, 'description'),
    sort_order: safeNumber(row, 'sort_order'),
    is_active: safeBoolean(row, 'is_active', true),
    permission_count: permissionsByGroup.get(id) || 0,
    created_at: safeString(row, 'created_at'),
    updated_at: safeString(row, 'updated_at'),
  };
}

function normalizePermission(
  row: JsonRecord,
  userPermissionCounts: Map<string, number>,
  rolePermissionCounts: Map<string, number>
): PlatformPermission {
  const permissionKey = safeString(row, 'permission_key') || '';
  return {
    id: safeString(row, 'id') || '',
    permission_key: permissionKey,
    label: safeString(row, 'label') || permissionKey,
    group_id: safeString(row, 'group_id'),
    group_name: safeString(row, 'group_name') || 'Custom',
    module_key: safeString(row, 'module_key'),
    description: safeString(row, 'description'),
    is_system_permission: safeBoolean(row, 'is_system_permission'),
    is_dangerous: safeBoolean(row, 'is_dangerous'),
    is_active: safeBoolean(row, 'is_active', true),
    sort_order: safeNumber(row, 'sort_order'),
    assigned_user_count: userPermissionCounts.get(permissionKey) || 0,
    assigned_role_count: rolePermissionCounts.get(permissionKey) || 0,
    created_at: safeString(row, 'created_at'),
    updated_at: safeString(row, 'updated_at'),
  };
}

export function normalizeStaffMember(input: {
  profile: JsonRecord;
  authUser: User | null;
  permissionKeys: string[];
  catalogPermissionKeys: Set<string>;
  supportRow: JsonRecord | null;
  department: PlatformDepartment | null;
  role: PlatformRole | null;
}): StaffMember {
  const userId = safeString(input.profile, 'user_id') || input.authUser?.id || '';
  const email = safeString(input.profile, 'email') || input.authUser?.email || '';
  const supportActive = safeBoolean(input.supportRow, 'is_active');
  const supportPermissions = stringArray(input.supportRow?.permissions);
  const status = safeString(input.profile, 'status') || (input.authUser?.last_sign_in_at ? 'active' : 'invited');
  const catalogPermissionKeys = input.permissionKeys.filter((key) => input.catalogPermissionKeys.has(key));
  const legacyPermissionKeys = input.permissionKeys.filter((key) => !input.catalogPermissionKeys.has(key));

  return {
    user_id: userId,
    email,
    full_name: safeString(input.profile, 'full_name') || (typeof input.authUser?.user_metadata?.full_name === 'string' ? input.authUser.user_metadata.full_name : null),
    phone: safeString(input.profile, 'phone') || input.authUser?.phone || null,
    username: safeString(input.profile, 'username'),
    role_label: safeString(input.profile, 'role_label'),
    account_type: safeString(input.profile, 'account_type'),
    platform_department_id: safeString(input.profile, 'platform_department_id'),
    department: input.department?.name || safeString(input.profile, 'department'),
    department_code: input.department?.code || null,
    platform_role_id: safeString(input.profile, 'platform_role_id'),
    role_name: input.role?.name || null,
    role_code: input.role?.code || null,
    custom_role_name: safeString(input.profile, 'custom_role_name'),
    job_title: safeString(input.profile, 'job_title'),
    employee_id: safeString(input.profile, 'employee_id'),
    start_date: safeString(input.profile, 'start_date'),
    notes: safeString(input.profile, 'notes'),
    status,
    is_company_staff: safeBoolean(input.profile, 'is_company_staff'),
    last_sign_in_at: input.authUser?.last_sign_in_at || null,
    permission_count: input.permissionKeys.length,
    permission_keys: input.permissionKeys,
    catalog_permission_keys: catalogPermissionKeys,
    legacy_permission_keys: legacyPermissionKeys,
    has_support_access: supportActive,
    support_role_code: safeString(input.supportRow, 'role_code'),
    support_permissions: supportPermissions,
    created_at: safeString(input.profile, 'created_at') || input.authUser?.created_at || null,
  };
}

export async function loadStaffMembers(config?: TeamConfig) {
  const supabaseAdmin = getSupabaseAdmin();
  const loadedConfig = config || (await loadTeamConfig());
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('is_company_staff', true);

  if (profilesError) throw new Error(profilesError.message);

  const profileRows = (profiles || []) as JsonRecord[];
  const userIds = profileRows.map((profile) => safeString(profile, 'user_id')).filter((id): id is string => Boolean(id));
  const authUsers = await getAuthUserMap();

  const { data: userPermissions, error: permissionsError } = userIds.length
    ? await supabaseAdmin.from('user_permissions').select('user_id, permission_key').in('user_id', userIds)
    : { data: [], error: null };

  if (permissionsError) throw new Error(permissionsError.message);

  const { data: supportRows, error: supportError } = userIds.length
    ? await supabaseAdmin.from('support_agent_permissions').select('*').in('user_id', userIds)
    : { data: [], error: null };

  if (supportError) throw new Error(supportError.message);

  const permissionsByUser = new Map<string, string[]>();
  for (const permission of (userPermissions || []) as JsonRecord[]) {
    const userId = safeString(permission, 'user_id');
    const key = safeString(permission, 'permission_key');
    if (!userId || !key) continue;
    permissionsByUser.set(userId, [...(permissionsByUser.get(userId) || []), key]);
  }

  const supportByUser = new Map<string, JsonRecord>();
  for (const supportRow of (supportRows || []) as JsonRecord[]) {
    const userId = safeString(supportRow, 'user_id');
    if (userId) supportByUser.set(userId, supportRow);
  }

  const departmentById = new Map(loadedConfig.departments.map((department) => [department.id, department]));
  const roleById = new Map(loadedConfig.roles.map((role) => [role.id, role]));
  const catalogPermissionKeys = new Set(loadedConfig.permissions.map((permission) => permission.permission_key));

  return profileRows
    .map((profile) => {
      const userId = safeString(profile, 'user_id') || '';
      const departmentId = safeString(profile, 'platform_department_id');
      const roleId = safeString(profile, 'platform_role_id');
      return normalizeStaffMember({
        profile,
        authUser: authUsers.get(userId) || null,
        permissionKeys: permissionsByUser.get(userId) || [],
        catalogPermissionKeys,
        supportRow: supportByUser.get(userId) || null,
        department: departmentId ? departmentById.get(departmentId) || null : null,
        role: roleId ? roleById.get(roleId) || null : null,
      });
    })
    .filter((staff) => staff.user_id && staff.email);
}

export function filterStaff(
  staff: StaffMember[],
  filters: {
    search?: string;
    department?: string;
    role?: string;
    status?: string;
    supportAccess?: string;
    superadmin?: string;
  }
) {
  const search = filters.search?.trim().toLowerCase();
  return staff.filter((member) => {
    if (filters.department && member.platform_department_id !== filters.department) return false;
    if (filters.role && member.platform_role_id !== filters.role) return false;
    if (filters.status && member.status !== filters.status) return false;
    if (filters.supportAccess === 'true' && !member.has_support_access) return false;
    if (filters.supportAccess === 'false' && member.has_support_access) return false;
    const isSuperadmin = member.permission_keys.includes('platform.superadmin');
    if (filters.superadmin === 'true' && !isSuperadmin) return false;
    if (filters.superadmin === 'false' && isSuperadmin) return false;
    if (!search) return true;

    const haystack = [
      member.full_name,
      member.email,
      member.phone,
      member.department,
      member.department_code,
      member.role_name,
      member.role_code,
      member.custom_role_name,
      member.job_title,
      member.employee_id,
      member.status,
      member.has_support_access ? 'support access' : 'no support access',
      isSuperadmin ? 'superadmin platform.superadmin' : null,
      member.permission_keys.join(' '),
      member.created_at,
      member.last_sign_in_at,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(search);
  });
}

export async function upsertStaffProfile(userId: string, email: string, body: StaffMutationBody, fallbackStatus: string) {
  const config = await loadTeamConfig();
  const departmentId = textOrNull(body.platform_department_id);
  const roleId = textOrNull(body.platform_role_id);
  const department = departmentId ? config.departments.find((item) => item.id === departmentId && item.is_active) : null;
  const role = roleId ? config.roles.find((item) => item.id === roleId && item.is_active) : null;

  if (departmentId && !department) throw new Error('Select a valid active department.');
  if (roleId && !role) throw new Error('Select a valid active role.');

  const notes = textOrNull(body.notes);
  if (notes && notes.length > 1000) throw new Error('Internal notes must be 1000 characters or fewer.');
  const requestedStatus = textOrNull(body.status);
  if (requestedStatus && !VALID_STATUSES.has(requestedStatus)) {
    throw new Error('Invalid staff status. Please refresh and try again.');
  }

  const profilePayload: JsonRecord = {
    user_id: userId,
    email,
    full_name: textOrNull(body.full_name),
    phone: textOrNull(body.phone),
    platform_department_id: departmentId,
    platform_role_id: roleId,
    custom_role_name: textOrNull(body.custom_role_name),
    job_title: textOrNull(body.job_title),
    employee_id: textOrNull(body.employee_id),
    start_date: textOrNull(body.start_date),
    notes,
    role_label: role?.name || textOrNull(body.custom_role_name),
    account_type: 'platform_internal',
    status: requestedStatus || fallbackStatus,
    is_company_staff: true,
    updated_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(body, 'require_password_change')) {
    profilePayload.must_change_password = boolValue(body.require_password_change, true);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(profilePayload, { onConflict: 'user_id' });

  if (error) throw new Error(error.message);

  return profilePayload;
}

export function validateTemporaryPassword(value: unknown) {
  const password = typeof value === 'string' ? value : '';
  if (!password) throw new Error('Temporary password is required.');
  if (password.length < 8) throw new Error('Temporary password must be at least 8 characters.');
  return password;
}

function readablePermissionLabel(permissionKey: string) {
  return permissionKey
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function permissionCategory(permissionKey: string, groupName: string | null) {
  const fallback = permissionKey.split('.')[0] || permissionKey;
  return groupName || fallback;
}

function permissionAction(permissionKey: string) {
  const [, ...rest] = permissionKey.split('.');
  return rest.join('.') || permissionKey;
}

export async function ensurePermissionKeysExist(permissionKeys: string[]) {
  const keys = Array.from(new Set(permissionKeys.map((key) => key.trim()).filter(Boolean)));
  if (keys.length === 0) return;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('permissions')
    .select('permission_key')
    .in('permission_key', keys);

  if (existingError) throw new Error(existingError.message);

  const existingKeys = new Set(
    ((existingRows || []) as JsonRecord[])
      .map((row) => safeString(row, 'permission_key'))
      .filter((key): key is string => Boolean(key))
  );
  const missingKeys = keys.filter((key) => !existingKeys.has(key));
  if (missingKeys.length === 0) return;

  const { data: platformRows, error: platformError } = await supabaseAdmin
    .from('platform_permissions')
    .select('*')
    .in('permission_key', missingKeys);

  if (platformError) throw new Error(platformError.message);

  const now = new Date().toISOString();
  const platformByKey = new Map(
    ((platformRows || []) as JsonRecord[])
      .map((row) => [safeString(row, 'permission_key'), row] as const)
      .filter((entry): entry is readonly [string, JsonRecord] => Boolean(entry[0]))
  );

  const insertRows = missingKeys
    .map((permissionKey) => {
      const platformRow = platformByKey.get(permissionKey);
      if (!platformRow) return null;
      const groupName = safeString(platformRow, 'group_name');
      return {
        permission_key: permissionKey,
        category: permissionCategory(permissionKey, groupName),
        action: permissionAction(permissionKey),
        label: safeString(platformRow, 'label') || readablePermissionLabel(permissionKey),
        description: safeString(platformRow, 'description'),
        is_dangerous: safeBoolean(platformRow, 'is_dangerous'),
        is_system: safeBoolean(platformRow, 'is_system_permission'),
        is_active: safeBoolean(platformRow, 'is_active', true),
        sort_order: safeNumber(platformRow, 'sort_order'),
        created_at: now,
        updated_at: now,
      };
    })
    .filter((row): row is {
      permission_key: string;
      category: string;
      action: string;
      label: string;
      description: string | null;
      is_dangerous: boolean;
      is_system: boolean;
      is_active: boolean;
      sort_order: number;
      created_at: string;
      updated_at: string;
    } => Boolean(row));

  if (insertRows.length === 0) return;

  const { error: insertError } = await supabaseAdmin
    .from('permissions')
    .upsert(insertRows, { onConflict: 'permission_key', ignoreDuplicates: true });

  if (insertError) throw new Error(insertError.message);
}

export async function replaceCatalogUserPermissions(input: {
  userId: string;
  selectedCatalogPermissionKeys: string[];
  actorUserId: string;
  currentUserId?: string;
}) {
  const config = await loadTeamConfig();
  const catalogKeys = new Set(config.permissions.map((permission) => permission.permission_key));
  const selectedCatalogKeys = Array.from(new Set(input.selectedCatalogPermissionKeys.filter((key) => catalogKeys.has(key))));
  const supabaseAdmin = getSupabaseAdmin();

  const { data: oldRows } = await supabaseAdmin
    .from('user_permissions')
    .select('permission_key, can_delegate')
    .eq('user_id', input.userId);

  const oldKeys = ((oldRows || []) as JsonRecord[]).map((row) => safeString(row, 'permission_key')).filter((key): key is string => Boolean(key));
  const legacyKeys = oldKeys.filter((key) => !catalogKeys.has(key));
  const finalKeys = Array.from(new Set([...selectedCatalogKeys, ...legacyKeys]));

  if (input.currentUserId === input.userId && oldKeys.includes('platform.superadmin') && !finalKeys.includes('platform.superadmin')) {
    throw new Error('You cannot remove your own platform superadmin access.');
  }

  await ensurePermissionKeysExist(selectedCatalogKeys);

  const { error: deleteError } = await supabaseAdmin.from('user_permissions').delete().eq('user_id', input.userId);
  if (deleteError) throw new Error(deleteError.message);

  if (finalKeys.length) {
    const { error: insertError } = await supabaseAdmin.from('user_permissions').insert(
      finalKeys.map((permissionKey) => ({
        user_id: input.userId,
        permission_key: permissionKey,
        can_delegate: false,
        granted_by: input.actorUserId,
      }))
    );
    if (insertError) throw new Error(insertError.message);
  }

  return {
    oldPermissions: oldKeys,
    catalogPermissions: selectedCatalogKeys,
    legacyPermissions: legacyKeys,
    finalPermissions: finalKeys,
  };
}

export async function syncSupportAccess(input: {
  userId: string;
  email: string;
  enabled: boolean;
  roleCode: string;
  supportPermissionKeys: string[];
  actorUserId: string;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const permissions = stringArray(input.supportPermissionKeys);
  const updatedAt = new Date().toISOString();

  const { data: oldRow } = await supabaseAdmin
    .from('support_agent_permissions')
    .select('*')
    .eq('user_id', input.userId)
    .maybeSingle();

  let result = await supabaseAdmin
    .from('support_agent_permissions')
    .upsert(
      {
        user_id: input.userId,
        email: input.email,
        role_code: input.roleCode || 'agent',
        permissions,
        is_active: input.enabled,
        updated_by: input.actorUserId,
        updated_at: updatedAt,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (result.error && (result.error.message.includes('schema cache') || result.error.message.includes('column'))) {
    result = await supabaseAdmin
      .from('support_agent_permissions')
      .upsert(
        {
          user_id: input.userId,
          role_code: input.roleCode || 'agent',
          permissions,
          is_active: input.enabled,
          updated_at: updatedAt,
        },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single();
  }

  if (result.error) throw new Error(result.error.message);

  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .update({
      is_company_staff: true,
      updated_at: updatedAt,
    })
    .eq('user_id', input.userId);

  if (profileError) throw new Error(profileError.message);

  return {
    oldRow: (oldRow || null) as JsonRecord | null,
    newRow: (result.data || null) as JsonRecord | null,
  };
}

export async function createAuthUserWithPassword(email: string, fullName: string | null, password: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      company_staff_password_created: true,
    },
  });

  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || 'Unable to create staff auth account.');
  }

  return created.data.user;
}

export async function setAuthUserPassword(userId: string, password: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function auditStaffAction(input: {
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
  targetTable?: string | null;
  targetRecordId?: string | null;
  oldValues?: JsonRecord | null;
  newValues?: JsonRecord | null;
  metadata?: JsonRecord | null;
  reason?: string | null;
}) {
  await createAdminAuditLog({
    actorUserId: input.actorUserId,
    action: input.action,
    targetUserId: input.targetUserId || null,
    targetTable: input.targetTable || 'user_profiles',
    targetRecordId: input.targetRecordId || input.targetUserId || null,
    oldValues: input.oldValues || null,
    newValues: input.newValues || null,
    metadata: {
      ...(input.targetUserId ? { target_user_id: input.targetUserId } : {}),
      ...(input.targetEmail ? { target_email: input.targetEmail } : {}),
      ...(input.metadata || {}),
    },
    reason: input.reason || null,
  });
}

export function cleanCode(value: unknown) {
  const text = textOrNull(value);
  if (!text) return '';
  return text.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}
