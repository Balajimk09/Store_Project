import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, numberOrNull, textOrNull, type JsonRecord } from '@/app/api/admin/_lib';
import {
  getScopedStore,
  normalizeSearch,
  PRODUCT_EDIT_PERMISSIONS,
  PRODUCT_VIEW_PERMISSIONS,
  rangeFromRequest,
  requireStorePermission,
  rowText,
} from '../_lib';

type RouteContext = { params: { storeId: string } };

const PRODUCT_FIELDS =
  'id, store_id, batch_id, upc, item_name, category, department, brand, vendor, cost_price, selling_price, stock, reorder_level, is_active, notes, updated_at';

const PRODUCT_WRITE_FIELDS = [
  'upc',
  'item_name',
  'category',
  'department',
  'brand',
  'vendor',
  'cost_price',
  'selling_price',
  'stock',
  'reorder_level',
  'is_active',
  'notes',
] as const;

function buildProductPayload(body: Record<string, unknown>, existingProduct?: JsonRecord) {
  const payload: Record<string, unknown> = {};
  const existingKeys = existingProduct ? new Set(Object.keys(existingProduct)) : null;

  for (const field of PRODUCT_WRITE_FIELDS) {
    if (existingKeys && !existingKeys.has(field)) continue;
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;

    if (field === 'cost_price' || field === 'selling_price' || field === 'stock' || field === 'reorder_level') {
      payload[field] = numberOrNull(body[field]) ?? 0;
    } else if (field === 'is_active') {
      payload[field] = body[field] === true;
    } else {
      payload[field] = textOrNull(body[field]);
    }
  }

  return payload;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, PRODUCT_VIEW_PERMISSIONS);
  if (!auth.ok) return auth.response;

  const { response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const { page, limit, from, to } = rangeFromRequest(request, 100, 500);
  const search = normalizeSearch(request.nextUrl.searchParams.get('search'));
  const supabaseAdmin = getSupabaseAdmin();

  let query = supabaseAdmin
    .from('products')
    .select(PRODUCT_FIELDS, { count: 'exact' })
    .eq('store_id', context.params.storeId)
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`item_name.ilike.%${search}%,upc.ilike.%${search}%,category.ilike.%${search}%,vendor.ilike.%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ products: data || [], total: count || 0, page, limit });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, PRODUCT_EDIT_PERMISSIONS);
  if (!auth.ok) return auth.response;

  const { response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const itemName = textOrNull(body.item_name);
  if (!itemName) return jsonError('Product name is required.');
  if (!textOrNull(body.upc)) return jsonError('UPC is required.');

  const payload = {
    store_id: context.params.storeId,
    ...buildProductPayload(
      { ...body, item_name: itemName, is_active: body.is_active ?? true, reorder_level: body.reorder_level ?? 10 },
    ),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from('products').insert(payload).select(PRODUCT_FIELDS).single();
  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'product.created_by_admin',
    description: `Created product "${itemName}" through Store 360.`,
    relatedType: 'product',
    relatedId: rowText(data as JsonRecord, 'id'),
    storeId: context.params.storeId,
    metadata: { productName: itemName, upc: textOrNull(body.upc), product: data as JsonRecord },
  });

  return NextResponse.json({ ok: true, product: data, message: 'Product created.' });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, PRODUCT_EDIT_PERMISSIONS);
  if (!auth.ok) return auth.response;

  const { response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const productId = textOrNull(body.id);
  if (!productId) return jsonError('Product id is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: oldProduct } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('store_id', context.params.storeId)
    .maybeSingle();

  if (!oldProduct) return jsonError('Product not found for this store.', 404);
  const payload = {
    ...buildProductPayload(body, oldProduct as JsonRecord),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('products')
    .update(payload)
    .eq('id', productId)
    .eq('store_id', context.params.storeId)
    .select(PRODUCT_FIELDS)
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'product.updated_by_admin',
    description: 'Updated product through Store 360.',
    relatedType: 'product',
    relatedId: productId,
    storeId: context.params.storeId,
    metadata: { oldProduct: oldProduct as JsonRecord, newProduct: data as JsonRecord },
  });

  return NextResponse.json({ ok: true, product: data, message: 'Product updated.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, ['products.manage']);
  if (!auth.ok) return auth.response;

  const { response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const productId = textOrNull(request.nextUrl.searchParams.get('id'));
  if (!productId) return jsonError('Product id is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: oldProduct } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('store_id', context.params.storeId)
    .maybeSingle();

  if (!oldProduct) return jsonError('Product not found for this store.', 404);

  let deleteError: { message: string } | null = null;
  if (Object.prototype.hasOwnProperty.call(oldProduct as JsonRecord, 'is_active')) {
    const { error } = await supabaseAdmin
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', productId)
      .eq('store_id', context.params.storeId);
    deleteError = error;
  } else {
    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('store_id', context.params.storeId);
    deleteError = error;
  }

  if (deleteError) return jsonError(deleteError.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'product.deleted_by_admin',
    description: 'Deleted or deactivated product through Store 360.',
    relatedType: 'product',
    relatedId: productId,
    storeId: context.params.storeId,
    metadata: { oldProduct: oldProduct as JsonRecord },
  });

  return NextResponse.json({ ok: true });
}
