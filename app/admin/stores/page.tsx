'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Store,
  StoreIcon,
  ToggleLeft,
  ToggleRight,
  Users,
} from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminFetch } from '@/lib/admin-client';

type OwnerProfile = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  username?: string | null;
  account_type_key?: string | null;
};

type AdminStore = {
  id: string;
  owner_id: string | null;
  ownerId: string | null;
  owner: OwnerProfile | null;

  store_name: string;
  storeName: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  zipCode: string;
  phone_number: string;
  phoneNumber: string;
  pos_type: string;
  posType: string;
  register_count: number;
  registerCount: number;

  status: string;
  is_active: boolean;
  isActive: boolean;

  setup_status: string;
  setupStatus: string;

  product_count: number;
  productCount: number;
  transaction_count: number;
  transactionCount: number;

  created_at: string | null;
  createdAt: string | null;
  updated_at: string | null;
  updatedAt: string | null;
};

type StoresResponse = {
  summary: {
    totalStores: number;
    activeStores: number;
    inactiveStores: number;
    storesOnPage: number;
    setupCompleteStores: number;
    totalProductsOnPage: number;
    totalTransactionsOnPage: number;
  };
  stores: AdminStore[];
  ownerOptions: OwnerProfile[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type StoreFormState = {
  id?: string;
  owner_id: string;
  store_name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  phone_number: string;
  pos_type: string;
  register_count: string;
  reason: string;
};

const emptyForm: StoreFormState = {
  owner_id: '',
  store_name: '',
  address: '',
  city: '',
  state: '',
  zip_code: '',
  phone_number: '',
  pos_type: '',
  register_count: '1',
  reason: '',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function formatOwner(owner: OwnerProfile | null, ownerId?: string | null) {
  if (!owner) return ownerId ? `Unknown owner (${ownerId.slice(0, 8)})` : 'Unassigned';

  return owner.full_name || owner.email || owner.username || `User ${owner.user_id.slice(0, 8)}`;
}

function formatOwnerSubtext(owner: OwnerProfile | null) {
  if (!owner) return '';

  return owner.email || owner.username || owner.account_type_key || '';
}

function getSetupBadgeClass(status: string) {
  if (status === 'complete') {
    return 'bg-emerald-500/10 text-emerald-700';
  }

  if (status === 'partial') {
    return 'bg-amber-500/10 text-amber-700';
  }

  return 'bg-muted text-muted-foreground';
}

function storeToForm(store: AdminStore): StoreFormState {
  return {
    id: store.id,
    owner_id: store.owner_id || '',
    store_name: store.store_name || '',
    address: store.address || '',
    city: store.city || '',
    state: store.state || '',
    zip_code: store.zip_code || '',
    phone_number: store.phone_number || '',
    pos_type: store.pos_type || '',
    register_count: String(store.register_count || 0),
    reason: '',
  };
}

function ownerOptionLabel(owner: OwnerProfile) {
  const name = owner.full_name || owner.email || owner.username || owner.user_id;
  const email = owner.email && owner.email !== name ? ` - ${owner.email}` : '';

  return `${name}${email}`;
}

export default function AdminStoresPage() {
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<OwnerProfile[]>([]);
  const [summary, setSummary] = useState({
    totalStores: 0,
    activeStores: 0,
    inactiveStores: 0,
    storesOnPage: 0,
    setupCompleteStores: 0,
    totalProductsOnPage: 0,
    totalTransactionsOnPage: 0,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [form, setForm] = useState<StoreFormState>(emptyForm);

  const sortedOwnerOptions = useMemo(() => {
    return [...ownerOptions].sort((a, b) => ownerOptionLabel(a).localeCompare(ownerOptionLabel(b)));
  }, [ownerOptions]);

  const loadStores = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '25',
        });

        if (debouncedSearch) params.set('search', debouncedSearch);
        if (statusFilter !== 'all') params.set('status', statusFilter);

        const payload = await adminFetch<StoresResponse>(
          `/api/admin/stores?${params.toString()}`
        );

        setStores(payload.stores || []);
        setOwnerOptions(payload.ownerOptions || []);
        setSummary(payload.summary || {
          totalStores: 0,
          activeStores: 0,
          inactiveStores: 0,
          storesOnPage: 0,
          setupCompleteStores: 0,
          totalProductsOnPage: 0,
          totalTransactionsOnPage: 0,
        });
        setPagination(payload.pagination || {
          page,
          pageSize: 25,
          total: 0,
          totalPages: 1,
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load stores.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [debouncedSearch, page, statusFilter]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  const openCreateForm = () => {
    setFormMode('create');
    setForm(emptyForm);
    setMessage(null);
    setError(null);
    setFormOpen(true);
  };

  const openEditForm = (store: AdminStore) => {
    setFormMode('edit');
    setForm(storeToForm(store));
    setMessage(null);
    setError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;

    setFormOpen(false);
    setForm(emptyForm);
  };

  const updateFormField = (field: keyof StoreFormState, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const validateForm = () => {
    if (!form.store_name.trim()) {
      return 'Store name is required.';
    }

    if (form.register_count && Number(form.register_count) < 0) {
      return 'Register count cannot be negative.';
    }

    return null;
  };

  const handleSubmitStore = async () => {
    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const payload = {
      id: form.id,
      owner_id: form.owner_id || null,
      store_name: form.store_name,
      address: form.address,
      city: form.city,
      state: form.state,
      zip_code: form.zip_code,
      phone_number: form.phone_number,
      pos_type: form.pos_type,
      register_count: Number(form.register_count || 0),
      reason: form.reason || null,
    };

    try {
      if (formMode === 'create') {
        await adminFetch('/api/admin/stores', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        setMessage(`Created store: ${form.store_name}`);
      } else {
        await adminFetch('/api/admin/stores', {
          method: 'PATCH',
          body: JSON.stringify({
            ...payload,
            action: 'update',
          }),
        });

        setMessage(`Updated store: ${form.store_name}`);
      }

      setFormOpen(false);
      setForm(emptyForm);
      await loadStores('refresh');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save store.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStoreStatus = async (store: AdminStore) => {
    const action = store.is_active ? 'deactivate' : 'reactivate';
    const confirmMessage = store.is_active
      ? `Deactivate ${store.store_name}? Store history will stay available.`
      : `Reactivate ${store.store_name}?`;

    const confirmed = window.confirm(confirmMessage);

    if (!confirmed) return;

    setStatusChangingId(store.id);
    setError(null);
    setMessage(null);

    try {
      await adminFetch('/api/admin/stores', {
        method: 'PATCH',
        body: JSON.stringify({
          id: store.id,
          action,
          reason: `Store ${action} from Superadmin Stores page.`,
        }),
      });

      setMessage(
        store.is_active
          ? `Deactivated store: ${store.store_name}`
          : `Reactivated store: ${store.store_name}`
      );

      await loadStores('refresh');
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not update store status.');
    } finally {
      setStatusChangingId(null);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Stores"
        description="Create, edit, deactivate, and manage store profiles across the platform."
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void loadStores('refresh')}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>

          <Button onClick={openCreateForm}>
            <Plus className="mr-2 h-4 w-4" />
            Add Store
          </Button>
        </div>
      </AdminPageHeader>

      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <StoreIcon className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Total Stores</p>
              <p className="text-2xl font-semibold text-foreground">
                {summary.totalStores.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <ToggleRight className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-semibold text-foreground">
                {summary.activeStores.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ToggleLeft className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Inactive</p>
              <p className="text-2xl font-semibold text-foreground">
                {summary.inactiveStores.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
              <Users className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Owner Options</p>
              <p className="text-2xl font-semibold text-foreground">
                {ownerOptions.length.toLocaleString()}
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
              <p className="text-sm font-semibold">Stores error</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-5 p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search store name, city, state, ZIP, phone, POS type..."
              className="pl-9"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading stores...
          </div>
        ) : stores.length === 0 ? (
          <div className="flex flex-col items-center justify-center border border-dashed border-border p-12 text-center">
            <Store className="h-10 w-10 text-muted-foreground" />
            <p className="mt-3 font-semibold text-foreground">No stores found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first store using the Add Store button.
            </p>

            <Button className="mt-5" onClick={openCreateForm}>
              <Plus className="mr-2 h-4 w-4" />
              Add Store
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-sm">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Store</th>
                    <th className="px-4 py-3 text-left">Owner</th>
                    <th className="px-4 py-3 text-left">Location</th>
                    <th className="px-4 py-3 text-left">POS</th>
                    <th className="px-4 py-3 text-left">Setup</th>
                    <th className="px-4 py-3 text-left">Products</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {stores.map((store) => (
                    <tr
                      key={store.id}
                      className="border-t border-border align-top hover:bg-secondary/30"
                    >
                      <td className="px-4 py-4">
                        <p className="font-medium text-foreground">{store.store_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {store.id.slice(0, 8)}
                        </p>
                        {store.phone_number && (
                          <p className="text-xs text-muted-foreground">{store.phone_number}</p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-medium text-foreground">
                          {formatOwner(store.owner, store.owner_id)}
                        </p>
                        {formatOwnerSubtext(store.owner) && (
                          <p className="text-xs text-muted-foreground">
                            {formatOwnerSubtext(store.owner)}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <p className="text-muted-foreground">
                          {[store.city, store.state].filter(Boolean).join(', ') || '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[store.address, store.zip_code].filter(Boolean).join(' ') || '—'}
                        </p>
                      </td>

                      <td className="px-4 py-4">
                        <p className="text-muted-foreground">{store.pos_type || '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {store.register_count.toLocaleString()} registers
                        </p>
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getSetupBadgeClass(
                            store.setup_status
                          )}`}
                        >
                          {store.setup_status}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-medium text-foreground">
                          {store.product_count.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {store.transaction_count.toLocaleString()} transactions
                        </p>
                      </td>

                      <td className="px-4 py-4">
                        {store.is_active ? (
                          <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                            Inactive
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-muted-foreground">
                        {formatDate(store.created_at)}
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditForm(store)}
                          >
                            <Edit3 className="mr-1 h-4 w-4" />
                            Edit
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            disabled={statusChangingId === store.id}
                            onClick={() => void handleToggleStoreStatus(store)}
                          >
                            {statusChangingId === store.id ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : store.is_active ? (
                              <ToggleLeft className="mr-1 h-4 w-4" />
                            ) : (
                              <ToggleRight className="mr-1 h-4 w-4" />
                            )}
                            {store.is_active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing page {pagination.page} of {pagination.totalPages} - {pagination.total.toLocaleString()} matching stores
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-foreground">
                {formMode === 'create' ? 'Add Store' : 'Edit Store'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formMode === 'create'
                  ? 'Create a new store profile in the platform.'
                  : 'Update store details. Changes will be recorded in audit logs.'}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Store name *
                </label>
                <Input
                  value={form.store_name}
                  onChange={(event) => updateFormField('store_name', event.target.value)}
                  placeholder="Example: Main Street Convenience"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Owner
                </label>
                <select
                  value={form.owner_id}
                  onChange={(event) => updateFormField('owner_id', event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Unassigned</option>
                  {sortedOwnerOptions.map((owner) => (
                    <option key={owner.user_id} value={owner.user_id}>
                      {ownerOptionLabel(owner)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Address
                </label>
                <Input
                  value={form.address}
                  onChange={(event) => updateFormField('address', event.target.value)}
                  placeholder="Street address"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  City
                </label>
                <Input
                  value={form.city}
                  onChange={(event) => updateFormField('city', event.target.value)}
                  placeholder="City"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  State
                </label>
                <Input
                  value={form.state}
                  onChange={(event) => updateFormField('state', event.target.value)}
                  placeholder="State"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  ZIP code
                </label>
                <Input
                  value={form.zip_code}
                  onChange={(event) => updateFormField('zip_code', event.target.value)}
                  placeholder="ZIP"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Phone number
                </label>
                <Input
                  value={form.phone_number}
                  onChange={(event) => updateFormField('phone_number', event.target.value)}
                  placeholder="Store phone"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  POS type
                </label>
                <Input
                  value={form.pos_type}
                  onChange={(event) => updateFormField('pos_type', event.target.value)}
                  placeholder="Example: Verifone, Clover, NCR"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Register count
                </label>
                <Input
                  type="number"
                  min="0"
                  value={form.register_count}
                  onChange={(event) => updateFormField('register_count', event.target.value)}
                  placeholder="1"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Change reason
                </label>
                <textarea
                  value={form.reason}
                  onChange={(event) => updateFormField('reason', event.target.value)}
                  placeholder="Optional reason for audit log"
                  className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>

              <Button onClick={handleSubmitStore} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {formMode === 'create' ? 'Create Store' : 'Save Changes'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}