'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  Store,
  Package,
  Truck,
  Receipt,
  UploadCloud,
  Shield,
  DollarSign,
  AlertCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type SummaryResponse = {
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

async function superadminFetch<T>(url: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('Please log in again.');
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Request failed.');
  }

  return json as T;
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await superadminFetch<SummaryResponse>('/api/admin/summary');
      setSummary(data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load Superadmin dashboard.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const cards = summary
    ? [
        {
          label: 'Users',
          value: summary.cards.userProfiles,
          icon: Users,
          href: '/admin/users',
          sub: 'Profiles created',
        },
        {
          label: 'Stores',
          value: summary.cards.stores,
          icon: Store,
          href: '/admin/stores',
          sub: 'Total stores',
        },
        {
          label: 'Products',
          value: summary.cards.products,
          icon: Package,
          href: '/admin/products',
          sub: 'Across all stores',
        },
        {
          label: 'Vendors',
          value: summary.cards.vendors,
          icon: Truck,
          href: '/admin/vendors',
          sub: 'Store vendors',
        },
        {
          label: 'Transactions',
          value: summary.cards.transactions,
          icon: Receipt,
          href: '/admin/transactions',
          sub: 'Uploaded records',
        },
        {
          label: 'Uploads',
          value: summary.cards.uploadBatches,
          icon: UploadCloud,
          href: '/admin/uploads',
          sub: 'CSV/PDF batches',
        },
        {
          label: 'Audit Logs',
          value: summary.cards.auditLogs,
          icon: Shield,
          href: '/admin/audit-logs',
          sub: 'Admin actions',
        },
        {
          label: 'Revenue',
          value: summary.cards.revenue,
          icon: DollarSign,
          href: '/admin/payments',
          sub: 'Payment module pending',
          money: true,
        },
      ]
    : [];

  return (
    <DashboardShell>
      <PageHeader
        title="Superadmin Control Center"
        description="Owner dashboard for users, stores, products, vendors, permissions, support, and revenue."
      >
        <Button asChild>
          <Link href="/admin/users">
            Manage Users
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </PageHeader>

      {loading && (
        <Card className="flex items-center gap-3 p-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Loading Superadmin dashboard...
          </p>
        </Card>
      )}

      {error && (
        <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-6 text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />

          <div>
            <p className="font-medium">Unable to load Superadmin dashboard</p>
            <p className="text-sm">{error}</p>
          </div>
        </Card>
      )}

      {summary && !loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <Link key={card.label} href={card.href}>
                  <Card className="p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {card.label}
                        </p>

                        <p className="mt-2 text-2xl font-semibold">
                          {card.money
                            ? `$${formatNumber(card.value)}`
                            : formatNumber(card.value)}
                        </p>

                        <p className="mt-1 text-xs text-muted-foreground">
                          {card.sub}
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Recent Stores</h2>
                  <p className="text-sm text-muted-foreground">
                    Latest stores created in the platform.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {summary.recentStores.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No stores found yet.
                  </p>
                )}

                {summary.recentStores.map((store) => (
                  <div key={store.id} className="rounded-lg border p-3">
                    <p className="font-medium">
                      {store.store_name || 'Unnamed Store'}
                    </p>

                    <p className="text-sm text-muted-foreground">
                      {[store.city, store.state, store.zip_code]
                        .filter(Boolean)
                        .join(', ') || 'No address details'}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDate(store.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Recent Admin Activity</h2>
                <p className="text-sm text-muted-foreground">
                  Latest permission, user, and support actions.
                </p>
              </div>

              <div className="space-y-3">
                {summary.recentAuditLogs.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No audit activity yet.
                  </p>
                )}

                {summary.recentAuditLogs.map((log) => (
                  <div key={log.id} className="rounded-lg border p-3">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(log.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}