import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, numberOrNull, textOrNull, type JsonRecord } from '@/app/api/admin/_lib';
import { getScopedStore, rangeFromRequest, requireStorePermission, rowText, UPLOAD_PERMISSIONS, STORE_VIEW_PERMISSIONS } from '../_lib';

type RouteContext = { params: { storeId: string } };
type UploadType = 'products' | 'transactions';

function cleanUploadType(value: unknown): UploadType | null {
  if (value === 'products' || value === 'pricebook' || value === 'product') return 'products';
  if (value === 'transactions') return 'transactions';
  return null;
}

function rowValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

function cleanText(row: Record<string, unknown>, keys: string[]) {
  return textOrNull(rowValue(row, keys));
}

function cleanNumber(row: Record<string, unknown>, keys: string[], fallback = 0) {
  return numberOrNull(rowValue(row, keys)) ?? fallback;
}

function cleanProductRows(rows: Record<string, unknown>[], storeId: string, batchId: string) {
  return rows
    .map((row) => ({
      store_id: storeId,
      batch_id: batchId,
      upc: cleanText(row, ['upc', 'UPC', 'barcode']),
      item_name: cleanText(row, ['item_name', 'name', 'product_name', 'description']),
      category: cleanText(row, ['category']),
      department: cleanText(row, ['department']),
      brand: cleanText(row, ['brand']),
      vendor: cleanText(row, ['vendor']),
      cost_price: cleanNumber(row, ['cost_price', 'cost', 'unit_cost']),
      selling_price: cleanNumber(row, ['selling_price', 'price', 'retail_price']),
      stock: cleanNumber(row, ['stock', 'quantity', 'qty_on_hand']),
      reorder_level: cleanNumber(row, ['reorder_level', 'reorder', 'min_stock']),
      is_active: true,
    }))
    .filter((row) => row.item_name || row.upc);
}

function cleanTransactionRows(rows: Record<string, unknown>[], storeId: string, batchId: string) {
  return rows
    .map((row, index) => ({
      store_id: storeId,
      batch_id: batchId,
      transaction_id: cleanText(row, ['transaction_id', 'id', 'receipt_id']) || `${batchId}-${index + 1}`,
      transaction_time: cleanText(row, ['transaction_time', 'timestamp', 'date']) || new Date().toISOString(),
      register_id: cleanText(row, ['register_id', 'register']),
      cashier_id: cleanText(row, ['cashier_id', 'cashier']),
      upc: cleanText(row, ['upc', 'UPC', 'barcode']),
      item_name: cleanText(row, ['item_name', 'name', 'product_name', 'description']),
      category: cleanText(row, ['category']),
      quantity: cleanNumber(row, ['quantity', 'qty'], 1),
      unit_price: cleanNumber(row, ['unit_price', 'price']),
      discount_amount: cleanNumber(row, ['discount_amount', 'discount']),
      total_amount: cleanNumber(row, ['total_amount', 'amount', 'total']),
      payment_type: cleanText(row, ['payment_type', 'payment']),
      transaction_type: cleanText(row, ['transaction_type', 'type']) || 'Sale',
    }))
    .filter((row) => row.item_name || row.upc || row.total_amount > 0);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, STORE_VIEW_PERMISSIONS);
  if (!auth.ok) return auth.response;

  const { response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const { page, limit, from, to } = rangeFromRequest(request, 50, 200);
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error, count } = await supabaseAdmin
    .from('upload_batches')
    .select('*', { count: 'exact' })
    .eq('store_id', context.params.storeId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ uploads: data || [], total: count || 0, page, limit });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireStorePermission(request, UPLOAD_PERMISSIONS);
  if (!auth.ok) return auth.response;

  const { store, response } = await getScopedStore(context.params.storeId);
  if (response) return response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const uploadType = cleanUploadType(body.upload_type ?? body.type);
  const rows = Array.isArray(body.rows) ? body.rows.filter((row): row is Record<string, unknown> => row && typeof row === 'object' && !Array.isArray(row)) : [];
  const fileName = textOrNull(body.file_name) || textOrNull(body.fileName) || `${uploadType || 'store'}-upload.csv`;

  if (!uploadType) return jsonError('Upload type must be products or transactions.');
  if (rows.length === 0) return jsonError('Upload rows are required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: batch, error: batchError } = await supabaseAdmin
    .from('upload_batches')
    .insert({
      store_id: context.params.storeId,
      upload_type: uploadType,
      file_name: fileName,
      total_rows: rows.length,
      valid_rows: rows.length,
      invalid_rows: 0,
    })
    .select('*')
    .single();

  if (batchError) return jsonError(batchError.message, 500);

  const batchId = rowText(batch as JsonRecord, 'id') || '';
  let insertedRows = 0;

  if (uploadType === 'products') {
    const productRows = cleanProductRows(rows, context.params.storeId, batchId);
    if (productRows.length === 0) return jsonError('No valid rows found in upload.');
    const { error } = await supabaseAdmin.from('products').upsert(productRows, { onConflict: 'store_id,upc' });
    if (error) return jsonError(error.message, 500);
    insertedRows = productRows.length;
  } else {
    const transactionRows = cleanTransactionRows(rows, context.params.storeId, batchId);
    if (transactionRows.length === 0) return jsonError('No valid rows found in upload.');
    const { error } = await supabaseAdmin.from('transactions').upsert(transactionRows, { onConflict: 'store_id,transaction_id' });
    if (error) return jsonError(error.message, 500);
    insertedRows = transactionRows.length;
  }

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'store.upload_by_admin',
    description: `Imported ${insertedRows} ${uploadType} rows through Store 360.`,
    relatedType: 'upload_batch',
    relatedId: batchId,
    storeId: context.params.storeId,
    metadata: {
      uploadType,
      type: uploadType,
      fileName,
      rowCount: insertedRows,
      validCount: insertedRows,
      invalidCount: rows.length - insertedRows,
      storeOwnerId: rowText(store, 'owner_id'),
    },
  });

  return NextResponse.json({
    ok: true,
    batchId,
    total: rows.length,
    valid: insertedRows,
    invalid: rows.length - insertedRows,
    message: `Imported ${insertedRows} ${uploadType} rows.`,
    summary: { inserted: insertedRows, skipped: rows.length - insertedRows, failed: 0 },
    batch,
  });
}
