import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type SupabaseRouteClient = ReturnType<typeof createRouteClient>;
type CandidateStatus = 'ready_to_add' | 'missing_upc' | 'duplicate_found' | 'price_conflict';

type PosPluSaleRow = {
  id: string;
  report_period_id: string;
  report_file_id: string | null;
  plu_raw: string | null;
  plu_normalized: string | null;
  upc_normalized: string | null;
  description: string | null;
  unit_price: number | string | null;
  items_sold: number | string | null;
  total_sales: number | string | null;
  promotion_id: string | null;
  period_open: string | null;
  period_close: string | null;
  created_at: string;
};

type ExistingProductRow = {
  id: string;
  upc: string;
  item_name: string | null;
  selling_price: number | string | null;
  plu: string | null;
  product_code: string | null;
};

type SourceRef = {
  candidateKey: string;
  pos_plu_sale_ids: string[];
  report_period_ids: string[];
  report_file_ids: string[];
  pos_plu_sale_count: number;
  report_period_count: number;
  report_file_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type DraftProduct = {
  upc: string;
  item_name: string;
  category: string;
  department: string;
  brand: string;
  cost_price: number;
  selling_price: number;
  stock: number;
  reorder_level: number;
  vendor: string;
  tax_rate: number;
  tax_category: string;
  taxable: boolean;
  ebt_eligible: boolean;
  units_per_case: number;
  cases_on_hand: number;
  loose_units: number;
  plu: string;
  product_code: string;
  age_verification: boolean;
  minimum_age: number | null;
  age_restriction_type: string | null;
  notes: string;
};

type ProductCandidate = {
  sourceType: 'pos_import';
  sourceRef: SourceRef;
  candidateKey: string;
  pluRaw: string | null;
  pluNormalized: string | null;
  upcNormalized: string | null;
  description: string | null;
  unitPrice: number;
  timesSold: number;
  totalRevenue: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latestImport: string | null;
  promotionId: string | null;
  confidenceScore: number;
  status: CandidateStatus;
  existingProduct: ExistingProductRow | null;
  priceConflict: {
    posPrice: number;
    existingPrice: number;
    percentDifference: number;
  } | null;
  draftProduct: DraftProduct;
};

type CandidateAggregate = {
  candidateKey: string;
  posPluSaleIds: string[];
  reportPeriodIds: string[];
  reportFileIds: string[];
  reportPeriodSet: Set<string>;
  reportFileSet: Set<string>;
  posPluSaleCount: number;
  pluRaw: string | null;
  pluNormalized: string | null;
  upcNormalized: string | null;
  description: string | null;
  unitPriceLatest: number | null;
  unitPriceMax: number | null;
  timesSold: number;
  totalRevenue: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latestImport: string | null;
  promotionId: string | null;
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
          // This read-only endpoint does not need to persist refreshed auth cookies.
        },
      },
    }
  );
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
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

function cleanText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[$,%]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/[$,%]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDescriptionKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMatchKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function candidateKeyFor(row: PosPluSaleRow) {
  const upc = cleanText(row.upc_normalized);
  if (upc) return `upc:${upc}`;

  const plu = cleanText(row.plu_normalized) || cleanText(row.plu_raw);
  if (plu) return `plu:${plu}`;

  const description = cleanText(row.description);
  if (description) {
    const normalized = normalizeDescriptionKey(description);
    if (normalized) return `name:${normalized}`;
  }

  return `unknown:${row.id}`;
}

function timeValue(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function earliest(current: string | null, next: string | null) {
  const currentTime = timeValue(current);
  const nextTime = timeValue(next);
  if (nextTime === null) return current;
  if (currentTime === null || nextTime < currentTime) return next;
  return current;
}

function latest(current: string | null, next: string | null) {
  const currentTime = timeValue(current);
  const nextTime = timeValue(next);
  if (nextTime === null) return current;
  if (currentTime === null || nextTime > currentTime) return next;
  return current;
}

function addCappedUnique(target: string[], seen: Set<string>, value: string | null) {
  const clean = cleanText(value);
  if (!clean || seen.has(clean)) return;
  seen.add(clean);
  if (target.length < 25) target.push(clean);
}

function confidenceScore(candidate: {
  upcNormalized: string | null;
  description: string | null;
  unitPrice: number;
  pluRaw: string | null;
  pluNormalized: string | null;
}) {
  if (candidate.upcNormalized && candidate.description && candidate.unitPrice > 0) return 90;
  if (candidate.upcNormalized) return 70;
  if (candidate.description) return 50;
  if (candidate.pluNormalized || candidate.pluRaw) return 30;
  return 0;
}

function statusRank(status: CandidateStatus) {
  return status === 'ready_to_add' ? 0 : status === 'price_conflict' ? 1 : status === 'missing_upc' ? 2 : 3;
}

function buildProductMaps(products: ExistingProductRow[]) {
  const byUpc = new Map<string, ExistingProductRow>();
  const byCode = new Map<string, ExistingProductRow>();

  for (const product of products) {
    const upc = normalizeMatchKey(product.upc);
    if (upc && !byUpc.has(upc)) byUpc.set(upc, product);

    const plu = normalizeMatchKey(product.plu);
    if (plu && !byCode.has(plu)) byCode.set(plu, product);

    const productCode = normalizeMatchKey(product.product_code);
    if (productCode && !byCode.has(productCode)) byCode.set(productCode, product);
  }

  return { byUpc, byCode };
}

function findExistingProduct(
  aggregate: CandidateAggregate,
  productsByUpc: Map<string, ExistingProductRow>,
  productsByCode: Map<string, ExistingProductRow>
) {
  const upc = normalizeMatchKey(aggregate.upcNormalized);
  if (upc) {
    const match = productsByUpc.get(upc);
    if (match) return match;
  }

  const pluNormalized = normalizeMatchKey(aggregate.pluNormalized);
  if (pluNormalized) {
    const match = productsByCode.get(pluNormalized);
    if (match) return match;
  }

  const pluRaw = normalizeMatchKey(aggregate.pluRaw);
  if (pluRaw) {
    const match = productsByCode.get(pluRaw);
    if (match) return match;
  }

  return null;
}

function buildCandidates(posRows: PosPluSaleRow[], products: ExistingProductRow[]) {
  const aggregateMap = new Map<string, CandidateAggregate>();

  for (const row of posRows) {
    const candidateKey = candidateKeyFor(row);
    const existing = aggregateMap.get(candidateKey);
    const unitPrice = nullableNumber(row.unit_price);
    const firstSeenCandidate = row.period_open || row.created_at || null;
    const lastSeenCandidate = row.period_close || row.created_at || null;

    if (existing) {
      existing.posPluSaleCount += 1;
      addCappedUnique(existing.posPluSaleIds, new Set(existing.posPluSaleIds), row.id);
      addCappedUnique(existing.reportPeriodIds, existing.reportPeriodSet, row.report_period_id);
      addCappedUnique(existing.reportFileIds, existing.reportFileSet, row.report_file_id);
      existing.timesSold += numberValue(row.items_sold);
      existing.totalRevenue += numberValue(row.total_sales);
      existing.firstSeenAt = earliest(existing.firstSeenAt, firstSeenCandidate);
      existing.lastSeenAt = latest(existing.lastSeenAt, lastSeenCandidate);
      existing.latestImport = latest(existing.latestImport, row.created_at);

      if (!existing.description) existing.description = cleanText(row.description);
      if (!existing.pluRaw) existing.pluRaw = cleanText(row.plu_raw);
      if (!existing.pluNormalized) existing.pluNormalized = cleanText(row.plu_normalized);
      if (!existing.upcNormalized) existing.upcNormalized = cleanText(row.upc_normalized);
      if (!existing.promotionId) existing.promotionId = cleanText(row.promotion_id);
      if (unitPrice !== null) {
        if (existing.unitPriceLatest === null) existing.unitPriceLatest = unitPrice;
        existing.unitPriceMax = Math.max(existing.unitPriceMax ?? unitPrice, unitPrice);
      }
      continue;
    }

    const reportPeriodSet = new Set<string>();
    const reportFileSet = new Set<string>();
    const posPluSaleIds: string[] = [];
    const reportPeriodIds: string[] = [];
    const reportFileIds: string[] = [];
    addCappedUnique(posPluSaleIds, new Set(posPluSaleIds), row.id);
    addCappedUnique(reportPeriodIds, reportPeriodSet, row.report_period_id);
    addCappedUnique(reportFileIds, reportFileSet, row.report_file_id);

    aggregateMap.set(candidateKey, {
      candidateKey,
      posPluSaleIds,
      reportPeriodIds,
      reportFileIds,
      reportPeriodSet,
      reportFileSet,
      posPluSaleCount: 1,
      pluRaw: cleanText(row.plu_raw),
      pluNormalized: cleanText(row.plu_normalized),
      upcNormalized: cleanText(row.upc_normalized),
      description: cleanText(row.description),
      unitPriceLatest: unitPrice,
      unitPriceMax: unitPrice,
      timesSold: numberValue(row.items_sold),
      totalRevenue: numberValue(row.total_sales),
      firstSeenAt: firstSeenCandidate,
      lastSeenAt: lastSeenCandidate,
      latestImport: row.created_at || null,
      promotionId: cleanText(row.promotion_id),
    });
  }

  const { byUpc, byCode } = buildProductMaps(products);
  const candidates = Array.from(aggregateMap.values()).map((aggregate): ProductCandidate => {
    const unitPrice = aggregate.unitPriceLatest ?? aggregate.unitPriceMax ?? 0;
    const existingProduct = findExistingProduct(aggregate, byUpc, byCode);
    let status: CandidateStatus = existingProduct ? 'duplicate_found' : aggregate.upcNormalized ? 'ready_to_add' : 'missing_upc';
    let priceConflict: ProductCandidate['priceConflict'] = null;

    if (existingProduct) {
      const existingPrice = numberValue(existingProduct.selling_price);
      const posPrice = unitPrice;
      if (existingPrice > 0 && posPrice > 0) {
        const percentDifference = Math.abs(posPrice - existingPrice) / existingPrice;
        if (percentDifference > 0.1) {
          status = 'price_conflict';
          priceConflict = { posPrice, existingPrice, percentDifference };
        }
      }
    }

    const draftProduct: DraftProduct = {
      upc: aggregate.upcNormalized || '',
      item_name: aggregate.description || '',
      category: 'Uncategorized',
      department: '',
      brand: 'Unknown',
      cost_price: 0,
      selling_price: unitPrice,
      stock: 0,
      reorder_level: 10,
      vendor: '',
      tax_rate: 0,
      tax_category: 'standard',
      taxable: true,
      ebt_eligible: false,
      units_per_case: 1,
      cases_on_hand: 0,
      loose_units: 0,
      plu: aggregate.pluRaw || aggregate.pluNormalized || '',
      product_code: aggregate.pluNormalized || aggregate.pluRaw || '',
      age_verification: false,
      minimum_age: null,
      age_restriction_type: null,
      notes: 'Discovered from POS PLU report',
    };

    return {
      sourceType: 'pos_import',
      sourceRef: {
        candidateKey: aggregate.candidateKey,
        pos_plu_sale_ids: aggregate.posPluSaleIds,
        report_period_ids: aggregate.reportPeriodIds,
        report_file_ids: aggregate.reportFileIds,
        pos_plu_sale_count: aggregate.posPluSaleCount,
        report_period_count: aggregate.reportPeriodSet.size,
        report_file_count: aggregate.reportFileSet.size,
        first_seen_at: aggregate.firstSeenAt,
        last_seen_at: aggregate.lastSeenAt,
      },
      candidateKey: aggregate.candidateKey,
      pluRaw: aggregate.pluRaw,
      pluNormalized: aggregate.pluNormalized,
      upcNormalized: aggregate.upcNormalized,
      description: aggregate.description,
      unitPrice,
      timesSold: aggregate.timesSold,
      totalRevenue: aggregate.totalRevenue,
      firstSeenAt: aggregate.firstSeenAt,
      lastSeenAt: aggregate.lastSeenAt,
      latestImport: aggregate.latestImport,
      promotionId: aggregate.promotionId,
      confidenceScore: confidenceScore({
        upcNormalized: aggregate.upcNormalized,
        description: aggregate.description,
        unitPrice,
        pluRaw: aggregate.pluRaw,
        pluNormalized: aggregate.pluNormalized,
      }),
      status,
      existingProduct,
      priceConflict,
      draftProduct,
    };
  });

  candidates.sort((a, b) => {
    const statusDifference = statusRank(a.status) - statusRank(b.status);
    if (statusDifference !== 0) return statusDifference;
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    return b.timesSold - a.timesSold;
  });

  return candidates;
}

function countsFor(candidates: ProductCandidate[]) {
  const readyToAdd = candidates.filter((candidate) => candidate.status === 'ready_to_add').length;
  const missingUpc = candidates.filter((candidate) => candidate.status === 'missing_upc').length;
  const duplicateFound = candidates.filter((candidate) => candidate.status === 'duplicate_found').length;
  const priceConflict = candidates.filter((candidate) => candidate.status === 'price_conflict').length;

  return {
    total: candidates.length,
    readyToAdd,
    missingUpc,
    duplicateFound,
    priceConflict,
    needsReview: missingUpc + priceConflict,
  };
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

export async function GET(request: NextRequest) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return jsonError('You must be signed in.', 401);

  const storeId = request.nextUrl.searchParams.get('storeId') || '';
  if (!storeId) return jsonError('storeId is required.', 400);

  try {
    const hasAccess = await requireOwnedStore(client, storeId, user.id);
    if (!hasAccess) return jsonError('Store not found or you do not have access.', 403);

    const [posResult, productsResult] = await Promise.all([
      client
        .from('pos_plu_sales')
        .select('id, report_period_id, report_file_id, plu_raw, plu_normalized, upc_normalized, description, unit_price, items_sold, total_sales, promotion_id, period_open, period_close, created_at')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(5000),
      client
        .from('products')
        .select('id, upc, item_name, selling_price, plu, product_code')
        .eq('store_id', storeId),
    ]);

    if (posResult.error) throw posResult.error;
    if (productsResult.error) throw productsResult.error;

    const candidates = buildCandidates(
      (posResult.data || []) as PosPluSaleRow[],
      (productsResult.data || []) as ExistingProductRow[]
    );

    return NextResponse.json({
      ok: true,
      candidates,
      counts: countsFor(candidates),
    });
  } catch (error) {
    console.error('[New Products Discovery Error]', error);
    return jsonError(formatError(error), 500);
  }
}
