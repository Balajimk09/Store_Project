import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type SupabaseRouteClient = ReturnType<typeof createRouteClient>;

type SaveFailureReason =
  | 'unauthorized'
  | 'invalid_store'
  | 'invalid_source'
  | 'missing_upc'
  | 'missing_item_name'
  | 'duplicate_upc'
  | 'insert_failed';

type ExistingProductSummary = {
  id: string;
  upc: string;
  item_name: string | null;
};

type ProductInsert = {
  store_id: string;
  batch_id: null;
  upc: string;
  item_name: string;
  category: string;
  brand: string;
  cost_price: number;
  selling_price: number;
  stock: number;
  reorder_level: number;
  vendor: string | null;
  department: string | null;
  sku: null;
  tax_rate: number;
  tax_category: string;
  taxable: boolean;
  is_active: true;
  notes: string;
  ebt_eligible: boolean;
  units_per_case: number;
  cases_on_hand: number;
  loose_units: number;
  plu: string | null;
  product_code: string | null;
  age_verification: boolean;
  minimum_age: number | null;
  age_restriction_type: string | null;
  updated_at: string;
};

function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // This route does not need to persist refreshed auth cookies.
        },
      },
    }
  );
}

function jsonFailure(
  reason: SaveFailureReason,
  message: string,
  status = 400,
  extra?: { existingProduct?: ExistingProductSummary }
) {
  return NextResponse.json({ ok: false, reason, message, ...(extra ?? {}) }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: unknown) {
  return String(value ?? '').trim();
}

function toNullableString(value: unknown) {
  const text = toTrimmedString(value);
  return text || null;
}

function toNumber(value: unknown, fallback: number) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/[$,%]/g, '').trim();
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const text = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', '1'].includes(text)) return true;
  if (['false', 'no', '0'].includes(text)) return false;
  return fallback;
}

function toNullableInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : null;
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const formatted = [
      record.message,
      record.details,
      record.hint,
      record.code ? `Code: ${record.code}` : null,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ');

    if (formatted) return formatted;
  }
  return String(error || 'Unknown error');
}

function postgresCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }

  return null;
}

function isDuplicateUpcError(error: unknown) {
  if (postgresCode(error) === '23505') return true;
  return formatError(error).toLowerCase().includes('products_store_id_upc_unique');
}

async function requireOwnedStore(client: SupabaseRouteClient, storeId: string, userId: string) {
  const { data, error } = await client
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

function sourceIdsFrom(sourceRef: Record<string, unknown>) {
  const value = sourceRef.pos_plu_sale_ids;
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(value.map((item) => toTrimmedString(item)).filter(Boolean)));
}

export async function POST(request: NextRequest) {
  const client = createRouteClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user) {
    return jsonFailure('unauthorized', 'You must be signed in.', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonFailure('insert_failed', 'Invalid request body.');
  }

  if (!isRecord(body)) {
    return jsonFailure('insert_failed', 'Invalid request body.');
  }

  const storeId = toTrimmedString(body.storeId);
  const sourceType = toTrimmedString(body.sourceType);
  const candidateKey = toTrimmedString(body.candidateKey);
  const sourceRef = isRecord(body.sourceRef) ? body.sourceRef : null;
  const product = isRecord(body.product) ? body.product : null;

  if (!storeId) return jsonFailure('invalid_store', 'Invalid store.');
  if (!product) return jsonFailure('insert_failed', 'Product data is required.');
  if (!candidateKey) return jsonFailure('invalid_source', 'Invalid source.');
  if (sourceType !== 'pos_import') return jsonFailure('invalid_source', 'Invalid source.');
  if (!sourceRef) return jsonFailure('invalid_source', 'Invalid POS source.');

  const posPluSaleIds = sourceIdsFrom(sourceRef);
  if (posPluSaleIds.length === 0) {
    return jsonFailure('invalid_source', 'Invalid POS source.');
  }

  try {
    const hasAccess = await requireOwnedStore(client, storeId, user.id);
    if (!hasAccess) {
      return jsonFailure('invalid_store', 'Invalid store.', 403);
    }

    const { data: validSourceRow, error: sourceError } = await client
      .from('pos_plu_sales')
      .select('id')
      .eq('store_id', storeId)
      .in('id', posPluSaleIds)
      .limit(1)
      .maybeSingle();

    if (sourceError) throw sourceError;
    if (!validSourceRow) {
      return jsonFailure('invalid_source', 'Invalid POS source.');
    }

    const upc = toTrimmedString(product.upc);
    const itemName = toTrimmedString(product.item_name);

    if (!upc) {
      return jsonFailure('missing_upc', 'UPC is required before saving this product.');
    }

    if (!itemName) {
      return jsonFailure('missing_item_name', 'Item name is required before saving this product.');
    }

    const { data: existingProduct, error: duplicateError } = await client
      .from('products')
      .select('id, upc, item_name')
      .eq('store_id', storeId)
      .eq('upc', upc)
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (existingProduct) {
      return jsonFailure('duplicate_upc', 'A product with this UPC already exists for this store.', 409, {
        existingProduct: existingProduct as ExistingProductSummary,
      });
    }

    const ageVerification = toBoolean(product.age_verification, false);
    const insertRow: ProductInsert = {
      store_id: storeId,
      batch_id: null,
      upc,
      item_name: itemName,
      category: toTrimmedString(product.category) || 'Uncategorized',
      brand: toTrimmedString(product.brand) || 'Unknown',
      cost_price: toNumber(product.cost_price, 0),
      selling_price: toNumber(product.selling_price, 0),
      stock: toNumber(product.stock, 0),
      reorder_level: toNumber(product.reorder_level, 10),
      vendor: toNullableString(product.vendor),
      department: toNullableString(product.department),
      sku: null,
      tax_rate: toNumber(product.tax_rate, 0),
      tax_category: toTrimmedString(product.tax_category) || 'standard',
      taxable: toBoolean(product.taxable, true),
      is_active: true,
      notes: toTrimmedString(product.notes) || 'Discovered from POS PLU report',
      ebt_eligible: toBoolean(product.ebt_eligible, false),
      units_per_case: toNumber(product.units_per_case, 1),
      cases_on_hand: toNumber(product.cases_on_hand, 0),
      loose_units: toNumber(product.loose_units, 0),
      plu: toNullableString(product.plu),
      product_code: toNullableString(product.product_code),
      age_verification: ageVerification,
      minimum_age: ageVerification ? toNullableInteger(product.minimum_age) : null,
      age_restriction_type: ageVerification ? toNullableString(product.age_restriction_type) : null,
      updated_at: new Date().toISOString(),
    };

    const { data: insertedProduct, error: insertError } = await client
      .from('products')
      .insert(insertRow)
      .select('id, upc, item_name')
      .single();

    if (insertError) {
      if (isDuplicateUpcError(insertError)) {
        return jsonFailure('duplicate_upc', 'A product with this UPC already exists for this store.', 409);
      }

      throw insertError;
    }

    return NextResponse.json({
      ok: true,
      inserted: insertedProduct as ExistingProductSummary,
    });
  } catch (error) {
    console.error('[New Product Save Error]', error);
    return jsonFailure('insert_failed', formatError(error), 500);
  }
}
