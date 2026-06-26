import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, type JsonRecord } from '@/app/api/admin/_lib';
import { getScopedStore, rangeFromRequest, requireStorePermission, STORE_AUDIT_PERMISSIONS } from '../_lib';

type RouteContext = { params: { storeId: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, STORE_AUDIT_PERMISSIONS);
  if (!auth.ok) return auth.response;

  const { response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const { page, limit, from, to } = rangeFromRequest(request, 50, 200);
  const supabaseAdmin = getSupabaseAdmin();

  const adminLogs = await supabaseAdmin
    .from('admin_activity_logs')
    .select('*', { count: 'exact' })
    .eq('store_id', context.params.storeId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (!adminLogs.error) {
    return NextResponse.json({ audit_logs: adminLogs.data || [], total: adminLogs.count || 0, page, limit });
  }

  const storeLogs = await supabaseAdmin
    .from('store_audit_logs')
    .select('*', { count: 'exact' })
    .eq('store_id', context.params.storeId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (storeLogs.error) {
    const missingTable = storeLogs.error.message.toLowerCase().includes('does not exist');
    if (missingTable) return NextResponse.json({ audit_logs: [], total: 0, page, limit });
    return jsonError(storeLogs.error.message, 500);
  }

  const logs = ((storeLogs.data || []) as JsonRecord[]).map((row) => ({
    ...row,
    action: row.action || row.event_type || 'store.activity',
  }));

  return NextResponse.json({ audit_logs: logs, total: storeLogs.count || logs.length, page, limit });
}
