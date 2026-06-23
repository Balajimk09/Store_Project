'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, RefreshCcw, Search, Store } from 'lucide-react';
import { adminFetch } from '@/lib/admin-client';
import { AdminShell, AdminPageHeader } from '@/components/layout/admin-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type AdminStoreRow = {
  id: string;
  store_name: string;
  store_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone_number: string | null;
  pos_type: string | null;
  register_count: number;
  has_fuel: boolean;
  created_at: string;
  owner_id: string;
  owner: {
    full_name: string | null;
    email: string | null;
    username: string | null;
  } | null;
  products_count: number;
  transactions_count: number;
  setup_status: 'complete' | 'incomplete';
};

type AdminStoresResponse = {
  summary: {
    totalStores: number;
  };
  stores: AdminStoreRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function formatLocation(store: AdminStoreRow) {
  const parts = [store.city, store.state, store.zip_code].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No location';
}

function formatOwner(store: AdminStoreRow) {
  return (
    store.owner?.full_name ||
    store.owner?.email ||
    store.owner?.username ||
    'Unknown'
  );
}

export default function AdminStoresPage() {
  const [stores, setStores] = useState<AdminStoreRow[]>([]);
  const [totalStores, setTotalStores] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStores = useCallback(async (nextPage: number, nextSearch: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: '25',
      });

      if (nextSearch.trim()) {
        params.set('search', nextSearch.trim());
      }

      const data = await adminFetch<AdminStoresResponse>(`/api/admin/stores?${params.toString()}`);

      setStores(data.stores);
      setTotalStores(data.summary.totalStores);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load stores.');
      setStores([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    loadStores(page, searchTerm);
  }, [loadStores, page, searchTerm]);

  const handleRefresh = () => {
    loadStores(page, searchTerm);
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Stores"
        description="Read-only view of all store profiles on the platform."
      >
        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </AdminPageHeader>

      {error && (
        <Card className="mb-6 flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleRefresh}
              disabled={loading}
            >
              Try Again
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-6">
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">Total Stores</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(totalStores)}</p>
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">All Stores</h2>
              <p className="text-sm text-muted-foreground">
                Search by store name, location, phone, or owner details.
              </p>
            </div>

            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search stores..."
                className="pl-9"
              />
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading stores...
            </div>
          )}

          {!loading && !error && stores.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <Store className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No stores found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {searchTerm
                  ? 'Try a different search term.'
                  : 'Store profiles will appear here after setup.'}
              </p>
            </div>
          )}

          {!loading && stores.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2">Store Name</th>
                      <th className="px-3 py-2">Owner</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2">POS Type</th>
                      <th className="px-3 py-2">Registers</th>
                      <th className="px-3 py-2">Products</th>
                      <th className="px-3 py-2">Transactions</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Setup</th>
                    </tr>
                  </thead>

                  <tbody>
                    {stores.map((store) => (
                      <tr key={store.id} className="border-b">
                        <td className="px-3 py-3">
                          <p className="font-medium">
                            {store.store_name?.trim() || 'Unnamed Store'}
                          </p>
                        </td>

                        <td className="px-3 py-3">
                          <p>{formatOwner(store)}</p>
                          {store.owner?.email && store.owner.full_name && (
                            <p className="text-xs text-muted-foreground">{store.owner.email}</p>
                          )}
                        </td>

                        <td className="px-3 py-3">{formatLocation(store)}</td>

                        <td className="px-3 py-3">
                          {store.phone_number?.trim() || '—'}
                        </td>

                        <td className="px-3 py-3">{store.pos_type?.trim() || '—'}</td>

                        <td className="px-3 py-3">{formatNumber(store.register_count)}</td>

                        <td className="px-3 py-3">{formatNumber(store.products_count)}</td>

                        <td className="px-3 py-3">{formatNumber(store.transactions_count)}</td>

                        <td className="px-3 py-3">{formatDate(store.created_at)}</td>

                        <td className="px-3 py-3">
                          <span
                            className={
                              store.setup_status === 'complete'
                                ? 'rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700'
                                : 'rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700'
                            }
                          >
                            {store.setup_status === 'complete' ? 'Complete' : 'Incomplete'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={loading || page <= 1}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Previous
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={loading || page >= totalPages}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
