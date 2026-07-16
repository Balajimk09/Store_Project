'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, ChevronDown, ChevronUp, Loader2, RefreshCcw } from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { adminFetch } from '@/lib/admin-client';
import { deriveConnectorStatus, type ConnectorDisplayStatus, type ConnectorStatusSeverity } from '@/lib/connector-status';

type ConnectorStore = {
  id: string;
  store_name: string | null;
  store_code: string | null;
  city: string | null;
  state: string | null;
  pos_type: string | null;
};

type ConnectorRow = {
  id: string;
  store_id: string;
  connector_name: string | null;
  source_system: string | null;
  source_store_number: string | null;
  status: string | null;
  service_version: string | null;
  runtime_mode: string | null;
  reported_state: string | null;
  runtime_started_at: string | null;
  last_heartbeat_at: string | null;
  reported_heartbeat_at: string | null;
  last_seen_at: string | null;
  last_upload_at: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  last_error: string | null;
  commander_status: string | null;
  cloud_status: string | null;
  live_poll_interval_seconds: number | null;
  last_canonical_record_count: number | null;
  last_inserted_count: number | null;
  last_updated_count: number | null;
  last_unchanged_count: number | null;
  last_failed_count: number | null;
  heartbeat_payload_version: string | null;
  created_at: string | null;
  updated_at: string | null;
  store: ConnectorStore | null;
};

type ConnectorsResponse = { connectors?: ConnectorRow[] };

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const STATUS_ORDER: ConnectorDisplayStatus[] = [
  'error', 'offline', 'degraded', 'delayed', 'setup_required', 'starting', 'syncing', 'online', 'stopping', 'disabled',
];

function displayText(value: string | null | undefined, fallback = '—') {
  return value?.trim() || fallback;
}

function formatDate(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatHeartbeatAge(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatDurationSince(value: Date | null, now: number) {
  if (!value) return 'Not refreshed yet';
  const seconds = Math.max(0, Math.floor((now - value.getTime()) / 1000));
  return seconds < 5 ? 'Last refreshed just now' : `Last refreshed ${formatHeartbeatAge(seconds)} ago`;
}

function statusClass(severity: ConnectorStatusSeverity) {
  if (severity === 'success') return 'bg-emerald-100 text-emerald-800';
  if (severity === 'danger') return 'bg-destructive/10 text-destructive';
  if (severity === 'warning') return 'bg-amber-100 text-amber-800';
  if (severity === 'info') return 'bg-primary/10 text-primary';
  return 'bg-secondary text-muted-foreground';
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

function ConnectorDetails({ connector }: { connector: ConnectorRow }) {
  const details = [
    ['Runtime mode', connector.runtime_mode],
    ['Reported runtime state', connector.reported_state],
    ['Runtime started', formatDate(connector.runtime_started_at)],
    ['Last sync started', formatDate(connector.last_sync_started_at)],
    ['Last sync completed', formatDate(connector.last_sync_completed_at)],
    ['Last upload', formatDate(connector.last_upload_at)],
    ['Last failure', formatDate(connector.last_failure_at)],
    ['Last error code', connector.last_error_code],
    ['Heartbeat payload version', connector.heartbeat_payload_version],
    ['Created', formatDate(connector.created_at)],
    ['Updated', formatDate(connector.updated_at)],
  ];

  return (
    <div className="grid gap-4 bg-muted/30 p-4 text-sm lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 break-words text-foreground">{displayText(value)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest counts</p>
          <p className="mt-1 text-foreground">
            Canonical {connector.last_canonical_record_count ?? 0} · Inserted {connector.last_inserted_count ?? 0} · Updated {connector.last_updated_count ?? 0} · Unchanged {connector.last_unchanged_count ?? 0} · Failed {connector.last_failed_count ?? 0}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last error</p>
          <p className="mt-1 break-words text-foreground">{displayText(connector.last_error)}</p>
        </div>
      </div>
    </div>
  );
}

export function ConnectorMonitoringPage({ portal }: { portal: 'admin' | 'superadmin' }) {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [commanderFilter, setCommanderFilter] = useState('');
  const [cloudFilter, setCloudFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    const initialLoad = !hasLoadedRef.current;
    if (initialLoad) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const response = await adminFetch<ConnectorsResponse>('/api/admin/connectors');
      setConnectors(Array.isArray(response.connectors) ? response.connectors : []);
      setLastRefreshed(new Date());
      hasLoadedRef.current = true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to refresh connector monitoring data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const updateClock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(updateClock);
  }, []);

  useEffect(() => {
    const clearTimer = () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
    const startTimer = () => {
      clearTimer();
      if (document.visibilityState === 'visible') {
        refreshTimerRef.current = window.setInterval(() => void load(), AUTO_REFRESH_INTERVAL_MS);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
      startTimer();
    };

    startTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load]);

  const enrichedConnectors = useMemo(
    () => connectors.map((connector) => ({ connector, status: deriveConnectorStatus(connector, now) })),
    [connectors, now]
  );

  const filteredConnectors = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return enrichedConnectors
      .filter(({ connector, status }) => {
        if (statusFilter && status.key !== statusFilter) return false;
        if (commanderFilter && normalized(connector.commander_status) !== normalized(commanderFilter)) return false;
        if (cloudFilter && normalized(connector.cloud_status) !== normalized(cloudFilter)) return false;
        if (sourceFilter && normalized(connector.source_system) !== normalized(sourceFilter)) return false;
        if (storeFilter && connector.store_id !== storeFilter) return false;
        if (!searchTerm) return true;
        return [connector.connector_name, connector.store?.store_name, connector.store?.store_code, connector.source_store_number]
          .some((value) => normalized(value).includes(searchTerm));
      })
      .sort((left, right) => {
        const statusDifference = STATUS_ORDER.indexOf(left.status.key) - STATUS_ORDER.indexOf(right.status.key);
        if (statusDifference !== 0) return statusDifference;
        const storeDifference = displayText(left.connector.store?.store_name, '').localeCompare(displayText(right.connector.store?.store_name, ''));
        if (storeDifference !== 0) return storeDifference;
        return displayText(left.connector.connector_name, '').localeCompare(displayText(right.connector.connector_name, ''));
      });
  }, [cloudFilter, commanderFilter, enrichedConnectors, search, sourceFilter, statusFilter, storeFilter]);

  const summary = useMemo(() => {
    const count = (key: ConnectorDisplayStatus) => enrichedConnectors.filter((item) => item.status.key === key).length;
    return {
      total: enrichedConnectors.length,
      online: count('online'),
      syncing: count('syncing'),
      delayed: count('delayed'),
      offline: count('offline'),
      attention: ['degraded', 'error', 'offline', 'setup_required'].reduce((total, key) => total + count(key as ConnectorDisplayStatus), 0),
    };
  }, [enrichedConnectors]);

  const filterValues = useMemo(() => ({
    commanders: Array.from(new Set(connectors.map((item) => item.commander_status).filter((item): item is string => Boolean(item?.trim())))).sort(),
    clouds: Array.from(new Set(connectors.map((item) => item.cloud_status).filter((item): item is string => Boolean(item?.trim())))).sort(),
    sources: Array.from(new Set(connectors.map((item) => item.source_system).filter((item): item is string => Boolean(item?.trim())))).sort(),
    stores: Array.from(new Map(connectors.filter((item) => item.store).map((item) => [item.store_id, item.store as ConnectorStore])).values()).sort((a, b) => displayText(a.store_name, '').localeCompare(displayText(b.store_name, ''))),
  }), [connectors]);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCommanderFilter('');
    setCloudFilter('');
    setSourceFilter('');
    setStoreFilter('');
  };

  const headerActions = (
    <Button type="button" variant="outline" onClick={() => void load()} disabled={loading || refreshing} aria-label="Refresh connector monitoring data">
      {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
      Refresh
    </Button>
  );
  const Header = portal === 'admin' ? AdminPageHeader : SuperadminPageHeader;
  const Shell = portal === 'admin' ? AdminShell : SuperadminShell;

  return (
    <Shell>
      <Header
        title="POS Connector Monitoring"
        description="Monitor store connector availability, Commander connectivity, cloud communication, transaction synchronization, and recent failures."
      >
        {headerActions}
      </Header>

      <p className="-mt-3 mb-5 text-xs text-muted-foreground" aria-live="polite">{formatDurationSince(lastRefreshed, now)}</p>

      {error ? (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ['Total connectors', summary.total], ['Online', summary.online], ['Syncing', summary.syncing],
          ['Delayed', summary.delayed], ['Offline', summary.offline], ['Needs attention', summary.attention],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium text-muted-foreground">Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Connector, store, code, or source number" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="">All statuses</option>{STATUS_ORDER.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">Commander status
            <select value={commanderFilter} onChange={(event) => setCommanderFilter(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="">All Commander statuses</option>{filterValues.commanders.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">Cloud status
            <select value={cloudFilter} onChange={(event) => setCloudFilter(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="">All cloud statuses</option>{filterValues.clouds.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">Source system
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="">All source systems</option>{filterValues.sources.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">Store
            <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="">All stores</option>{filterValues.stores.map((store) => <option key={store.id} value={store.id}>{displayText(store.store_name)}{store.store_code ? ` (${store.store_code})` : ''}</option>)}
            </select>
          </label>
          <div className="flex items-end"><Button type="button" variant="ghost" onClick={clearFilters} className="w-full">Clear filters</Button></div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading connector monitoring data...</div>
        ) : filteredConnectors.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground"><Activity className="h-8 w-8" />No connectors match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1350px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr>
                {['Status', 'Store', 'Connector', 'Source', 'Version', 'Commander / Cloud', 'Heartbeat', 'Last successful sync', 'Poll', 'Latest counts', 'Last error', ''].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}
              </tr></thead>
              <tbody className="divide-y">
                {filteredConnectors.map(({ connector, status }) => {
                  const expanded = expandedId === connector.id;
                  return (
                    <Fragment key={connector.id}>
                      <tr className="align-top hover:bg-muted/30">
                        <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(status.severity)}`} title={status.explanation}>{status.label}</span></td>
                        <td className="px-3 py-3"><p className="font-medium text-foreground">{displayText(connector.store?.store_name)}</p><p className="text-xs text-muted-foreground">{displayText(connector.store?.store_code)}{connector.store?.city || connector.store?.state ? ` · ${[connector.store.city, connector.store.state].filter(Boolean).join(', ')}` : ''}</p></td>
                        <td className="px-3 py-3 font-medium text-foreground">{displayText(connector.connector_name)}</td>
                        <td className="px-3 py-3"><p>{displayText(connector.source_system)}</p><p className="text-xs text-muted-foreground">{displayText(connector.source_store_number)}</p></td>
                        <td className="px-3 py-3">{displayText(connector.service_version)}</td>
                        <td className="px-3 py-3"><p>{displayText(connector.commander_status)}</p><p className="text-xs text-muted-foreground">{displayText(connector.cloud_status)}</p></td>
                        <td className="px-3 py-3"><p>{formatDate(connector.last_heartbeat_at || connector.last_seen_at)}</p><p className="text-xs text-muted-foreground">{formatHeartbeatAge(status.heartbeatAgeSeconds)}{status.usingLegacyHeartbeat ? ' (legacy)' : ''}</p></td>
                        <td className="px-3 py-3">{formatDate(connector.last_success_at)}</td>
                        <td className="px-3 py-3">{status.pollingIntervalSeconds}s</td>
                        <td className="px-3 py-3 text-xs">C {connector.last_canonical_record_count ?? 0} · I {connector.last_inserted_count ?? 0} · U {connector.last_updated_count ?? 0} · Un {connector.last_unchanged_count ?? 0} · F {connector.last_failed_count ?? 0}</td>
                        <td className="max-w-56 px-3 py-3 text-xs text-muted-foreground">{displayText(connector.last_error)}</td>
                        <td className="px-3 py-3"><Button type="button" variant="ghost" size="icon" onClick={() => setExpandedId(expanded ? null : connector.id)} aria-label={`${expanded ? 'Hide' : 'Show'} details for ${displayText(connector.connector_name)}`} aria-expanded={expanded}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></td>
                      </tr>
                      {expanded ? <tr><td colSpan={12}><ConnectorDetails connector={connector} /></td></tr> : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
