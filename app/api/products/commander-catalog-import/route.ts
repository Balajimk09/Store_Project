import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  CommanderCatalogProductImportError,
  executeCommanderCatalogProductImport,
  readBoundedCommanderCatalogProductImportJson,
} from '@/lib/pos/commander-catalog-product-import.mjs';

export const runtime = 'nodejs';

function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
}

function errorResponse(errorCode: string) {
  const status = errorCode === 'unauthorized' ? 401
    : errorCode === 'catalog_promotion_forbidden' ? 403
      : errorCode === 'invalid_action' ? 400
        : errorCode === 'catalog_review_stale' || errorCode === 'catalog_promotion_master_data_unavailable' || errorCode === 'catalog_import_no_progress' || errorCode === 'catalog_import_batch_limit' ? 409
          : 500;
  return NextResponse.json({ ok: false, error_code: errorCode }, { status });
}

async function requireAuthorizedCommanderCatalogRun(
  client: ReturnType<typeof createRouteClient>,
  catalogSyncRunId: string,
  userId: string,
) {
  const { data: run, error: runError } = await client
    .from('pos_catalog_sync_runs')
    .select('store_id')
    .eq('id', catalogSyncRunId)
    .eq('source_system', 'commander')
    .maybeSingle();
  if (runError) throw new CommanderCatalogProductImportError('promotion_unavailable', 'authorization');
  if (!run) throw new CommanderCatalogProductImportError('catalog_promotion_forbidden', 'authorization');

  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id')
    .eq('id', run.store_id)
    .eq('owner_id', userId)
    .maybeSingle();
  if (storeError) throw new CommanderCatalogProductImportError('promotion_unavailable', 'authorization');
  if (!store) throw new CommanderCatalogProductImportError('catalog_promotion_forbidden', 'authorization');
}

export async function POST(request: Request) {
  const routeClient = createRouteClient();
  const { data: { user }, error: userError } = await routeClient.auth.getUser();
  if (userError || !user) return errorResponse('unauthorized');

  try {
    const requestBody = await readBoundedCommanderCatalogProductImportJson(request);
    if (!requestBody) return errorResponse('invalid_action');
    await requireAuthorizedCommanderCatalogRun(routeClient, requestBody.catalog_sync_run_id, user.id);
    const serviceClient = getSupabaseAdmin();
    const result = await executeCommanderCatalogProductImport({
      client: serviceClient,
      actorId: user.id,
      catalogSyncRunId: requestBody.catalog_sync_run_id,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CommanderCatalogProductImportError) {
      console.error(`[Commander catalog import] stage=${error.stage} code=${error.code}`);
      return errorResponse(error.code);
    }
    console.error('[Commander catalog import] stage=server code=promotion_unavailable');
    return errorResponse('promotion_unavailable');
  }
}
