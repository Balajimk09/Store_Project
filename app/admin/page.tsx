'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Building2,
  FileClock,
  Loader2,
  Package,
  RefreshCcw,
  Store,
  UploadCloud,
  Users,
  Wallet,
} from 'lucide-react';
import { adminFetch } from '@/lib/admin-client';
import { AdminShell, AdminPageHeader } from '@/components/layout/admin-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type AdminSummaryResponse = {
  cards: {
    stores: number;
    products: number;
    transactions: number;
    vendors: number;
    uploadBatches: number;
    userProfiles: number;
    auditLogs: number;
    revenue: number;
    payingCustomers: number;
    openTickets: number;
  };
  recentStores: Array<{
    id: string;
    store_name: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    phone_number: string | null;
    created_at: string;
  }>;
  recentAuditLogs: Array<{
    id: string;
    action: string;
    actor_user_id: string | null;
    target_user_id: string | null;
    target_store_id: string | null;
    created_at: string;
  }>;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function storeLocation(store: AdminSummaryResponse['recentStores'][number]) {
  const parts = [store.city, store.state, store.zip_code].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No location added';
}

export default function AdminOverviewPage() {
  const [summary, setSummary] = useState<AdminSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await adminFetch<AdminSummaryResponse>('/api/admin/summary');
      setSummary(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load admin summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const cards = summary?.cards;

  const overviewCards = [
    {
      label: 'Users',
      value: formatNumber((cards as any)?.users || cards?.userProfiles || 0),
      description: 'Total Supabase Auth users',
      icon: Users,
      href: '/admin/users',
    },
    {
      label: 'Stores',
      value: formatNumber(cards?.stores || 0),
      description: 'Stores created in StorePulse',
      icon: Store,
      href: '/admin/stores',
    },
    {
      label: 'Products',
      value: formatNumber(cards?.products || 0),
      description: 'Products across all stores',
      icon: Package,
      href: '/admin/products',
    },
    {
      label: 'Vendors',
      value: formatNumber(cards?.vendors || 0),
      description: 'Store vendor records',
      icon: Building2,
      href: '/admin/vendors',
    },
    {
      label: 'Transactions',
      value: formatNumber(cards?.transactions || 0),
      description: 'Uploaded transaction rows',
      icon: BarChart3,
      href: '/admin/products',
    },
    {
      label: 'Uploads',
      value: formatNumber(cards?.uploadBatches || 0),
      description: 'POS and inventory upload batches',
      icon: UploadCloud,
      href: '/admin/stores',
    },
    {
      label: 'Audit Logs',
      value: formatNumber(cards?.auditLogs || 0),
      description: 'Superadmin actions recorded',
      icon: FileClock,
      href: '/admin/audit-logs',
    },
    {
      label: 'Revenue',
      value: formatCurrency(cards?.revenue || 0),
      description: 'Payment tracking placeholder',
      icon: Wallet,
      href: '/admin/payments',
    },
  ];

  return (
    <AdminShell>
      <AdminPageHeader
        title="Superadmin Overview"
        description="Owner control center for users, stores, uploads, products, support, and platform activity."
      >
        <Button variant="outline" onClick={loadSummary} disabled={loading}>
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
          <p className="text-sm">{error}</p>
        </Card>
      )}

      {loading && !summary ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Superadmin dashboard...
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {overviewCards.map((item) => {
              const Icon = item.icon;

              return (
                <Link key={item.label} href={item.href}>
                  <Card className="h-full p-5 transition hover:border-primary/40 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{item.label}</p>
                        <p className="mt-2 text-2xl font-semibold tracking-tight">
                          {item.value}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      </div>

                      <div className="rounded-xl bg-primary/10 p-3 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Recent Stores</h2>
                  <p className="text-sm text-muted-foreground">
                    Latest store profiles created on the platform.
                  </p>
                </div>

                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/stores">View Stores</Link>
                </Button>
              </div>

              {!summary?.recentStores?.length ? (
                <div className="rounded-xl border border-dashed p-8 text-center">
                  <Store className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">No stores found yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Store profiles will appear here after setup.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {summary.recentStores.map((store) => (
                    <div
                      key={store.id}
                      className="flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium">
                          {store.store_name || 'Unnamed Store'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {storeLocation(store)}
                        </p>
                        {store.phone_number && (
                          <p className="text-xs text-muted-foreground">
                            {store.phone_number}
                          </p>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {formatDate(store.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Recent Admin Activity</h2>
                  <p className="text-sm text-muted-foreground">
                    Latest Superadmin actions from audit logs.
                  </p>
                </div>

                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/audit-logs">Audit Logs</Link>
                </Button>
              </div>

              {!summary?.recentAuditLogs?.length ? (
                <div className="rounded-xl border border-dashed p-8 text-center">
                  <Activity className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">No audit activity yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    User creation, resets, and permission changes will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {summary.recentAuditLogs.map((log) => (
                    <div key={log.id} className="rounded-xl border p-4">
                      <p className="text-sm font-medium">{log.action}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(log.created_at)}
                      </p>
                      <p className="mt-2 break-all text-xs text-muted-foreground">
                        Actor: {log.actor_user_id || 'Unknown'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </AdminShell>
  );
}