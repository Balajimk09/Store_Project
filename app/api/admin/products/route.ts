import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  jsonError,
  logAdminActivity,
  numberOrNull,
  requireAnyAdminPermission,
  rowString,
  textOrNull,
  type JsonRecord,
} from '@/app/api/admin/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['products.view']);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const search = request.nextUrl.searchParams.get('search')?.trim().toLowerCase() || '';
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, store_id, upc, item_name, category, department, brand, vendor, cost_price, selling_price, stock, reorder_level, is_active, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) return jsonError(error.message, 500);

  const productRows = (data || []) as JsonRecord[];
  const storeIds = Array.from(new Set(productRows.map((row) => rowString(row, 'store_id')).filter((id): id is string => Boolean(id))));
  const { data: stores } = storeIds.length ? await supabaseAdmin.from('stores').select('id, store_name').in('id', storeIds) : { data: [] };
  const storeById = new Map(((stores || []) as JsonRecord[]).map((store) => [rowString(store, 'id'), rowString(store, 'store_name')]));

  const products: JsonRecord[] = productRows
    .map((row): JsonRecord => ({ ...row, store_name: storeById.get(rowString(row, 'store_id')) || 'Unknown Store' }))
    .filter((row) => {
      if (!search) return true;
      return [row.item_name, row.upc, row.category, row.vendor, row.store_name].filter(Boolean).join(' ').toLowerCase().includes(search);
    });

  return NextResponse.json({ products });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['products.edit']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const productId = textOrNull(body.id);
  if (!productId) return jsonError('Product id is required.');

  const payload = {
    item_name: textOrNull(body.item_name),
    category: textOrNull(body.category),
    brand: textOrNull(body.brand),
    vendor: textOrNull(body.vendor),
    cost_price: numberOrNull(body.cost_price),
    selling_price: numberOrNull(body.selling_price),
    notes: textOrNull(body.notes),
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data: oldProduct } = await supabaseAdmin.from('products').select('*').eq('id', productId).maybeSingle();
  const { data, error } = await supabaseAdmin.from('products').update(payload).eq('id', productId).select('*').single();
  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'product.edited',
    description: 'Edited product details.',
    relatedType: 'product',
    relatedId: productId,
    storeId: rowString((data || {}) as JsonRecord, 'store_id'),
    metadata: { oldProduct: (oldProduct || null) as JsonRecord | null, newProduct: data as JsonRecord },
  });

  return NextResponse.json({ product: data, message: 'Product updated.' });
}
