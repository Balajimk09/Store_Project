'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileClock,
  Loader2,
  RefreshCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminFetch } from '@/lib/admin-client';

type UserProfile = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  username?: string | null;
};

type AuditLog = {
  id: string;
  created_at: string | null;
  actor_user_id: string | null;
  actor: UserProfile | null;
  action: string;
  target_user_id: string | null;
  target_user: UserProfile | null;
  target_store_id: string | null;
  target_table: string | null;
  target_record_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  reason: string | null;
};

type AuditLogsResponse = {
  summary: {
    totalAuditLogs: number;
  };
  logs: AuditLog[];
  filters: {
    actions: string[];
    targetTables: string[];
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function formatDate(value: string | null) {
  if (!value) return 'Unknown';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatUser(profile: UserProfile | null, fallbackId?: string | null) {
  if (!profile) return fallbackId ? `Unknown (${fallbackId.slice(0, 8)})` : 'Unknown';

  return (
    profile.full_name ||
    profile.email ||
    profile.username ||
    (fallbackId ? `User ${fallbackId.slice(0, 8)}` : 'Unknown')
  );
}

function formatAction(action: string) {
  return action
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getMetadataIp(metadata: Record<string, unknown> | null) {
  if (!metadata || typeof metadata !== 'object') return '—';

  const direct =
    metadata.ip ||
    metadata.ip_address ||
    metadata.ipAddress ||
    metadata.client_ip ||
    metadata.clientIp;

  return direct ? String(direct) : '—';
}

function getDetailsPreview(log: AuditLog) {
  if (log.reason) return log.reason;

  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  const keys = Object.keys(metadata);

  if (keys.length > 0) {
    return keys.slice(0, 3).join(', ');
  }

  if (log.new_values) return 'New values recorded';
  if (log.old_values) return 'Old values recorded';

  return '—';
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (!value || (typeof value === 'object' && Object.keys(value as object).length === 0)) {
    return null;
  }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>

      <pre className="max-h-56 overflow-auto rounded-lg bg-secondary/60 p-3 text-xs text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState({ totalAuditLogs: 0 });
  const [actions, setActions] = useState<string[]>([]);
  const [targetTables, setTargetTables] = useState<string[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [targetFilter, setTargetFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(
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
        if (actionFilter !== 'all') params.set('action', actionFilter);
        if (targetFilter !== 'all') params.set('target', targetFilter);

        const payload = await adminFetch<AuditLogsResponse>(
          `/api/admin/audit-logs?${params.toString()}`
        );

        setLogs(payload.logs || []);
        setSummary(payload.summary || { totalAuditLogs: 0 });
        setActions(payload.filters?.actions || []);
        setTargetTables(payload.filters?.targetTables || []);
        setPagination(payload.pagination || {
          page,
          pageSize: 25,
          total: 0,
          totalPages: 1,
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load audit logs.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actionFilter, debouncedSearch, page, targetFilter]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <AdminShell>
      <AdminPageHeader
        title="Audit Logs"
        description="Read-only record of Superadmin actions across users, stores, permissions, and settings."
      >
        <Button
          variant="outline"
          onClick={() => void loadLogs('refresh')}
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
              <FileClock className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Total Audit Logs</p>
              <p className="text-2xl font-semibold text-foreground">
                {summary.totalAuditLogs.toLocaleString()}
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
              <p className="text-sm text-muted-foreground">Action Types</p>
              <p className="text-2xl font-semibold text-foreground">
                {actions.length.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <Clock3 className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Current Page</p>
              <p className="text-2xl font-semibold text-foreground">
                {pagination.page} / {pagination.totalPages}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mb-5 p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_240px_240px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action, target, reason, admin name, or email..."
              className="pl-9"
            />
          </div>

          <select
            value={actionFilter}
            onChange={(event) => {
              setActionFilter(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {formatAction(action)}
              </option>
            ))}
          </select>

          <select
            value={targetFilter}
            onChange={(event) => {
              setTargetFilter(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All target types</option>
            {targetTables.map((target) => (
              <option key={target} value={target}>
                {target}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && (
        <Card className="mb-5 border-destructive/30 bg-destructive/10 p-5 text-destructive">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="font-semibold">Could not load audit logs</p>
              <p className="mt-1 text-sm">{error}</p>

              <Button
                variant="outline"
                className="mt-4"
                onClick={() => void loadLogs('refresh')}
              >
                Try Again
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading audit logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center border border-dashed border-border p-12 text-center">
            <FileClock className="h-10 w-10 text-muted-foreground" />
            <p className="mt-3 font-semibold text-foreground">No audit logs found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Admin activity will appear here after actions are recorded.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Timestamp</th>
                    <th className="px-4 py-3 text-left">Admin</th>
                    <th className="px-4 py-3 text-left">Action</th>
                    <th className="px-4 py-3 text-left">Target Type</th>
                    <th className="px-4 py-3 text-left">Target ID</th>
                    <th className="px-4 py-3 text-left">Details</th>
                    <th className="px-4 py-3 text-left">IP</th>
                  </tr>
                </thead>

                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-border align-top hover:bg-secondary/30">
                      <td className="px-4 py-4 whitespace-nowrap text-muted-foreground">
                        {formatDate(log.created_at)}
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-medium text-foreground">
                          {formatUser(log.actor, log.actor_user_id)}
                        </p>
                        {log.actor?.email && (
                          <p className="text-xs text-muted-foreground">{log.actor.email}</p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                          {formatAction(log.action)}
                        </span>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {log.action}
                        </p>
                      </td>

                      <td className="px-4 py-4 text-muted-foreground">
                        {log.target_table || '—'}
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-mono text-xs text-muted-foreground">
                          {log.target_record_id || log.target_user_id || log.target_store_id || '—'}
                        </p>

                        {log.target_user && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Target user: {formatUser(log.target_user, log.target_user_id)}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <p className="max-w-[280px] truncate text-muted-foreground">
                          {getDetailsPreview(log)}
                        </p>

                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium text-primary">
                            View details
                          </summary>

                          <div className="mt-3 grid gap-3">
                            {log.reason && (
                              <div className="rounded-lg bg-secondary/50 p-3 text-xs">
                                <p className="font-semibold text-foreground">Reason</p>
                                <p className="mt-1 text-muted-foreground">{log.reason}</p>
                              </div>
                            )}

                            <JsonBlock title="Metadata" value={log.metadata} />
                            <JsonBlock title="Old Values" value={log.old_values} />
                            <JsonBlock title="New Values" value={log.new_values} />
                          </div>
                        </details>
                      </td>

                      <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                        {getMetadataIp(log.metadata)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString()} total logs
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
    </AdminShell>
  );
}