import {
  CanonicalProductCatalogReadError,
  canonicalProductPageCount,
  normalizeCanonicalProductFacets,
  normalizeCanonicalProductMetrics,
  normalizeCanonicalProductRow,
  parseCanonicalProductCatalogQuery,
} from '@/lib/pos/canonical-product-catalog-read-model.mjs';
import { createSupabaseRouteClient } from '@/lib/supabase-route-auth';

export const runtime = 'nodejs';

function failure(route: ReturnType<typeof createSupabaseRouteClient>, errorCode: 'unauthorized' | 'invalid_query' | 'forbidden' | 'catalog_unavailable') {
  const status = errorCode === 'unauthorized' ? 401 : errorCode === 'invalid_query' ? 400 : errorCode === 'forbidden' ? 403 : 500;
  return route.json({ ok: false, error_code: errorCode }, { status });
}

export async function GET(request: Request) {
  const route = createSupabaseRouteClient();
  const { client: routeClient } = route;
  const { data: { user }, error: userError } = await routeClient.auth.getUser();
  if (userError || !user) return failure(route, 'unauthorized');

  let query;
  try {
    query = parseCanonicalProductCatalogQuery(new URL(request.url).searchParams);
  } catch (error) {
    if (error instanceof CanonicalProductCatalogReadError) return failure(route, 'invalid_query');
    return failure(route, 'catalog_unavailable');
  }

  try {
    const { data: store, error: storeError } = await routeClient
      .from('stores')
      .select('id')
      .eq('id', query.storeId)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return failure(route, 'forbidden');

    const filters = {
      p_store_id: query.storeId,
      p_search: query.search,
      p_department: query.department,
      p_vendor: query.vendor,
      p_stock_status: query.stock,
      p_min_price: query.minPrice,
      p_max_price: query.maxPrice,
      p_ebt_only: query.ebtOnly,
      p_age_restricted_only: query.ageRestrictedOnly,
      p_taxable_only: query.taxableOnly,
      p_active_status: query.active,
    };
    const [catalogResult, countResult, metricsResult, facetsResult] = await Promise.all([
      routeClient.rpc('read_store_canonical_product_catalog', {
        ...filters,
        p_offset: query.offset,
        p_limit: query.pageSize,
      }),
      routeClient.rpc('count_store_canonical_product_catalog', filters),
      routeClient.rpc('read_store_canonical_product_catalog_metrics', { p_store_id: query.storeId }),
      routeClient.rpc('read_store_canonical_product_catalog_facets', { p_store_id: query.storeId }),
    ]);
    if (catalogResult.error || countResult.error || metricsResult.error || facetsResult.error) {
      throw catalogResult.error || countResult.error || metricsResult.error || facetsResult.error;
    }

    const catalogRows = catalogResult.data || [];
    const products = catalogRows.map(normalizeCanonicalProductRow);
    const metrics = normalizeCanonicalProductMetrics(metricsResult.data?.[0]);
    const total = Number(countResult.data || 0);
    return route.json({
      ok: true,
      products,
      metrics,
      facets: normalizeCanonicalProductFacets(facetsResult.data),
      pagination: {
        page: query.page,
        page_size: query.pageSize,
        total,
        total_pages: canonicalProductPageCount(total, query.pageSize),
      },
    });
  } catch {
    return failure(route, 'catalog_unavailable');
  }
}
