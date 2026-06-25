import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/admin-auth';
import { createAdminAuditLog } from '@/lib/audit-log';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { SupportPermission } from '@/lib/support-auth';

export type JsonRecord = Record<string, unknown>;

export type StoreSafeRow = {
  id: string;
  owner_id: string | null;
  store_name: string | null;
  primary_owner_email?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  phone_number?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

export type TicketRow = {
  id: string;
  ticket_number: string;
  store_id: string | null;
  owner_id: string;
  submitted_by: string | null;
  assigned_to: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  source: string;
  tags: string[];
  is_vip: boolean;
  sla_breach_at: string | null;
  sla_breached: boolean;
  merged_into: string | null;
  satisfaction_rating: number | null;
  satisfaction_comment: string | null;
  rated_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  store_owner_read_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
};

export type ReplyRow = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_role: string;
  body: string;
  is_internal: boolean;
  attachments: JsonRecord[];
  created_at: string;
};

export type ActivityRow = {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  activity_type: string;
  body: string | null;
  is_public: boolean;
  metadata: JsonRecord;
  created_at: string;
};

export const STORE_SAFE_SELECT =
  'id, owner_id, store_name, primary_owner_email, address_line1, city, state, zip_code, phone_number, is_active, created_at';

export const TICKET_SELECT =
  'id, ticket_number, store_id, owner_id, submitted_by, assigned_to, title, description, category, priority, status, source, tags, is_vip, sla_breach_at, sla_breached, merged_into, satisfaction_rating, satisfaction_comment, rated_at, verified_at, verified_by, store_owner_read_at, created_at, updated_at, resolved_at, closed_at';

export const PUBLIC_ACTIVITY_TYPES = new Set([
  'ticket_created',
  'owner_replied',
  'support_replied',
  'status_changed_to_resolved',
  'status_changed_to_closed',
  'ticket_resolved',
  'ticket_closed',
  'ticket_reopened_by_owner',
  'satisfaction_rated',
]);

const PRIORITY_HOURS: Record<string, { first: number; resolution: number }> = {
  urgent: { first: 1, resolution: 8 },
  high: { first: 4, resolution: 24 },
  normal: { first: 24, resolution: 72 },
  low: { first: 48, resolution: 168 },
};

export async function requireStoreOwner(request: NextRequest) {
  return getAuthenticatedUser(request);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function boolValue(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'active', '1'].includes(normalized)) return true;
    if (['false', 'no', 'inactive', '0'].includes(normalized)) return false;
  }
  return fallback;
}

export function arrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function safeStoreName(store: StoreSafeRow | null | undefined) {
  return store?.store_name || store?.primary_owner_email || 'Unknown Store';
}

export async function loadOwnerStores(ownerId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select(STORE_SAFE_SELECT)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []) as StoreSafeRow[];
}

export async function verifyOwnerTicket(ticketId: string, ownerId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(TICKET_SELECT)
    .eq('id', ticketId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as TicketRow | null) || null;
}

export async function generateTicketNumber() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.rpc('generate_ticket_number');

  if (!error && typeof data === 'string' && data.trim()) {
    return data;
  }

  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `TKT-${yearMonth}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
}

export async function calculateSlaBreachAt(priority: string) {
  const normalized = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
  const fallbackHours = PRIORITY_HOURS[normalized].resolution;
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from('support_sla_policies')
    .select('resolution_hours')
    .eq('priority', normalized)
    .eq('is_active', true)
    .maybeSingle();

  const row = data as { resolution_hours?: number | null } | null;
  const hours = Number(row?.resolution_hours || fallbackHours);
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export async function insertActivity(input: {
  ticketId: string;
  actorId?: string | null;
  activityType: string;
  body?: string | null;
  metadata?: JsonRecord;
  isPublic?: boolean;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const isPublic =
    typeof input.isPublic === 'boolean'
      ? input.isPublic
      : PUBLIC_ACTIVITY_TYPES.has(input.activityType);

  await supabaseAdmin.from('support_ticket_activities').insert({
    ticket_id: input.ticketId,
    actor_id: input.actorId || null,
    activity_type: input.activityType,
    body: input.body || null,
    metadata: input.metadata || {},
    is_public: isPublic,
  });
}

export async function auditSupportAction(input: {
  actorUserId: string;
  action: string;
  ticketId?: string | null;
  storeId?: string | null;
  table?: string | null;
  recordId?: string | null;
  oldValues?: JsonRecord | null;
  newValues?: JsonRecord | null;
  metadata?: JsonRecord | null;
  reason?: string | null;
}) {
  await createAdminAuditLog({
    actorUserId: input.actorUserId,
    action: input.action,
    targetStoreId: input.storeId || null,
    targetTable: input.table || null,
    targetRecordId: input.recordId || input.ticketId || null,
    oldValues: input.oldValues || null,
    newValues: input.newValues || null,
    metadata: input.metadata || {},
    reason: input.reason || null,
  });
}

export function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 120);
}

export function isAllowedAttachment(file: File) {
  return (
    file.type.startsWith('image/') ||
    ['application/pdf', 'text/csv', 'text/plain'].includes(file.type)
  );
}

export function hasPermission(permissions: string[], permission: SupportPermission) {
  return permissions.includes('ALL') || permissions.includes(permission);
}
