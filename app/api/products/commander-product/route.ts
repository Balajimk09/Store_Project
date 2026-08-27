import {
  CommanderProductPublishError,
  hasCommanderProductSourceIdentity,
  getCommanderProductContext,
  getCommanderProductJob,
  readBoundedCommanderProductJson,
  requestCommanderProductCreate,
  requestCommanderProductUpdate,
} from '@/lib/pos/controlled-commander-product-publish.mjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseRouteClient } from '@/lib/supabase-route-auth';

export const runtime = 'nodejs';

type ErrorCode =
  | 'unauthorized'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'invalid_request'
  | 'invalid_store'
  | 'invalid_product'
  | 'invalid_job'
  | 'invalid_price'
  | 'product_unchanged'
  | 'forbidden'
  | 'publish_already_active'
  | 'publish_conflict'
  | 'master_data_mapping_unavailable'
  | 'master_data_mapping_ambiguous'
  | 'commander_create_profile_missing'
  | 'commander_create_profile_invalid'
  | 'commander_create_payload_invalid'
  | 'job_not_found'
  | 'publish_unavailable';

function errorResponse(route: ReturnType<typeof createSupabaseRouteClient>, code: ErrorCode) {
  const status = code === 'unauthorized'
    ? 401
    : code === 'forbidden'
      ? 403
      : code === 'job_not_found'
        ? 404
        : code === 'unsupported_media_type'
          ? 415
          : code === 'payload_too_large'
            ? 413
            : code === 'publish_already_active' || code === 'publish_conflict' || code === 'master_data_mapping_unavailable' || code === 'master_data_mapping_ambiguous' || code === 'commander_create_profile_missing' || code === 'commander_create_profile_invalid'
              ? 409
              : code === 'publish_unavailable'
                ? 503
                : 400;
  return route.json({ ok: false, error_code: code }, { status });
}

function mappedError(route: ReturnType<typeof createSupabaseRouteClient>, error: unknown) {
  if (error instanceof CommanderProductPublishError) {
    return errorResponse(route, error.code as ErrorCode);
  }
  console.error('[Commander product] Request failed.');
  return errorResponse(route, 'publish_unavailable');
}

export async function POST(request: Request) {
  const route = createSupabaseRouteClient();
  const { client } = route;
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return errorResponse(route, 'unauthorized');

  try {
    const input = await readBoundedCommanderProductJson(request);
    const linked = await hasCommanderProductSourceIdentity({
      client,
      userId: user.id,
      storeId: input?.store_id,
      productId: input?.product_id,
    });
    const job = linked
      ? await requestCommanderProductUpdate({ client, userId: user.id, input })
      : await requestCommanderProductCreate({ client, privilegedClient: getSupabaseAdmin(), userId: user.id, input });
    return route.json({ ok: true, job }, { status: 202 });
  } catch (error) {
    return mappedError(route, error);
  }
}

export async function GET(request: Request) {
  const route = createSupabaseRouteClient();
  const { client } = route;
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return errorResponse(route, 'unauthorized');

  const url = new URL(request.url);
  try {
    if (url.searchParams.get('context') === '1') {
      const context = await getCommanderProductContext({
        client,
        userId: user.id,
        storeId: url.searchParams.get('storeId') || '',
        productId: url.searchParams.get('productId') || '',
      });
      return route.json({ ok: true, context });
    }
    const job = await getCommanderProductJob({
      client,
      userId: user.id,
      storeId: url.searchParams.get('storeId') || '',
      jobId: url.searchParams.get('jobId') || '',
    });
    return route.json({ ok: true, job });
  } catch (error) {
    return mappedError(route, error);
  }
}
