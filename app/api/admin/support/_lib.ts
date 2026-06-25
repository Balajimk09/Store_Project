import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  STORE_SAFE_SELECT,
  TICKET_SELECT,
  auditSupportAction,
  boolValue,
  calculateSlaBreachAt,
  generateTicketNumber,
  hasPermission,
  insertActivity,
  jsonError,
  numberOrNull,
  safeStoreName,
  textOrNull,
  type JsonRecord,
  type StoreSafeRow,
  type TicketRow,
} from '@/app/api/support/_lib';
import type { SupportAuthResult, SupportPermission } from '@/lib/support-auth';

export const ALL_SUPPORT_PERMISSIONS: SupportPermission[] = [
  'tickets.view',
  'tickets.reply',
  'tickets.assign',
  'tickets.close',
  'tickets.reopen',
  'tickets.merge',
  'tickets.export',
  'tickets.bulk_action',
  'tickets.add_internal_note',
  'tickets.add_tag',
  'tickets.set_follow_up',
  'tickets.log_call',
  'tickets.supervisor_review',
  'stores.view',
  'stores.search',
  'stores.view_360',
  'stores.edit_profile',
  'stores.flag',
  'stores.impersonate_view',
  'products.view',
  'products.edit',
  'products.bulk_update',
  'vendors.view',
  'vendors.edit',
  'billing.view',
  'billing.request_adjustment',
  'billing.approve_adjustment',
  'account.view_owner_email',
  'account.request_email_change',
  'account.send_password_reset',
  'account.set_temp_password',
  'account.deactivate_user',
  'account.reactivate_user',
  'approval.request_action',
  'approval.approve_action',
  'approval.reject_action',
  'knowledge_base.view',
  'knowledge_base.create',
  'knowledge_base.edit',
  'analytics.view',
];

export const ROLE_PRESETS: Record<string, SupportPermission[]> = {
  viewer: ['tickets.view', 'stores.search', 'stores.view', 'knowledge_base.view'],
  agent: [
    'tickets.view',
    'tickets.reply',
    'tickets.add_internal_note',
    'tickets.set_follow_up',
    'tickets.log_call',
    'stores.search',
    'stores.view',
    'stores.view_360',
    'knowledge_base.view',
  ],
  product_support: ['tickets.view', 'tickets.reply', 'stores.search', 'stores.view_360', 'products.view', 'products.edit'],
  vendor_support: ['tickets.view', 'tickets.reply', 'stores.search', 'stores.view_360', 'vendors.view', 'vendors.edit'],
  billing_support: ['tickets.view', 'tickets.reply', 'stores.search', 'stores.view_360', 'billing.view', 'billing.request_adjustment'],
  manager: ALL_SUPPORT_PERMISSIONS.filter((permission) => permission !== 'approval.approve_action'),
  superadmin: ALL_SUPPORT_PERMISSIONS,
};

export type AdminTicketRow = TicketRow & {
  store_name: string;
  owner_email: string | null;
  follow_up_due_at?: string | null;
};

export function parsePagination(request: NextRequest) {
  const page = Math.max(0, Number(request.nextUrl.searchParams.get('page') || 0));
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 50)));
  return {
    page: Number.isFinite(page) ? Math.floor(page) : 0,
    limit: Number.isFinite(limit) ? Math.floor(limit) : 50,
  };
}

export function requireFieldPermission(
  auth: Extract<SupportAuthResult, { ok: true }>,
  permission: SupportPermission
) {
  return hasPermission(auth.permissions, permission);
}

export async function loadTicket(ticketId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(TICKET_SELECT)
    .eq('id', ticketId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as TicketRow | null) || null;
}

export async function loadStoreMap(storeIds: string[]) {
  const ids = Array.from(new Set(storeIds.filter(Boolean)));
  const map = new Map<string, StoreSafeRow>();
  if (ids.length === 0) return map;

  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin.from('stores').select(STORE_SAFE_SELECT).in('id', ids);
  for (const store of (data || []) as StoreSafeRow[]) {
    map.set(store.id, store);
  }
  return map;
}

export function hydrateTickets(tickets: TicketRow[], stores: Map<string, StoreSafeRow>) {
  return tickets.map((ticket) => {
    const store = ticket.store_id ? stores.get(ticket.store_id) : null;
    return {
      ...ticket,
      store_name: safeStoreName(store),
      owner_email: store?.primary_owner_email || null,
    };
  });
}

export async function createTicketFromBody(body: JsonRecord, actorUserId: string) {
  const title = textOrNull(body.title);
  const description = textOrNull(body.description);
  const storeId = textOrNull(body.store_id);
  const ownerId = textOrNull(body.owner_id);
  const category = textOrNull(body.category) || 'general';
  const priority = textOrNull(body.priority) || 'normal';

  if (!title) throw new Error('Title is required.');
  if (!description) throw new Error('Description is required.');
  if (!storeId) throw new Error('Store is required.');
  if (!ownerId) throw new Error('Owner is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const ticketNumber = await generateTicketNumber();
  const slaBreachAt = await calculateSlaBreachAt(priority);
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      ticket_number: ticketNumber,
      store_id: storeId,
      owner_id: ownerId,
      submitted_by: actorUserId,
      title,
      description,
      category,
      priority,
      status: textOrNull(body.status) || 'open',
      source: textOrNull(body.source) || 'phone',
      caller_name: textOrNull(body.caller_name),
      sla_breach_at: slaBreachAt,
      tags: [],
    })
    .select(TICKET_SELECT)
    .single();

  if (error) throw new Error(error.message);
  const ticket = data as TicketRow;
  await insertActivity({
    ticketId: ticket.id,
    actorId: actorUserId,
    activityType: 'ticket_created',
    body: 'Ticket created by support.',
    isPublic: false,
  });
  await auditSupportAction({
    actorUserId,
    action: 'support.ticket_created',
    ticketId: ticket.id,
    storeId,
    table: 'support_tickets',
    recordId: ticket.id,
    newValues: ticket,
  });
  return ticket;
}

export function buildTicketUpdate(body: JsonRecord, auth: Extract<SupportAuthResult, { ok: true }>) {
  const payload: JsonRecord = {};
  const denied: string[] = [];

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = textOrNull(body.status);
    if (status === 'closed' && !requireFieldPermission(auth, 'tickets.close')) denied.push('tickets.close');
    if (status === 'reopened' && !requireFieldPermission(auth, 'tickets.reopen')) denied.push('tickets.reopen');
    payload.status = status;
    if (status === 'resolved') payload.resolved_at = new Date().toISOString();
    if (status === 'closed') payload.closed_at = new Date().toISOString();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'assigned_to')) {
    if (!requireFieldPermission(auth, 'tickets.assign')) denied.push('tickets.assign');
    payload.assigned_to = textOrNull(body.assigned_to);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
    payload.priority = textOrNull(body.priority) || 'normal';
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
    if (!requireFieldPermission(auth, 'tickets.add_tag')) denied.push('tickets.add_tag');
    payload.tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  }

  payload.updated_at = new Date().toISOString();
  return { payload, denied };
}

export async function executeApprovalAction(itemId: string, actorUserId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_approval_queue')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Approval item not found.');

  const item = data as {
    id: string;
    action_type: string;
    action_payload: JsonRecord | null;
    ticket_id: string | null;
    store_id: string | null;
  };
  const payload = item.action_payload || {};
  let responsePayload: JsonRecord = {};

  if (item.action_type === 'update_owner_email') {
    const userId = textOrNull(payload.user_id);
    const newEmail = textOrNull(payload.new_email);
    if (!userId || !newEmail) throw new Error('User ID and new email are required.');
    await supabaseAdmin.auth.admin.updateUserById(userId, { email: newEmail });
    responsePayload = { user_id: userId, new_email: newEmail };
    if (item.ticket_id) {
      await insertActivity({
        ticketId: item.ticket_id,
        actorId: actorUserId,
        activityType: 'owner_email_updated',
        body: 'Owner email was updated after approval.',
        isPublic: false,
      });
    }
  } else if (item.action_type === 'send_password_reset') {
    const email = textOrNull(payload.email);
    if (!email) throw new Error('Email is required.');
    await supabaseAdmin.auth.resetPasswordForEmail(email);
    responsePayload = { email };
    if (item.ticket_id) {
      await insertActivity({
        ticketId: item.ticket_id,
        actorId: actorUserId,
        activityType: 'password_reset_sent',
        body: 'Password reset was sent.',
        isPublic: false,
      });
    }
  } else if (item.action_type === 'set_temp_password') {
    const userId = textOrNull(payload.user_id);
    if (!userId) throw new Error('User ID is required.');
    const tempPassword = `${randomUUID().replace(/-/g, '').slice(0, 16)}Aa1!`;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: tempPassword,
      user_metadata: {
        needs_password_change: true,
        temp_password_set_at: new Date().toISOString(),
        temp_password_set_by_support: true,
      },
    });
    responsePayload = { user_id: userId, temp_password: tempPassword };
    if (item.ticket_id) {
      await insertActivity({
        ticketId: item.ticket_id,
        actorId: actorUserId,
        activityType: 'temp_password_set',
        body: 'Temporary password was set.',
        isPublic: false,
      });
    }
  } else if (item.action_type === 'deactivate_store' || item.action_type === 'reactivate_store') {
    if (!item.store_id) throw new Error('Store ID is required.');
    await supabaseAdmin
      .from('stores')
      .update({ is_active: item.action_type === 'reactivate_store' })
      .eq('id', item.store_id);
    responsePayload = { store_id: item.store_id, is_active: item.action_type === 'reactivate_store' };
  } else if (item.action_type === 'billing_adjustment' || item.action_type === 'refund_credit_request') {
    await supabaseAdmin
      .from('support_billing_adjustments')
      .update({ status: 'approved', reviewed_by: actorUserId, reviewed_at: new Date().toISOString() })
      .eq('approval_queue_id', item.id);
    responsePayload = { tracked_only: true };
  } else {
    responsePayload = { tracked_only: true };
  }

  return responsePayload;
}

export function approvalStatusPermission(status: unknown): SupportPermission {
  return status === 'rejected' ? 'approval.reject_action' : 'approval.approve_action';
}

export function normalizeAdjustmentPayload(body: JsonRecord, actorUserId: string) {
  return {
    ticket_id: textOrNull(body.ticket_id),
    store_id: textOrNull(body.store_id),
    issue_type: textOrNull(body.issue_type) || 'manual_adjustment',
    original_amount: numberOrNull(body.original_amount),
    correct_amount: numberOrNull(body.correct_amount),
    difference_amount: numberOrNull(body.difference_amount),
    reason: textOrNull(body.reason),
    status: textOrNull(body.status) || 'reported',
    requested_by: actorUserId,
  };
}

export function normalizeFlagPayload(body: JsonRecord, actorUserId: string) {
  return {
    flag_type: textOrNull(body.flag_type) || 'watch',
    note: textOrNull(body.note),
    created_by: actorUserId,
    is_active: true,
  };
}

export function normalizeCallLogPayload(body: JsonRecord, actorUserId: string) {
  return {
    ticket_id: textOrNull(body.ticket_id),
    store_id: textOrNull(body.store_id),
    caller_name: textOrNull(body.caller_name),
    caller_role: textOrNull(body.caller_role),
    call_direction: textOrNull(body.call_direction) || 'inbound',
    duration_minutes: numberOrNull(body.duration_minutes),
    summary: textOrNull(body.summary),
    outcome: textOrNull(body.outcome),
    follow_up_required: boolValue(body.follow_up_required, false),
    logged_by: actorUserId,
  };
}

export async function maybeBreachTicket(ticket: TicketRow, actorUserId: string) {
  if (!ticket.sla_breach_at || ticket.sla_breached) return;
  if (new Date(ticket.sla_breach_at).getTime() > Date.now()) return;

  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin.from('support_tickets').update({ sla_breached: true }).eq('id', ticket.id);
  await insertActivity({
    ticketId: ticket.id,
    actorId: actorUserId,
    activityType: 'sla_breached',
    body: 'SLA breach detected.',
    isPublic: false,
  });
}
