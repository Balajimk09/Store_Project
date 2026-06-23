import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requirePermission } from '@/lib/admin-auth';

async function safeCount(tableName: string) {
  const supabaseAdmin = getSupabaseAdmin();

  const { count, error } = await supabaseAdmin
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  if (error) {
    return 0;
  }

  return count || 0;
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.dashboard.view');

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  const [
    stores,
    products,
    transactions,
    vendors,
    uploadBatches,
    userProfiles,
    auditLogs,
  ] = await Promise.all([
    safeCount('stores'),
    safeCount('products'),
    safeCount('transactions'),
    safeCount('store_vendors'),
    safeCount('upload_batches'),
    safeCount('user_profiles'),
    safeCount('admin_audit_logs'),
  ]);

  const { data: recentStores } = await supabaseAdmin
    .from('stores')
    .select('id, store_name, city, state, zip_code, phone_number, created_at')
    .order('created_at', { ascending: false })
    .limit(6);

  const { data: recentAuditLogs } = await supabaseAdmin
    .from('admin_audit_logs')
    .select('id, action, actor_user_id, target_user_id, target_store_id, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  return NextResponse.json({
    cards: {
      stores,
      products,
      transactions,
      vendors,
      uploadBatches,
      userProfiles,
      auditLogs,
      revenue: 0,
      payingCustomers: 0,
      openTickets: 0,
    },
    recentStores: recentStores || [],
    recentAuditLogs: recentAuditLogs || [],
  });
}