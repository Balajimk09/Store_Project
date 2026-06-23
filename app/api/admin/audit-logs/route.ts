import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type UserProfile = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  username?: string | null;
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

function normalizeAuditLog(row: any, profileMap: Map<string, UserProfile>) {
  const actorUserId = row.actor_user_id || null;
  const targetUserId = row.target_user_id || null;

  return {
    id: String(row.id || `${row.created_at}-${row.action}-${row.target_record_id || ''}`),
    created_at: row.created_at || null,
    actor_user_id: actorUserId,
    actor: actorUserId ? profileMap.get(actorUserId) || null : null,
    action: row.action || 'unknown.action',
    target_user_id: targetUserId,
    target_user: targetUserId ? profileMap.get(targetUserId) || null : null,
    target_store_id: row.target_store_id || null,
    target_table: row.target_table || null,
    target_record_id: row.target_record_id || null,
    old_values: row.old_values || null,
    new_values: row.new_values || null,
    metadata: row.metadata || {},
    reason: row.reason || null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'audit_logs.view');

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;

  const page = clampPage(searchParams.get('page'));
  const pageSize = clampPageSize(searchParams.get('pageSize'));
  const search = cleanSearch(searchParams.get('search'));
  const actionFilter = String(searchParams.get('action') || 'all').trim();
  const targetFilter = String(searchParams.get('target') || 'all').trim();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let matchingProfileIds: string[] = [];

  if (search) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .or(
        [
          `full_name.ilike.%${search}%`,
          `email.ilike.%${search}%`,
          `username.ilike.%${search}%`,
        ].join(',')
      )
      .limit(100);

    matchingProfileIds = (profiles || [])
      .map((profile: any) => profile.user_id)
      .filter(Boolean);
  }

  let query = supabaseAdmin
    .from('admin_audit_logs')
    .select('*', { count: 'exact' });

  if (actionFilter && actionFilter !== 'all') {
    query = query.eq('action', actionFilter);
  }

  if (targetFilter && targetFilter !== 'all') {
    query = query.eq('target_table', targetFilter);
  }

  if (search) {
    const searchTerms = [
      `action.ilike.%${search}%`,
      `target_table.ilike.%${search}%`,
      `target_record_id.ilike.%${search}%`,
      `reason.ilike.%${search}%`,
    ];

    if (matchingProfileIds.length > 0) {
      const ids = matchingProfileIds.join(',');
      searchTerms.push(`actor_user_id.in.(${ids})`);
      searchTerms.push(`target_user_id.in.(${ids})`);
    }

    query = query.or(searchTerms.join(','));
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];

  const userIds = Array.from(
    new Set(
      rows
        .flatMap((row: any) => [row.actor_user_id, row.target_user_id])
        .filter(Boolean)
    )
  );

  const profileMap = new Map<string, UserProfile>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, full_name, email, username')
      .in('user_id', userIds);

    (profiles || []).forEach((profile: UserProfile) => {
      profileMap.set(profile.user_id, profile);
    });
  }

  const { data: filterRows } = await supabaseAdmin
    .from('admin_audit_logs')
    .select('action, target_table')
    .order('created_at', { ascending: false })
    .limit(1000);

  const actions = Array.from(
    new Set((filterRows || []).map((row: any) => row.action).filter(Boolean))
  ).sort();

  const targetTables = Array.from(
    new Set((filterRows || []).map((row: any) => row.target_table).filter(Boolean))
  ).sort();

  const total = count || 0;

  return NextResponse.json({
    summary: {
      totalAuditLogs: total,
    },
    logs: rows.map((row: any) => normalizeAuditLog(row, profileMap)),
    filters: {
      actions,
      targetTables,
    },
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}