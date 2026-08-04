import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import {
  CommanderPricePublishError,
  getCommanderPriceJob,
  listCommanderPriceIdentities,
  readBoundedCommanderPriceJson,
  requestCommanderPriceUpdate,
} from '@/lib/pos/controlled-commander-price-publish.mjs';

export const runtime = 'nodejs';

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
          // This endpoint never needs to persist refreshed cookies.
        },
      },
    }
  );
}

type ErrorCode =
  | 'unauthorized'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'invalid_request'
  | 'invalid_store'
  | 'invalid_product'
  | 'invalid_job'
  | 'invalid_price'
  | 'price_unchanged'
  | 'forbidden'
  | 'publish_already_active'
  | 'publish_conflict'
  | 'job_not_found'
  | 'publish_unavailable';

function errorResponse(code: ErrorCode) {
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
            : code === 'publish_already_active' || code === 'publish_conflict'
              ? 409
              : code === 'publish_unavailable'
                ? 503
                : 400;
  return NextResponse.json({ ok: false, error_code: code }, { status });
}

function mappedError(error: unknown) {
  if (error instanceof CommanderPricePublishError) {
    return errorResponse(error.code as ErrorCode);
  }
  console.error('[Commander price] Request failed.');
  return errorResponse('publish_unavailable');
}

export async function POST(request: Request) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return errorResponse('unauthorized');

  try {
    const input = await readBoundedCommanderPriceJson(request);
    const job = await requestCommanderPriceUpdate({
      client,
      userId: user.id,
      input,
    });
    return NextResponse.json({ ok: true, job }, { status: 202 });
  } catch (error) {
    return mappedError(error);
  }
}

export async function GET(request: Request) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return errorResponse('unauthorized');

  const url = new URL(request.url);
  try {
    if (url.searchParams.get('identities') === '1') {
      const identities = await listCommanderPriceIdentities({
        client,
        userId: user.id,
        storeId: url.searchParams.get('storeId') || '',
      });
      return NextResponse.json({ ok: true, identities });
    }
    const job = await getCommanderPriceJob({
      client,
      userId: user.id,
      storeId: url.searchParams.get('storeId') || '',
      jobId: url.searchParams.get('jobId') || '',
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return mappedError(error);
  }
}
