'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserCog,
  UserRoundCheck,
  UserRoundX,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminFetch, type AdminMeResponse } from '@/lib/admin-client';
import { cn } from '@/lib/utils';

type PlatformDepartment = {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  staff_count: number;
  role_count: number;
};

type PlatformRole = {
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
};

type PlatformPermissionGroup = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  permission_count: number;
};

type PlatformPermission = {
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
};

type TeamConfig = {
  departments: PlatformDepartment[];
  roles: PlatformRole[];
  permissionGroups: PlatformPermissionGroup[];
  permissions: PlatformPermission[];
  tablesMissing: boolean;
  warning?: string;
};

type StaffMember = {
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

type TeamResponse = {
  staff: StaffMember[];
  total: number;
  page: number;
  limit: number;
};

type StaffFormState = {
  email: string;
  full_name: string;
  phone: string;
  platform_department_id: string;
  platform_role_id: string;
  custom_role_name: string;
  job_title: string;
  employee_id: string;
  start_date: string;
  notes: string;
  support_role_code: string;
  support_access_enabled: boolean;
  permission_keys: string[];
  support_permission_keys: string[];
  temporary_password: string;
  confirm_temporary_password: string;
  require_password_change: boolean;
  password_reason: string;
};

type ConfigFormState = {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string;
  department_id: string;
  permission_key: string;
  label: string;
  group_id: string;
  group_name: string;
  module_key: string;
  sort_order: string;
  is_active: boolean;
  is_system_role: boolean;
  is_superadmin_role: boolean;
  grants_support_access: boolean;
  is_system_permission: boolean;
  is_dangerous: boolean;
  permission_keys: string[];
};

type ActiveTab = 'staff' | 'departments' | 'roles' | 'permissions';
type DrawerMode = 'createStaff' | 'editStaff' | 'staffPermissions' | 'supportAccess' | 'setPassword' | 'department' | 'role' | 'group' | 'permission' | null;

const LIMIT = 50;
const EMPTY_CONFIG: TeamConfig = {
  departments: [],
  roles: [],
  permissionGroups: [],
  permissions: [],
  tablesMissing: false,
};

const EMPTY_STAFF_FORM: StaffFormState = {
  email: '',
  full_name: '',
  phone: '',
  platform_department_id: '',
  platform_role_id: '',
  custom_role_name: '',
  job_title: '',
  employee_id: '',
  start_date: '',
  notes: '',
  support_role_code: '',
  support_access_enabled: false,
  permission_keys: [],
  support_permission_keys: [],
  temporary_password: '',
  confirm_temporary_password: '',
  require_password_change: true,
  password_reason: '',
};

const EMPTY_CONFIG_FORM: ConfigFormState = {
  id: '',
  name: '',
  code: '',
  color: 'gray',
  description: '',
  department_id: '',
  permission_key: '',
  label: '',
  group_id: '',
  group_name: '',
  module_key: '',
  sort_order: '0',
  is_active: true,
  is_system_role: false,
  is_superadmin_role: false,
  grants_support_access: false,
  is_system_permission: false,
  is_dangerous: false,
  permission_keys: [],
};

const DEPARTMENT_COLORS: Record<string, string> = {
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  orange: 'border-orange-200 bg-orange-50 text-orange-700',
  purple: 'border-purple-200 bg-purple-50 text-purple-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  gray: 'border-slate-200 bg-slate-50 text-slate-700',
};

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function pretty(value: string | null | undefined) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initials(member: StaffMember) {
  return (member.full_name || member.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function toggleValue(values: string[], key: string) {
  return values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
}

function badgeClass(color: string | null | undefined) {
  return DEPARTMENT_COLORS[color || 'gray'] || DEPARTMENT_COLORS.gray;
}

function statusBadgeClass(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'invited') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'suspended') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function permissionBadges(member: StaffMember) {
  const badges: string[] = [];
  if (member.permission_keys.includes('platform.superadmin')) badges.push('Superadmin');
  if (member.has_support_access) badges.push('Support Access');
  if (member.permission_keys.some((key) => key.startsWith('billing.'))) badges.push('Billing Access');
  if (member.permission_keys.some((key) => key.startsWith('stores.'))) badges.push('Store Access');
  return badges;
}

export default function SuperadminTeamPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('staff');
  const [config, setConfig] = useState<TeamConfig>(EMPTY_CONFIG);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supportAccessFilter, setSupportAccessFilter] = useState('');
  const [superadminFilter, setSuperadminFilter] = useState('');
  const [configSearch, setConfigSearch] = useState('');
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffForm, setStaffForm] = useState<StaffFormState>(EMPTY_STAFF_FORM);
  const [configForm, setConfigForm] = useState<ConfigFormState>(EMPTY_CONFIG_FORM);

  const activeDepartments = useMemo(() => config.departments.filter((department) => department.is_active), [config.departments]);
  const activeRoles = useMemo(() => config.roles.filter((role) => role.is_active), [config.roles]);
  const activePermissions = useMemo(() => config.permissions.filter((permission) => permission.is_active), [config.permissions]);
  const supportPermissions = useMemo(
    () => config.permissions.filter((permission) => permission.group_name.toLowerCase() === 'support' && permission.is_active),
    [config.permissions]
  );

  const showSuccess = useCallback((message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const response = await adminFetch<TeamConfig>('/api/superadmin/team/config');
      setConfig(response);
      return response;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load team configuration.');
      return EMPTY_CONFIG;
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadTeam = useCallback(
    async (currentPage = page) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(currentPage), limit: String(LIMIT) });
        if (search.trim()) params.set('search', search.trim());
        if (departmentFilter) params.set('department', departmentFilter);
        if (roleFilter) params.set('role', roleFilter);
        if (statusFilter) params.set('status', statusFilter);
        if (supportAccessFilter) params.set('supportAccess', supportAccessFilter);
        if (superadminFilter) params.set('superadmin', superadminFilter);
        const response = await adminFetch<TeamResponse>(`/api/superadmin/team?${params.toString()}`);
        setStaff(response.staff);
        setTotal(response.total);
        setPage(currentPage);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load team.');
      } finally {
        setLoading(false);
      }
    },
    [departmentFilter, page, roleFilter, search, statusFilter, superadminFilter, supportAccessFilter]
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [loadedConfig, me] = await Promise.all([
        loadConfig(),
        adminFetch<AdminMeResponse>('/api/admin/me').catch(() => null),
      ]);
      setCurrentUserId(me?.user.id || null);
      if (!loadedConfig.tablesMissing) {
        await loadTeam(0);
      } else {
        setStaff([]);
        setTotal(0);
        setLoading(false);
      }
    })();
  }, []);

  const refreshAll = async () => {
    const loadedConfig = await loadConfig();
    if (!loadedConfig.tablesMissing) await loadTeam(page);
  };

  const summary = useMemo(
    () => ({
      totalStaff: total,
      activeStaff: staff.filter((member) => member.status === 'active').length,
      supportStaff: staff.filter((member) => member.has_support_access).length,
      superadmins: staff.filter((member) => member.permission_keys.includes('platform.superadmin')).length,
      invited: staff.filter((member) => member.status === 'invited' || !member.last_sign_in_at).length,
    }),
    [staff, total]
  );

  const groupedPermissions = useMemo(() => {
    return config.permissionGroups
      .filter((group) => group.is_active)
      .map((group) => ({
        group,
        permissions: activePermissions
          .filter((permission) => permission.group_id === group.id || (!permission.group_id && permission.group_name === group.name))
          .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)),
      }))
      .filter((entry) => entry.permissions.length > 0);
  }, [activePermissions, config.permissionGroups]);

  const openCreateStaff = () => {
    setStaffForm(EMPTY_STAFF_FORM);
    setEditingStaff(null);
    setDrawerMode('createStaff');
    setError(null);
  };

  const openEditStaff = (member: StaffMember) => {
    setEditingStaff(member);
    setStaffForm({
      email: member.email,
      full_name: member.full_name || '',
      phone: member.phone || '',
      platform_department_id: member.platform_department_id || '',
      platform_role_id: member.platform_role_id || '',
      custom_role_name: member.custom_role_name || '',
      job_title: member.job_title || '',
      employee_id: member.employee_id || '',
      start_date: member.start_date || '',
      notes: member.notes || '',
      support_role_code: member.support_role_code || '',
      support_access_enabled: member.has_support_access,
      permission_keys: member.catalog_permission_keys,
      support_permission_keys: member.support_permissions,
      temporary_password: '',
      confirm_temporary_password: '',
      require_password_change: true,
      password_reason: '',
    });
    setDrawerMode('editStaff');
    setError(null);
  };

  const openStaffPermissions = (member: StaffMember) => {
    setEditingStaff(member);
    setStaffForm((current) => ({ ...current, permission_keys: member.catalog_permission_keys }));
    setDrawerMode('staffPermissions');
    setError(null);
  };

  const openSupportAccess = (member: StaffMember) => {
    setEditingStaff(member);
    setStaffForm((current) => ({
      ...current,
      support_access_enabled: member.has_support_access,
      support_role_code: member.support_role_code || '',
      support_permission_keys: member.support_permissions,
    }));
    setDrawerMode('supportAccess');
    setError(null);
  };

  const openSetPassword = (member: StaffMember) => {
    setEditingStaff(member);
    setStaffForm((current) => ({
      ...current,
      temporary_password: '',
      confirm_temporary_password: '',
      require_password_change: true,
      password_reason: '',
    }));
    setDrawerMode('setPassword');
    setError(null);
  };

  const openConfigDrawer = (mode: Exclude<DrawerMode, 'createStaff' | 'editStaff' | 'staffPermissions' | 'supportAccess' | 'setPassword' | null>, row?: PlatformDepartment | PlatformRole | PlatformPermissionGroup | PlatformPermission) => {
    if (!row) {
      setConfigForm(EMPTY_CONFIG_FORM);
    } else if (mode === 'department') {
      const department = row as PlatformDepartment;
      setConfigForm({ ...EMPTY_CONFIG_FORM, id: department.id, name: department.name, code: department.code, color: department.color, description: department.description || '', sort_order: String(department.sort_order), is_active: department.is_active });
    } else if (mode === 'role') {
      const role = row as PlatformRole;
      setConfigForm({ ...EMPTY_CONFIG_FORM, id: role.id, name: role.name, code: role.code, description: role.description || '', department_id: role.department_id || '', sort_order: String(role.sort_order), is_active: role.is_active, is_system_role: role.is_system_role, is_superadmin_role: role.is_superadmin_role, grants_support_access: role.grants_support_access, permission_keys: role.permission_keys });
    } else if (mode === 'group') {
      const group = row as PlatformPermissionGroup;
      setConfigForm({ ...EMPTY_CONFIG_FORM, id: group.id, name: group.name, code: group.code, description: group.description || '', sort_order: String(group.sort_order), is_active: group.is_active });
    } else {
      const permission = row as PlatformPermission;
      setConfigForm({ ...EMPTY_CONFIG_FORM, id: permission.id, permission_key: permission.permission_key, label: permission.label, group_id: permission.group_id || '', group_name: permission.group_name, module_key: permission.module_key || '', description: permission.description || '', sort_order: String(permission.sort_order), is_active: permission.is_active, is_system_permission: permission.is_system_permission, is_dangerous: permission.is_dangerous });
    }
    setDrawerMode(mode);
    setError(null);
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingStaff(null);
    setStaffForm(EMPTY_STAFF_FORM);
    setConfigForm(EMPTY_CONFIG_FORM);
  };

  const selectRole = (roleId: string) => {
    const role = config.roles.find((item) => item.id === roleId);
    setStaffForm((current) => ({
      ...current,
      platform_role_id: roleId,
      support_access_enabled: role?.grants_support_access || current.support_access_enabled,
      permission_keys: role?.permission_keys.length ? role.permission_keys : current.permission_keys,
    }));
  };

  const confirmDangerousGrant = (selectedKeys: string[], previousKeys: string[]) => {
    if (!selectedKeys.includes('platform.superadmin') || previousKeys.includes('platform.superadmin')) return true;
    return window.confirm('You are granting full platform owner access. This user will be able to manage stores, users, billing, settings, staff, and platform data. Continue?');
  };

  const submitStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!staffForm.full_name.trim()) {
      setError('Full name is required.');
      return;
    }
    if (!staffForm.email.trim()) {
      setError('Email is required.');
      return;
    }
    if (drawerMode === 'createStaff') {
      if (!staffForm.temporary_password) {
        setError('Temporary password is required.');
        return;
      }
      if (staffForm.temporary_password.length < 8) {
        setError('Temporary password must be at least 8 characters.');
        return;
      }
      if (staffForm.temporary_password !== staffForm.confirm_temporary_password) {
        setError('Temporary password and confirmation must match.');
        return;
      }
    }
    if (!confirmDangerousGrant(staffForm.permission_keys, editingStaff?.permission_keys || [])) return;

    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        ...staffForm,
        notes: staffForm.notes.trim(),
        temporary_password: drawerMode === 'createStaff' ? staffForm.temporary_password : undefined,
        require_password_change: staffForm.require_password_change,
      };
      const url = drawerMode === 'editStaff' && editingStaff ? `/api/superadmin/team/${editingStaff.user_id}` : '/api/superadmin/team';
      const response = await adminFetch<{ message: string }>(url, {
        method: drawerMode === 'editStaff' ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      showSuccess(response.message);
      closeDrawer();
      await refreshAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save staff member.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveTemporaryPassword = async () => {
    if (!editingStaff) return;
    if (!staffForm.temporary_password) {
      setError('Temporary password is required.');
      return;
    }
    if (staffForm.temporary_password.length < 8) {
      setError('Temporary password must be at least 8 characters.');
      return;
    }
    if (staffForm.temporary_password !== staffForm.confirm_temporary_password) {
      setError('Temporary password and confirmation must match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await adminFetch<{ message: string }>(`/api/superadmin/team/${editingStaff.user_id}/password`, {
        method: 'POST',
        body: JSON.stringify({
          password: staffForm.temporary_password,
          requirePasswordChange: staffForm.require_password_change,
          reason: staffForm.password_reason.trim() || null,
        }),
      });
      showSuccess(`${response.message} Share it with the staff member manually.`);
      closeDrawer();
      await refreshAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to set temporary password.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveStaffPermissions = async () => {
    if (!editingStaff) return;
    if (!confirmDangerousGrant(staffForm.permission_keys, editingStaff.permission_keys)) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await adminFetch<{ message: string }>(`/api/superadmin/team/${editingStaff.user_id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permission_keys: staffForm.permission_keys }),
      });
      showSuccess(response.message);
      closeDrawer();
      await refreshAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update permissions.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveSupportAccess = async () => {
    if (!editingStaff) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await adminFetch<{ message: string }>(`/api/superadmin/team/${editingStaff.user_id}/support-access`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: staffForm.support_access_enabled,
          role_code: staffForm.support_role_code,
          support_permission_keys: staffForm.support_permission_keys,
        }),
      });
      showSuccess(response.message);
      closeDrawer();
      await refreshAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update support access.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const common = {
        name: configForm.name,
        code: configForm.code,
        description: configForm.description,
        sort_order: configForm.sort_order,
        is_active: configForm.is_active,
      };
      let url = '';
      let method = configForm.id ? 'PATCH' : 'POST';
      let payload: Record<string, unknown> = {};
      if (drawerMode === 'department') {
        url = configForm.id ? `/api/superadmin/team/departments/${configForm.id}` : '/api/superadmin/team/departments';
        payload = { ...common, color: configForm.color };
      } else if (drawerMode === 'role') {
        url = configForm.id ? `/api/superadmin/team/roles/${configForm.id}` : '/api/superadmin/team/roles';
        payload = { ...common, department_id: configForm.department_id || null, is_system_role: configForm.is_system_role, is_superadmin_role: configForm.is_superadmin_role, grants_support_access: configForm.grants_support_access, permission_keys: configForm.permission_keys };
      } else if (drawerMode === 'group') {
        url = configForm.id ? `/api/superadmin/team/permission-groups/${configForm.id}` : '/api/superadmin/team/permission-groups';
      } else if (drawerMode === 'permission') {
        url = configForm.id ? `/api/superadmin/team/permissions/${configForm.id}` : '/api/superadmin/team/permissions';
        payload = { permission_key: configForm.permission_key, label: configForm.label, group_id: configForm.group_id || null, group_name: configForm.group_name, module_key: configForm.module_key, description: configForm.description, sort_order: configForm.sort_order, is_active: configForm.is_active, is_system_permission: configForm.is_system_permission, is_dangerous: configForm.is_dangerous };
      }
      if (!payload.name && drawerMode !== 'permission') payload = common;
      const response = await adminFetch<{ message: string }>(url, { method, body: JSON.stringify(payload) });
      showSuccess(response.message);
      closeDrawer();
      await refreshAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save configuration.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteConfig = async (kind: 'departments' | 'roles' | 'permission-groups' | 'permissions', id: string, label: string) => {
    if (!window.confirm(`Delete or deactivate "${label}"?`)) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await adminFetch<{ message: string }>(`/api/superadmin/team/${kind}/${id}`, { method: 'DELETE' });
      showSuccess(response.message);
      await refreshAll();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete configuration.');
    } finally {
      setSubmitting(false);
    }
  };

  const runStaffAction = async (member: StaffMember, action: 'deactivate' | 'reactivate') => {
    if (action === 'deactivate' && member.user_id === currentUserId && member.permission_keys.includes('platform.superadmin')) {
      setError('You cannot deactivate your own platform superadmin account.');
      return;
    }
    const labels = {
      deactivate: 'Deactivate this staff member and disable Support Desk access?',
      reactivate: 'Reactivate this staff member?',
    };
    if (!window.confirm(labels[action])) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await adminFetch<{ message: string }>(`/api/superadmin/team/${member.user_id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      showSuccess(response.message);
      await refreshAll();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to complete action.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectAllCatalogPermissions = () => setStaffForm((current) => ({ ...current, permission_keys: activePermissions.map((permission) => permission.permission_key) }));
  const clearAllCatalogPermissions = () => setStaffForm((current) => ({ ...current, permission_keys: [] }));

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));
  const start = total === 0 ? 0 : page * LIMIT + 1;
  const end = Math.min(total, (page + 1) * LIMIT);
  const summaryCards: Array<[string, number, LucideIcon]> = [
    ['Total Staff', summary.totalStaff, Users],
    ['Active Staff', summary.activeStaff, UserRoundCheck],
    ['Support Staff', summary.supportStaff, ShieldCheck],
    ['Superadmins', summary.superadmins, UserCog],
  ];

  return (
    <SuperadminShell>
      <SuperadminPageHeader title="Company Team" description="Manage StorePulse AI internal staff, departments, roles, and permissions.">
        <Button variant="outline" onClick={() => void refreshAll()} disabled={loading || configLoading}>
          {loading || configLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
        <Button onClick={openCreateStaff} disabled={config.tablesMissing}>
          <Plus className="mr-2 h-4 w-4" />
          Add Staff Member
        </Button>
      </SuperadminPageHeader>

      <div className="space-y-6">
        {config.tablesMissing && (
          <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>Dynamic configuration tables not yet created. Run the SQL migration in Supabase to enable Departments, Roles, and Permissions tabs.</p>
            </div>
          </Card>
        )}

        {error && (
          <Card className="flex items-start justify-between gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshAll()}>Retry</Button>
          </Card>
        )}

        {success && (
          <Card className="flex items-start gap-3 border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">{success}</p>
          </Card>
        )}

        <div className="flex flex-wrap gap-2 border-b">
          {[
            ['staff', 'Staff Members'],
            ['departments', 'Departments'],
            ['roles', 'Roles'],
            ['permissions', 'Permissions'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as ActiveTab)}
              className={cn('border-b-2 px-4 py-2 text-sm font-medium', activeTab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'staff' && (
          <StaffTab
            staff={staff}
            loading={loading}
            total={total}
            page={page}
            pageCount={pageCount}
            start={start}
            end={end}
            summaryCards={summaryCards}
            departments={config.departments}
            roles={config.roles}
            search={search}
            setSearch={setSearch}
            departmentFilter={departmentFilter}
            setDepartmentFilter={setDepartmentFilter}
            roleFilter={roleFilter}
            setRoleFilter={setRoleFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            supportAccessFilter={supportAccessFilter}
            setSupportAccessFilter={setSupportAccessFilter}
            superadminFilter={superadminFilter}
            setSuperadminFilter={setSuperadminFilter}
            loadTeam={loadTeam}
            openCreateStaff={openCreateStaff}
            openEditStaff={openEditStaff}
            openStaffPermissions={openStaffPermissions}
            openSupportAccess={openSupportAccess}
            openSetPassword={openSetPassword}
            runStaffAction={runStaffAction}
            submitting={submitting}
          />
        )}

        {activeTab === 'departments' && (
          <ConfigList
            title="Departments"
            description="Create and manage company staff departments."
            search={configSearch}
            setSearch={setConfigSearch}
            empty="No departments found."
            onCreate={() => openConfigDrawer('department')}
            rows={config.departments.filter((department) => searchable(department, configSearch))}
            renderRow={(department) => (
              <ConfigRow
                key={department.id}
                title={department.name}
                subtitle={department.code}
                badges={[department.is_active ? 'Active' : 'Inactive', `${department.staff_count} staff`, `${department.role_count} roles`]}
                body={department.description}
                onEdit={() => openConfigDrawer('department', department)}
                onDelete={() => void deleteConfig('departments', department.id, department.name)}
              />
            )}
          />
        )}

        {activeTab === 'roles' && (
          <ConfigList
            title="Roles"
            description="Create staff roles and assign default permissions."
            search={configSearch}
            setSearch={setConfigSearch}
            empty="No roles found."
            onCreate={() => openConfigDrawer('role')}
            rows={config.roles.filter((role) => searchable(role, configSearch))}
            renderRow={(role) => (
              <ConfigRow
                key={role.id}
                title={role.name}
                subtitle={[role.code, role.department_name].filter(Boolean).join(' · ')}
                badges={[role.is_active ? 'Active' : 'Inactive', `${role.permission_keys.length} permissions`, `${role.staff_count} staff`, role.grants_support_access ? 'Support Access' : 'No Support']}
                body={role.description}
                onEdit={() => openConfigDrawer('role', role)}
                onDelete={() => void deleteConfig('roles', role.id, role.name)}
              />
            )}
          />
        )}

        {activeTab === 'permissions' && (
          <PermissionsTab
            config={config}
            search={configSearch}
            setSearch={setConfigSearch}
            openGroup={(group) => openConfigDrawer('group', group)}
            openPermission={(permission) => openConfigDrawer('permission', permission)}
            createGroup={() => openConfigDrawer('group')}
            createPermission={() => openConfigDrawer('permission')}
            deleteGroup={deleteConfig}
            deletePermission={deleteConfig}
          />
        )}
      </div>

      {drawerMode && (
        <TeamDrawer title={drawerTitle(drawerMode, editingStaff)} onClose={closeDrawer}>
          {(drawerMode === 'createStaff' || drawerMode === 'editStaff') && (
            <StaffForm
              form={staffForm}
              setForm={setStaffForm}
              departments={activeDepartments}
              roles={activeRoles}
              groupedPermissions={groupedPermissions}
              legacyKeys={editingStaff?.legacy_permission_keys || []}
              onRoleChange={selectRole}
              onSubmit={submitStaff}
              submitting={submitting}
              mode={drawerMode}
              selectAll={selectAllCatalogPermissions}
              clearAll={clearAllCatalogPermissions}
              onCancel={closeDrawer}
            />
          )}

          {drawerMode === 'staffPermissions' && (
            <div className="space-y-5 p-5">
              <PermissionPicker
                groupedPermissions={groupedPermissions}
                selected={staffForm.permission_keys}
                setSelected={(permissionKeys) => setStaffForm((current) => ({ ...current, permission_keys: permissionKeys }))}
                selectAll={selectAllCatalogPermissions}
                clearAll={clearAllCatalogPermissions}
              />
              <LegacyPermissions keys={editingStaff?.legacy_permission_keys || []} />
              <DrawerActions onCancel={closeDrawer} onSave={() => void saveStaffPermissions()} submitting={submitting} saveLabel="Save Permissions" />
            </div>
          )}

          {drawerMode === 'supportAccess' && (
            <div className="space-y-5 p-5">
              <Card className="space-y-4 p-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={staffForm.support_access_enabled} onChange={(event) => setStaffForm((current) => ({ ...current, support_access_enabled: event.target.checked }))} />
                  Enable Support Desk access
                </label>
                <Field label="Support role code">
                  <Input value={staffForm.support_role_code} onChange={(event) => setStaffForm((current) => ({ ...current, support_role_code: event.target.value }))} placeholder="agent, manager, billing_support..." />
                </Field>
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-semibold">Support Permissions</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {supportPermissions.map((permission) => (
                    <label key={permission.permission_key} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={staffForm.support_permission_keys.includes(permission.permission_key)}
                        onChange={() => setStaffForm((current) => ({ ...current, support_permission_keys: toggleValue(current.support_permission_keys, permission.permission_key) }))}
                        className="mt-0.5"
                      />
                      <span>{permission.label}</span>
                    </label>
                  ))}
                </div>
              </Card>
              <DrawerActions onCancel={closeDrawer} onSave={() => void saveSupportAccess()} submitting={submitting} saveLabel="Save Support Access" />
            </div>
          )}

          {drawerMode === 'setPassword' && (
            <div className="space-y-5 p-5">
              <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                This will replace the staff member&apos;s current password. The old password cannot be viewed. Share the new temporary password manually.
              </Card>
              <Field label="New Temporary Password *">
                <Input type="password" value={staffForm.temporary_password} onChange={(event) => setStaffForm((current) => ({ ...current, temporary_password: event.target.value }))} />
              </Field>
              <Field label="Confirm Temporary Password *">
                <Input type="password" value={staffForm.confirm_temporary_password} onChange={(event) => setStaffForm((current) => ({ ...current, confirm_temporary_password: event.target.value }))} />
              </Field>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={staffForm.require_password_change} onChange={(event) => setStaffForm((current) => ({ ...current, require_password_change: event.target.checked }))} />
                Require password change on next login
              </label>
              <Field label="Reason">
                <textarea rows={2} value={staffForm.password_reason} onChange={(event) => setStaffForm((current) => ({ ...current, password_reason: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              </Field>
              <DrawerActions onCancel={closeDrawer} onSave={() => void saveTemporaryPassword()} submitting={submitting} saveLabel="Set Temporary Password" />
            </div>
          )}

          {['department', 'role', 'group', 'permission'].includes(drawerMode) && (
            <ConfigForm
              mode={drawerMode}
              form={configForm}
              setForm={setConfigForm}
              config={config}
              groupedPermissions={groupedPermissions}
              onSubmit={submitConfig}
              onCancel={closeDrawer}
              submitting={submitting}
            />
          )}
        </TeamDrawer>
      )}
    </SuperadminShell>
  );
}

function StaffTab(props: {
  staff: StaffMember[];
  loading: boolean;
  total: number;
  page: number;
  pageCount: number;
  start: number;
  end: number;
  summaryCards: Array<[string, number, LucideIcon]>;
  departments: PlatformDepartment[];
  roles: PlatformRole[];
  search: string;
  setSearch: (value: string) => void;
  departmentFilter: string;
  setDepartmentFilter: (value: string) => void;
  roleFilter: string;
  setRoleFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  supportAccessFilter: string;
  setSupportAccessFilter: (value: string) => void;
  superadminFilter: string;
  setSuperadminFilter: (value: string) => void;
  loadTeam: (page?: number) => Promise<void>;
  openCreateStaff: () => void;
  openEditStaff: (member: StaffMember) => void;
  openStaffPermissions: (member: StaffMember) => void;
  openSupportAccess: (member: StaffMember) => void;
  openSetPassword: (member: StaffMember) => void;
  runStaffAction: (member: StaffMember, action: 'deactivate' | 'reactivate') => Promise<void>;
  submitting: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {props.summaryCards.map(([label, value, Icon]) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
              <Icon className="h-5 w-5 text-indigo-600" />
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1.5fr_180px_180px_150px_180px_190px_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Search staff, permissions, dates..." className="pl-9" />
          </div>
          <select value={props.departmentFilter} onChange={(event) => props.setDepartmentFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All Departments</option>
            {props.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
          <select value={props.roleFilter} onChange={(event) => props.setRoleFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All Roles</option>
            {props.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
          <select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All Statuses</option>
            {['active', 'invited', 'inactive', 'suspended'].map((status) => <option key={status} value={status}>{pretty(status)}</option>)}
          </select>
          <select value={props.supportAccessFilter} onChange={(event) => props.setSupportAccessFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Any Support Access</option>
            <option value="true">Has Support Access</option>
            <option value="false">No Support Access</option>
          </select>
          <select value={props.superadminFilter} onChange={(event) => props.setSuperadminFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Any Superadmin</option>
            <option value="true">Has Superadmin Permission</option>
            <option value="false">No Superadmin Permission</option>
          </select>
          <Button onClick={() => void props.loadTeam(0)}>Search</Button>
          <Button variant="outline" onClick={() => {
            props.setSearch('');
            props.setDepartmentFilter('');
            props.setRoleFilter('');
            props.setStatusFilter('');
            props.setSupportAccessFilter('');
            props.setSuperadminFilter('');
            window.setTimeout(() => void props.loadTeam(0), 0);
          }}>Clear</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b p-5">
          <h2 className="text-lg font-semibold">StorePulse Company Staff</h2>
          <p className="text-sm text-muted-foreground">Internal employees only. Store owners and store employees remain in Users.</p>
        </div>
        {props.loading ? (
          <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading team...
          </div>
        ) : props.staff.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
            <h3 className="font-semibold">No company staff found.</h3>
            <p className="mt-1 text-sm text-muted-foreground">Add your first StorePulse staff member.</p>
            <Button className="mt-4" onClick={props.openCreateStaff}>
              <Plus className="mr-2 h-4 w-4" />
              Add Staff Member
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Staff Member</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Access</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Permissions</th>
                    <th className="px-4 py-3">Created Date</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {props.staff.map((member) => (
                    <tr key={member.user_id} className="hover:bg-muted/25">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">{initials(member)}</div>
                          <div>
                            <p className="font-semibold">{member.full_name || member.email}</p>
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                            {member.employee_id && <p className="text-xs text-muted-foreground">Employee ID: {member.employee_id}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs font-medium', badgeClass(props.departments.find((department) => department.id === member.platform_department_id)?.color))}>{member.department || 'Unassigned'}</span>
                        <p className="mt-1 text-xs text-muted-foreground">{member.job_title || member.role_name || member.custom_role_name || 'Role not set'}</p>
                      </td>
                      <td className="px-4 py-4">
                        {member.has_support_access ? <Badge>Support Access</Badge> : <Badge muted>No Support Access</Badge>}
                        <p className="mt-1 text-xs text-muted-foreground">{member.support_role_code || 'No support role'}</p>
                      </td>
                      <td className="px-4 py-4">
                        <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs font-medium', statusBadgeClass(member.status))}>{pretty(member.status)}</span>
                        <p className="mt-1 text-xs text-muted-foreground">{member.last_sign_in_at ? `Last login ${formatDate(member.last_sign_in_at)}` : 'Never logged in'}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium">{member.permission_count} permissions</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {permissionBadges(member).map((badge) => <span key={badge} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">{badge}</span>)}
                          {member.legacy_permission_keys.length > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{member.legacy_permission_keys.length} legacy</span>}
                        </div>
                      </td>
                      <td className="px-4 py-4">{formatDate(member.created_at)}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => props.openEditStaff(member)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                          <Button variant="outline" size="sm" onClick={() => props.openStaffPermissions(member)}><UserCog className="mr-1 h-3.5 w-3.5" />Permissions</Button>
                          <Button variant="outline" size="sm" onClick={() => props.openSupportAccess(member)}><ShieldCheck className="mr-1 h-3.5 w-3.5" />Support</Button>
                          <Button variant="outline" size="sm" onClick={() => props.openSetPassword(member)} disabled={props.submitting}><KeyRound className="mr-1 h-3.5 w-3.5" />Set Password</Button>
                          {member.status === 'inactive' ? (
                            <Button variant="outline" size="sm" onClick={() => void props.runStaffAction(member, 'reactivate')} disabled={props.submitting}><UserRoundCheck className="mr-1 h-3.5 w-3.5" />Reactivate</Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => void props.runStaffAction(member, 'deactivate')} disabled={props.submitting}><UserRoundX className="mr-1 h-3.5 w-3.5" />Deactivate</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p>Showing {props.start}-{props.end} of {props.total}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={props.page === 0 || props.loading} onClick={() => void props.loadTeam(props.page - 1)}>Previous</Button>
                <span>Page {props.page + 1} of {props.pageCount}</span>
                <Button variant="outline" size="sm" disabled={props.page + 1 >= props.pageCount || props.loading} onClick={() => void props.loadTeam(props.page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function StaffForm(props: {
  form: StaffFormState;
  setForm: React.Dispatch<React.SetStateAction<StaffFormState>>;
  departments: PlatformDepartment[];
  roles: PlatformRole[];
  groupedPermissions: Array<{ group: PlatformPermissionGroup; permissions: PlatformPermission[] }>;
  legacyKeys: string[];
  onRoleChange: (roleId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  mode: 'createStaff' | 'editStaff';
  selectAll: () => void;
  clearAll: () => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full Name *"><Input required value={props.form.full_name} onChange={(event) => props.setForm((current) => ({ ...current, full_name: event.target.value }))} /></Field>
        <Field label="Email *">
          <Input required type="email" value={props.form.email} disabled={props.mode === 'editStaff'} onChange={(event) => props.setForm((current) => ({ ...current, email: event.target.value }))} />
          {props.mode === 'createStaff' && <p className="text-xs text-muted-foreground">Email invite is disabled for now. This staff member will log in with their email and temporary password.</p>}
        </Field>
        {props.mode === 'createStaff' && (
          <>
            <Field label="Temporary Password *">
              <Input required type="password" minLength={8} value={props.form.temporary_password} onChange={(event) => props.setForm((current) => ({ ...current, temporary_password: event.target.value }))} />
            </Field>
            <Field label="Confirm Temporary Password *">
              <Input required type="password" minLength={8} value={props.form.confirm_temporary_password} onChange={(event) => props.setForm((current) => ({ ...current, confirm_temporary_password: event.target.value }))} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={props.form.require_password_change} onChange={(event) => props.setForm((current) => ({ ...current, require_password_change: event.target.checked }))} />
              Require password change on next login
            </label>
          </>
        )}
        <Field label="Phone"><Input value={props.form.phone} onChange={(event) => props.setForm((current) => ({ ...current, phone: event.target.value }))} /></Field>
        <Field label="Department">
          <select value={props.form.platform_department_id} onChange={(event) => props.setForm((current) => ({ ...current, platform_department_id: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Unassigned</option>
            {props.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </Field>
        <Field label="Role">
          <select value={props.form.platform_role_id} onChange={(event) => props.onRoleChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">No role</option>
            {props.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </Field>
        <Field label="Custom Role Name"><Input value={props.form.custom_role_name} onChange={(event) => props.setForm((current) => ({ ...current, custom_role_name: event.target.value }))} /></Field>
        <Field label="Job Title"><Input value={props.form.job_title} onChange={(event) => props.setForm((current) => ({ ...current, job_title: event.target.value }))} /></Field>
        <Field label="Employee ID"><Input value={props.form.employee_id} onChange={(event) => props.setForm((current) => ({ ...current, employee_id: event.target.value }))} /></Field>
        <Field label="Start Date"><Input type="date" value={props.form.start_date} onChange={(event) => props.setForm((current) => ({ ...current, start_date: event.target.value }))} /></Field>
      </div>
      <Field label="Internal Notes (optional)">
        <textarea rows={2} maxLength={1000} value={props.form.notes} onChange={(event) => props.setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="e.g. Reports to Balaji. Joined from sales team." className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </Field>
      <Card className="p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={props.form.support_access_enabled} onChange={(event) => props.setForm((current) => ({ ...current, support_access_enabled: event.target.checked }))} />
          Support Desk access
        </label>
        {props.form.support_access_enabled && (
          <div className="mt-3">
            <Field label="Support role code"><Input value={props.form.support_role_code} onChange={(event) => props.setForm((current) => ({ ...current, support_role_code: event.target.value }))} placeholder="agent, manager, billing_support..." /></Field>
          </div>
        )}
      </Card>
      <PermissionPicker groupedPermissions={props.groupedPermissions} selected={props.form.permission_keys} setSelected={(permissionKeys) => props.setForm((current) => ({ ...current, permission_keys: permissionKeys }))} selectAll={props.selectAll} clearAll={props.clearAll} />
      <LegacyPermissions keys={props.legacyKeys} />
      <DrawerActions onCancel={props.onCancel} submitting={props.submitting} saveLabel={props.mode === 'editStaff' ? 'Save Changes' : 'Add Staff Member'} submit />
    </form>
  );
}

function PermissionPicker(props: {
  groupedPermissions: Array<{ group: PlatformPermissionGroup; permissions: PlatformPermission[] }>;
  selected: string[];
  setSelected: (permissionKeys: string[]) => void;
  selectAll: () => void;
  clearAll: () => void;
}) {
  const setGroup = (keys: string[], checked: boolean) => {
    props.setSelected(checked ? Array.from(new Set([...props.selected, ...keys])) : props.selected.filter((key) => !keys.includes(key)));
  };
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Permission Groups</h3>
          <p className="text-xs text-muted-foreground">Only catalog permissions are changed here. Legacy permissions are preserved.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={props.selectAll}>Select All Permissions</Button>
          <Button type="button" size="sm" variant="outline" onClick={props.clearAll}>Clear All Permissions</Button>
        </div>
      </div>
      <div className="space-y-3">
        {props.groupedPermissions.map(({ group, permissions }) => {
          const keys = permissions.map((permission) => permission.permission_key);
          const selectedCount = keys.filter((key) => props.selected.includes(key)).length;
          return (
            <details key={group.id} className="rounded-lg border" open={group.code === 'platform'}>
              <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold">
                <span>{group.name} ({selectedCount}/{keys.length})</span>
                <span className="ml-3 flex gap-2">
                  <button type="button" className="text-xs text-indigo-700" onClick={(event) => { event.preventDefault(); setGroup(keys, true); }}>Select All</button>
                  <button type="button" className="text-xs text-muted-foreground" onClick={(event) => { event.preventDefault(); setGroup(keys, false); }}>Clear</button>
                </span>
              </summary>
              <div className="grid gap-2 border-t p-3 sm:grid-cols-2">
                {permissions.map((permission) => (
                  <label key={permission.permission_key} className="flex cursor-pointer items-start gap-2 rounded-lg bg-muted/20 p-3 text-sm">
                    <input type="checkbox" checked={props.selected.includes(permission.permission_key)} onChange={() => props.setSelected(toggleValue(props.selected, permission.permission_key))} className="mt-0.5" />
                    <span>
                      {permission.label}
                      {permission.is_dangerous && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">Dangerous</span>}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </Card>
  );
}

function LegacyPermissions({ keys }: { keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <Card className="border-amber-200 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold text-amber-900">Legacy Permissions</h3>
      <p className="text-xs text-amber-800">Other permissions not in catalog</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {keys.map((key) => <span key={key} className="rounded border border-amber-200 bg-white px-2 py-1 text-xs text-amber-800">{key}</span>)}
      </div>
    </Card>
  );
}

function ConfigList<T>(props: {
  title: string;
  description: string;
  search: string;
  setSearch: (value: string) => void;
  empty: string;
  onCreate: () => void;
  rows: T[];
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{props.title}</h2>
          <p className="text-sm text-muted-foreground">{props.description}</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder={`Search ${props.title.toLowerCase()}...`} className="pl-9" />
          </div>
          <Button onClick={props.onCreate}><Plus className="mr-2 h-4 w-4" />Create</Button>
        </div>
      </div>
      {props.rows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">{props.empty}</div> : <div className="divide-y">{props.rows.map(props.renderRow)}</div>}
    </Card>
  );
}

function ConfigRow(props: { title: string; subtitle: string; body?: string | null; badges: string[]; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold">{props.title}</p>
        <p className="text-xs text-muted-foreground">{props.subtitle}</p>
        {props.body && <p className="mt-1 text-sm text-muted-foreground">{props.body}</p>}
        <div className="mt-2 flex flex-wrap gap-1">{props.badges.map((badge) => <Badge key={badge} muted={badge.includes('Inactive') || badge.includes('No ')}>{badge}</Badge>)}</div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={props.onEdit}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
        <Button variant="outline" size="sm" onClick={props.onDelete}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
      </div>
    </div>
  );
}

function PermissionsTab(props: {
  config: TeamConfig;
  search: string;
  setSearch: (value: string) => void;
  openGroup: (group: PlatformPermissionGroup) => void;
  openPermission: (permission: PlatformPermission) => void;
  createGroup: () => void;
  createPermission: () => void;
  deleteGroup: (kind: 'permission-groups', id: string, label: string) => Promise<void>;
  deletePermission: (kind: 'permissions', id: string, label: string) => Promise<void>;
}) {
  const groups = props.config.permissionGroups.filter((group) => searchable(group, props.search));
  const permissions = props.config.permissions.filter((permission) => searchable(permission, props.search));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Permission Catalog</h2>
            <p className="text-sm text-muted-foreground">Create permission groups and controlled permission keys.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Search permissions..." className="pl-9" />
            </div>
            <Button variant="outline" onClick={props.createGroup}><Plus className="mr-2 h-4 w-4" />Group</Button>
            <Button onClick={props.createPermission}><Plus className="mr-2 h-4 w-4" />Permission</Button>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b p-4"><h3 className="font-semibold">Groups</h3></div>
          <div className="divide-y">{groups.map((group) => <ConfigRow key={group.id} title={group.name} subtitle={group.code} badges={[group.is_active ? 'Active' : 'Inactive', `${group.permission_count} permissions`]} body={group.description} onEdit={() => props.openGroup(group)} onDelete={() => void props.deleteGroup('permission-groups', group.id, group.name)} />)}</div>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b p-4"><h3 className="font-semibold">Permissions</h3></div>
          <div className="divide-y">{permissions.map((permission) => <ConfigRow key={permission.id} title={permission.label} subtitle={permission.permission_key} badges={[permission.is_active ? 'Active' : 'Inactive', permission.group_name, permission.is_dangerous ? 'Dangerous' : 'Standard', `${permission.assigned_user_count} users`, `${permission.assigned_role_count} roles`]} body={permission.description} onEdit={() => props.openPermission(permission)} onDelete={() => void props.deletePermission('permissions', permission.id, permission.label)} />)}</div>
        </Card>
      </div>
    </div>
  );
}

function ConfigForm(props: {
  mode: DrawerMode;
  form: ConfigFormState;
  setForm: React.Dispatch<React.SetStateAction<ConfigFormState>>;
  config: TeamConfig;
  groupedPermissions: Array<{ group: PlatformPermissionGroup; permissions: PlatformPermission[] }>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-5 p-5">
      {props.mode !== 'permission' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name *"><Input required value={props.form.name} onChange={(event) => props.setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Code *"><Input required value={props.form.code} onChange={(event) => props.setForm((current) => ({ ...current, code: event.target.value }))} /></Field>
          {props.mode === 'department' && <Field label="Color"><Input value={props.form.color} onChange={(event) => props.setForm((current) => ({ ...current, color: event.target.value }))} placeholder="blue, green, orange, purple, red, gray" /></Field>}
          {props.mode === 'role' && <Field label="Department"><select value={props.form.department_id} onChange={(event) => props.setForm((current) => ({ ...current, department_id: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">None</option>{props.config.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>}
          <Field label="Sort Order"><Input type="number" value={props.form.sort_order} onChange={(event) => props.setForm((current) => ({ ...current, sort_order: event.target.value }))} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.form.is_active} onChange={(event) => props.setForm((current) => ({ ...current, is_active: event.target.checked }))} />Active</label>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Permission Key *"><Input required value={props.form.permission_key} disabled={props.form.permission_key === 'platform.superadmin'} onChange={(event) => props.setForm((current) => ({ ...current, permission_key: event.target.value }))} /></Field>
          <Field label="Label *"><Input required value={props.form.label} onChange={(event) => props.setForm((current) => ({ ...current, label: event.target.value }))} /></Field>
          <Field label="Group"><select value={props.form.group_id} onChange={(event) => {
            const group = props.config.permissionGroups.find((item) => item.id === event.target.value);
            props.setForm((current) => ({ ...current, group_id: event.target.value, group_name: group?.name || current.group_name }));
          }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Custom</option>{props.config.permissionGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
          <Field label="Group Name"><Input value={props.form.group_name} onChange={(event) => props.setForm((current) => ({ ...current, group_name: event.target.value }))} /></Field>
          <Field label="Module Key"><Input value={props.form.module_key} onChange={(event) => props.setForm((current) => ({ ...current, module_key: event.target.value }))} /></Field>
          <Field label="Sort Order"><Input type="number" value={props.form.sort_order} onChange={(event) => props.setForm((current) => ({ ...current, sort_order: event.target.value }))} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.form.is_active} disabled={props.form.permission_key === 'platform.superadmin'} onChange={(event) => props.setForm((current) => ({ ...current, is_active: event.target.checked }))} />Active</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.form.is_dangerous} onChange={(event) => props.setForm((current) => ({ ...current, is_dangerous: event.target.checked }))} />Dangerous</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.form.is_system_permission} onChange={(event) => props.setForm((current) => ({ ...current, is_system_permission: event.target.checked }))} />System permission</label>
        </div>
      )}
      <Field label="Description"><textarea rows={3} value={props.form.description} onChange={(event) => props.setForm((current) => ({ ...current, description: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></Field>
      {props.mode === 'role' && (
        <>
          <Card className="space-y-2 p-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.form.is_system_role} onChange={(event) => props.setForm((current) => ({ ...current, is_system_role: event.target.checked }))} />System role</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.form.is_superadmin_role} onChange={(event) => props.setForm((current) => ({ ...current, is_superadmin_role: event.target.checked }))} />Superadmin role</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.form.grants_support_access} onChange={(event) => props.setForm((current) => ({ ...current, grants_support_access: event.target.checked }))} />Grants Support Desk access</label>
          </Card>
          <PermissionPicker groupedPermissions={props.groupedPermissions} selected={props.form.permission_keys} setSelected={(permissionKeys) => props.setForm((current) => ({ ...current, permission_keys: permissionKeys }))} selectAll={() => props.setForm((current) => ({ ...current, permission_keys: props.config.permissions.filter((permission) => permission.is_active).map((permission) => permission.permission_key) }))} clearAll={() => props.setForm((current) => ({ ...current, permission_keys: [] }))} />
        </>
      )}
      <DrawerActions onCancel={props.onCancel} submitting={props.submitting} saveLabel="Save" submit />
    </form>
  );
}

function TeamDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-background shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-background p-5">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">No passwords, tokens, invite links, or reset links are shown here.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function DrawerActions(props: { onCancel?: () => void; onSave?: () => void; submitting: boolean; saveLabel: string; submit?: boolean }) {
  return (
    <div className="flex justify-end gap-2 border-t pt-4">
      {props.onCancel && <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.submitting}>Cancel</Button>}
      <Button type={props.submit ? 'submit' : 'button'} onClick={props.onSave} disabled={props.submitting}>
        {props.submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {props.saveLabel}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

function Badge({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs font-medium', muted ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-indigo-200 bg-indigo-50 text-indigo-700')}>{children}</span>;
}

function drawerTitle(mode: DrawerMode, member: StaffMember | null) {
  if (mode === 'createStaff') return 'Add Staff Member';
  if (mode === 'editStaff') return `Edit: ${member?.full_name || member?.email || 'Staff Member'}`;
  if (mode === 'staffPermissions') return `Permissions: ${member?.full_name || member?.email || 'Staff Member'}`;
  if (mode === 'supportAccess') return `Support Access: ${member?.full_name || member?.email || 'Staff Member'}`;
  if (mode === 'setPassword') return `Set Temporary Password: ${member?.full_name || member?.email || 'Staff Member'}`;
  if (mode === 'department') return 'Department';
  if (mode === 'role') return 'Role';
  if (mode === 'group') return 'Permission Group';
  if (mode === 'permission') return 'Permission';
  return 'Team';
}

function searchable(row: Record<string, unknown>, search: string) {
  if (!search.trim()) return true;
  return Object.values(row).filter((value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean').join(' ').toLowerCase().includes(search.trim().toLowerCase());
}
