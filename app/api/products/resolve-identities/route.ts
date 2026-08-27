import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import {
  CanonicalProductIdentityResolverError,
  collectCanonicalProductIdentityValues,
  readBoundedCanonicalProductIdentityResolveJson,
  resolveCanonicalProductIdentities,
} from '@/lib/pos/canonical-product-identity-resolver.mjs';

export const runtime = 'nodejs';

const PRODUCT_IDENTITY_COLUMNS = 'id, upc, plu, product_code, item_name, department, selling_price, is_active';

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

function failure(errorCode: 'unauthorized' | 'invalid_request' | 'forbidden' | 'resolver_unavailable') {
  const status = errorCode === 'unauthorized' ? 401 : errorCode === 'invalid_request' ? 400 : errorCode === 'forbidden' ? 403 : 500;
  return NextResponse.json({ ok: false, error_code: errorCode }, { status });
}

export async function POST(request: Request) {
  const routeClient = createRouteClient();
  const { data: { user }, error: userError } = await routeClient.auth.getUser();
  if (userError || !user) return failure('unauthorized');

  try {
    const requestBody = await readBoundedCanonicalProductIdentityResolveJson(request);
    if (!requestBody) return failure('invalid_request');
    const { data: store, error: storeError } = await routeClient
      .from('stores')
      .select('id')
      .eq('id', requestBody.storeId)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return failure('forbidden');

    const values = collectCanonicalProductIdentityValues(requestBody.identities);
    const queries = [];
    if (values.upcs.length) {
      queries.push(routeClient.from('products').select(PRODUCT_IDENTITY_COLUMNS).eq('store_id', requestBody.storeId).in('upc', values.upcs).limit(100));
    }
    if (values.plus.length) {
      queries.push(routeClient.from('products').select(PRODUCT_IDENTITY_COLUMNS).eq('store_id', requestBody.storeId).in('plu', values.plus).limit(100));
    }
    if (values.productCodes.length) {
      queries.push(routeClient.from('products').select(PRODUCT_IDENTITY_COLUMNS).eq('store_id', requestBody.storeId).in('product_code', values.productCodes).limit(100));
    }
    const responses = await Promise.all(queries);
    if (responses.some((response) => response.error)) throw new Error('resolver_query_failed');
    const candidatesById = new Map();
    for (const response of responses) {
      for (const candidate of response.data || []) candidatesById.set(candidate.id, candidate);
    }

    return NextResponse.json({
      ok: true,
      resolutions: resolveCanonicalProductIdentities(requestBody.identities, [...candidatesById.values()]),
    });
  } catch (error) {
    if (error instanceof CanonicalProductIdentityResolverError) return failure('invalid_request');
    console.error('[Canonical product identity resolver] stage=server code=resolver_unavailable');
    return failure('resolver_unavailable');
  }
}
