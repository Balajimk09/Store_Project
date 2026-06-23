import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requirePermission } from '@/lib/admin-auth';

type StoreRecord = Record<string, unknown>;

type NormalizedStore = {
  id: string;
  store_name: string;
  store_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone_number: string | null;
  pos_type: string | null;
  register_count: number;
  has_fuel: boolean;
  created_at: string;
  owner_id: string;
};

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeStore(record: StoreRecord): NormalizedStore {
  return {
    id: String(record.id ?? ''),
    store_name: typeof record.store_name === 'string' ? record.store_name : '',
    store_address: typeof record.store_address === 'string' ? record.store_address : null,
    city: typeof record.city === 'string' ? record.city : null,
    state: typeof record.state === 'string' ? record.state : null,
    zip_code: typeof record.zip_code === 'string' ? record.zip_code : null,
    phone_number: typeof record.phone_number === 'string' ? record.phone_number : null,
    pos_type: typeof record.pos_type === 'string' ? record.pos_type : null,
    register_count: Number(record.register_count) || 0,
    has_fuel: Boolean(record.has_fuel),
    created_at:
      typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    owner_id: String(record.owner_id ?? ''),
  };
}

function computeSetupStatus(store: NormalizedStore): 'complete' | 'incomplete' {
  const complete =
    !!store.store_name.trim() &&
    !!store.store_address?.trim() &&
    !!store.city?.trim() &&
    !!store.state?.trim() &&
    !!store.zip_code?.trim() &&
    !!store.phone_number?.trim() &&
    !!store.pos_type?.trim() &&
    store.register_count > 0;

  return complete ? 'complete' : 'incomplete';
}

function buildSearchPattern(search: string) {
  return `%${search.trim()}%`;
}

function buildStoreSearchParts(search: string, ownerIds: string[], includeOptionalFields: boolean) {
  const pattern = buildSearchPattern(search);
  const parts = [`store_name.ilike.${pattern}`, `store_address.ilike.${pattern}`];

  if (includeOptionalFields) {
    parts.push(
      `city.ilike.${pattern}`,
      `state.ilike.${pattern}`,
      `zip_code.ilike.${pattern}`,
      `phone_number.ilike.${pattern}`,
      `pos_type.ilike.${pattern}`
    );
  }

  if (ownerIds.length > 0) {
    parts.push(`owner_id.in.(${ownerIds.join(',')})`);
  }

  return parts;
}

async function findMatchingOwnerIds(search: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const pattern = buildSearchPattern(search);

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .or(`email.ilike.${pattern},full_name.ilike.${pattern},username.ilike.${pattern}`);

  if (error) {
    return { ownerIds: [] as string[], error: error.message };
  }

  return {
    ownerIds: (data || []).map((profile) => String(profile.user_id)).filter(Boolean),
    error: null as string | null,
  };
}

async function fetchStoresPage(input: {
  search: string;
  page: number;
  pageSize: number;
  ownerIds: string[];
  includeOptionalFields: boolean;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;

  let query = supabaseAdmin.from('stores').select('*', { count: 'exact' });

  if (input.search) {
    const parts = buildStoreSearchParts(
      input.search,
      input.ownerIds,
      input.includeOptionalFields
    );
    query = query.or(parts.join(','));
  }

  return query.order('created_at', { ascending: false }).range(from, to);
}

async function countAllStores() {
  const supabaseAdmin = getSupabaseAdmin();

  const { count, error } = await supabaseAdmin
    .from('stores')
    .select('*', { count: 'exact', head: true });

  if (error) {
    return { total: 0, error: error.message };
  }

  return { total: count || 0, error: null as string | null };
}

function aggregateCounts(rows: Array<{ store_id: string }> | null) {
  const counts = new Map<string, number>();

  for (const row of rows || []) {
    if (!row.store_id) continue;
    counts.set(row.store_id, (counts.get(row.store_id) || 0) + 1);
  }

  return counts;
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'stores.view_all');

  if (!auth.ok) {
    return auth.response;
  }

  const searchParams = request.nextUrl.searchParams;
  const search = (searchParams.get('search') || '').trim();
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = Math.min(
    parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );

  try {
    const supabaseAdmin = getSupabaseAdmin();

    let ownerIds: string[] = [];

    if (search) {
      const ownerLookup = await findMatchingOwnerIds(search);

      if (ownerLookup.error) {
        return NextResponse.json({ error: ownerLookup.error }, { status: 500 });
      }

      ownerIds = ownerLookup.ownerIds;
    }

    let storesResult = await fetchStoresPage({
      search,
      page,
      pageSize,
      ownerIds,
      includeOptionalFields: true,
    });

    if (storesResult.error && search) {
      storesResult = await fetchStoresPage({
        search,
        page,
        pageSize,
        ownerIds,
        includeOptionalFields: false,
      });
    }

    if (storesResult.error) {
      return NextResponse.json({ error: storesResult.error.message }, { status: 500 });
    }

    const rawStores = storesResult.data || [];
    const filteredTotal = storesResult.count || 0;

    let totalStores = filteredTotal;

    if (!search) {
      const totalResult = await countAllStores();

      if (totalResult.error) {
        return NextResponse.json({ error: totalResult.error }, { status: 500 });
      }

      totalStores = totalResult.total;
    }

    const normalizedStores = rawStores.map((record) =>
      normalizeStore(record as StoreRecord)
    );
    const storeIds = normalizedStores.map((store) => store.id).filter(Boolean);
    const ownerIdList = Array.from(
      new Set(normalizedStores.map((store) => store.owner_id).filter(Boolean))
    );

    const [{ data: profiles, error: profilesError }, productsResult, transactionsResult] =
      await Promise.all([
        ownerIdList.length
          ? supabaseAdmin
              .from('user_profiles')
              .select('user_id, full_name, email, username')
              .in('user_id', ownerIdList)
          : Promise.resolve({ data: [], error: null }),
        storeIds.length
          ? supabaseAdmin.from('products').select('store_id').in('store_id', storeIds)
          : Promise.resolve({ data: [], error: null }),
        storeIds.length
          ? supabaseAdmin.from('transactions').select('store_id').in('store_id', storeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (profilesError) {
      return NextResponse.json({ error: profilesError.message }, { status: 500 });
    }

    if (productsResult.error) {
      return NextResponse.json({ error: productsResult.error.message }, { status: 500 });
    }

    if (transactionsResult.error) {
      return NextResponse.json({ error: transactionsResult.error.message }, { status: 500 });
    }

    const profileByUserId = new Map(
      (profiles || []).map((profile) => [String(profile.user_id), profile])
    );
    const productCounts = aggregateCounts(productsResult.data);
    const transactionCounts = aggregateCounts(transactionsResult.data);

    const stores = normalizedStores.map((store) => {
      const owner = profileByUserId.get(store.owner_id);

      return {
        ...store,
        owner: owner
          ? {
              full_name:
                typeof owner.full_name === 'string' ? owner.full_name : null,
              email: typeof owner.email === 'string' ? owner.email : null,
              username: typeof owner.username === 'string' ? owner.username : null,
            }
          : null,
        products_count: productCounts.get(store.id) || 0,
        transactions_count: transactionCounts.get(store.id) || 0,
        setup_status: computeSetupStatus(store),
      };
    });

    const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize));

    return NextResponse.json({
      summary: {
        totalStores,
      },
      stores,
      pagination: {
        page,
        pageSize,
        total: filteredTotal,
        totalPages,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unexpected server error.',
      },
      { status: 500 }
    );
  }
}
