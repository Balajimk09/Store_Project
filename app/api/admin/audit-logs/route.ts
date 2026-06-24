import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type UserProfile = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  username?: string | null;
};

type StoreRow = {
  id: string;
  store_name?: string | null;
};

const EDITABLE_FIELDS = [
  'action',
  'reason',
  'metadata',
  'target_table',
  'target_record_id',
] as const;

function parsePage(value: string | null) {
  const parsed = Number(value || '0');
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function parseLimit(value: string | null) {
  const parsed = Number(value || '50');
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(100, Math.floor(parsed));
}

function clean(value: string | null) {
  return (value || '').trim();
}

function wildcard(value: string) {
  return value.replace(/[%_]/g, '\\$&');
}

function buildEditablePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const value = body[field];
      payload[field] = value === '' || value === undefined ? null : value;
    }
  }

  return payload;
}

async function profileIdsForActorSearch(search: string) {
  if (!search) return [];

  const supabaseAdmin = getSupabaseAdmin();
  const term = wildcard(search);

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .or(`email.ilike.%${term}%,full_name.ilike.%${term}%,username.ilike.%${term}%`)
    .limit(200);

  if (error) return [];

  return (data || []).map((profile: Pick<UserProfile, 'user_id'>) => profile.user_id);
}

async function enrichLogs(rows: any[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const userIds = Array.from(
    new Set(
      rows.flatMap((row) => [row.actor_user_id, row.target_user_id]).filter(Boolean)
    )
  );
  const storeIds = Array.from(
    new Set(rows.map((row) => row.target_store_id).filter(Boolean))
  );

  const profileMap = new Map<string, UserProfile>();
  const storeMap = new Map<string, StoreRow>();

  if (userIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, full_name, email, username')
      .in('user_id', userIds);

    for (const profile of data || []) {
      profileMap.set(profile.user_id, profile);
    }
  }

  if (storeIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('stores')
      .select('id, store_name')
      .in('id', storeIds);

    for (const store of data || []) {
      storeMap.set(store.id, store);
    }
  }

  return rows.map((row) => {
    const actor = row.actor_user_id ? profileMap.get(row.actor_user_id) : null;
    const targetUser = row.target_user_id ? profileMap.get(row.target_user_id) : null;
    const targetStore = row.target_store_id ? storeMap.get(row.target_store_id) : null;

    return {
      id: row.id,
      action: row.action,
      actor_user_id: row.actor_user_id,
      actor_email: actor?.email || null,
      actor_name: actor?.full_name || actor?.username || null,
      target_user_id: row.target_user_id,
      target_user_email: targetUser?.email || null,
      target_user_name: targetUser?.full_name || targetUser?.username || null,
      target_store_id: row.target_store_id,
      target_store_name: targetStore?.store_name || null,
      target_table: row.target_table,
      target_record_id: row.target_record_id,
      old_values: row.old_values,
      new_values: row.new_values,
      metadata: row.metadata || {},
      reason: row.reason,
      created_at: row.created_at,
    };
  });
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;
  const page = parsePage(searchParams.get('page'));
  const limit = parseLimit(searchParams.get('limit'));
  const search = clean(searchParams.get('search'));
  const actorSearch = clean(searchParams.get('actor_search'));
  const action = clean(searchParams.get('action'));
  const targetTable = clean(searchParams.get('target_table'));
  const targetStoreId = clean(searchParams.get('target_store_id'));
  const fromDate = clean(searchParams.get('from'));
  const toDate = clean(searchParams.get('to'));

  let query = supabaseAdmin
    .from('admin_audit_logs')
    .select('*', { count: 'exact' });

  if (search) {
    const term = wildcard(search);
    query = query.or(
      `action.ilike.%${term}%,reason.ilike.%${term}%,target_table.ilike.%${term}%`
    );
  }

  if (actorSearch) {
    const actorIds = await profileIdsForActorSearch(actorSearch);

    if (actorIds.length === 0) {
      return NextResponse.json({ logs: [], total: 0, page, limit });
    }

    query = query.in('actor_user_id', actorIds);
  }

  if (action) query = query.eq('action', action);
  if (targetTable) query = query.eq('target_table', targetTable);
  if (targetStoreId) query = query.eq('target_store_id', targetStoreId);
  if (fromDate) query = query.gte('created_at', new Date(fromDate).toISOString());
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    query = query.lte('created_at', end.toISOString());
  }

  const from = page * limit;
  const to = from + limit - 1;

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    logs: await enrichLogs(data || []),
    total: count || 0,
    page,
    limit,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const action = clean(String(body.action || 'platform.manual_note')) || 'platform.manual_note';
  const reason = clean(String(body.reason || ''));

  if (!action || !reason) {
    return NextResponse.json(
      { error: 'Action and reason are required.' },
      { status: 400 }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('admin_audit_logs')
    .insert({
      actor_user_id: auth.user.id,
      action,
      target_store_id: body.target_store_id || null,
      target_user_id: body.target_user_id || null,
      target_table: body.target_table || null,
      target_record_id: body.target_record_id || null,
      old_values: null,
      new_values: null,
      metadata:
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
      reason,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ log: data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const id = clean(String(body.id || ''));

  if (!id) {
    return NextResponse.json({ error: 'Audit log id is required.' }, { status: 400 });
  }

  const payload = buildEditablePayload(body);

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'No supported fields to update.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('admin_audit_logs')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ log: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const id = clean(request.nextUrl.searchParams.get('id'));

  if (!id) {
    return NextResponse.json({ error: 'Audit log id is required.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.from('admin_audit_logs').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: 'Deleted successfully.' });
}
