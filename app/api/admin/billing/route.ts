import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, requireAnyAdminPermission, rowString, type JsonRecord } from '@/app/api/admin/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['renewals.view', 'billing.view']);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: subscriptions, error } = await supabaseAdmin
    .from('store_subscriptions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(300);

  if (error) return jsonError(error.message, 500);

  const rows = (subscriptions || []) as JsonRecord[];
  const storeIds = rows.map((row) => rowString(row, 'store_id')).filter((id): id is string => Boolean(id));
  const { data: stores } = storeIds.length
    ? await supabaseAdmin.from('stores').select('id, store_name, primary_owner_email, owner_id').in('id', storeIds)
    : { data: [] };

  const storeById = new Map(((stores || []) as JsonRecord[]).map((store) => [rowString(store, 'id'), store]));

  return NextResponse.json({
    subscriptions: rows.map((row) => {
      const store = storeById.get(rowString(row, 'store_id'));
      return {
        ...row,
        store_name: rowString(store, 'store_name') || 'Unknown Store',
        owner_email: rowString(store, 'primary_owner_email'),
      };
    }),
  });
}
