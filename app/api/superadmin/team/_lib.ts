import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { ALL_SUPPORT_PERMISSIONS, ROLE_PRESETS } from '@/app/api/admin/support/_lib';
import { createAdminAuditLog } from '@/lib/audit-log';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type JsonRecord = Record<string, unknown>;

export type StaffMember = {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  username: string | null;
  role_label: string | null;
  account_type: string | null;
  department: string | null;
  job_title: string | null;
  employee_id: string | null;
  start_date: string | null;
  status: string;
  is_company_staff: boolean;
  last_sign_in_at: string | null;
  permission_count: number;
  permission_keys: string[];
  has_support_access: boolean;
  support_role_code: string | null;
  support_permissions: string[];
  created_at: string | null;
};

export type StaffMutationBody = {
  email?: unknown;
  full_name?: unknown;
  phone?: unknown;
  department?: unknown;
  job_title?: unknown;
  employee_id?: unknown;
  start_date?: unknown;
  role_label?: unknown;
  status?: unknown;
  support_access_enabled?: unknown;
  support_role_code?: unknown;
  permission_keys?: unknown;
  support_permission_keys?: unknown;
};

export const VALID_DEPARTMENTS = new Set([
  'support',
  'sales',
  'operations',
  'finance',
  'technical',
  'management',
  'other',
]);

export const VALID_STATUSES = new Set(['active', 'invited', 'inactive', 'suspended', 'disabled']);

export const SUPPORT_ROLE_CODES = ['viewer', 'agent', 'product_support', 'vendor_support', 'billing_support', 'manager', 'superadmin'];

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

export function supportPermissionsFromInput(value: unknown, roleCode: string) {
  const requested = stringArray(value);
  const fallback = ROLE_PRESETS[roleCode] || ROLE_PRESETS.agent || [];
  const source = requested.length ? requested : fallback;
  return source.filter((permission) =>
    ALL_SUPPORT_PERMISSIONS.includes(permission as (typeof ALL_SUPPORT_PERMISSIONS)[number])
  );
}

export function normalizeRoleCode(value: unknown) {
  const roleCode = textOrNull(value) || 'agent';
  return SUPPORT_ROLE_CODES.includes(roleCode) ? roleCode : 'agent';
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

export function normalizeStaffMember(input: {
  profile: JsonRecord;
  authUser: User | null;
  permissionKeys: string[];
  supportRow: JsonRecord | null;
}): StaffMember {
  const userId = safeString(input.profile, 'user_id') || input.authUser?.id || '';
  const email = safeString(input.profile, 'email') || input.authUser?.email || '';
  const supportActive = safeBoolean(input.supportRow, 'is_active');
  const supportPermissions = stringArray(input.supportRow?.permissions);
  const status = safeString(input.profile, 'status') || (input.authUser?.last_sign_in_at ? 'active' : 'invited');

  return {
    user_id: userId,
    email,
    full_name: safeString(input.profile, 'full_name') || (typeof input.authUser?.user_metadata?.full_name === 'string' ? input.authUser.user_metadata.full_name : null),
    phone: safeString(input.profile, 'phone') || input.authUser?.phone || null,
    username: safeString(input.profile, 'username'),
    role_label: safeString(input.profile, 'role_label'),
    account_type: safeString(input.profile, 'account_type'),
    department: safeString(input.profile, 'department'),
    job_title: safeString(input.profile, 'job_title'),
    employee_id: safeString(input.profile, 'employee_id'),
    start_date: safeString(input.profile, 'start_date'),
    status,
    is_company_staff: safeBoolean(input.profile, 'is_company_staff'),
    last_sign_in_at: input.authUser?.last_sign_in_at || null,
    permission_count: input.permissionKeys.length,
    permission_keys: input.permissionKeys,
    has_support_access: supportActive,
    support_role_code: safeString(input.supportRow, 'role_code'),
    support_permissions: supportPermissions,
    created_at: safeString(input.profile, 'created_at') || input.authUser?.created_at || null,
  };
}

export async function loadStaffMembers() {
  const supabaseAdmin = getSupabaseAdmin();
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

  return profileRows
    .map((profile) => {
      const userId = safeString(profile, 'user_id') || '';
      return normalizeStaffMember({
        profile,
        authUser: authUsers.get(userId) || null,
        permissionKeys: permissionsByUser.get(userId) || [],
        supportRow: supportByUser.get(userId) || null,
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
  const role = filters.role?.trim().toLowerCase();
  return staff.filter((member) => {
    if (filters.department && member.department !== filters.department) return false;
    if (role && !(member.role_label || '').toLowerCase().includes(role)) return false;
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
      member.job_title,
      member.employee_id,
      member.role_label,
      member.department,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(search);
  });
}

export async function upsertStaffProfile(userId: string, email: string, body: StaffMutationBody, actorUserId: string, fallbackStatus: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const department = textOrNull(body.department);
  if (!department || !VALID_DEPARTMENTS.has(department)) throw new Error('Select a valid department.');

  const profilePayload: JsonRecord = {
    user_id: userId,
    email,
    full_name: textOrNull(body.full_name),
    phone: textOrNull(body.phone),
    department,
    job_title: textOrNull(body.job_title),
    employee_id: textOrNull(body.employee_id),
    start_date: textOrNull(body.start_date),
    role_label: textOrNull(body.role_label),
    account_type: 'platform_internal',
    status: VALID_STATUSES.has(textOrNull(body.status) || '') ? textOrNull(body.status) : fallbackStatus,
    is_company_staff: true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(profilePayload, { onConflict: 'user_id' });

  if (error) throw new Error(error.message);

  return { ...profilePayload, updated_by: actorUserId };
}

export async function replaceUserPermissions(userId: string, permissionKeys: string[], actorUserId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const uniqueKeys = Array.from(new Set(permissionKeys.map((key) => key.trim()).filter(Boolean)));

  const { data: oldRows } = await supabaseAdmin
    .from('user_permissions')
    .select('permission_key, can_delegate')
    .eq('user_id', userId);

  const { error: deleteError } = await supabaseAdmin.from('user_permissions').delete().eq('user_id', userId);
  if (deleteError) throw new Error(deleteError.message);

  if (uniqueKeys.length) {
    const { error: insertError } = await supabaseAdmin.from('user_permissions').insert(
      uniqueKeys.map((permissionKey) => ({
        user_id: userId,
        permission_key: permissionKey,
        can_delegate: false,
        granted_by: actorUserId,
      }))
    );
    if (insertError) throw new Error(insertError.message);
  }

  return {
    oldPermissions: (oldRows || []) as JsonRecord[],
    newPermissions: uniqueKeys,
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
  const permissions = supportPermissionsFromInput(input.supportPermissionKeys, input.roleCode);

  const { data: oldRow } = await supabaseAdmin
    .from('support_agent_permissions')
    .select('*')
    .eq('user_id', input.userId)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from('support_agent_permissions')
    .upsert(
      {
        user_id: input.userId,
        email: input.email,
        role_code: input.roleCode,
        permissions,
        is_active: input.enabled,
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  return {
    oldRow: (oldRow || null) as JsonRecord | null,
    newRow: (data || null) as JsonRecord | null,
  };
}

export async function sendInvite(email: string, fullName: string | null) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: {
      full_name: fullName,
      company_staff_invite: true,
    },
  });

  if (error || !data.user) {
    throw new Error('Invite email could not be sent. Check Supabase email settings.');
  }

  return data.user;
}

export async function sendResetEmail(email: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);

  if (error) {
    throw new Error('Reset email could not be sent. Check Supabase email settings.');
  }
}

export async function auditStaffAction(input: {
  actorUserId: string;
  action: string;
  targetUserId: string;
  targetEmail: string;
  oldValues?: JsonRecord | null;
  newValues?: JsonRecord | null;
  metadata?: JsonRecord | null;
  reason?: string | null;
}) {
  await createAdminAuditLog({
    actorUserId: input.actorUserId,
    action: input.action,
    targetUserId: input.targetUserId,
    targetTable: 'user_profiles',
    targetRecordId: input.targetUserId,
    oldValues: input.oldValues || null,
    newValues: input.newValues || null,
    metadata: {
      target_user_id: input.targetUserId,
      target_email: input.targetEmail,
      ...(input.metadata || {}),
    },
    reason: input.reason || null,
  });
}
