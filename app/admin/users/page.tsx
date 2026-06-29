'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { adminFetch } from '@/lib/admin-client';
import { AdminShell, AdminPageHeader } from '@/components/layout/admin-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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

type AccountTypeOption = {
  id: string;
  account_type_key: string;
  label: string;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
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

type AccountTypesResponse = {
  accountTypes: AccountTypeOption[];
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

function formatDate(value: string | null) {
  if (!value) return 'Never';

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

function formatCategoryName(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildPermissionMap(userPermissions: UserPermission[]) {
  return userPermissions.reduce<SelectedPermissionMap>((map, permission) => {
    map[permission.permission_key] = {
      checked: true,
      canDelegate: permission.can_delegate,
    };

    return map;
  }, {});
}

function permissionsToPayload(selectedPermissions: SelectedPermissionMap) {
  return Object.entries(selectedPermissions)
    .filter(([, value]) => value.checked)
    .map(([permission_key, value]) => ({
      permission_key,
      can_delegate: value.canDelegate,
    }));
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [accountTypes, setAccountTypes] = useState<AccountTypeOption[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<SelectedPermissionMap>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editPermissionsOpen, setEditPermissionsOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState('');
  const [password, setPassword] = useState('');

  const [newAccountTypeLabel, setNewAccountTypeLabel] = useState('');
  const [addingAccountType, setAddingAccountType] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const activeAccountTypes = useMemo(
    () => accountTypes.filter((type) => type.is_active),
    [accountTypes]
  );

  const accountTypeByKey = useMemo(() => {
    return new Map(accountTypes.map((type) => [type.account_type_key, type]));
  }, [accountTypes]);

  const filteredPermissions = useMemo(() => {
    const search = permissionSearch.trim().toLowerCase();

    if (!search) return permissions;

    return permissions.filter((permission) =>
      permission.label.toLowerCase().includes(search)
    );
  }, [permissions, permissionSearch]);

  const permissionsByCategory = useMemo(
    () => groupPermissions(filteredPermissions),
    [filteredPermissions]
  );

  const filteredUsers = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    if (!search) return users;

    return users.filter((user) => {
      const values = [
        user.email,
        user.phone,
        user.profile?.phone,
        user.profile?.username,
        user.profile?.full_name,
        user.profile?.account_type,
        user.profile?.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return values.includes(search);
    });
  }, [users, searchTerm]);

  const totalUsers = users.length;
  const activeUsers = users.filter((user) => user.profile?.status === 'active').length;
  const passwordChangeUsers = users.filter(
    (user) => user.profile?.must_change_password
  ).length;
  const usersWithPermissions = users.filter((user) => user.permissions.length > 0).length;

  const selectedPermissionCount = Object.values(selectedPermissions).filter(
    (permission) => permission.checked
  ).length;

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [usersData, accountTypesData] = await Promise.all([
        adminFetch<UsersResponse>('/api/admin/users'),
        adminFetch<AccountTypesResponse>('/api/admin/account-types'),
      ]);

      setUsers(usersData.users);
      setPermissions(usersData.permissions);
      setAccountTypes(accountTypesData.accountTypes);

      if (!accountType && accountTypesData.accountTypes.length > 0) {
        setAccountType(accountTypesData.accountTypes[0].account_type_key);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setEmail('');
    setUsername('');
    setFullName('');
    setPhone('');
    setPassword('');
    setSelectedPermissions({});
    setPermissionSearch('');
    setAccountType(activeAccountTypes[0]?.account_type_key || '');
  };

  const openAddUser = () => {
    resetForm();
    setError(null);
    setSuccess(null);
    setTemporaryPassword(null);
    setAddUserOpen(true);
  };

  const togglePermission = (permissionKey: string) => {
    setSelectedPermissions((current) => {
      const existing = current[permissionKey];

      return {
        ...current,
        [permissionKey]: {
          checked: !existing?.checked,
          canDelegate: existing?.checked ? false : existing?.canDelegate || false,
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

  const handleAddAccountType = async () => {
    setAddingAccountType(true);
    setError(null);

    try {
      const result = await adminFetch<{
        accountType: AccountTypeOption;
        message: string;
      }>('/api/admin/account-types', {
        method: 'POST',
        body: JSON.stringify({
          label: newAccountTypeLabel,
        }),
      });

      setAccountTypes((current) => {
        const existing = current.filter(
          (type) => type.id !== result.accountType.id
        );

        return [...existing, result.accountType].sort((a, b) =>
          a.label.localeCompare(b.label)
        );
      });

      setAccountType(result.accountType.account_type_key);
      setNewAccountTypeLabel('');
      setSuccess(result.message);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Unable to add account type.');
    } finally {
      setAddingAccountType(false);
    }
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSaving(true);
    setError(null);
    setSuccess(null);
    setTemporaryPassword(null);

    try {
      const result = await adminFetch<CreateUserResponse>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          username,
          fullName,
          phone,
          password,
          accountType,
          status: 'active',
          permissions: permissionsToPayload(selectedPermissions),
        }),
      });

      setSuccess(result.message);
      setTemporaryPassword(result.temporaryPassword);
      setAddUserOpen(false);
      resetForm();
      await loadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create user.');
    } finally {
      setSaving(false);
    }
  };

  const openEditPermissions = (user: AdminUser) => {
    setEditingUser(user);
    setSelectedPermissions(buildPermissionMap(user.permissions));
    setPermissionSearch('');
    setError(null);
    setSuccess(null);
    setTemporaryPassword(null);
    setEditPermissionsOpen(true);
  };

  const handleUpdatePermissions = async () => {
    if (!editingUser) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await adminFetch<{ message: string }>(
        `/api/admin/users/${editingUser.id}/permissions`,
        {
          method: 'PUT',
          body: JSON.stringify({
            permissions: permissionsToPayload(selectedPermissions),
          }),
        }
      );

      setSuccess(result.message);
      setEditPermissionsOpen(false);
      setEditingUser(null);
      setSelectedPermissions({});
      await loadData();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : 'Unable to update permissions.'
      );
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
      const result = await adminFetch<{
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
      await loadData();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset password.');
    }
  };

  const renderPermissionPicker = () => (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={permissionSearch}
          onChange={(event) => setPermissionSearch(event.target.value)}
          placeholder="Search permissions like users, stores, products..."
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        {selectedPermissionCount} permission{selectedPermissionCount === 1 ? '' : 's'} selected
      </div>

      <div className="space-y-3">
        {Object.entries(permissionsByCategory).map(([category, categoryPermissions]) => (
          <details key={category} className="rounded-xl border bg-background" open={false}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
              {formatCategoryName(category)} ({categoryPermissions.length})
            </summary>

            <div className="grid gap-2 border-t p-3 sm:grid-cols-2 xl:grid-cols-3">
              {categoryPermissions.map((permission) => {
                const selected = selectedPermissions[permission.permission_key];

                return (
                  <div
                    key={permission.permission_key}
                    className="rounded-lg border bg-muted/20 p-3"
                  >
                    <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(selected?.checked)}
                        onChange={() => togglePermission(permission.permission_key)}
                        className="mt-0.5"
                      />
                      <span>{permission.label}</span>
                    </label>

                    <label className="mt-2 flex cursor-pointer items-center gap-2 pl-6 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={Boolean(selected?.canDelegate)}
                        onChange={() => toggleDelegate(permission.permission_key)}
                      />
                      <span>Can give this to others</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </div>
  );

  return (
    <AdminShell>
      <AdminPageHeader
        title="Users & Permissions"
        description="Create platform users, manage account access, reset passwords, and control permissions."
      >
        <Button variant="outline" onClick={loadData} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>

        <Button onClick={openAddUser}>
          <Plus className="mr-2 h-4 w-4" />
          Add User
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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="mt-2 text-2xl font-semibold">{totalUsers}</p>
              </div>
              <Users className="h-5 w-5 text-primary" />
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Active Users</p>
                <p className="mt-2 text-2xl font-semibold">{activeUsers}</p>
              </div>
              <UserCheck className="h-5 w-5 text-primary" />
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Need Password Change</p>
                <p className="mt-2 text-2xl font-semibold">{passwordChangeUsers}</p>
              </div>
              <LockKeyhole className="h-5 w-5 text-primary" />
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">With Permissions</p>
                <p className="mt-2 text-2xl font-semibold">{usersWithPermissions}</p>
              </div>
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
          </Card>
        </div>

        <Card className="p-6">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">All Users</h2>
              <p className="text-sm text-muted-foreground">
                Search and manage all users created in StorePulse AI.
              </p>
            </div>

            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search users..."
                className="pl-9"
              />
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading users...
            </div>
          )}

          {!loading && filteredUsers.length === 0 && (
            <p className="text-sm text-muted-foreground">No users found.</p>
          )}

          {!loading && filteredUsers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Contact</th>
                    <th className="px-3 py-2">Username</th>
                    <th className="px-3 py-2">Account Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Stores</th>
                    <th className="px-3 py-2">Permissions</th>
                    <th className="px-3 py-2">Last Login</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredUsers.map((user) => {
                    const type = user.profile?.account_type
                      ? accountTypeByKey.get(user.profile.account_type)
                      : null;

                    return (
                      <tr key={user.id} className="border-b">
                        <td className="px-3 py-3">
                          <p className="font-medium">
                            {user.profile?.full_name || user.email || user.phone || 'Unnamed User'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Created {formatDate(user.created_at)}
                          </p>
                        </td>

                        <td className="px-3 py-3">
                          <p>{user.email || 'No email'}</p>
                          <p className="text-xs text-muted-foreground">
                            {user.profile?.phone || user.phone || 'No phone'}
                          </p>
                        </td>

                        <td className="px-3 py-3">
                          {user.profile?.username || (
                            <span className="text-muted-foreground">Not set</span>
                          )}
                        </td>

                        <td className="px-3 py-3">
                          {type?.label || user.profile?.account_type || 'Unknown'}
                        </td>

                        <td className="px-3 py-3">
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                            {user.profile?.status || 'auth only'}
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

                        <td className="px-3 py-3">{formatDate(user.last_sign_in_at)}</td>

                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => openEditPermissions(user)}
                            >
                              <UserCog className="mr-1 h-3.5 w-3.5" />
                              Permissions
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>
              Create a user, choose account type, and assign only the permissions they need.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input
                  required
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Owner or team member name"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Phone number"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="quickmart27"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email address"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Leave blank to auto-generate"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Account Type</Label>
                <select
                  required
                  value={accountType}
                  onChange={(event) => setAccountType(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select account type</option>
                  {activeAccountTypes.map((type) => (
                    <option key={type.id} value={type.account_type_key}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Card className="p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Customize Account Type Dropdown</h3>
                <p className="text-xs text-muted-foreground">
                  Add a new account type if the dropdown does not have what you need.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={newAccountTypeLabel}
                  onChange={(event) => setNewAccountTypeLabel(event.target.value)}
                  placeholder="Example: Regional Manager"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddAccountType}
                  disabled={addingAccountType || !newAccountTypeLabel.trim()}
                >
                  {addingAccountType ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add Type
                </Button>
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />

                <div>
                  <h3 className="font-semibold">Permissions</h3>
                  <p className="text-sm text-muted-foreground">
                    Select the actions this user can perform.
                  </p>
                </div>
              </div>

              {renderPermissionPicker()}
            </Card>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddUserOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>

              <Button type="submit" disabled={saving || loading}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="mr-2 h-4 w-4" />
                )}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editPermissionsOpen} onOpenChange={setEditPermissionsOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Permissions</DialogTitle>
            <DialogDescription>
              Update what {editingUser?.profile?.full_name || editingUser?.email || 'this user'} can access.
            </DialogDescription>
          </DialogHeader>

          <Card className="p-4">
            {renderPermissionPicker()}
          </Card>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditPermissionsOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>

            <Button type="button" onClick={handleUpdatePermissions} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Save Permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
