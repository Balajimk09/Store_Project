import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import {
  COMMANDER_MASTER_DATA_SOURCE_SYSTEM,
  SourceMasterDataReadError,
  buildSourceMasterDataReview,
  normalizeSourceMasterDataProductCodes,
  parseSourceMasterDataQuery,
  sourceMasterDataPageCount,
} from '@/lib/pos/source-master-data-read-model.mjs';

export const runtime = 'nodejs';

function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {
          // Read-only source master-data access never refreshes cookies from this route.
        },
      },
    },
  );
}

function errorResponse(errorCode: 'unauthorized' | 'invalid_store' | 'invalid_query' | 'forbidden' | 'master_data_unavailable') {
  const status = errorCode === 'unauthorized' ? 401 : errorCode === 'forbidden' ? 403 : errorCode === 'invalid_store' || errorCode === 'invalid_query' ? 400 : 500;
  return NextResponse.json({ ok: false, error_code: errorCode }, { status });
}

async function requireOwnedStore(client: ReturnType<typeof createRouteClient>, storeId: string, userId: string) {
  const { data, error } = await client.from('stores').select('id').eq('id', storeId).eq('owner_id', userId).maybeSingle();
  if (error) throw new SourceMasterDataReadError('master_data_unavailable');
  if (!data) throw new SourceMasterDataReadError('forbidden');
}

function currentRunScope<T>(query: T, runId: string) {
  const scoped = query as T & { eq: (column: string, value: string | boolean) => T };
  return (scoped.eq('last_master_data_run_id', runId) as T & { eq: (column: string, value: string | boolean) => T })
    .eq('is_present', true);
}

export async function GET(request: Request) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return errorResponse('unauthorized');

  try {
    const filters = parseSourceMasterDataQuery(new URL(request.url).searchParams);
    await requireOwnedStore(client, filters.storeId, user.id);

    const { data: latestRun, error: runError } = await client
      .from('pos_catalog_source_master_data_runs')
      .select('id,source_system,collected_at,department_count,category_count,product_code_count,tax_definition_count,age_validation_count,restrictions_available,age_validation_available,age_service_available,restrictions_summary')
      .eq('store_id', filters.storeId)
      .eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM)
      .order('collected_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) throw new SourceMasterDataReadError('master_data_unavailable');
    if (!latestRun) return NextResponse.json({ ok: true, available: false });

    const offset = (filters.page - 1) * filters.pageSize;
    let productCodeQuery = currentRunScope(
      client.from('pos_catalog_source_product_codes').select('source_product_code_key,source_name,is_not_sold,is_fuel', { count: 'exact' }).eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM),
      latestRun.id,
    );
    if (filters.search !== null) {
      const pattern = `%${filters.search}%`;
      productCodeQuery = productCodeQuery.or(`source_product_code_key.ilike.${pattern},source_name.ilike.${pattern}`);
    }

    const [categoriesResponse, productCodeMapResponse, departmentsResponse, taxesResponse, ageValidationsResponse, ageServiceResponse, taxLinksResponse, ageLinksResponse, productCodesResponse] = await Promise.all([
      currentRunScope(client.from('pos_catalog_source_categories').select('source_category_key,source_name').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM), latestRun.id).order('source_name'),
      currentRunScope(client.from('pos_catalog_source_product_codes').select('source_product_code_key,source_name,is_not_sold,is_fuel').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM), latestRun.id).order('source_product_code_key'),
      currentRunScope(client.from('pos_catalog_source_department_definitions').select('source_department_key,source_name,source_category_key,source_product_code_key').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM), latestRun.id).order('source_name'),
      currentRunScope(client.from('pos_catalog_source_tax_definitions').select('source_tax_key,source_name,source_rate').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM), latestRun.id).order('source_name'),
      currentRunScope(client.from('pos_catalog_source_age_validations').select('source_age_validation_key,source_name,source_min_age').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM), latestRun.id).order('source_name'),
      currentRunScope(client.from('pos_catalog_source_age_service_settings').select('enabled').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM), latestRun.id).limit(1).maybeSingle(),
      client.from('pos_catalog_source_department_tax_links').select('source_department_key,source_tax_key').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM).eq('master_data_run_id', latestRun.id),
      client.from('pos_catalog_source_department_age_validation_links').select('source_department_key,source_age_validation_key').eq('store_id', filters.storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM).eq('master_data_run_id', latestRun.id),
      productCodeQuery.order('source_product_code_key').range(offset, offset + filters.pageSize - 1),
    ]);

    for (const response of [categoriesResponse, productCodeMapResponse, departmentsResponse, taxesResponse, ageValidationsResponse, ageServiceResponse, taxLinksResponse, ageLinksResponse, productCodesResponse]) {
      if (response.error) throw new SourceMasterDataReadError('master_data_unavailable');
    }

    const review = buildSourceMasterDataReview({
      latestRun,
      categories: categoriesResponse.data ?? [],
      productCodes: productCodeMapResponse.data ?? [],
      departments: departmentsResponse.data ?? [],
      taxes: taxesResponse.data ?? [],
      ageValidations: ageValidationsResponse.data ?? [],
      ageServiceSetting: ageServiceResponse.data,
      departmentTaxLinks: taxLinksResponse.data ?? [],
      departmentAgeValidationLinks: ageLinksResponse.data ?? [],
      productCodeTotal: latestRun.product_code_count,
    });
    const productCodes = normalizeSourceMasterDataProductCodes(productCodesResponse.data ?? []);

    return NextResponse.json({
      ok: true,
      available: true,
      ...review,
      product_codes: productCodes,
      product_code_pagination: {
        page: filters.page,
        page_size: filters.pageSize,
        total: productCodesResponse.count ?? 0,
        total_pages: sourceMasterDataPageCount(productCodesResponse.count ?? 0, filters.pageSize),
      },
    });
  } catch (error) {
    if (error instanceof SourceMasterDataReadError) return errorResponse(error.code as Parameters<typeof errorResponse>[0]);
    console.error('[Source master data] Read failed.');
    return errorResponse('master_data_unavailable');
  }
}
