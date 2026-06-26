'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeDollarSign,
  BookOpen,
  Boxes,
  CheckSquare,
  ClipboardList,
  Headphones,
  Loader2,
  RefreshCcw,
  Store,
  UserPlus,
} from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { adminFetch, type AdminMeResponse } from '@/lib/admin-client';

type DashboardStats = {
  demoRequestsNew: number;
  demoRequestsAssignedToMe: number;
  recentDemoRequests: Array<Record<string, unknown>>;
  newSignupsThisWeek: number;
  storesActiveToday: number;
  storesNotLoggedIn7Days: number;
  storesSetupIncomplete: number;
  storesNeedingHelp: number;
  myOpenTickets: number;
  unassignedTickets: number;
  followupsDueToday: number;
  followupsDueTodayList: Array<Record<string, unknown>>;
  pendingApprovals: number;
  trialsEndingIn7Days: number;
  failedPayments: number;
  renewalsDueSoon: number;
  expiredPlans: number;
  productIssues: number;
  activePromotions: number;
  recentStoreActivity: Array<Record<string, unknown>>;
};

const emptyStats: DashboardStats = {
  demoRequestsNew: 0,
  demoRequestsAssignedToMe: 0,
  recentDemoRequests: [],
  newSignupsThisWeek: 0,
  storesActiveToday: 0,
  storesNotLoggedIn7Days: 0,
  storesSetupIncomplete: 0,
  storesNeedingHelp: 0,
  myOpenTickets: 0,
  unassignedTickets: 0,
  followupsDueToday: 0,
  followupsDueTodayList: [],
  pendingApprovals: 0,
  trialsEndingIn7Days: 0,
  failedPayments: 0,
  renewalsDueSoon: 0,
  expiredPlans: 0,
  productIssues: 0,
  activePromotions: 0,
  recentStoreActivity: [],
};

function hasPermission(me: AdminMeResponse | null, key: string) {
  return Boolean(me?.isSuperadmin || me?.permissionKeys.includes(key));
}

function hasSupportAccess(me: AdminMeResponse | null) {
  return Boolean(me?.isSuperadmin || me?.profile.supportAccess || me?.profile.isSupportAgent || me?.supportAccess.isActive || me?.permissionKeys.includes('tickets.view'));
}

function hasAny(me: AdminMeResponse | null, keys: string[]) {
  return keys.some((key) => hasPermission(me, key));
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'red' }) {
  return (
    <Card className={tone === 'red' ? 'border-red-200 bg-red-50 p-4' : 'p-4'}>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={tone === 'red' ? 'mt-2 text-2xl font-semibold text-red-700' : 'mt-2 text-2xl font-semibold'}>{value}</p>
    </Card>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function StaffDashboardPage() {
  const [me, setMe] = useState<AdminMeResponse | null>(null);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [meResponse, statsResponse] = await Promise.all([
        adminFetch<AdminMeResponse>('/api/admin/me'),
        adminFetch<DashboardStats>('/api/admin/dashboard/stats'),
      ]);
      setMe(meResponse);
      setStats(statsResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load admin dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const quickActions = useMemo(
    () =>
      [
        { label: 'Open Support Desk', href: '/admin/support-desk', icon: Headphones, show: hasSupportAccess(me) },
        { label: 'View Stores', href: '/admin/stores', icon: Store, show: hasAny(me, ['stores.view', 'stores.search']) },
        { label: 'View Signups', href: '/admin/signups', icon: UserPlus, show: hasAny(me, ['demo_requests.view', 'signups.view']) },
        { label: 'View Billing', href: '/admin/billing', icon: BadgeDollarSign, show: hasAny(me, ['renewals.view', 'billing.view']) },
        { label: 'View Knowledge Base', href: '/admin/knowledge-base', icon: BookOpen, show: hasPermission(me, 'knowledge_base.view') },
        { label: 'View Approvals', href: '/admin/approvals', icon: CheckSquare, show: hasAny(me, ['approvals.view', 'approval.request_action', 'approval.approve_action', 'approvals.manage']) },
        { label: 'View Products', href: '/admin/products', icon: Boxes, show: hasPermission(me, 'products.view') },
      ].filter((item) => item.show),
    [me]
  );

  return (
    <AdminShell>
      <AdminPageHeader title="Admin Operations Hub" description="Sales, support, billing, store health, and operations for StorePulse staff.">
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </AdminPageHeader>

      {loading ? (
        <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading admin dashboard...
        </Card>
      ) : error ? (
        <Card className="flex items-start gap-3 border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <div>
            <p className="font-medium">Dashboard unavailable</p>
            <p>{error}</p>
          </div>
        </Card>
      ) : (me?.permissionKeys.length || 0) === 0 && !hasSupportAccess(me) ? (
        <Card className="p-8 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">No Permissions Assigned</h2>
          <p className="mt-1 text-sm text-muted-foreground">Contact your superadmin if you need this permission.</p>
        </Card>
      ) : (
        <div className="space-y-8">
          <Section title="Quick Actions">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Button key={action.href} asChild variant="outline" className="justify-start">
                    <Link href={action.href}>
                      <Icon className="mr-2 h-4 w-4" />
                      {action.label}
                    </Link>
                  </Button>
                );
              })}
            </div>
          </Section>

          {hasAny(me, ['demo_requests.view', 'signups.view']) && (
            <Section title="Sales & Growth">
              <div className="grid gap-4 md:grid-cols-4">
                <MetricCard label="New Demo Requests" value={stats.demoRequestsNew} />
                <MetricCard label="Assigned to Me" value={stats.demoRequestsAssignedToMe} />
                <MetricCard label="New Signups This Week" value={stats.newSignupsThisWeek} />
                <MetricCard label="Trials Ending in 7 Days" value={stats.trialsEndingIn7Days} />
              </div>
            </Section>
          )}

          {hasAny(me, ['store_activity.view', 'stores.view']) && (
            <Section title="Customer Success">
              <div className="grid gap-4 md:grid-cols-4">
                <MetricCard label="Stores Active Today" value={stats.storesActiveToday} />
                <MetricCard label="Not Logged In 7+ Days" value={stats.storesNotLoggedIn7Days} tone="red" />
                <MetricCard label="Setup Incomplete" value={stats.storesSetupIncomplete} />
                <MetricCard label="Stores Needing Help" value={stats.storesNeedingHelp} />
              </div>
            </Section>
          )}

          {hasSupportAccess(me) && (
            <Section title="Support">
              <div className="grid gap-4 md:grid-cols-4">
                <MetricCard label="My Open Tickets" value={stats.myOpenTickets} />
                <MetricCard label="Unassigned Tickets" value={stats.unassignedTickets} />
                <MetricCard label="Follow-ups Due Today" value={stats.followupsDueToday} />
                <MetricCard label="Pending Approvals" value={stats.pendingApprovals} />
              </div>
            </Section>
          )}

          {hasAny(me, ['renewals.view', 'billing.view']) && (
            <Section title="Billing & Renewals">
              <div className="grid gap-4 md:grid-cols-4">
                <MetricCard label="Trials Ending 7 Days" value={stats.trialsEndingIn7Days} />
                <MetricCard label="Renewals Due Soon" value={stats.renewalsDueSoon} />
                <MetricCard label="Failed Payments" value={stats.failedPayments} tone="red" />
                <MetricCard label="Expired Plans" value={stats.expiredPlans} />
              </div>
            </Section>
          )}

          {hasAny(me, ['products.view', 'promotions.view']) && (
            <Section title="Products & Promotions">
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard label="Products Needing Review" value={stats.productIssues} />
                <MetricCard label="Active Promotions" value={stats.activePromotions} />
                <MetricCard label="Vendor Opportunities" value={0} />
              </div>
            </Section>
          )}
        </div>
      )}
    </AdminShell>
  );
}
