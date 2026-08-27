import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import {
  SourceMasterDataMappingError,
  parseCommanderMasterDataMappingRequest,
} from '@/lib/pos/source-master-data-mapping.mjs';
import { COMMANDER_MASTER_DATA_SOURCE_SYSTEM } from '@/lib/pos/source-master-data-read-model.mjs';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type SafeErrorCode = 'unauthorized' | 'forbidden' | 'invalid_request' | 'master_data_unavailable' | 'master_data_review_stale' | 'master_data_mapping_invalid' | 'master_data_mapping_restriction_type_required' | 'master_data_mapping_dependency_missing' | 'master_data_mapping_target_invalid' | 'master_data_mapping_source_invalid' | 'master_data_mapping_relationship_ambiguous';

function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {
          // This API never writes session cookies.
        },
      },
    },
  );
}

function createServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function errorResponse(errorCode: SafeErrorCode) {
  const status = errorCode === 'unauthorized' ? 401
    : errorCode === 'forbidden' ? 403
      : errorCode === 'master_data_review_stale' ? 409
        : errorCode === 'invalid_request' || errorCode.startsWith('master_data_mapping_') ? 400
          : 500;
  return NextResponse.json({ ok: false, error_code: errorCode }, { status });
}

async function requireOwnedStore(client: ReturnType<typeof createRouteClient>, storeId: string, userId: string) {
  const { data, error } = await client.from('stores').select('id').eq('id', storeId).eq('owner_id', userId).maybeSingle();
  if (error) throw new SourceMasterDataMappingError('master_data_unavailable');
  if (!data) throw new SourceMasterDataMappingError('forbidden');
}

async function requireCurrentRun(client: ReturnType<typeof createRouteClient>, storeId: string, masterDataRunId: string) {
  const { data, error } = await client
    .from('pos_catalog_source_master_data_runs')
    .select('id')
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM)
    .order('collected_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new SourceMasterDataMappingError('master_data_unavailable');
  if (data.id !== masterDataRunId) throw new SourceMasterDataMappingError('master_data_review_stale');
}

function parseMappingReadQuery(searchParams: URLSearchParams) {
  const allowed = new Set(['storeId', 'masterDataRunId']);
  for (const key of searchParams.keys()) if (!allowed.has(key)) throw new SourceMasterDataMappingError('invalid_request');
  const storeId = searchParams.get('storeId');
  const masterDataRunId = searchParams.get('masterDataRunId');
  if (!storeId || !masterDataRunId || !UUID.test(storeId) || !UUID.test(masterDataRunId)) {
    throw new SourceMasterDataMappingError('invalid_request');
  }
  return { storeId: storeId.toLowerCase(), masterDataRunId: masterDataRunId.toLowerCase() };
}

function safeRpcErrorCode(value: unknown): SafeErrorCode {
  const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : '';
  const codes: SafeErrorCode[] = [
    'master_data_review_stale',
    'master_data_mapping_invalid',
    'master_data_mapping_restriction_type_required',
    'master_data_mapping_dependency_missing',
    'master_data_mapping_target_invalid',
    'master_data_mapping_source_invalid',
    'master_data_mapping_relationship_ambiguous',
    'forbidden',
  ];
  return codes.find((code) => message.includes(code)) ?? 'master_data_unavailable';
}

function nonNegativeCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;
}

export async function GET(request: Request) {
  const routeClient = createRouteClient();
  const { data: { user }, error: userError } = await routeClient.auth.getUser();
  if (userError || !user) return errorResponse('unauthorized');
  try {
    const { storeId, masterDataRunId } = parseMappingReadQuery(new URL(request.url).searchParams);
    await requireOwnedStore(routeClient, storeId, user.id);
    await requireCurrentRun(routeClient, storeId, masterDataRunId);
    const serviceClient = createServiceClient();
    if (!serviceClient) throw new SourceMasterDataMappingError('master_data_unavailable');

    const [mappings, taxes, ages, departments, categories] = await Promise.all([
      serviceClient.from('pos_catalog_source_master_data_mappings')
        .select('entity_type,source_key,source_context_key,status,canonical_tax_category_id,canonical_age_restriction_id,canonical_department_id,canonical_category_id')
        .eq('store_id', storeId).eq('source_system', COMMANDER_MASTER_DATA_SOURCE_SYSTEM),
      serviceClient.from('tax_categories').select('id,name,rate').eq('store_id', storeId).order('name'),
      serviceClient.from('store_age_restriction_presets').select('id,name,minimum_age,restriction_type').eq('store_id', storeId).order('name'),
      serviceClient.from('store_departments').select('id,name,tax_category_id,age_restriction_id').eq('store_id', storeId).order('name'),
      serviceClient.from('store_categories').select('id,name,department_id').eq('store_id', storeId).order('name'),
    ]);
    if (mappings.error || taxes.error || ages.error || departments.error || categories.error) {
      throw new SourceMasterDataMappingError('master_data_unavailable');
    }
    return NextResponse.json({
      ok: true,
      master_data_run_id: masterDataRunId,
      mappings: mappings.data ?? [],
      canonical_targets: {
        taxes: taxes.data ?? [],
        age_validations: ages.data ?? [],
        departments: departments.data ?? [],
        categories: categories.data ?? [],
      },
    });
  } catch (error) {
    if (error instanceof SourceMasterDataMappingError) return errorResponse(error.code as SafeErrorCode);
    console.error('[Source master data mappings] Read failed.');
    return errorResponse('master_data_unavailable');
  }
}

export async function POST(request: Request) {
  const routeClient = createRouteClient();
  const { data: { user }, error: userError } = await routeClient.auth.getUser();
  if (userError || !user) return errorResponse('unauthorized');
  try {
    const requestBody = await request.json();
    const mutation = parseCommanderMasterDataMappingRequest(requestBody);
    await requireOwnedStore(routeClient, mutation.storeId, user.id);
    await requireCurrentRun(routeClient, mutation.storeId, mutation.masterDataRunId);
    const serviceClient = createServiceClient();
    if (!serviceClient) throw new SourceMasterDataMappingError('master_data_unavailable');
    const { data, error } = await serviceClient.rpc('promote_commander_master_data_mappings', {
      p_store_id: mutation.storeId,
      p_master_data_run_id: mutation.masterDataRunId,
      p_actor_id: user.id,
      p_requests: mutation.requests,
    });
    if (error || !Array.isArray(data) || data.length !== 1) return errorResponse(safeRpcErrorCode(error));
    const result = data[0] as { created_count?: unknown; mapped_count?: unknown; ignored_count?: unknown };
    const createdCount = nonNegativeCount(result.created_count);
    const mappedCount = nonNegativeCount(result.mapped_count);
    const ignoredCount = nonNegativeCount(result.ignored_count);
    if (createdCount === null || mappedCount === null || ignoredCount === null) return errorResponse('master_data_unavailable');
    return NextResponse.json({ ok: true, created_count: createdCount, mapped_count: mappedCount, ignored_count: ignoredCount });
  } catch (error) {
    if (error instanceof SourceMasterDataMappingError) return errorResponse(error.code as SafeErrorCode);
    console.error('[Source master data mappings] Promotion failed.');
    return errorResponse('master_data_unavailable');
  }
}
