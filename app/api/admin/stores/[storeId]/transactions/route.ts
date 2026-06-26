import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError } from '@/app/api/admin/_lib';
import {
  getScopedStore,
  normalizeSearch,
  rangeFromRequest,
  requireStorePermission,
  TRANSACTION_VIEW_PERMISSIONS,
} from '../_lib';

type RouteContext = { params: { storeId: string } };

const TRANSACTION_FIELDS =
  'id, store_id, batch_id, transaction_id, transaction_time, register_id, cashier_id, upc, item_name, category, quantity, unit_price, discount_amount, total_amount, payment_type, transaction_type, fuel_grade';

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, TRANSACTION_VIEW_PERMISSIONS);
  if (!auth.ok) return auth.response;

  const { response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const { page, limit, from, to } = rangeFromRequest(request, 100, 500);
  const search = normalizeSearch(request.nextUrl.searchParams.get('search'));
  const supabaseAdmin = getSupabaseAdmin();

  let query = supabaseAdmin
    .from('transactions')
    .select(TRANSACTION_FIELDS, { count: 'exact' })
    .eq('store_id', context.params.storeId)
    .order('transaction_time', { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`transaction_id.ilike.%${search}%,item_name.ilike.%${search}%,upc.ilike.%${search}%,category.ilike.%${search}%,payment_type.ilike.%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ transactions: data || [], total: count || 0, page, limit });
}
