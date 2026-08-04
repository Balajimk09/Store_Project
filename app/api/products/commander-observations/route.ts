import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import {
  CommanderObservationReviewError,
  listCommanderObservationReview,
} from '@/lib/pos/catalog-pilot-commander-observations.mjs';

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
          // This read-only endpoint does not need to persist refreshed auth cookies.
        },
      },
    }
  );
}

function errorResponse(errorCode: 'unauthorized' | 'invalid_store' | 'forbidden' | 'observations_unavailable') {
  const status = errorCode === 'unauthorized' ? 401 : errorCode === 'forbidden' ? 403 : errorCode === 'invalid_store' ? 400 : 500;
  return NextResponse.json({ ok: false, error_code: errorCode }, { status });
}

export async function GET(request: Request) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return errorResponse('unauthorized');

  const storeId = new URL(request.url).searchParams.get('storeId') || '';

  try {
    const observations = await listCommanderObservationReview({
      client,
      userId: user.id,
      storeId,
    });

    return NextResponse.json({
      ok: true,
      source_system: 'commander',
      count: observations.length,
      observations,
    });
  } catch (error) {
    if (error instanceof CommanderObservationReviewError) {
      return errorResponse(error.code);
    }

    console.error('[Commander observation review] Unable to load observations.');
    return errorResponse('observations_unavailable');
  }
}
