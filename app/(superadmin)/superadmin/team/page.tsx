'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserCog,
  UserRoundX,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminFetch } from '@/lib/admin-client';
import { cn } from '@/lib/utils';

type StaffMember = {
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

type StaffFormState = {
  email: string;
  full_name: string;
  phone: string;
  department: string;
  job_title: string;
  employee_id: string;
  start_date: string;
  role_label: string;
  support_role_code: string;
  support_access_enabled: boolean;
  permission_keys: string[];
  support_permission_keys: string[];
};

type TeamResponse = {
  staff: StaffMember[];
  total: number;
  page: number;
  limit: number;
};

type DrawerMode = 'create' | 'edit' | 'permissions' | 'support' | null;

const LIMIT = 50;

const DEPARTMENTS = [
  { value: 'support', label: 'Support', color: 'blue' },
  { value: 'sales', label: 'Sales', color: 'green' },
  { value: 'operations', label: 'Operations', color: 'orange' },
  { value: 'finance', label: 'Finance/Billing', color: 'purple' },
  { value: 'technical', label: 'Technical', color: 'gray' },
  { value: 'management', label: 'Management', color: 'red' },
  { value: 'other', label: 'Other', color: 'gray' },
];

const STAFF_ROLES = [
  'Support Agent',
  'Support Manager',
  'Sales Representative',
  'Operations Specialist',
  'Billing Specialist',
  'Technical Staff',
  'Manager',
  'Superadmin',
  'Custom',
];

const SUPPORT_ROLES = ['viewer', 'agent', 'product_support', 'vendor_support', 'billing_support', 'manager'];

const PERMISSION_GROUPS = [
  {
    label: 'Platform',
    keys: [
      'platform.superadmin',
      'platform.settings.view',
      'platform.settings.manage',
      'platform.users.view',
      'platform.users.manage',
      'platform.audit_logs.view',
      'platform.audit_logs.manage',
    ],
  },
  {
    label: 'Stores',
    keys: ['stores.view', 'stores.search', 'stores.view_360', 'stores.edit', 'stores.deactivate', 'stores.export'],
  },
  {
    label: 'Products',
    keys: ['products.view', 'products.edit', 'products.bulk_update', 'products.export'],
  },
  {
    label: 'Vendors',
    keys: ['vendors.view', 'vendors.edit', 'vendors.export'],
  },
  {
    label: 'Billing',
    keys: ['billing.view', 'billing.request_adjustment', 'billing.approve_adjustment', 'billing.export'],
  },
];

const SUPPORT_PERMISSION_GROUP = {
  label: 'Support',
  keys: [
    'tickets.view',
    'tickets.reply',
    'tickets.assign',
    'tickets.close',
    'tickets.reopen',
    'tickets.add_internal_note',
    'tickets.set_follow_up',
    'tickets.log_call',
    'tickets.export',
    'approval.request_action',
    'approval.approve_action',
    'approval.reject_action',
    'knowledge_base.view',
    'knowledge_base.create',
    'knowledge_base.edit',
    'analytics.view',
  ],
};

const DEFAULT_FORM: StaffFormState = {
  email: '',
  full_name: '',
  phone: '',
  department: '',
  job_title: '',
  employee_id: '',
  start_date: '',
  role_label: '',
  support_role_code: 'agent',
  support_access_enabled: false,
  permission_keys: [],
  support_permission_keys: [],
};

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function pretty(value: string | null | undefined) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initials(member: StaffMember) {
  const name = member.full_name || member.email;
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function departmentLabel(value: string | null) {
  return DEPARTMENTS.find((department) => department.value === value)?.label || 'Other';
}

function departmentBadgeClass(value: string | null) {
  const color = DEPARTMENTS.find((department) => department.value === value)?.color || 'gray';
  const classes: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    orange: 'border-orange-200 bg-orange-50 text-orange-700',
    purple: 'border-purple-200 bg-purple-50 text-purple-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    gray: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  return classes[color] || classes.gray;
}

function statusBadgeClass(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'invited') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'suspended') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function permissionBadges(member: StaffMember) {
  const keys = member.permission_keys;
  const badges: string[] = [];
  if (keys.includes('platform.superadmin')) badges.push('Superadmin');
  if (member.has_support_access) badges.push('Support Access');
  if (keys.some((key) => key.startsWith('billing.'))) badges.push('Billing Access');
  if (keys.some((key) => key.startsWith('stores.'))) badges.push('Store Access');
  return badges;
}

function toggleValue(values: string[], key: string) {
  return values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
}

export default function SuperadminTeamPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supportAccessFilter, setSupportAccessFilter] = useState('');
  const [superadminFilter, setSuperadminFilter] = useState('');
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [form, setForm] = useState<StaffFormState>(DEFAULT_FORM);

  const showSuccess = useCallback((message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  const loadTeam = useCallback(
    async (currentPage = page) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(currentPage),
          limit: String(LIMIT),
        });
        if (search.trim()) params.set('search', search.trim());
        if (departmentFilter) params.set('department', departmentFilter);
        if (roleFilter.trim()) params.set('role', roleFilter.trim());
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
    void loadTeam(0);
  }, []);

  const summary = useMemo(() => {
    return {
      totalStaff: total,
      activeStaff: staff.filter((member) => member.status === 'active').length,
      supportStaff: staff.filter((member) => member.has_support_access).length,
      superadmins: staff.filter((member) => member.permission_keys.includes('platform.superadmin')).length,
      invited: staff.filter((member) => member.status === 'invited' || !member.last_sign_in_at).length,
    };
  }, [staff, total]);

  const openCreate = () => {
    setForm(DEFAULT_FORM);
    setEditingStaff(null);
    setError(null);
    setDrawerMode('create');
  };

  const openEdit = (member: StaffMember) => {
    setEditingStaff(member);
    setForm({
      email: member.email,
      full_name: member.full_name || '',
      phone: member.phone || '',
      department: member.department || '',
      job_title: member.job_title || '',
      employee_id: member.employee_id || '',
      start_date: member.start_date || '',
      role_label: member.role_label || '',
      support_role_code: member.support_role_code || 'agent',
      support_access_enabled: member.has_support_access,
      permission_keys: member.permission_keys,
      support_permission_keys: member.support_permissions,
    });
    setError(null);
    setDrawerMode('edit');
  };

  const openPermissions = (member: StaffMember) => {
    setEditingStaff(member);
    setForm((current) => ({
      ...current,
      permission_keys: member.permission_keys,
      support_permission_keys: member.support_permissions,
    }));
    setError(null);
    setDrawerMode('permissions');
  };

  const openSupport = (member: StaffMember) => {
    setEditingStaff(member);
    setForm((current) => ({
      ...current,
      support_role_code: member.support_role_code || 'agent',
      support_access_enabled: member.has_support_access,
      support_permission_keys: member.support_permissions,
    }));
    setError(null);
    setDrawerMode('support');
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingStaff(null);
    setForm(DEFAULT_FORM);
  };

  const handleSubmitStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        email: form.email,
        full_name: form.full_name,
        phone: form.phone,
        department: form.department,
        job_title: form.job_title,
        employee_id: form.employee_id,
        start_date: form.start_date || null,
        role_label: form.role_label,
        support_access_enabled: form.support_access_enabled,
        support_role_code: form.support_role_code,
        permission_keys: form.permission_keys,
        support_permission_keys: form.support_permission_keys,
      };

      if (drawerMode === 'edit' && editingStaff) {
        const response = await adminFetch<{ message: string }>(`/api/superadmin/team/${editingStaff.user_id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showSuccess(response.message);
      } else {
        const response = await adminFetch<{ message: string }>('/api/superadmin/team', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showSuccess(response.message);
      }

      closeDrawer();
      await loadTeam(0);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save staff member.');
    } finally {
      setSubmitting(false);
    }
  };

  const savePermissions = async () => {
    if (!editingStaff) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await adminFetch<{ message: string }>(`/api/superadmin/team/${editingStaff.user_id}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ permission_keys: form.permission_keys }),
      });
      showSuccess(response.message);
      closeDrawer();
      await loadTeam();
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
        method: 'POST',
        body: JSON.stringify({
          enabled: form.support_access_enabled,
          role_code: form.support_role_code,
          support_permission_keys: form.support_permission_keys,
        }),
      });
      showSuccess(response.message);
      closeDrawer();
      await loadTeam();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update support access.');
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (member: StaffMember, action: 'deactivate' | 'reactivate' | 'reset-access') => {
    const labels = {
      deactivate: 'Deactivate this staff member and disable Support Desk access?',
      reactivate: 'Reactivate this staff member?',
      'reset-access': 'Send a reset access email to this staff member?',
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
      await loadTeam();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to complete action.');
    } finally {
      setSubmitting(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setDepartmentFilter('');
    setRoleFilter('');
    setStatusFilter('');
    setSupportAccessFilter('');
    setSuperadminFilter('');
    window.setTimeout(() => void loadTeam(0), 0);
  };

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));
  const start = total === 0 ? 0 : page * LIMIT + 1;
  const end = Math.min(total, (page + 1) * LIMIT);
  const summaryCards: Array<[string, number, LucideIcon]> = [
    ['Total Staff', summary.totalStaff, Users],
    ['Active Staff', summary.activeStaff, UserRoundCheck],
    ['Support Staff', summary.supportStaff, ShieldCheck],
    ['Superadmins', summary.superadmins, UserCog],
    ['Pending Invites', summary.invited, BriefcaseBusiness],
  ];

  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Company Team"
        description="Manage StorePulse AI internal staff, departments, roles, and permissions."
      >
        <Button variant="outline" onClick={() => void loadTeam()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Staff Member
        </Button>
      </SuperadminPageHeader>

      <div className="space-y-6">
        {error && (
          <Card className="flex items-start justify-between gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadTeam(0)}>
              Retry
            </Button>
          </Card>
        )}

        {success && (
          <Card className="flex items-start gap-3 border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">{success}</p>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-5">
          {summaryCards.map(([label, value, SummaryIcon]) => {
            return (
              <Card key={label} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-semibold">{value}</p>
                  </div>
                  <SummaryIcon className="h-5 w-5 text-indigo-600" />
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1.5fr_160px_160px_150px_180px_190px_auto_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email, phone, title, employee ID..."
                className="pl-9"
              />
            </div>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">All Departments</option>
              {DEPARTMENTS.map((department) => (
                <option key={department.value} value={department.value}>{department.label}</option>
              ))}
            </select>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">All Roles</option>
              {STAFF_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">All Statuses</option>
              {['active', 'invited', 'inactive', 'suspended'].map((status) => <option key={status} value={status}>{pretty(status)}</option>)}
            </select>
            <select value={supportAccessFilter} onChange={(event) => setSupportAccessFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Any Support Access</option>
              <option value="true">Has Support Access</option>
              <option value="false">No Support Access</option>
            </select>
            <select value={superadminFilter} onChange={(event) => setSuperadminFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Any Superadmin</option>
              <option value="true">Has Superadmin Permission</option>
              <option value="false">No Superadmin Permission</option>
            </select>
            <Button onClick={() => void loadTeam(0)}>Search</Button>
            <Button variant="outline" onClick={clearFilters}>Clear</Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b p-5">
            <h2 className="text-lg font-semibold">StorePulse Company Staff</h2>
            <p className="text-sm text-muted-foreground">Internal StorePulse AI employees only. Store owners and store employees stay in Users.</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading team...
            </div>
          ) : staff.length === 0 ? (
            <div className="p-10 text-center">
              <Users className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
              <h3 className="font-semibold">No company staff found.</h3>
              <p className="mt-1 text-sm text-muted-foreground">Add your first StorePulse staff member.</p>
              <Button className="mt-4" onClick={openCreate}>
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
                    {staff.map((member) => (
                      <tr key={member.user_id} className="hover:bg-muted/25">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
                              {initials(member)}
                            </div>
                            <div>
                              <p className="font-semibold">{member.full_name || member.email}</p>
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                              {member.employee_id && <p className="text-xs text-muted-foreground">Employee ID: {member.employee_id}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs font-medium', departmentBadgeClass(member.department))}>
                            {departmentLabel(member.department)}
                          </span>
                          <p className="mt-1 text-xs text-muted-foreground">{member.job_title || member.role_label || 'Role not set'}</p>
                        </td>
                        <td className="px-4 py-4">
                          {member.has_support_access ? (
                            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">Support Access</span>
                          ) : (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">No Support Access</span>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">{member.support_role_code ? pretty(member.support_role_code) : 'No support role'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs font-medium', statusBadgeClass(member.status))}>{pretty(member.status)}</span>
                          <p className="mt-1 text-xs text-muted-foreground">{member.last_sign_in_at ? `Last login ${formatDate(member.last_sign_in_at)}` : 'Never logged in'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-medium">{member.permission_count} permissions</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {permissionBadges(member).length ? permissionBadges(member).map((badge) => (
                              <span key={badge} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">{badge}</span>
                            )) : <span className="text-xs text-muted-foreground">No permission badges</span>}
                          </div>
                        </td>
                        <td className="px-4 py-4">{formatDate(member.created_at)}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(member)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openPermissions(member)}>
                              <UserCog className="mr-1 h-3.5 w-3.5" />
                              Permissions
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openSupport(member)}>
                              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                              Support Access
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void runAction(member, 'reset-access')} disabled={submitting}>
                              <KeyRound className="mr-1 h-3.5 w-3.5" />
                              Reset
                            </Button>
                            {member.status === 'inactive' ? (
                              <Button variant="outline" size="sm" onClick={() => void runAction(member, 'reactivate')} disabled={submitting}>
                                <UserRoundCheck className="mr-1 h-3.5 w-3.5" />
                                Reactivate
                              </Button>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => void runAction(member, 'deactivate')} disabled={submitting}>
                                <UserRoundX className="mr-1 h-3.5 w-3.5" />
                                Deactivate
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>Showing {start}-{end} of {total}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => void loadTeam(page - 1)}>Previous</Button>
                  <span>Page {page + 1} of {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={page + 1 >= pageCount || loading} onClick={() => void loadTeam(page + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {drawerMode && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeDrawer} />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-background shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-background p-5">
              <div>
                <h2 className="text-xl font-semibold">
                  {drawerMode === 'create' && 'Add Staff Member'}
                  {drawerMode === 'edit' && `Edit: ${editingStaff?.full_name || editingStaff?.email}`}
                  {drawerMode === 'permissions' && `Permissions: ${editingStaff?.full_name || editingStaff?.email}`}
                  {drawerMode === 'support' && `Support Access: ${editingStaff?.full_name || editingStaff?.email}`}
                </h2>
                <p className="text-sm text-muted-foreground">No passwords, tokens, or invite links are shown here.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeDrawer}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {(drawerMode === 'create' || drawerMode === 'edit') && (
              <form onSubmit={handleSubmitStaff} className="space-y-5 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full Name *">
                    <Input required value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} />
                  </Field>
                  <Field label="Email *">
                    <Input required type="email" value={form.email} disabled={drawerMode === 'edit'} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                  </Field>
                  <Field label="Phone">
                    <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
                  </Field>
                  <Field label="Department *">
                    <select required value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="">Select department</option>
                      {DEPARTMENTS.map((department) => <option key={department.value} value={department.value}>{department.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Job Title">
                    <Input value={form.job_title} onChange={(event) => setForm((current) => ({ ...current, job_title: event.target.value }))} />
                  </Field>
                  <Field label="Employee ID">
                    <Input value={form.employee_id} onChange={(event) => setForm((current) => ({ ...current, employee_id: event.target.value }))} />
                  </Field>
                  <Field label="Start Date">
                    <Input type="date" value={form.start_date} onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))} />
                  </Field>
                  <Field label="Role">
                    <select value={form.role_label} onChange={(event) => setForm((current) => ({ ...current, role_label: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="">Select role</option>
                      {STAFF_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </Field>
                </div>

                <Card className="p-4">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={form.support_access_enabled}
                      onChange={(event) => setForm((current) => ({ ...current, support_access_enabled: event.target.checked }))}
                    />
                    Support Desk access
                  </label>
                  {form.support_access_enabled && (
                    <div className="mt-3">
                      <Field label="Support Role">
                        <select value={form.support_role_code} onChange={(event) => setForm((current) => ({ ...current, support_role_code: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          {SUPPORT_ROLES.map((role) => <option key={role} value={role}>{pretty(role)}</option>)}
                        </select>
                      </Field>
                    </div>
                  )}
                </Card>

                <Card className="p-4">
                  <h3 className="text-sm font-semibold">Permission Groups</h3>
                  <p className="text-xs text-muted-foreground">Choose starting permissions. These can be adjusted later.</p>
                  <PermissionPicker
                    selected={form.permission_keys}
                    onToggle={(key) => setForm((current) => ({ ...current, permission_keys: toggleValue(current.permission_keys, key) }))}
                  />
                </Card>

                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button type="button" variant="outline" onClick={closeDrawer} disabled={submitting}>Cancel</Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {drawerMode === 'edit' ? 'Save Changes' : 'Add Staff Member'}
                  </Button>
                </div>
              </form>
            )}

            {drawerMode === 'permissions' && (
              <div className="space-y-5 p-5">
                <Card className="p-4">
                  <PermissionPicker
                    selected={form.permission_keys}
                    onToggle={(key) => setForm((current) => ({ ...current, permission_keys: toggleValue(current.permission_keys, key) }))}
                  />
                </Card>
                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button type="button" variant="outline" onClick={closeDrawer} disabled={submitting}>Cancel</Button>
                  <Button type="button" onClick={() => void savePermissions()} disabled={submitting}>
                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Permissions
                  </Button>
                </div>
              </div>
            )}

            {drawerMode === 'support' && (
              <div className="space-y-5 p-5">
                <Card className="space-y-4 p-4">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={form.support_access_enabled}
                      onChange={(event) => setForm((current) => ({ ...current, support_access_enabled: event.target.checked }))}
                    />
                    Enable Support Desk access
                  </label>
                  <Field label="Support Role">
                    <select value={form.support_role_code} onChange={(event) => setForm((current) => ({ ...current, support_role_code: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {SUPPORT_ROLES.map((role) => <option key={role} value={role}>{pretty(role)}</option>)}
                    </select>
                  </Field>
                </Card>
                <Card className="p-4">
                  <h3 className="text-sm font-semibold">Support Permissions</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {SUPPORT_PERMISSION_GROUP.keys.map((key) => (
                      <label key={key} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                        <input
                          type="checkbox"
                          checked={form.support_permission_keys.includes(key)}
                          onChange={() => setForm((current) => ({ ...current, support_permission_keys: toggleValue(current.support_permission_keys, key) }))}
                          className="mt-0.5"
                        />
                        <span>{pretty(key)}</span>
                      </label>
                    ))}
                  </div>
                </Card>
                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button type="button" variant="outline" onClick={closeDrawer} disabled={submitting}>Cancel</Button>
                  <Button type="button" onClick={() => void saveSupportAccess()} disabled={submitting}>
                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Support Access
                  </Button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </SuperadminShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function PermissionPicker({ selected, onToggle }: { selected: string[]; onToggle: (key: string) => void }) {
  return (
    <div className="mt-4 space-y-3">
      {PERMISSION_GROUPS.map((group) => (
        <details key={group.label} className="rounded-lg border" open={group.label === 'Platform'}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            {group.label} ({group.keys.filter((key) => selected.includes(key)).length}/{group.keys.length})
          </summary>
          <div className="grid gap-2 border-t p-3 sm:grid-cols-2">
            {group.keys.map((key) => (
              <label key={key} className="flex cursor-pointer items-start gap-2 rounded-lg bg-muted/20 p-3 text-sm">
                <input type="checkbox" checked={selected.includes(key)} onChange={() => onToggle(key)} className="mt-0.5" />
                <span>{pretty(key)}</span>
              </label>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
