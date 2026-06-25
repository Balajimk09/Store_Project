'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  RefreshCcw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Shield,
  Plus,
  X,
  Pencil,
  Trash2,
  Download,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SuperadminShell, SuperadminPageHeader } from '@/components/layout/superadmin-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type AuditLogRow = {
  id?: string | null;
  action?: string | null;
  actor_user_id?: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  target_user_id?: string | null;
  target_user_email?: string | null;
  target_user_name?: string | null;
  target_store_id?: string | null;
  target_store_name?: string | null;
  target_table?: string | null;
  target_record_id?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  reason?: string | null;
  created_at?: string | null;
};

type Filters = {
  search: string;
  action: string;
  target_table: string;
  actor_search: string;
  from: string;
  to: string;
};

type AuditLogsResponse = {
  logs: AuditLogRow[];
  total: number;
  page: number;
  limit: number;
};

const LIMIT = 50;
const AUTO_REFRESH_INTERVAL = 30000;

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

function getActionColor(action = '') {
  if (action.includes('delete') || action.includes('remove')) {
    return 'bg-red-100 text-red-700';
  }
  if (action.includes('deactivate')) {
    return 'bg-amber-100 text-amber-700';
  }
  if (action.startsWith('team.') || action.startsWith('users.')) {
    return 'bg-blue-100 text-blue-700';
  }
  if (action.startsWith('store.') || action.startsWith('stores.')) {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (action.startsWith('platform.')) {
    return 'bg-purple-100 text-purple-700';
  }
  return 'bg-slate-100 text-slate-600';
}

function formatDate(value?: string | null) {
  if (!value) return '-';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function shortId(value?: string | null) {
  if (!value) return '';
  return value.length > 20 ? `${value.slice(0, 20)}...` : value;
}

function truncate(value: string, length = 50) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function jsonText(value: unknown) {
  if (!value) return '';
  return JSON.stringify(value, null, 2);
}

function csvValue(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function lastRefreshedLabel(value: Date | null) {
  if (!value) return 'Last refreshed: never';
  const seconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
  return seconds <= 3 ? 'Last refreshed: just now' : `Last refreshed: ${seconds} seconds ago`;
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [actorSearch, setActorSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [manualAction, setManualAction] = useState('platform.manual_note');
  const [manualReason, setManualReason] = useState('');
  const [manualTargetTable, setManualTargetTable] = useState('');
  const [manualTargetRecordId, setManualTargetRecordId] = useState('');
  const [manualMetadataText, setManualMetadataText] = useState('');
  const [editingLog, setEditingLog] = useState<AuditLogRow | null>(null);
  const [editAction, setEditAction] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editMetadataText, setEditMetadataText] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const intervalRef = useRef<number | null>(null);

  const currentFilters = useCallback<() => Filters>(
    () => ({
      search,
      action: actionFilter,
      target_table: tableFilter,
      actor_search: actorSearch,
      from: fromDate,
      to: toDate,
    }),
    [actionFilter, actorSearch, fromDate, search, tableFilter, toDate]
  );

  const buildUrl = (currentPage: number, filters: Filters, limit = LIMIT) => {
    const params = new URLSearchParams({
      page: String(currentPage),
      limit: String(limit),
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });

    return `/api/admin/audit-logs?${params.toString()}`;
  };

  const load = useCallback(
    async (currentPage = page, filters = currentFilters()) => {
      setLoading(true);
      setError(null);

      try {
        const payload = await adminFetch<AuditLogsResponse>(buildUrl(currentPage, filters));
        setLogs(payload.logs || []);
        setTotal(payload.total || 0);
        setPage(payload.page || currentPage);
        setLastRefreshed(new Date());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load audit logs.');
      } finally {
        setLoading(false);
      }
    },
    [currentFilters, page]
  );

  useEffect(() => {
    void load(0, {
      search: '',
      action: '',
      target_table: '',
      actor_search: '',
      from: '',
      to: '',
    });
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (autoRefresh) {
      intervalRef.current = window.setInterval(() => {
        void load(page, currentFilters());
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [autoRefresh, currentFilters, load, page]);

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const handleSearch = () => {
    setPage(0);
    void load(0, currentFilters());
  };

  const handleClearFilters = () => {
    const emptyFilters = {
      search: '',
      action: '',
      target_table: '',
      actor_search: '',
      from: '',
      to: '',
    };
    setSearch('');
    setActionFilter('');
    setTableFilter('');
    setActorSearch('');
    setFromDate('');
    setToDate('');
    setPage(0);
    void load(0, emptyFilters);
  };

  const handleRefresh = () => {
    void load(page, currentFilters());
  };

  const fetchAllForExport = async () => {
    const payload = await adminFetch<AuditLogsResponse>(buildUrl(0, currentFilters(), 10000));
    return payload.logs || [];
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    setError(null);

    try {
      const exportRows = await fetchAllForExport();
      const rows = exportRows.map((log) => ({
        ID: log.id || '',
        Action: log.action || '',
        'Actor Email': log.actor_email || '',
        'Actor Name': log.actor_name || '',
        'Target Store': log.target_store_name || '',
        'Target Table': log.target_table || '',
        'Target Record': log.target_record_id || '',
        Reason: log.reason || '',
        'Created At': log.created_at || '',
      }));

      if (format === 'xlsx') {
        try {
          const xlsx = await import('xlsx');
          const workbook = xlsx.utils.book_new();
          const worksheet = xlsx.utils.json_to_sheet(rows);
          xlsx.utils.book_append_sheet(workbook, worksheet, 'Audit Logs');
          xlsx.writeFile(workbook, 'audit-logs.xlsx');
          return;
        } catch (exportError) {
          console.warn('XLSX export unavailable; falling back to CSV.', exportError);
        }
      }

      const headers = [
        'ID',
        'Action',
        'Actor Email',
        'Actor Name',
        'Target Store',
        'Target Table',
        'Target Record',
        'Reason',
        'Created At',
      ];
      const csv = [
        headers.map(csvValue).join(','),
        ...rows.map((row) => headers.map((header) => csvValue(row[header as keyof typeof row])).join(',')),
      ].join('\n');

      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'audit-logs.csv');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  const handleDelete = async (logId?: string | null) => {
    if (!logId) return;
    if (!window.confirm('Delete this audit log? This cannot be undone.')) return;

    try {
      await adminFetch(`/api/admin/audit-logs/${logId}`, { method: 'DELETE' });
      showSuccess('Audit log deleted.');
      await load(page, currentFilters());
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed.');
    }
  };

  const handleEditOpen = (log: AuditLogRow) => {
    setEditingLog(log);
    setEditAction(log.action || '');
    setEditReason(log.reason || '');
    setEditMetadataText(log.metadata ? JSON.stringify(log.metadata, null, 2) : '');
  };

  const handleEditSave = async () => {
    if (!editingLog?.id) return;
    if (!editAction.trim() || !editReason.trim()) {
      setError('Action and reason are required.');
      return;
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = editMetadataText.trim() ? JSON.parse(editMetadataText) : {};
    } catch {
      setError('Metadata must be valid JSON.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await adminFetch(`/api/admin/audit-logs/${editingLog.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: editAction.trim(),
          reason: editReason.trim(),
          metadata,
        }),
      });
      setEditingLog(null);
      showSuccess('Audit log updated.');
      await load(page, currentFilters());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddManualLog = async () => {
    if (!manualAction.trim() || !manualReason.trim()) {
      setError('Action and reason are required.');
      return;
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = manualMetadataText.trim() ? JSON.parse(manualMetadataText) : {};
    } catch {
      setError('Metadata must be valid JSON.');
      return;
    }

    setAdding(true);
    setError(null);

    try {
      await adminFetch('/api/admin/audit-logs', {
        method: 'POST',
        body: JSON.stringify({
          action: manualAction.trim(),
          reason: manualReason.trim(),
          target_table: manualTargetTable.trim() || null,
          target_record_id: manualTargetRecordId.trim() || null,
          metadata,
        }),
      });
      setAddModalOpen(false);
      setManualAction('platform.manual_note');
      setManualReason('');
      setManualTargetTable('');
      setManualTargetRecordId('');
      setManualMetadataText('');
      setPage(0);
      showSuccess('Manual audit log added.');
      await load(0, currentFilters());
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not add audit log.');
    } finally {
      setAdding(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const start = total === 0 ? 0 : page * LIMIT + 1;
  const end = Math.min(total, (page + 1) * LIMIT);
  const storeActions = logs.filter((log) =>
    (log.action || '').match(/^stores?\./)
  ).length;
  const userAdminActions = logs.filter((log) =>
    (log.action || '').match(/^(users?|team|platform)\./)
  ).length;

  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Audit Logs"
        description="All superadmin actions, changes, and permission updates."
      >
        <Button
          variant={autoRefresh ? 'default' : 'outline'}
          onClick={() => setAutoRefresh((current) => !current)}
        >
          Auto Refresh: {autoRefresh ? 'ON' : 'OFF'}
        </Button>
        <Button variant="outline" onClick={() => setAddModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Manual Log
        </Button>
        <Button variant="outline" onClick={() => void handleExport('csv')} disabled={Boolean(exporting)}>
          <Download className="mr-2 h-4 w-4" />
          CSV
        </Button>
        <Button variant="outline" onClick={() => void handleExport('xlsx')} disabled={Boolean(exporting)}>
          <Download className="mr-2 h-4 w-4" />
          XLSX
        </Button>
        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </SuperadminPageHeader>

      <p className="mb-4 text-xs text-muted-foreground">{lastRefreshedLabel(lastRefreshed)}</p>

      <div className="space-y-5">
        {error && (
          <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </Card>
        )}

        {success && (
          <Card className="border-emerald-500/30 bg-emerald-500/5 p-4 text-sm font-medium text-emerald-700">
            {success}
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          {[
            ['Total Logs', total],
            ['This Page', logs.length],
            ['Store Actions', storeActions],
            ['User/Admin Actions', userAdminActions],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{Number(value).toLocaleString()}</p>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_1fr_1fr_160px_160px_auto_auto]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action or reason..."
            />
            <Input
              value={actorSearch}
              onChange={(event) => setActorSearch(event.target.value)}
              placeholder="Search by actor email..."
            />
            <Input
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              placeholder="Filter by action..."
            />
            <Input
              value={tableFilter}
              onChange={(event) => setTableFilter(event.target.value)}
              placeholder="Filter by table..."
            />
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            <Button onClick={handleSearch}>Search</Button>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading audit logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Shield className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 font-semibold">No audit logs yet</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] text-left text-sm">
                  <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Actor</th>
                      <th className="px-3 py-2">Target Store</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const isExpanded = expandedId === log.id;
                      const target = log.target_table
                        ? `${log.target_table}${log.target_record_id ? ` / ${shortId(log.target_record_id)}` : ''}`
                        : '-';

                      return (
                        <>
                          <tr
                            key={log.id}
                            className="cursor-pointer border-b hover:bg-muted/40"
                            onClick={() => setExpandedId(isExpanded ? null : log.id || null)}
                          >
                            <td className="px-3 py-3">
                              <span className={`rounded-full px-2 py-1 text-xs font-medium ${getActionColor(log.action || '')}`}>
                                {log.action || 'unknown'}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <p>{log.actor_name || log.actor_email || shortId(log.actor_user_id) || 'System'}</p>
                              {log.actor_email && (
                                <p className="text-xs text-muted-foreground">{log.actor_email}</p>
                              )}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {log.target_store_name || '-'}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{target}</td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {log.reason ? truncate(log.reason) : '-'}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {formatDate(log.created_at)}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleEditOpen(log);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDelete(log.id);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost">
                                  {isExpanded ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${log.id}-details`} className="bg-slate-50">
                              <td colSpan={7} className="px-4 py-4">
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="space-y-2 text-sm">
                                    <p><strong>Full reason:</strong> {log.reason || '-'}</p>
                                    <p><strong>Actor user id:</strong> {log.actor_user_id || '-'}</p>
                                    <p><strong>Target user:</strong> {log.target_user_name || log.target_user_email || log.target_user_id || '-'}</p>
                                    <p><strong>Target store id:</strong> {log.target_store_id || '-'}</p>
                                    <p><strong>Target:</strong> {target}</p>
                                  </div>
                                  {[
                                    ['Metadata', log.metadata],
                                    ['Before', log.old_values],
                                    ['After', log.new_values],
                                  ].map(([label, value]) => (
                                    <div key={String(label)}>
                                      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                        {String(label)}
                                      </p>
                                      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                                        {jsonText(value) || '{}'}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {start}-{end} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 0}
                    onClick={() => void load(Math.max(0, page - 1), currentFilters())}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Previous
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => void load(page + 1, currentFilters())}
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

      {editingLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-xl p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Edit Audit Log</h2>
                <p className="text-sm text-muted-foreground">
                  You can only edit: action, reason, metadata. Actor, timestamps, and old/new values are locked.
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setEditingLog(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <Input value={editAction} onChange={(event) => setEditAction(event.target.value)} />
              <textarea
                className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={editReason}
                onChange={(event) => setEditReason(event.target.value)}
              />
              <textarea
                className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                value={editMetadataText}
                onChange={(event) => setEditMetadataText(event.target.value)}
                placeholder="Metadata JSON"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditingLog(null)}>Cancel</Button>
                <Button onClick={() => void handleEditSave()} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-xl p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Add Manual Log</h2>
                <p className="text-sm text-muted-foreground">
                  Create an append-only note for platform context.
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setAddModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <Input value={manualAction} onChange={(event) => setManualAction(event.target.value)} />
              <textarea
                className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                placeholder="Reason"
              />
              <Input
                value={manualTargetTable}
                onChange={(event) => setManualTargetTable(event.target.value)}
                placeholder="Target table (optional)"
              />
              <Input
                value={manualTargetRecordId}
                onChange={(event) => setManualTargetRecordId(event.target.value)}
                placeholder="Target record ID (optional)"
              />
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                value={manualMetadataText}
                onChange={(event) => setManualMetadataText(event.target.value)}
                placeholder="Metadata JSON (optional)"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddModalOpen(false)}>Cancel</Button>
                <Button onClick={() => void handleAddManualLog()} disabled={adding}>
                  {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Manual Log
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </SuperadminShell>
  );
}
