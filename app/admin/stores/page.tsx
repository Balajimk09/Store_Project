'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCcw, Store } from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import StoreProfileForm, {
  LoginAccountOption,
  PosTypeOption,
  StoreProfileFormValues,
} from '@/components/stores/store-profile-form';

type StoreRow = StoreProfileFormValues & {
  id: string;
  created_at?: string;
  updated_at?: string;
};

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  return headers;
}

function normalizeStores(data: unknown): StoreRow[] {
  if (Array.isArray(data)) return data as StoreRow[];

  if (data && typeof data === 'object') {
    const objectData = data as {
      stores?: StoreRow[];
      data?: StoreRow[];
      results?: StoreRow[];
    };

    return objectData.stores || objectData.data || objectData.results || [];
  }

  return [];
}

function normalizeAccounts(data: unknown): LoginAccountOption[] {
  if (!data || typeof data !== 'object') return [];

  const objectData = data as {
    users?: LoginAccountOption[];
    accounts?: LoginAccountOption[];
    loginAccounts?: LoginAccountOption[];
    owners?: LoginAccountOption[];
  };

  return (
    objectData.users ||
    objectData.accounts ||
    objectData.loginAccounts ||
    objectData.owners ||
    []
  );
}

function normalizePosTypes(data: unknown): PosTypeOption[] {
  if (Array.isArray(data)) return data as PosTypeOption[];

  if (data && typeof data === 'object') {
    const objectData = data as {
      posTypes?: PosTypeOption[];
      pos_types?: PosTypeOption[];
      data?: PosTypeOption[];
    };

    return objectData.posTypes || objectData.pos_types || objectData.data || [];
  }

  return [];
}

export default function AdminStoresPage() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loginAccounts, setLoginAccounts] = useState<LoginAccountOption[]>([]);
  const [posTypes, setPosTypes] = useState<PosTypeOption[]>([]);
  const [selectedStore, setSelectedStore] = useState<StoreRow | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sortedStores = useMemo(() => {
    return [...stores].sort((a, b) => {
      return (a.store_name || '').localeCompare(b.store_name || '');
    });
  }, [stores]);

  const loadStores = useCallback(async () => {
    const headers = await getAuthHeaders();

    const response = await fetch('/api/admin/stores', {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || 'Unable to load stores.');
    }

    setStores(normalizeStores(data));
    setLoginAccounts(normalizeAccounts(data));
  }, []);

  const loadPosTypes = useCallback(async () => {
    const response = await fetch('/api/admin/pos-types', {
      method: 'GET',
      cache: 'no-store',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || 'Unable to load POS types.');
    }

    setPosTypes(normalizePosTypes(data));
  }, []);

  const loadPageData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      await Promise.all([loadStores(), loadPosTypes()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load admin stores.');
    } finally {
      setIsLoading(false);
    }
  }, [loadPosTypes, loadStores]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  function handleCreateStore() {
    setSelectedStore(null);
    setIsFormOpen(true);
    setErrorMessage(null);
  }

  function handleEditStore(store: StoreRow) {
    setSelectedStore(store);
    setIsFormOpen(true);
    setErrorMessage(null);
  }

  async function handleSaveStore(values: StoreProfileFormValues) {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const headers = await getAuthHeaders();
      const method = values.id ? 'PATCH' : 'POST';

      const response = await fetch('/api/admin/stores', {
        method,
        headers,
        body: JSON.stringify(values),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Unable to save store.');
      }

      await loadStores();
      setSelectedStore(null);
      setIsFormOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save store.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddPosType() {
    const name = window.prompt('Enter POS type name, for example Verifone Commander:');

    if (!name || !name.trim()) {
      return;
    }

    const description = window.prompt('Optional description for this POS type:') || '';

    setErrorMessage(null);

    try {
      const headers = await getAuthHeaders();

      const response = await fetch('/api/admin/pos-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Unable to create POS type.');
      }

      await loadPosTypes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create POS type.');
    }
  }

  return (
    <AdminShell>
      <AdminPageHeader
        title="Admin Stores"
        description="Manage store profiles, owner access, POS setup, billing, and support controls."
      >
        <Button variant="outline" onClick={() => void loadPageData()} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>

        <Button onClick={handleCreateStore}>
          <Plus className="mr-2 h-4 w-4" />
          Add Store
        </Button>
      </AdminPageHeader>

      <div className="space-y-6">
        {errorMessage ? (
          <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {errorMessage}
          </Card>
        ) : null}

        {isFormOpen ? (
          <Card className="p-4">
            <StoreProfileForm
              initialValues={selectedStore}
              loginAccounts={loginAccounts}
              posTypes={posTypes}
              isSubmitting={isSaving}
              submitLabel={selectedStore ? 'Update Store' : 'Create Store'}
              onSubmit={handleSaveStore}
              onCancel={() => {
                setSelectedStore(null);
                setIsFormOpen(false);
              }}
              onAddPosType={handleAddPosType}
            />
          </Card>
        ) : null}

        <Card className="overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold text-foreground">Stores</h2>
            <p className="text-sm text-muted-foreground">
              Select a store to edit the full Store Profile form.
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading stores...
            </div>
          ) : sortedStores.length === 0 ? (
            <div className="p-8 text-center">
              <Store className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-3 text-base font-semibold text-foreground">No stores yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first store profile from the superadmin panel.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {sortedStores.map((store) => (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => handleEditStore(store)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left hover:bg-secondary/50"
                >
                  <div>
                    <div className="font-semibold text-foreground">{store.store_name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {[store.address_line1, store.city, store.state, store.zip_code]
                        .filter(Boolean)
                        .join(', ') || 'No address saved'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      POS: {store.pos_type || 'Not selected'} - Plan: {store.plan || 'Not set'}
                    </div>
                  </div>

                  <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
                    Edit
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
