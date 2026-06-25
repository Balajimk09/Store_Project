'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Star,
  Ticket,
  Upload,
} from 'lucide-react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type SupportTab = 'tickets' | 'new' | 'articles';

type StoreOption = {
  id: string;
  store_name: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
};

type SupportTicket = {
  id: string;
  ticket_number: string;
  store_id: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  store_owner_read_at: string | null;
  satisfaction_rating: number | null;
};

type SupportReply = {
  id: string;
  author_role: string;
  body: string;
  attachments: AttachmentMeta[];
  created_at: string;
};

type SupportActivity = {
  id: string;
  activity_type: string;
  body: string | null;
  created_at: string;
};

type KnowledgeArticle = {
  id: string;
  title: string;
  category: string | null;
  content: string;
  tags: string[];
};

type AttachmentMeta = {
  path: string;
  signed_url: string | null;
  filename: string;
  size: number;
  mime_type: string;
};

type TicketDetail = {
  ticket: SupportTicket;
  replies: SupportReply[];
  activities: SupportActivity[];
};

const CATEGORIES = [
  'account_access',
  'billing',
  'technical',
  'products_pricebook',
  'vendors',
  'csv_upload',
  'pos_register',
  'ai_assistant',
  'reports',
  'general',
];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

async function supportFetch<T>(url: string, options?: RequestInit) {
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function prettyLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function SupportPage() {
  const [activeTab, setActiveTab] = useState<SupportTab>('tickets');
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [articleQuery, setArticleQuery] = useState('');
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<AttachmentMeta[]>([]);
  const [newAttachments, setNewAttachments] = useState<AttachmentMeta[]>([]);
  const [newAttachmentFiles, setNewAttachmentFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'general',
    priority: 'normal',
    store_id: '',
  });

  const showSuccess = useCallback((message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [storesResponse, ticketsResponse, articlesResponse] = await Promise.all([
        supportFetch<{ stores: StoreOption[] }>('/api/support/stores'),
        supportFetch<{ tickets: SupportTicket[] }>('/api/support/tickets'),
        supportFetch<{ articles: KnowledgeArticle[] }>('/api/support/knowledge-base'),
      ]);
      setStores(storesResponse.stores || []);
      setTickets(ticketsResponse.tickets || []);
      setArticles(articlesResponse.articles || []);
      if (storesResponse.stores.length === 1) {
        setSelectedStoreId(storesResponse.stores[0].id);
        setForm((current) => ({ ...current, store_id: storesResponse.stores[0].id }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load support portal.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredArticles = useMemo(() => {
    const query = articleQuery.trim().toLowerCase();
    if (!query) return articles;
    return articles.filter(
      (article) =>
        article.title.toLowerCase().includes(query) ||
        article.content.toLowerCase().includes(query) ||
        article.category?.toLowerCase().includes(query)
    );
  }, [articleQuery, articles]);

  const loadTicketDetail = async (ticketId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const detail = await supportFetch<TicketDetail>(`/api/support/tickets/${ticketId}`);
      setTicketDetail(detail);
      setExpandedTicketId(ticketId);
      setReplyAttachments([]);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load ticket.');
    } finally {
      setDetailLoading(false);
    }
  };

  const uploadAttachment = async (event: ChangeEvent<HTMLInputElement>, forReply: boolean) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ticketId = forReply ? expandedTicketId : null;
    if (forReply && !ticketId) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('ticket_id', ticketId || 'new');
      if (!forReply) {
        setNewAttachmentFiles((current) => [...current, file]);
        setNewAttachments((current) => [
          ...current,
          { path: '', signed_url: null, filename: file.name, size: file.size, mime_type: file.type },
        ]);
      } else {
        const uploaded = await supportFetch<AttachmentMeta>('/api/support/attachments', {
          method: 'POST',
          body: formData,
        });
        setReplyAttachments((current) => [...current, uploaded]);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const submitTicket = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await supportFetch<{ ticket: SupportTicket; message: string }>('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          store_id: form.store_id || selectedStoreId,
        }),
      });
      if (newAttachmentFiles.length > 0) {
        const uploadedAttachments: AttachmentMeta[] = [];
        for (const file of newAttachmentFiles) {
          const uploadForm = new FormData();
          uploadForm.append('file', file);
          uploadForm.append('ticket_id', response.ticket.id);
          const uploaded = await supportFetch<AttachmentMeta>('/api/support/attachments', {
            method: 'POST',
            body: uploadForm,
          });
          uploadedAttachments.push(uploaded);
        }
        await supportFetch(`/api/support/tickets/${response.ticket.id}/replies`, {
          method: 'POST',
          body: JSON.stringify({
            body: 'Initial ticket attachments uploaded.',
            attachments: uploadedAttachments,
          }),
        });
      }
      showSuccess(`Ticket ${response.ticket.ticket_number} created.`);
      setForm({ title: '', description: '', category: 'general', priority: 'normal', store_id: selectedStoreId });
      setNewAttachments([]);
      setNewAttachmentFiles([]);
      await load();
      setActiveTab('tickets');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const sendReply = async () => {
    if (!expandedTicketId) return;
    setSubmitting(true);
    setError(null);
    try {
      await supportFetch(`/api/support/tickets/${expandedTicketId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body: replyBody, attachments: replyAttachments }),
      });
      setReplyBody('');
      setReplyAttachments([]);
      showSuccess('Reply sent.');
      await loadTicketDetail(expandedTicketId);
      await load();
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Could not send reply.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRating = async () => {
    if (!expandedTicketId) return;
    setSubmitting(true);
    setError(null);
    try {
      await supportFetch(`/api/support/tickets/${expandedTicketId}/rating`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment: ratingComment }),
      });
      showSuccess('Rating saved.');
      await loadTicketDetail(expandedTicketId);
      await load();
    } catch (ratingError) {
      setError(ratingError instanceof Error ? ratingError.message : 'Could not save rating.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardShell>
      <PageHeader title="Support" description="Create tickets, track conversations, and browse help articles.">
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCcw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </PageHeader>

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Our support team may access your store data to assist you. All actions are logged and audited.</p>
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

      <div className="mb-5 flex flex-wrap gap-2 border-b border-border">
        {[
          ['tickets', 'My Tickets'],
          ['new', 'New Ticket'],
          ['articles', 'Help Articles'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as SupportTab)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium',
              activeTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Card className="flex items-center justify-center p-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading support portal...
        </Card>
      ) : (
        <>
          {stores.length > 1 && (
            <Card className="mb-4 p-4">
              <label className="text-xs font-medium text-muted-foreground">Store</label>
              <select
                value={selectedStoreId}
                onChange={(event) => {
                  setSelectedStoreId(event.target.value);
                  setForm((current) => ({ ...current, store_id: event.target.value }));
                }}
                className="mt-1 h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select a store</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.store_name || store.id}
                  </option>
                ))}
              </select>
            </Card>
          )}

          {activeTab === 'tickets' && (
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="overflow-hidden">
                <div className="border-b border-border p-4">
                  <h2 className="font-semibold text-foreground">My Tickets</h2>
                  <p className="text-sm text-muted-foreground">Public conversation and status history only.</p>
                </div>
                {tickets.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <Ticket className="mx-auto mb-3 h-8 w-8" />
                    No tickets yet. Create one when you need help.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {tickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        onClick={() => void loadTicketDetail(ticket.id)}
                        className={cn(
                          'block w-full p-4 text-left hover:bg-secondary/40',
                          expandedTicketId === ticket.id && 'bg-secondary/50'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">{ticket.ticket_number}</p>
                            <p className="mt-1 text-sm text-foreground">{ticket.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {prettyLabel(ticket.category)} · {prettyLabel(ticket.priority)} · {formatDate(ticket.created_at)}
                            </p>
                          </div>
                          <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">
                            {prettyLabel(ticket.status)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="min-h-[520px] overflow-hidden">
                {!expandedTicketId ? (
                  <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                    Select a ticket to view the public conversation.
                  </div>
                ) : detailLoading || !ticketDetail ? (
                  <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading ticket...
                  </div>
                ) : (
                  <div>
                    <div className="border-b border-border p-4">
                      <h2 className="font-semibold text-foreground">{ticketDetail.ticket.title}</h2>
                      <p className="text-sm text-muted-foreground">
                        {ticketDetail.ticket.ticket_number} · {prettyLabel(ticketDetail.ticket.status)}
                      </p>
                    </div>
                    <div className="space-y-3 p-4">
                      {ticketDetail.activities.map((activity) => (
                        <div key={activity.id} className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                          {prettyLabel(activity.activity_type)} · {formatDate(activity.created_at)}
                        </div>
                      ))}
                      {ticketDetail.replies.map((reply) => (
                        <div key={reply.id} className="rounded-lg border border-border p-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            {prettyLabel(reply.author_role)} · {formatDate(reply.created_at)}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{reply.body}</p>
                          {reply.attachments?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {reply.attachments.map((attachment) => (
                                <a
                                  key={attachment.path}
                                  href={attachment.signed_url || '#'}
                                  className="rounded border border-border px-2 py-1 text-xs text-primary"
                                  target="_blank"
                                >
                                  {attachment.filename}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="rounded-lg border border-border p-3">
                        <textarea
                          value={replyBody}
                          onChange={(event) => setReplyBody(event.target.value)}
                          rows={3}
                          placeholder="Write a reply..."
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                            <Paperclip className="h-4 w-4" />
                            Add attachment
                            <input type="file" className="hidden" onChange={(event) => void uploadAttachment(event, true)} />
                          </label>
                          <Button onClick={() => void sendReply()} disabled={submitting || uploading}>
                            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Send
                          </Button>
                        </div>
                      </div>
                      {['resolved', 'closed'].includes(ticketDetail.ticket.status) && !ticketDetail.ticket.satisfaction_rating && (
                        <div className="rounded-lg border border-border p-3">
                          <p className="text-sm font-medium text-foreground">Rate this support experience</p>
                          <div className="mt-2 flex gap-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button key={star} onClick={() => setRating(star)} className="text-amber-500">
                                <Star className={cn('h-5 w-5', star <= rating && 'fill-current')} />
                              </button>
                            ))}
                          </div>
                          <Input
                            value={ratingComment}
                            onChange={(event) => setRatingComment(event.target.value)}
                            placeholder="Optional comment"
                            className="mt-2"
                          />
                          <Button size="sm" className="mt-2" onClick={() => void submitRating()} disabled={submitting}>
                            Save Rating
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {activeTab === 'new' && (
            <Card className="max-w-3xl p-5">
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-foreground">New Ticket</h2>
              </div>
              <div className="grid gap-4">
                {stores.length > 1 && (
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Store *</span>
                    <select
                      value={form.store_id}
                      onChange={(event) => setForm((current) => ({ ...current, store_id: event.target.value }))}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select a store</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.store_name || store.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Category</span>
                    <select
                      value={form.category}
                      onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {prettyLabel(category)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Priority</span>
                    <select
                      value={form.priority}
                      onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {prettyLabel(priority)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Title *</span>
                  <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Description *</span>
                  <textarea
                    rows={5}
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <div className="rounded-lg border border-dashed border-border p-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    Stage attachment for ticket
                    <input type="file" className="hidden" onChange={(event) => void uploadAttachment(event, false)} />
                  </label>
                  {newAttachments.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {newAttachments.map((attachment) => attachment.filename).join(', ')}
                    </p>
                  )}
                </div>
                <Button onClick={() => void submitTicket()} disabled={submitting}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ticket className="mr-2 h-4 w-4" />}
                  Submit Ticket
                </Button>
              </div>
            </Card>
          )}

          {activeTab === 'articles' && (
            <div className="space-y-4">
              <div className="relative max-w-xl">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={articleQuery}
                  onChange={(event) => setArticleQuery(event.target.value)}
                  placeholder="Search help articles..."
                  className="pl-9"
                />
              </div>
              {filteredArticles.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  <BookOpen className="mx-auto mb-3 h-8 w-8" />
                  No public help articles found.
                </Card>
              ) : (
                filteredArticles.map((article) => (
                  <Card key={article.id} className="p-4">
                    <button
                      className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => setExpandedArticleId(expandedArticleId === article.id ? null : article.id)}
                    >
                      <div>
                        <p className="font-semibold text-foreground">{article.title}</p>
                        <p className="text-sm text-muted-foreground">{article.category || 'General'}</p>
                      </div>
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {expandedArticleId === article.id && (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{article.content}</p>
                    )}
                  </Card>
                ))
              )}
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
