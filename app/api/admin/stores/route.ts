import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction, requirePermission, requireSuperadmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type StoreRow = Record<string, any>;

type UserProfile = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  username?: string | null;
  account_type_key?: string | null;
};

function clampPage(value: string | null) {
  const parsed = Number(value || '1');
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function clampPageSize(value: string | null) {
  const parsed = Number(value || '25');
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(50, Math.floor(parsed));
}

function cleanSearch(value: string | null) {
  return String(value || '')
    .trim()
    .replace(/[%_,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function cleanText(value: unknown, maxLength = 255) {
  const text = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);

  return text || null;
}

function cleanStatus(value: unknown) {
  const status = String(value || 'active').trim().toLowerCase();

  if (status === 'inactive') return 'inactive';
  if (status === 'active') return 'active';

  return 'active';
}

function cleanRegisterCount(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.floor(parsed);
}

function getStoreSetupStatus(store: StoreRow) {
  const requiredFields = [
    store.store_name,
    store.city,
    store.state,
    store.zip_code,
    store.phone_number,
  ];

  const completedFields = requiredFields.filter(
    (field) => field !== null && field !== undefined && String(field).trim() !== ''
  ).length;

  if (completedFields === requiredFields.length) return 'complete';
  if (completedFields > 0) return 'partial';

  return 'missing';
}

function buildStorePayload(input: Record<string, unknown>) {
  const storeName = cleanText(input.store_name || input.storeName, 160);

  if (!storeName) {
    throw new Error('Store name is required.');
  }

  const ownerId = cleanText(input.owner_id || input.ownerId, 80);

  return {
    owner_id: ownerId,
    store_name: storeName,
    address: cleanText(input.address, 255),
    city: cleanText(input.city, 120),
    state: cleanText(input.state, 80),
    zip_code: cleanText(input.zip_code || input.zipCode, 20),
    phone_number: cleanText(input.phone_number || input.phoneNumber, 40),
    pos_type: cleanText(input.pos_type || input.posType, 120),
    register_count: cleanRegisterCount(input.register_count || input.registerCount),
    status: cleanStatus(input.status),
    updated_at: new Date().toISOString(),
  };
}

function normalizeStore(
  store: StoreRow,
  ownerMap: Map<string, UserProfile>,
  productCounts: Map<string, number>,
  transactionCounts: Map<string, number>
) {
  const ownerId = store.owner_id ? String(store.owner_id) : null;
  const storeId = String(store.id);
  const status = cleanStatus(store.status);
  const setupStatus = getStoreSetupStatus(store);
  const productCount = productCounts.get(storeId) || 0;
  const transactionCount = transactionCounts.get(storeId) || 0;

  return {
    id: storeId,
    owner_id: ownerId,
    ownerId,
    owner: ownerId ? ownerMap.get(ownerId) || null : null,

    store_name: store.store_name || '',
    storeName: store.store_name || '',

    address: store.address || '',
    city: store.city || '',
    state: store.state || '',
    zip_code: store.zip_code || '',
    zipCode: store.zip_code || '',
    phone_number: store.phone_number || '',
    phoneNumber: store.phone_number || '',
    pos_type: store.pos_type || '',
    posType: store.pos_type || '',
    register_count: Number(store.register_count || 0),
    registerCount: Number(store.register_count || 0),

    status,
    is_active: status === 'active',
    isActive: status === 'active',

    setup_status: setupStatus,
    setupStatus,

    product_count: productCount,
    productCount,
    transaction_count: transactionCount,
    transactionCount,

    created_by: store.created_by || null,
    created_at: store.created_at || null,
    createdAt: store.created_at || null,
    updated_at: store.updated_at || null,
    updatedAt: store.updated_at || null,
    deactivated_at: store.deactivated_at || null,
    deactivatedAt: store.deactivated_at || null,
    deactivated_by: store.deactivated_by || null,
  };
}

async function getOwnerMap(ownerIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const ownerMap = new Map<string, UserProfile>();

  if (ownerIds.length === 0) return ownerMap;

  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, email, username, account_type_key')
    .in('user_id', ownerIds);

  (data || []).forEach((profile: UserProfile) => {
    ownerMap.set(profile.user_id, profile);
  });

  return ownerMap;
}

async function getOwnerOptions() {
  const supabaseAdmin = getSupabaseAdmin();

  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, email, username, account_type_key')
    .limit(500);

  return data || [];
}

async function getProductCounts(storeIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const counts = new Map<string, number>();

  if (storeIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin
    .from('products')
    .select('store_id')
    .in('store_id', storeIds);

  if (error) return counts;

  (data || []).forEach((row: { store_id?: string | null }) => {
    if (!row.store_id) return;
    counts.set(row.store_id, (counts.get(row.store_id) || 0) + 1);
  });

  return counts;
}

async function getTransactionCounts(storeIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const counts = new Map<string, number>();

  if (storeIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('store_id')
    .in('store_id', storeIds)
    .limit(5000);

  if (error) return counts;

  (data || []).forEach((row: { store_id?: string | null }) => {
    if (!row.store_id) return;
    counts.set(row.store_id, (counts.get(row.store_id) || 0) + 1);
  });

  return counts;
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'stores.view_all');

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;

  const page = clampPage(searchParams.get('page'));
  const pageSize = clampPageSize(searchParams.get('pageSize'));
  const search = cleanSearch(searchParams.get('search'));
  const status = String(searchParams.get('status') || 'all').trim().toLowerCase();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from('stores')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (status === 'active' || status === 'inactive') {
    query = query.eq('status', status);
  }

  if (search) {
    query = query.or(
      [
        `store_name.ilike.%${search}%`,
        `city.ilike.%${search}%`,
        `state.ilike.%${search}%`,
        `zip_code.ilike.%${search}%`,
        `phone_number.ilike.%${search}%`,
        `pos_type.ilike.%${search}%`,
        `address.ilike.%${search}%`,
      ].join(',')
    );
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stores = data || [];
  const storeIds = stores.map((store: StoreRow) => String(store.id));
  const ownerIds = Array.from(
    new Set(stores.map((store: StoreRow) => store.owner_id).filter(Boolean).map(String))
  );

  const [ownerMap, productCounts, transactionCounts, ownerOptions] = await Promise.all([
    getOwnerMap(ownerIds),
    getProductCounts(storeIds),
    getTransactionCounts(storeIds),
    getOwnerOptions(),
  ]);

  const normalizedStores = stores.map((store: StoreRow) =>
    normalizeStore(store, ownerMap, productCounts, transactionCounts)
  );

  const { count: totalActiveStores } = await supabaseAdmin
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: totalInactiveStores } = await supabaseAdmin
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'inactive');

  return NextResponse.json({
    summary: {
      totalStores: count || 0,
      activeStores: totalActiveStores || 0,
      inactiveStores: totalInactiveStores || 0,
      storesOnPage: normalizedStores.length,
      setupCompleteStores: normalizedStores.filter((store) => store.setupStatus === 'complete').length,
      totalProductsOnPage: normalizedStores.reduce((sum, store) => sum + store.productCount, 0),
      totalTransactionsOnPage: normalizedStores.reduce(
        (sum, store) => sum + store.transactionCount,
        0
      ),
    },
    stores: normalizedStores,
    ownerOptions,
    pagination: {
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin(request);

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    const body = await request.json();
    const payload = {
      ...buildStorePayload(body),
      created_by: auth.user.id,
      status: 'active',
    };

    const { data, error } = await supabaseAdmin
      .from('stores')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAction({
      actorUserId: auth.user.id,
      action: 'store.created',
      targetStoreId: data.id,
      targetTable: 'stores',
      targetRecordId: data.id,
      newValues: data,
      reason: cleanText(body.reason, 500),
      metadata: {
        source: 'superadmin_stores_page',
      },
    });

    return NextResponse.json({ store: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create store.' },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperadmin(request);

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    const body = await request.json();
    const storeId = cleanText(body.id || body.store_id || body.storeId, 80);
    const action = String(body.action || 'update').trim().toLowerCase();

    if (!storeId) {
      return NextResponse.json({ error: 'Store ID is required.' }, { status: 400 });
    }

    const { data: existingStore, error: existingError } = await supabaseAdmin
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    if (existingError || !existingStore) {
      return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
    }

    if (action === 'deactivate') {
      const updatePayload = {
        status: 'inactive',
        deactivated_at: new Date().toISOString(),
        deactivated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from('stores')
        .update(updatePayload)
        .eq('id', storeId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      await logAdminAction({
        actorUserId: auth.user.id,
        action: 'store.deactivated',
        targetStoreId: storeId,
        targetTable: 'stores',
        targetRecordId: storeId,
        oldValues: existingStore,
        newValues: data,
        reason: cleanText(body.reason, 500),
        metadata: {
          source: 'superadmin_stores_page',
        },
      });

      return NextResponse.json({ store: data });
    }

    if (action === 'reactivate') {
      const updatePayload = {
        status: 'active',
        deactivated_at: null,
        deactivated_by: null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from('stores')
        .update(updatePayload)
        .eq('id', storeId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      await logAdminAction({
        actorUserId: auth.user.id,
        action: 'store.reactivated',
        targetStoreId: storeId,
        targetTable: 'stores',
        targetRecordId: storeId,
        oldValues: existingStore,
        newValues: data,
        reason: cleanText(body.reason, 500),
        metadata: {
          source: 'superadmin_stores_page',
        },
      });

      return NextResponse.json({ store: data });
    }

    const updatePayload = buildStorePayload(body);

    const { data, error } = await supabaseAdmin
      .from('stores')
      .update(updatePayload)
      .eq('id', storeId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAction({
      actorUserId: auth.user.id,
      action: 'store.updated',
      targetStoreId: storeId,
      targetTable: 'stores',
      targetRecordId: storeId,
      oldValues: existingStore,
      newValues: data,
      reason: cleanText(body.reason, 500),
      metadata: {
        source: 'superadmin_stores_page',
      },
    });

    return NextResponse.json({ store: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update store.' },
      { status: 400 }
    );
  }
}