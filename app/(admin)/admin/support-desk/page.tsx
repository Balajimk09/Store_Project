'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Eye,
  Loader2,
  Lock,
  Phone,
  RefreshCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Store,
  Ticket,
  UserCog,
  X,
} from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type SupportTab =
  | 'tickets'
  | 'lookup'
  | 'approvals'
  | 'calls'
  | 'billing'
  | 'knowledge'
  | 'analytics'
  | 'agents';

type PermissionResponse = {
  permissions: string[];
  role_code: string | null;
  is_superadmin: boolean;
  support_access?: boolean;
};

type TicketRow = {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  store_id: string | null;
  store_name: string;
  owner_email: string | null;
  assigned_to: string | null;
  tags: string[];
  is_vip: boolean;
  sla_breached: boolean;
  created_at: string;
  updated_at: string;
};

type TicketDetail = {
  ticket: TicketRow;
  replies: Array<{ id: string; body: string; author_role: string; is_internal: boolean; created_at: string }>;
  activities: Array<{ id: string; activity_type: string; body: string | null; is_public: boolean; created_at: string }>;
  latest_verification: { is_verified: boolean; expires_at: string | null } | null;
  verification_valid: boolean;
  follow_ups: Array<Record<string, unknown>>;
  call_logs: Array<Record<string, unknown>>;
  billing_adjustments: Array<Record<string, unknown>>;
  approval_queue: Array<Record<string, unknown>>;
  store_flags: Array<{ id: string; flag_type: string; note: string | null }>;
};

type StoreCard = {
  id: string;
  store_name: string | null;
  primary_owner_email?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  status?: string;
};

type ApprovalItem = {
  id: string;
  action_type: string;
  reason: string;
  status: string;
  store_id: string | null;
  ticket_id: string | null;
  created_at: string;
};

type CallLog = {
  id: string;
  call_direction: string;
  caller_name: string | null;
  duration_minutes: number | null;
  summary: string;
  ticket_id: string | null;
  store_id: string | null;
  created_at: string;
};

type BillingAdjustment = {
  id: string;
  ticket_id: string | null;
  store_id: string | null;
  issue_type: string;
  original_amount: number | null;
  correct_amount: number | null;
  difference_amount: number | null;
  reason: string;
  status: string;
  created_at: string;
};

type KnowledgeArticle = {
  id: string;
  article_key: string;
  title: string;
  category: string;
  visibility: string;
  tags: string[];
  views: number;
  is_published: boolean;
  content: string;
};

type AnalyticsResponse = {
  cards: {
    open_tickets: number;
    sla_breached: number;
    average_resolution_hours: number | null;
    satisfaction_score: number | null;
  };
  tickets_by_status: Array<{ key: string; count: number }>;
  tickets_by_category: Array<{ key: string; count: number }>;
  tickets_by_priority: Array<{ key: string; count: number }>;
  tickets_per_assigned_agent: Array<{ key: string; count: number }>;
  pending_billing_adjustment_count: number;
  follow_ups_due_today_count: number;
  this_week_ticket_count: number;
  last_week_ticket_count: number;
};

type AgentRow = {
  id: string;
  user_id: string;
  email: string | null;
  name: string | null;
  role_code: string | null;
  permissions: string[];
  is_active: boolean;
};

const SUPPORT_TABS: Array<{ key: SupportTab; label: string; permission?: string; superadminOnly?: boolean }> = [
  { key: 'tickets', label: 'Tickets', permission: 'tickets.view' },
  { key: 'lookup', label: 'Store Lookup', permission: 'stores.search' },
  { key: 'approvals', label: 'Approval Queue', permission: 'approval.approve_action' },
  { key: 'calls', label: 'Call Logs', permission: 'tickets.log_call' },
  { key: 'billing', label: 'Billing Adjustments', permission: 'billing.view' },
  { key: 'knowledge', label: 'Knowledge Base', permission: 'knowledge_base.view' },
  { key: 'analytics', label: 'Analytics', permission: 'analytics.view' },
  { key: 'agents', label: 'Agents & Permissions', superadminOnly: true },
];

async function adminFetch<T>(url: string, options?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please log in again.');
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(json.error || `Request failed with status ${response.status}.`);
  return json as T;
}

function pretty(value: string | null | undefined) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function hasPermission(permissionState: PermissionResponse | null, permission?: string) {
  if (!permission) return true;
  if (!permissionState) return false;
  if (permission === 'tickets.view' && permissionState.support_access) return true;
  return permissionState.is_superadmin || permissionState.permissions.includes('ALL') || permissionState.permissions.includes(permission);
}

export default function SupportDeskPage() {
  const [permissions, setPermissions] = useState<PermissionResponse | null>(null);
  const [activeTab, setActiveTab] = useState<SupportTab>('tickets');
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stores, setStores] = useState<StoreCard[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [billing, setBilling] = useState<BillingAdjustment[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [verificationChecks, setVerificationChecks] = useState<boolean[]>([false, false, false, false, false, false]);
  const [verificationReason, setVerificationReason] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [newTicketForm, setNewTicketForm] = useState({
    title: '',
    description: '',
    owner_id: '',
    store_id: '',
    category: 'general',
    priority: 'normal',
  });
  const [agentForm, setAgentForm] = useState({
    email: '',
    role_code: 'agent',
    permissions: '',
    is_active: true,
  });

  const availableTabs = useMemo(
    () =>
      SUPPORT_TABS.filter((tab) =>
        tab.superadminOnly ? permissions?.is_superadmin : hasPermission(permissions, tab.permission)
      ),
    [permissions]
  );

  const showSuccess = useCallback((message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  const loadPermissions = useCallback(async () => {
    const response = await adminFetch<PermissionResponse>('/api/admin/support/me/permissions');
    setPermissions(response);
    return response;
  }, []);

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    const response = await adminFetch<{ tickets: TicketRow[] }>(`/api/admin/support/tickets?${params.toString()}`);
    setTickets(response.tickets || []);
  }, [search]);

  const loadTabData = useCallback(
    async (tab: SupportTab) => {
      setTabLoading(true);
      setError(null);
      try {
        if (tab === 'tickets') await loadTickets();
        if (tab === 'lookup') {
          const response = await adminFetch<{ stores: StoreCard[] }>(
            `/api/admin/support/stores/search?q=${encodeURIComponent(storeSearch)}`
          );
          setStores(response.stores || []);
        }
        if (tab === 'approvals') {
          const response = await adminFetch<{ items: ApprovalItem[] }>('/api/admin/support/approval-queue');
          setApprovals(response.items || []);
        }
        if (tab === 'calls') {
          const response = await adminFetch<{ call_logs: CallLog[] }>('/api/admin/support/call-logs');
          setCallLogs(response.call_logs || []);
        }
        if (tab === 'billing') {
          const response = await adminFetch<{ adjustments: BillingAdjustment[] }>('/api/admin/support/billing-adjustments');
          setBilling(response.adjustments || []);
        }
        if (tab === 'knowledge') {
          const response = await adminFetch<{ articles: KnowledgeArticle[] }>('/api/admin/support/knowledge-base');
          setArticles(response.articles || []);
        }
        if (tab === 'analytics') {
          const response = await adminFetch<AnalyticsResponse>('/api/admin/support/analytics');
          setAnalytics(response);
        }
        if (tab === 'agents') {
          const response = await adminFetch<{ agents: AgentRow[] }>('/api/admin/support/agents');
          setAgents(response.agents || []);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load support data.');
      } finally {
        setTabLoading(false);
      }
    },
    [loadTickets, storeSearch]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const currentPermissions = await loadPermissions();
        if (currentPermissions.permissions.length > 0 || currentPermissions.is_superadmin || currentPermissions.support_access) {
          await loadTickets();
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load support permissions.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPermissions, loadTickets]);

  useEffect(() => {
    if (!permissions) return;
    if (!availableTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(availableTabs[0]?.key || 'tickets');
    }
  }, [activeTab, availableTabs, permissions]);

  const openTicket = async (ticket: TicketRow) => {
    setDrawerOpen(true);
    setError(null);
    setSelectedTicket(null);
    try {
      const detail = await adminFetch<TicketDetail>(`/api/admin/support/tickets/${ticket.id}`);
      setSelectedTicket(detail);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load ticket.');
    }
  };

  const sendReply = async () => {
    if (!selectedTicket) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/support/tickets/${selectedTicket.ticket.id}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body: replyBody, is_internal: internalNote }),
      });
      setReplyBody('');
      showSuccess(internalNote ? 'Internal note saved.' : 'Reply sent.');
      await openTicket(selectedTicket.ticket);
      await loadTickets();
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Could not send reply.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateTicketStatus = async (status: string) => {
    if (!selectedTicket) return;
    setSubmitting(true);
    try {
      await adminFetch(`/api/admin/support/tickets/${selectedTicket.ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showSuccess('Ticket updated.');
      await openTicket(selectedTicket.ticket);
      await loadTickets();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not update ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitVerification = async () => {
    if (!selectedTicket) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/support/tickets/${selectedTicket.ticket.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ checklist: verificationChecks, reason: verificationReason }),
      });
      showSuccess('Verification saved.');
      setVerificationChecks([false, false, false, false, false, false]);
      setVerificationReason('');
      await openTicket(selectedTicket.ticket);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const createApproval = async (actionType: string) => {
    if (!selectedTicket) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminFetch('/api/admin/support/approval-queue', {
        method: 'POST',
        body: JSON.stringify({
          ticket_id: selectedTicket.ticket.id,
          store_id: selectedTicket.ticket.store_id,
          action_type: actionType,
          action_payload: {},
          reason: actionReason || `Requested ${pretty(actionType)}`,
        }),
      });
      showSuccess('Approval request created.');
      setActionReason('');
      await loadTabData('approvals');
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Could not request approval.');
    } finally {
      setSubmitting(false);
    }
  };

  const approveItem = async (item: ApprovalItem, status: 'approved' | 'rejected') => {
    setSubmitting(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/support/approval-queue/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reviewer_note: status === 'approved' ? 'Approved from console.' : 'Rejected from console.' }),
      });
      showSuccess(status === 'approved' ? 'Approval completed.' : 'Approval rejected.');
      await loadTabData('approvals');
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Could not update approval.');
    } finally {
      setSubmitting(false);
    }
  };

  const createTicket = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await adminFetch('/api/admin/support/tickets', {
        method: 'POST',
        body: JSON.stringify(newTicketForm),
      });
      showSuccess('Ticket created.');
      setNewTicketForm({ title: '', description: '', owner_id: '', store_id: '', category: 'general', priority: 'normal' });
      await loadTickets();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveAgent = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await adminFetch('/api/admin/support/agents', {
        method: 'POST',
        body: JSON.stringify({
          ...agentForm,
          permissions: agentForm.permissions.split(',').map((permission) => permission.trim()).filter(Boolean),
        }),
      });
      showSuccess('Agent permissions saved.');
      setAgentForm({ email: '', role_code: 'agent', permissions: '', is_active: true });
      await loadTabData('agents');
    } catch (agentError) {
      setError(agentError instanceof Error ? agentError.message : 'Could not save agent.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader title="Support Desk" description="Support operations console.">
        <Button variant="outline" onClick={() => void loadTabData(activeTab)} disabled={tabLoading || loading}>
          <RefreshCcw className={cn('mr-2 h-4 w-4', (tabLoading || loading) && 'animate-spin')} />
          Refresh
        </Button>
      </AdminPageHeader>

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Support Console - You are accessing customer data. Only access data for verified support reasons. All actions are logged and audited.</p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4" />
          {success}
        </div>
      )}

      {loading ? (
        <Card className="flex items-center justify-center p-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading support permissions...
        </Card>
      ) : permissions && permissions.permissions.length === 0 && !permissions.is_superadmin && !permissions.support_access ? (
        <Card className="p-8 text-center">
          <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Access Limited</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You do not have support permissions yet. Ask a superadmin to grant access.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2 border-b border-border">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  void loadTabData(tab.key);
                }}
                className={cn(
                  'border-b-2 px-4 py-2 text-sm font-medium',
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {tabLoading && (
            <Card className="mb-4 flex items-center justify-center p-4 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading {pretty(activeTab)}...
            </Card>
          )}

          {activeTab === 'tickets' && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_140px_140px_140px_auto]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tickets..." className="pl-9" />
                  </div>
                  <select className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option>Status</option>
                  </select>
                  <select className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option>Priority</option>
                  </select>
                  <select className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option>Category</option>
                  </select>
                  <Button onClick={() => void loadTickets()}>
                    <Search className="mr-2 h-4 w-4" />
                    Search
                  </Button>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="border-b border-border p-4">
                  <h2 className="font-semibold text-foreground">Tickets</h2>
                  <p className="text-sm text-muted-foreground">Filter, triage, and open ticket detail drawers.</p>
                </div>
                {tickets.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <Ticket className="mx-auto mb-3 h-8 w-8" />
                    No tickets found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3"><input type="checkbox" aria-label="Select all tickets" /></th>
                          <th className="px-4 py-3">Ticket</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3">Priority</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Store</th>
                          <th className="px-4 py-3">Assigned</th>
                          <th className="px-4 py-3">Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {tickets.map((ticket) => (
                          <tr key={ticket.id} className="cursor-pointer hover:bg-secondary/40" onClick={() => void openTicket(ticket)}>
                            <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${ticket.ticket_number}`} onClick={(event) => event.stopPropagation()} /></td>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-foreground">{ticket.ticket_number}</div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {ticket.is_vip && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">VIP</span>}
                                {ticket.sla_breached && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">SLA</span>}
                                {ticket.title}
                              </div>
                            </td>
                            <td className="px-4 py-3">{pretty(ticket.category)}</td>
                            <td className="px-4 py-3">{pretty(ticket.priority)}</td>
                            <td className="px-4 py-3">{pretty(ticket.status)}</td>
                            <td className="px-4 py-3">{ticket.store_name}</td>
                            <td className="px-4 py-3">{ticket.assigned_to || '-'}</td>
                            <td className="px-4 py-3">{formatDate(ticket.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h3 className="font-semibold text-foreground">Create Ticket for Store</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Input placeholder="Owner user ID" value={newTicketForm.owner_id} onChange={(event) => setNewTicketForm((current) => ({ ...current, owner_id: event.target.value }))} />
                  <Input placeholder="Store ID" value={newTicketForm.store_id} onChange={(event) => setNewTicketForm((current) => ({ ...current, store_id: event.target.value }))} />
                  <Input placeholder="Title" value={newTicketForm.title} onChange={(event) => setNewTicketForm((current) => ({ ...current, title: event.target.value }))} />
                  <Input placeholder="Category" value={newTicketForm.category} onChange={(event) => setNewTicketForm((current) => ({ ...current, category: event.target.value }))} />
                  <textarea className="rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2" rows={3} placeholder="Description" value={newTicketForm.description} onChange={(event) => setNewTicketForm((current) => ({ ...current, description: event.target.value }))} />
                </div>
                <Button className="mt-3" onClick={() => void createTicket()} disabled={submitting}>New Ticket</Button>
              </Card>
            </div>
          )}

          {activeTab === 'lookup' && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex gap-2">
                  <Input value={storeSearch} onChange={(event) => setStoreSearch(event.target.value)} placeholder="Search store name, address, ZIP, owner email, or ID..." />
                  <Button onClick={() => void loadTabData('lookup')}><Search className="mr-2 h-4 w-4" />Search</Button>
                </div>
              </Card>
              {stores.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground"><Store className="mx-auto mb-3 h-8 w-8" />No stores found.</Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {stores.map((store) => (
                    <Card key={store.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{store.store_name || store.id}</p>
                          <p className="text-sm text-muted-foreground">{[store.city, store.state, store.zip_code].filter(Boolean).join(', ') || 'Address unavailable'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{store.primary_owner_email || 'No owner email'}</p>
                        </div>
                        <span className="rounded bg-secondary px-2 py-1 text-xs">{store.status || 'active'}</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => window.open(`/api/admin/support/stores/${store.id}/360`, '_blank')}>
                          <Eye className="mr-2 h-4 w-4" />Store 360
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setNewTicketForm((current) => ({ ...current, store_id: store.id }))}>
                          <Ticket className="mr-2 h-4 w-4" />Create Ticket
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'approvals' && (
            <SupportTable
              title="Approval Queue"
              icon={<ClipboardCheck className="h-5 w-5 text-primary" />}
              empty="No approval requests."
              rows={approvals}
              columns={['Action', 'Store', 'Reason', 'Status', 'Requested', 'Actions']}
              renderRow={(item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-4 py-3">{pretty(item.action_type)}</td>
                  <td className="px-4 py-3">{item.store_id || '-'}</td>
                  <td className="px-4 py-3">{item.reason}</td>
                  <td className="px-4 py-3">{pretty(item.status)}</td>
                  <td className="px-4 py-3">{formatDate(item.created_at)}</td>
                  <td className="px-4 py-3">
                    {item.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void approveItem(item, 'approved')} disabled={submitting}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => void approveItem(item, 'rejected')} disabled={submitting}>Reject</Button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            />
          )}

          {activeTab === 'calls' && (
            <SupportTable
              title="Call Logs"
              icon={<Phone className="h-5 w-5 text-primary" />}
              empty="No call logs."
              rows={callLogs}
              columns={['Date', 'Direction', 'Caller', 'Duration', 'Summary', 'Ticket']}
              renderRow={(call) => (
                <tr key={call.id} className="border-t border-border">
                  <td className="px-4 py-3">{formatDate(call.created_at)}</td>
                  <td className="px-4 py-3">{pretty(call.call_direction)}</td>
                  <td className="px-4 py-3">{call.caller_name || '-'}</td>
                  <td className="px-4 py-3">{call.duration_minutes || 0} min</td>
                  <td className="px-4 py-3">{call.summary}</td>
                  <td className="px-4 py-3">{call.ticket_id || '-'}</td>
                </tr>
              )}
            />
          )}

          {activeTab === 'billing' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Real payment processing is not enabled. These records track billing issues for manual resolution and audit purposes only.
              </div>
              <SupportTable
                title="Billing Adjustments"
                icon={<CreditCard className="h-5 w-5 text-primary" />}
                empty="No billing adjustments."
                rows={billing}
                columns={['Ticket', 'Store', 'Issue', 'Original', 'Correct', 'Difference', 'Status']}
                renderRow={(item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-4 py-3">{item.ticket_id || '-'}</td>
                    <td className="px-4 py-3">{item.store_id || '-'}</td>
                    <td className="px-4 py-3">{pretty(item.issue_type)}</td>
                    <td className="px-4 py-3">{formatMoney(item.original_amount)}</td>
                    <td className="px-4 py-3">{formatMoney(item.correct_amount)}</td>
                    <td className="px-4 py-3">{formatMoney(item.difference_amount)}</td>
                    <td className="px-4 py-3">{pretty(item.status)}</td>
                  </tr>
                )}
              />
            </div>
          )}

          {activeTab === 'knowledge' && (
            <SupportTable
              title="Knowledge Base"
              icon={<BookOpen className="h-5 w-5 text-primary" />}
              empty="No articles."
              rows={articles}
              columns={['Title', 'Category', 'Visibility', 'Tags', 'Views', 'Published']}
              renderRow={(article) => (
                <tr key={article.id} className="border-t border-border">
                  <td className="px-4 py-3">{article.title}</td>
                  <td className="px-4 py-3">{article.category}</td>
                  <td className="px-4 py-3">{pretty(article.visibility)}</td>
                  <td className="px-4 py-3">{article.tags?.join(', ') || '-'}</td>
                  <td className="px-4 py-3">{article.views || 0}</td>
                  <td className="px-4 py-3">{article.is_published ? 'Yes' : 'No'}</td>
                </tr>
              )}
            />
          )}

          {activeTab === 'analytics' && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                {[
                  ['Open Tickets', analytics?.cards.open_tickets],
                  ['SLA Breached', analytics?.cards.sla_breached],
                  ['Avg Resolution Hours', analytics?.cards.average_resolution_hours?.toFixed(1) || '-'],
                  ['Satisfaction Score', analytics?.cards.satisfaction_score?.toFixed(1) || '-'],
                ].map(([label, value]) => (
                  <Card key={label} className="p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-foreground">{value ?? 0}</p>
                  </Card>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <MiniBreakdown title="Tickets by Status" rows={analytics?.tickets_by_status || []} />
                <MiniBreakdown title="Tickets by Category" rows={analytics?.tickets_by_category || []} />
                <MiniBreakdown title="Tickets by Priority" rows={analytics?.tickets_by_priority || []} />
              </div>
            </div>
          )}

          {activeTab === 'agents' && (
            <div className="space-y-4">
              {!permissions?.is_superadmin ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">Access denied.</Card>
              ) : (
                <>
                  <Card className="p-4">
                    <h2 className="font-semibold text-foreground">Add Agent</h2>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px_1fr_auto]">
                      <Input placeholder="User email" value={agentForm.email} onChange={(event) => setAgentForm((current) => ({ ...current, email: event.target.value }))} />
                      <select value={agentForm.role_code} onChange={(event) => setAgentForm((current) => ({ ...current, role_code: event.target.value }))} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                        {['viewer', 'agent', 'product_support', 'vendor_support', 'billing_support', 'manager', 'superadmin'].map((role) => (
                          <option key={role} value={role}>{pretty(role)}</option>
                        ))}
                      </select>
                      <Input placeholder="Optional comma-separated permission overrides" value={agentForm.permissions} onChange={(event) => setAgentForm((current) => ({ ...current, permissions: event.target.value }))} />
                      <Button onClick={() => void saveAgent()} disabled={submitting}>Save</Button>
                    </div>
                  </Card>
                  <SupportTable
                    title="Agents & Permissions"
                    icon={<UserCog className="h-5 w-5 text-primary" />}
                    empty="No support agents."
                    rows={agents}
                    columns={['Agent', 'Role', 'Permissions', 'Active']}
                    renderRow={(agent) => (
                      <tr key={agent.id} className="border-t border-border">
                        <td className="px-4 py-3">{agent.email || agent.user_id}</td>
                        <td className="px-4 py-3">{pretty(agent.role_code)}</td>
                        <td className="px-4 py-3">{agent.permissions?.length || 0}</td>
                        <td className="px-4 py-3">{agent.is_active ? 'Active' : 'Inactive'}</td>
                      </tr>
                    )}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-background shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-background p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {selectedTicket?.ticket.ticket_number || 'Loading ticket...'}
                </h2>
                <p className="text-sm text-muted-foreground">{selectedTicket?.ticket.title || 'Ticket detail'}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            {!selectedTicket ? (
              <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading ticket detail...
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedTicket.ticket.is_vip && <Badge tone="amber">VIP</Badge>}
                    {selectedTicket.ticket.sla_breached && <Badge tone="red">SLA Breached</Badge>}
                    <Badge>{pretty(selectedTicket.ticket.status)}</Badge>
                    <Badge>{pretty(selectedTicket.ticket.priority)}</Badge>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{selectedTicket.ticket.description}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={selectedTicket.ticket.status} onChange={(event) => void updateTicketStatus(event.target.value)}>
                      {['open', 'pending', 'resolved', 'closed', 'reopened'].map((status) => <option key={status} value={status}>{pretty(status)}</option>)}
                    </select>
                    <Button variant="outline" onClick={() => window.open(`/api/admin/support/tickets/${selectedTicket.ticket.id}/export`, '_blank')}>
                      Export
                    </Button>
                    <Button variant="outline" disabled>Merge</Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{selectedTicket.ticket.store_name}</p>
                      <p className="text-sm text-muted-foreground">{selectedTicket.ticket.owner_email || 'Owner email unavailable'}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedTicket.store_flags.map((flag) => <Badge key={flag.id} tone="amber">{pretty(flag.flag_type)}</Badge>)}
                      </div>
                    </div>
                    <Button variant="outline" size="sm">
                      <Store className="mr-2 h-4 w-4" />
                      Open Store 360
                    </Button>
                  </div>
                </div>

                <div className={cn('rounded-lg border p-4', selectedTicket.verification_valid ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4" />
                    {selectedTicket.verification_valid ? 'Identity verified for sensitive actions.' : 'Identity not verified. Sensitive support actions are disabled.'}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {['Store name', 'Store address', 'Phone number', 'ZIP code', 'Owner email', 'Recent invoice/upload/order'].map((label, index) => (
                      <label key={label} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={verificationChecks[index]}
                          onChange={(event) =>
                            setVerificationChecks((current) => current.map((checked, checkIndex) => (checkIndex === index ? event.target.checked : checked)))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Input className="mt-3" value={verificationReason} onChange={(event) => setVerificationReason(event.target.value)} placeholder="Verification reason" />
                  <Button className="mt-3" size="sm" onClick={() => void submitVerification()} disabled={submitting}>Start Verification</Button>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-foreground">Conversation Timeline</h3>
                    {selectedTicket.activities.map((activity) => (
                      <div key={activity.id} className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                        {activity.is_public ? 'Public' : 'Internal'} · {pretty(activity.activity_type)} · {formatDate(activity.created_at)}
                      </div>
                    ))}
                    {selectedTicket.replies.map((reply) => (
                      <div key={reply.id} className={cn('rounded-lg border p-3', reply.is_internal ? 'border-amber-200 bg-amber-50' : 'border-border')}>
                        <p className="text-xs font-medium text-muted-foreground">{pretty(reply.author_role)} · {formatDate(reply.created_at)}</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm">{reply.body}</p>
                      </div>
                    ))}
                    <div className="rounded-lg border border-border p-3">
                      <label className="mb-2 flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={internalNote} onChange={(event) => setInternalNote(event.target.checked)} />
                        Internal note
                      </label>
                      <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)} rows={4} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Write a reply or internal note..." />
                      <Button className="mt-2" onClick={() => void sendReply()} disabled={submitting}>
                        <Send className="mr-2 h-4 w-4" />
                        Send
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Panel title="Follow-ups" rows={selectedTicket.follow_ups.length} />
                    <Panel title="Call logs" rows={selectedTicket.call_logs.length} />
                    <Panel title="Billing issues" rows={selectedTicket.billing_adjustments.length} />
                    <Panel title="Approval items" rows={selectedTicket.approval_queue.length} />
                    <Card className="p-3">
                      <h3 className="font-semibold text-foreground">Support Actions</h3>
                      <Input className="mt-2" placeholder="Reason for sensitive action" value={actionReason} onChange={(event) => setActionReason(event.target.value)} />
                      <div className="mt-3 grid gap-2">
                        <Button variant="outline" size="sm" disabled={!selectedTicket.verification_valid} onClick={() => void createApproval('send_password_reset')}>Request Password Reset</Button>
                        <Button variant="outline" size="sm" disabled={!selectedTicket.verification_valid} onClick={() => void createApproval('set_temp_password')}>Request Temp Password</Button>
                        <Button variant="outline" size="sm" disabled={!selectedTicket.verification_valid} onClick={() => void createApproval('deactivate_store')}>Request Deactivate Store</Button>
                        <Button variant="outline" size="sm" disabled={!selectedTicket.verification_valid}>View as Store Owner</Button>
                      </div>
                    </Card>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </AdminShell>
  );
}

function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'amber' | 'red' }) {
  const className =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-800'
      : tone === 'red'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-secondary text-muted-foreground';
  return <span className={cn('rounded-full px-2 py-1 text-xs font-medium', className)}>{children}</span>;
}

function Panel({ title, rows }: { title: string; rows: number }) {
  return (
    <Card className="p-3">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{rows === 0 ? 'No records.' : `${rows} records`}</p>
    </Card>
  );
}

function MiniBreakdown({ title, rows }: { title: string; rows: Array<{ key: string; count: number }> }) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No data.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{pretty(row.key)}</span>
              <span className="font-semibold text-foreground">{row.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SupportTable<T>({
  title,
  icon,
  empty,
  rows,
  columns,
  renderRow,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  rows: T[];
  columns: string[];
  renderRow: (row: T) => React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border p-4">
        {icon}
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{rows.length} records</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="px-4 py-3">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>{rows.map((row) => renderRow(row))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
