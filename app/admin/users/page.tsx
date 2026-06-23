'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  KeyRound,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AdminShell, AdminPageHeader } from '@/components/layout/admin-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PermissionRow = {
  permission_key: string;
  category: string;
  action: string;
  label: string;
  description: string | null;
  is_dangerous: boolean;
  sort_order: number;
};

type UserPermission = {
  permission_key: string;
  can_delegate: boolean;
};

type AdminUser = {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  profile: {
    username: string | null;
    full_name: string | null;
    phone: string | null;
    account_type: string;
    role_label: string;
    status: string;
    must_change_password: boolean;
  } | null;
  stores: Array<{
    id: string;
    store_name: string | null;
  }>;
  permissions: UserPermission[];
};

type UsersResponse = {
  users: AdminUser[];
  permissions: PermissionRow[];
};

type CreateUserResponse = {
  userId: string;
  email: string;
  username: string | null;
  temporaryPassword: string;
  message: string;
};

type SelectedPermissionMap = Record<
  string,
  {
    checked: boolean;
    canDelegate: boolean;
  }
>;

async function superadminFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('Please log in again.');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Request failed.');
  }

  return json as T;
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Never';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function groupPermissions(permissions: PermissionRow[]) {
  return permissions.reduce<Record<string, PermissionRow[]>>((groups, permission) => {
    if (!groups[permission.category]) {
      groups[permission.category] = [];
    }

    groups[permission.category].push(permission);
    return groups;
  }, {});
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<SelectedPermissionMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [roleLabel, setRoleLabel] = useState('User');
  const [accountType, setAccountType] = useState('store_user');
  const [password, setPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const permissionsByCategory = useMemo(() => groupPermissions(permissions), [permissions]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await superadminFetch<UsersResponse>('/api/admin/users');
      setUsers(data.users);
      setPermissions(data.permissions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const togglePermission = (permissionKey: string) => {
    setSelectedPermissions((current) => {
      const existing = current[permissionKey];

      return {
        ...current,
        [permissionKey]: {
          checked: !existing?.checked,
          canDelegate: existing?.canDelegate || false,
        },
      };
    });
  };

  const toggleDelegate = (permissionKey: string) => {
    setSelectedPermissions((current) => {
      const existing = current[permissionKey] || {
        checked: false,
        canDelegate: false,
      };

      return {
        ...current,
        [permissionKey]: {
          checked: true,
          canDelegate: !existing.canDelegate,
        },
      };
    });
  };

  const resetForm = () => {
    setEmail('');
    setUsername('');
    setFullName('');
    setPhone('');
    setRoleLabel('User');
    setAccountType('store_user');
    setPassword('');
    setSelectedPermissions({});
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSaving(true);
    setError(null);
    setSuccess(null);
    setTemporaryPassword(null);

    try {
      const permissionsToSave = Object.entries(selectedPermissions)
        .filter(([, value]) => value.checked)
        .map(([permission_key, value]) => ({
          permission_key,
          can_delegate: value.canDelegate,
        }));

      const result = await superadminFetch<CreateUserResponse>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          username,
          fullName,
          phone,
          password,
          accountType,
          roleLabel,
          status: 'active',
          permissions: permissionsToSave,
        }),
      });

      setSuccess(result.message);
      setTemporaryPassword(result.temporaryPassword);
      resetForm();
      await loadUsers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create user.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (userId: string) => {
    const confirmed = window.confirm(
      'Reset this user password and generate a temporary password?'
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setSuccess(null);
    setTemporaryPassword(null);

    try {
      const result = await superadminFetch<{
        temporaryPassword: string;
        message: string;
      }>(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Manual reset from Superadmin Users page.',
        }),
      });

      setSuccess(result.message);
      setTemporaryPassword(result.temporaryPassword);
      await loadUsers();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset password.');
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Users & Permissions"
        description="Create users, assign checkbox permissions, allow delegation, and reset access."
      >
        <Button variant="outline" onClick={loadUsers} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </AdminPageHeader>

      <div className="space-y-6">
        {error && (
          <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </Card>
        )}

        {success && (
          <Card className="flex items-start gap-3 border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="text-sm font-medium">{success}</p>

              {temporaryPassword && (
                <div className="mt-2 rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Temporary password</p>
                  <p className="font-mono text-base font-semibold">{temporaryPassword}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Share this only after verifying the store owner or user.
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        <Card className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <UserPlus className="h-5 w-5" />
            </div>

            <div>
              <h2 className="text-lg font-semibold">Create User</h2>
              <p className="text-sm text-muted-foreground">
                Create a user and choose exactly what they can see, do, and delegate.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setEmail(event.target.value)
                  }
                  placeholder="user@store.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  value={username}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setUsername(event.target.value)
                  }
                  placeholder="quickmart27"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Temporary Password</Label>
                <Input
                  value={password}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setPassword(event.target.value)
                  }
                  placeholder="Leave blank to auto-generate"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input
                  value={fullName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setFullName(event.target.value)
                  }
                  placeholder="Owner or team member name"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={phone}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setPhone(event.target.value)
                  }
                  placeholder="405-123-4567"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Role Label</Label>
                <Input
                  value={roleLabel}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setRoleLabel(event.target.value)
                  }
                  placeholder="Support Agent, Marketing User, Manager"
                />
              </div>

              <div className="space-y-1.5 md:col-span-3">
                <Label>Account Type</Label>
                <select
                  value={accountType}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setAccountType(event.target.value)
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="store_user">Store User</option>
                  <option value="store_owner">Store Owner</option>
                  <option value="platform_internal">Platform Internal</option>
                  <option value="support_user">Support User</option>
                  <option value="marketing_user">Marketing User</option>
                  <option value="sales_user">Sales User</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />

                <div>
                  <h3 className="font-semibold">Permission Checkboxes</h3>
                  <p className="text-sm text-muted-foreground">
                    Select what this user can do. Select delegate only if this user can give
                    that permission to another user.
                  </p>
                </div>
              </div>

              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading permissions...
                </div>
              )}

              {!loading && (
                <div className="space-y-5">
                  {Object.entries(permissionsByCategory).map(
                    ([category, categoryPermissions]) => (
                      <div key={category} className="rounded-lg border bg-muted/20 p-4">
                        <h4 className="mb-3 font-medium">{category}</h4>

                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          {categoryPermissions.map((permission) => {
                            const selected = selectedPermissions[permission.permission_key];

                            return (
                              <div
                                key={permission.permission_key}
                                className="rounded-lg border bg-background p-3"
                              >
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(selected?.checked)}
                                    onChange={() =>
                                      togglePermission(permission.permission_key)
                                    }
                                    className="mt-1"
                                  />

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium">
                                        {permission.label}
                                      </p>

                                      {permission.is_dangerous && (
                                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                                          sensitive
                                        </span>
                                      )}
                                    </div>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {permission.permission_key}
                                    </p>

                                    {permission.description && (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {permission.description}
                                      </p>
                                    )}

                                    <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(selected?.canDelegate)}
                                        onChange={() =>
                                          toggleDelegate(permission.permission_key)
                                        }
                                      />
                                      Can delegate this permission
                                    </label>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            <Button type="submit" disabled={saving || loading}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create User
            </Button>
          </form>
        </Card>

        <Card className="p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold">All Users</h2>
            <p className="text-sm text-muted-foreground">
              Users from Supabase Auth joined with StorePulse user profiles and permissions.
            </p>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading users...
            </div>
          )}

          {!loading && users.length === 0 && (
            <p className="text-sm text-muted-foreground">No users found.</p>
          )}

          {!loading && users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Username</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Stores</th>
                    <th className="px-3 py-2">Permissions</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Last Login</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b">
                      <td className="px-3 py-3">
                        <p className="font-medium">
                          {user.profile?.full_name ||
                            user.email ||
                            user.phone ||
                            'Unnamed User'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {user.email || user.phone}
                        </p>
                        <p className="text-xs text-muted-foreground">{user.id}</p>
                      </td>

                      <td className="px-3 py-3">
                        {user.profile?.username || (
                          <span className="text-muted-foreground">Not set</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        <p>{user.profile?.role_label || 'User'}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.profile?.account_type || 'unknown'}
                        </p>
                      </td>

                      <td className="px-3 py-3">
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                          {user.profile?.status || 'auth_only'}
                        </span>

                        {user.profile?.must_change_password && (
                          <p className="mt-1 text-xs text-amber-600">
                            Must change password
                          </p>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        {user.stores.length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          <div className="space-y-1">
                            {user.stores.map((store) => (
                              <p key={store.id}>
                                {store.store_name || 'Unnamed Store'}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        <p>{user.permissions.length}</p>
                        <p className="text-xs text-muted-foreground">permissions</p>
                      </td>

                      <td className="px-3 py-3">{formatDate(user.created_at)}</td>
                      <td className="px-3 py-3">{formatDate(user.last_sign_in_at)}</td>

                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" type="button">
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            View
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() => handleResetPassword(user.id)}
                          >
                            <KeyRound className="mr-1 h-3.5 w-3.5" />
                            Reset
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}