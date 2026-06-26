import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hasAdminPermission, requireAdminAccess, type AdminAccessResult } from '@/lib/admin-auth';

export type JsonRecord = Record<string, unknown>;

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function numberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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

export async function requireAnyAdminPermission(request: NextRequest, permissionKeys: string[]) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) return auth;

  if (permissionKeys.length === 0 || permissionKeys.some((key) => hasAdminPermission(auth.permissions, key))) {
    return auth;
  }

  return {
    ok: false,
    response: jsonError('You do not have access to this section.', 403),
  } satisfies AdminAccessResult;
}

export async function logAdminActivity(input: {
  actorId: string;
  actorEmail?: string | null;
  action: string;
  description: string;
  relatedType?: string | null;
  relatedId?: string | null;
  storeId?: string | null;
  metadata?: JsonRecord;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin.from('admin_activity_logs').insert({
    actor_id: input.actorId,
    actor_email: input.actorEmail || null,
    action: input.action,
    description: input.description,
    related_type: input.relatedType || null,
    related_id: input.relatedId || null,
    store_id: input.storeId || null,
    metadata: input.metadata || {},
  });
}

export async function safeSelect(input: {
  table: string;
  columns?: string;
  order?: string;
  ascending?: boolean;
  limit?: number;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin.from(input.table).select(input.columns || '*');

  if (input.order) query = query.order(input.order, { ascending: input.ascending ?? false });
  if (input.limit) query = query.limit(input.limit);

  const { data, error } = await query;
  if (error) return [] as JsonRecord[];
  return ((data || []) as unknown) as JsonRecord[];
}

export function rowString(row: JsonRecord | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function rowNumber(row: JsonRecord | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
