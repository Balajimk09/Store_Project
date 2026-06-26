import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hasAdminPermission, requireAdminAccess, type AdminAccessResult } from '@/lib/admin-auth';
import { jsonError, type JsonRecord } from '@/app/api/admin/_lib';

export type StoreScopeAuth = Extract<AdminAccessResult, { ok: true }>;

export const STORE_VIEW_PERMISSIONS = ['stores.view_360', 'stores.view', 'stores.search'];
export const STORE_EDIT_PERMISSIONS = ['stores.edit'];
export const STORE_DEACTIVATE_PERMISSIONS = ['stores.deactivate'];
export const STORE_AUDIT_PERMISSIONS = ['stores.audit_logs.view', 'store_activity.view'];
export const PRODUCT_VIEW_PERMISSIONS = ['products.view', 'stores.view_360'];
export const PRODUCT_EDIT_PERMISSIONS = ['products.edit', 'products.manage'];
export const UPLOAD_PERMISSIONS = ['uploads.create', 'stores.edit'];
export const TRANSACTION_VIEW_PERMISSIONS = ['store_activity.view', 'stores.view_360', 'stores.view'];
export const SUPPORT_VIEW_PERMISSIONS = ['tickets.view', 'stores.view_360'];

export function hasAnyStorePermission(auth: StoreScopeAuth, permissionKeys: string[]) {
  return permissionKeys.some((permissionKey) => hasAdminPermission(auth.permissions, permissionKey));
}

export async function requireStorePermission(request: NextRequest, permissionKeys: string[]) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) return auth;

  if (!hasAnyStorePermission(auth, permissionKeys)) {
    return {
      ok: false,
      response: jsonError('You do not have permission to access this store section.', 403),
    } satisfies AdminAccessResult;
  }

  return auth;
}

export async function getScopedStore(storeId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from('stores').select('*').eq('id', storeId).maybeSingle();

  if (error) return { store: null, response: jsonError(error.message, 500) };
  if (!data) return { store: null, response: jsonError('Store not found.', 404) };

  return { store: data as JsonRecord, response: null };
}

export function rowText(row: JsonRecord | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function rowBoolean(row: JsonRecord | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'boolean' ? value : null;
}

export function rowNumber(row: JsonRecord | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeSearch(value: string | null) {
  return value?.trim().toLowerCase() || '';
}

export function limitFromRequest(request: NextRequest, fallback = 100, max = 500) {
  const parsed = Number(request.nextUrl.searchParams.get('limit') || fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export function pageFromRequest(request: NextRequest) {
  const parsed = Number(request.nextUrl.searchParams.get('page') || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

export function rangeFromRequest(request: NextRequest, fallback = 100, max = 500) {
  const limit = limitFromRequest(request, fallback, max);
  const page = pageFromRequest(request);
  return { page, limit, from: page * limit, to: page * limit + limit - 1 };
}

export function pickExistingColumns(source: Record<string, unknown>, existingRow: JsonRecord, allowedFields: readonly string[]) {
  const payload: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(source, field) && Object.prototype.hasOwnProperty.call(existingRow, field)) {
      payload[field] = source[field];
    }
  }

  return payload;
}
