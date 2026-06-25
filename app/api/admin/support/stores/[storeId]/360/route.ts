import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import { STORE_SAFE_SELECT, jsonError } from '@/app/api/support/_lib';

type RouteContext = { params: { storeId: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'stores.view_360');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const storeId = context.params.storeId;
  const [
    storeResult,
    productsResult,
    vendorsResult,
    uploadsResult,
    ticketsResult,
    logsResult,
    flagsResult,
    billingResult,
  ] = await Promise.all([
    supabaseAdmin.from('stores').select(STORE_SAFE_SELECT).eq('id', storeId).maybeSingle(),
    supabaseAdmin.from('products').select('id, stock, reorder_level, vendor', { count: 'exact' }).eq('store_id', storeId).limit(5000),
    supabaseAdmin.from('store_vendors').select('id', { count: 'exact' }).eq('store_id', storeId),
    supabaseAdmin.from('upload_batches').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(5),
    supabaseAdmin.from('support_tickets').select('*').eq('store_id', storeId).order('updated_at', { ascending: false }).limit(5),
    supabaseAdmin.from('admin_audit_logs').select('*').eq('target_store_id', storeId).order('created_at', { ascending: false }).limit(5),
    supabaseAdmin.from('support_store_flags').select('*').eq('store_id', storeId).eq('is_active', true),
    supabaseAdmin.from('support_billing_adjustments').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(10),
  ]);

  if (storeResult.error) return jsonError(storeResult.error.message, 500);
  if (!storeResult.data) return jsonError('Store not found.', 404);

  const products = (productsResult.data || []) as Array<{
    stock: number | null;
    reorder_level: number | null;
    vendor: string | null;
  }>;
  const lowStockCount = products.filter(
    (product) => Number(product.stock || 0) <= Number(product.reorder_level || 0)
  ).length;

  return NextResponse.json({
    store: storeResult.data,
    owner: { email: storeResult.data.primary_owner_email || null },
    inventory: {
      product_count: productsResult.count || products.length,
      low_stock_count: lowStockCount,
      products_with_vendor: products.filter((product) => product.vendor?.trim()).length,
    },
    vendors: { vendor_count: vendorsResult.count || 0 },
    upload_batches: uploadsResult.data || [],
    recent_tickets: ticketsResult.data || [],
    recent_audit_logs: logsResult.data || [],
    store_flags: flagsResult.data || [],
    billing_adjustments: billingResult.data || [],
    support_history: {
      ticket_count: ticketsResult.data?.length || 0,
      satisfaction_average: null,
    },
  });
}
