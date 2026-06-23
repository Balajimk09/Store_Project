'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Loader2,
  Plus,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Tag,
} from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminFetch } from '@/lib/admin-client';

type AccountType = {
  id?: string;
  account_type_key?: string;
  accountTypeKey?: string;
  label: string;
  description?: string | null;
  is_active?: boolean;
  isActive?: boolean;
  is_system?: boolean;
  isSystem?: boolean;
  sort_order?: number | null;
  sortOrder?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AccountTypesResponse =
  | AccountType[]
  | {
      accountTypes?: AccountType[];
      account_types?: AccountType[];
      data?: AccountType[];
    };

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function getAccountTypeKey(accountType: AccountType) {
  return accountType.account_type_key || accountType.accountTypeKey || normalizeKey(accountType.label);
}

function isActive(accountType: AccountType) {
  if (typeof accountType.is_active === 'boolean') return accountType.is_active;
  if (typeof accountType.isActive === 'boolean') return accountType.isActive;
  return true;
}

function isSystem(accountType: AccountType) {
  if (typeof accountType.is_system === 'boolean') return accountType.is_system;
  if (typeof accountType.isSystem === 'boolean') return accountType.isSystem;
  return false;
}

function extractAccountTypes(payload: AccountTypesResponse) {
  if (Array.isArray(payload)) return payload;
  return payload.accountTypes || payload.account_types || payload.data || [];
}

function formatDate(value?: string | null) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

export default function AdminSettingsPage() {
  const [accountTypes, setAccountTypes] = useState<AccountType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');

  const activeTypes = useMemo(
    () => accountTypes.filter((accountType) => isActive(accountType)),
    [accountTypes]
  );

  const systemTypes = useMemo(
    () => accountTypes.filter((accountType) => isSystem(accountType)),
    [accountTypes]
  );

  const customTypes = useMemo(
    () => accountTypes.filter((accountType) => !isSystem(accountType)),
    [accountTypes]
  );

  const loadAccountTypes = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const payload = await adminFetch<AccountTypesResponse>('/api/admin/account-types');
      setAccountTypes(extractAccountTypes(payload));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load account types.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAccountTypes();
  }, [loadAccountTypes]);

  const handleCreateAccountType = async () => {
    const cleanLabel = label.trim();
    const cleanDescription = description.trim();
    const accountTypeKey = normalizeKey(cleanLabel);

    setMessage(null);
    setError(null);

    if (!cleanLabel) {
      setError('Account type label is required.');
      return;
    }

    if (!accountTypeKey) {
      setError('Account type key could not be generated. Use letters or numbers in the label.');
      return;
    }

    const duplicate = accountTypes.some(
      (accountType) => getAccountTypeKey(accountType) === accountTypeKey
    );

    if (duplicate) {
      setError('An account type with this key already exists.');
      return;
    }

    setSaving(true);

    try {
      await adminFetch('/api/admin/account-types', {
        method: 'POST',
        body: JSON.stringify({
          label: cleanLabel,
          description: cleanDescription || null,
          accountTypeKey,
          account_type_key: accountTypeKey,
        }),
      });

      setLabel('');
      setDescription('');
      setMessage(`Created account type: ${cleanLabel}`);
      await loadAccountTypes('refresh');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create account type.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Superadmin Settings"
        description="Manage platform account types and Superadmin configuration."
      >
        <Button
          variant="outline"
          onClick={() => void loadAccountTypes('refresh')}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </AdminPageHeader>

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Settings className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Total Account Types</p>
              <p className="text-2xl font-semibold text-foreground">
                {accountTypes.length.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
              <ShieldCheck className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">System Types</p>
              <p className="text-2xl font-semibold text-foreground">
                {systemTypes.length.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <Tag className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Custom Types</p>
              <p className="text-2xl font-semibold text-foreground">
                {customTypes.length.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {message && (
        <Card className="mb-5 border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
          <div className="flex items-start gap-3">
            <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">{message}</p>
          </div>
        </Card>
      )}

      {error && (
        <Card className="mb-5 border-destructive/30 bg-destructive/10 p-4 text-destructive">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="text-sm font-semibold">Settings error</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Card className="p-5">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-foreground">Add Account Type</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create reusable account types for Users & Permissions.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Account type label
              </label>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Example: Regional Manager"
              />
              {label.trim() && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Key: <span className="font-mono">{normalizeKey(label)}</span>
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe what this account type is used for."
                className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <Button
              className="w-full"
              onClick={handleCreateAccountType}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create Account Type
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <h2 className="text-lg font-semibold text-foreground">Account Types</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Active account types available when creating users.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading account types...
            </div>
          ) : activeTypes.length === 0 ? (
            <div className="flex flex-col items-center justify-center border border-dashed border-border p-12 text-center">
              <Settings className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 font-semibold text-foreground">No account types found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first account type to use it in Users & Permissions.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Label</th>
                    <th className="px-4 py-3 text-left">Key</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Created</th>
                  </tr>
                </thead>

                <tbody>
                  {activeTypes.map((accountType) => (
                    <tr
                      key={accountType.id || getAccountTypeKey(accountType)}
                      className="border-t border-border hover:bg-secondary/30"
                    >
                      <td className="px-4 py-4">
                        <p className="font-medium text-foreground">{accountType.label}</p>
                      </td>

                      <td className="px-4 py-4">
                        <span className="font-mono text-xs text-muted-foreground">
                          {getAccountTypeKey(accountType)}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <p className="max-w-[420px] text-muted-foreground">
                          {accountType.description || '—'}
                        </p>
                      </td>

                      <td className="px-4 py-4">
                        {isSystem(accountType) ? (
                          <span className="inline-flex rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-700">
                            System
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            Custom
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-muted-foreground">
                        {formatDate(accountType.created_at)}
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