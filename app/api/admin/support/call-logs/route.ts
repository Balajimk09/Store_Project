import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import { auditSupportAction, insertActivity, jsonError } from '@/app/api/support/_lib';
import { normalizeCallLogPayload, parsePagination } from '@/app/api/admin/support/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'tickets.log_call');
  if (!auth.ok) return auth.response;

  const { page, limit } = parsePagination(request);
  const from = page * limit;
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from('support_call_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  const direction = request.nextUrl.searchParams.get('direction');
  const storeId = request.nextUrl.searchParams.get('store_id');
  if (direction) query = query.eq('call_direction', direction);
  if (storeId) query = query.eq('store_id', storeId);

  const { data, error, count } = await query;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ call_logs: data || [], total: count || 0, page, limit });
}

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'tickets.log_call');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const payload = normalizeCallLogPayload(body, auth.user.id);
  if (!payload.summary) return jsonError('Call summary is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: callLog, error } = await supabaseAdmin
    .from('support_call_logs')
    .insert(payload)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);
  if (payload.ticket_id) {
    await insertActivity({
      ticketId: payload.ticket_id,
      actorId: auth.user.id,
      activityType: 'call_logged',
      body: payload.summary,
      isPublic: false,
    });
  }
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.call_logged',
    ticketId: payload.ticket_id,
    storeId: payload.store_id,
    table: 'support_call_logs',
    recordId: String((callLog as { id?: string }).id || ''),
    newValues: (callLog || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ call_log: callLog, message: 'Call logged.' });
}
