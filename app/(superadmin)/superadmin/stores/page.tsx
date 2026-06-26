'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCcw,
  Pencil,
  Trash2,
  Store,
  X,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SuperadminShell, SuperadminPageHeader } from '@/components/layout/superadmin-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  StoreProfileForm,
  type StoreProfileFormValues,
} from '@/components/stores/store-profile-form';

const POS_TYPES = [
  { name: 'Verifone', pos_key: 'verifone' },
  { name: 'Gilbarco', pos_key: 'gilbarco' },
  { name: 'Clover', pos_key: 'clover' },
  { name: 'NCR', pos_key: 'ncr' },
  { name: 'Square', pos_key: 'square' },
  { name: 'Ruby', pos_key: 'ruby' },
  { name: 'Other', pos_key: 'other' },
];

type StoreRow = StoreProfileFormValues & {
  created_at?: string;
  is_active?: boolean;
};

async function adminFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('Please log in again.');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json.error || 'Request failed.');
  }

  return json as T;
}

export default function AdminStoresPage() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [editingStore, setEditingStore] = useState<StoreRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const storesData = await adminFetch<{ stores: StoreRow[] }>('/api/admin/stores');

      setStores(storesData.stores || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load stores.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const openCreate = () => {
    setEditingStore(null);
    setDrawerMode('create');
    setDrawerOpen(true);
    setError(null);
  };

  const openEdit = (store: StoreRow) => {
    setEditingStore(store);
    setDrawerMode('edit');
    setDrawerOpen(true);
    setError(null);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingStore(null);
    setError(null);
  };

  const handleCreate = async (values: StoreProfileFormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      await adminFetch('/api/admin/stores', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      showSuccess('Store created successfully.');
      closeDrawer();
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create store.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (values: StoreProfileFormValues) => {
    if (!editingStore?.id) return;

    setSubmitting(true);
    setError(null);

    try {
      await adminFetch(`/api/admin/stores/${editingStore.id}`, {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
      showSuccess('Store updated successfully.');
      closeDrawer();
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update store.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (storeId: string, storeName: string) => {
    const confirmed = window.confirm(`Delete "${storeName}"? This cannot be undone.`);

    if (!confirmed) return;

    setError(null);

    try {
      await adminFetch(`/api/admin/stores/${storeId}`, { method: 'DELETE' });
      showSuccess('Store deleted.');
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete store.');
    }
  };

  const handleToggleActive = async (store: StoreRow) => {
    if (!store.id) return;

    const nextIsActive = store.is_active === false;
    const confirmed = window.confirm(
      nextIsActive
        ? `Activate "${store.store_name}"?`
        : `Deactivate "${store.store_name}"?`
    );

    if (!confirmed) return;

    setError(null);

    try {
      await adminFetch(`/api/admin/stores/${store.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: nextIsActive }),
      });
      showSuccess(nextIsActive ? 'Store activated.' : 'Store deactivated.');
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update status.');
    }
  };

  const getPrimaryOwnerEmail = (store: StoreRow) => {
    const ownerContact = store.primary_contacts?.find(
      (contact) => (contact.role || '').toLowerCase() === 'owner' && contact.email
    );

    return store.primary_owner_email || ownerContact?.email || null;
  };

  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Stores"
        description="All StorePulse stores. Create, edit, activate, and manage."
      >
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>

        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Store
        </Button>
      </SuperadminPageHeader>

      <div className="space-y-5">
        {error && (
          <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </Card>
        )}

        {success && (
          <Card className="flex items-start gap-3 border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">{success}</p>
          </Card>
        )}

        <Card className="p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading stores...
            </div>
          ) : stores.length === 0 ? (
            <div className="py-12 text-center">
              <Store className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="font-medium text-muted-foreground">No stores yet</p>
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create First Store
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2">Store</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((store) => {
                    const active = store.is_active !== false;
                    const primaryOwnerEmail = getPrimaryOwnerEmail(store);

                    return (
                      <tr key={store.id} className="border-b last:border-0">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            {store.logo_url ? (
                              <img
                                src={store.logo_url}
                                alt=""
                                className="h-10 w-10 rounded-lg border object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted">
                                <Store className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-foreground">{store.store_name}</p>
                              {store.store_code && (
                                <p className="text-xs text-muted-foreground">{store.store_code}</p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                {store.store_type || 'Convenience Store'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {[store.city, store.state, store.zip_code].filter(Boolean).join(', ') ||
                            '-'}
                        </td>
                        <td className="px-3 py-3">
                          {primaryOwnerEmail ? (
                            <>
                              <p className="text-sm text-foreground">
                                {primaryOwnerEmail}
                              </p>
                              <p className="text-xs text-muted-foreground">Primary owner</p>
                            </>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 capitalize text-muted-foreground">
                          {store.plan || 'starter'}
                        </td>
                        <td className="px-3 py-3">
                          {active ? (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              Active
                            </span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {store.id ? (
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/superadmin/stores/${store.id}`}>View Store 360</Link>
                              </Button>
                            ) : null}
                            <Button size="sm" variant="outline" onClick={() => openEdit(store)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleToggleActive(store)}
                              title={active ? 'Deactivate store' : 'Activate store'}
                            >
                              {active ? (
                                <ToggleLeft className="mr-1 h-3.5 w-3.5" />
                              ) : (
                                <ToggleRight className="mr-1 h-3.5 w-3.5" />
                              )}
                              {active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => void handleDelete(store.id!, store.store_name)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close store drawer"
            className="flex-1 bg-black/50"
            onClick={closeDrawer}
          />

          <aside className="flex h-full w-full max-w-2xl flex-col bg-background shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {drawerMode === 'create'
                    ? 'New Store'
                    : `Edit: ${editingStore?.store_name || 'Store'}`}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {drawerMode === 'create'
                    ? 'Create a StorePulse profile and assign owner access.'
                    : 'Update store details, users, compliance, and billing metadata.'}
                </p>
              </div>

              <Button variant="ghost" size="icon" onClick={closeDrawer} aria-label="Close">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {error ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <StoreProfileForm
                initialValues={drawerMode === 'edit' ? editingStore : null}
                posTypes={POS_TYPES}
                isSubmitting={submitting}
                submitLabel={drawerMode === 'create' ? 'Create Store' : 'Save Changes'}
                onSubmit={drawerMode === 'create' ? handleCreate : handleUpdate}
                onCancel={closeDrawer}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </SuperadminShell>
  );
}
