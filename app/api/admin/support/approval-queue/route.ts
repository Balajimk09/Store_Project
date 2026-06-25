import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { checkVerificationValid, requireSupportPermission } from '@/lib/support-auth';
import {
  auditSupportAction,
  insertActivity,
  jsonError,
  textOrNull,
} from '@/app/api/support/_lib';
import { parsePagination } from '@/app/api/admin/support/_lib';

const SENSITIVE_ACTIONS = new Set([
  'update_owner_email',
  'send_password_reset',
  'set_temp_password',
  'deactivate_user',
  'reactivate_user',
  'deactivate_store',
  'reactivate_store',
]);

export async function GET(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'approval.approve_action');
  if (!auth.ok) return auth.response;

  const { page, limit } = parsePagination(request);
  const from = page * limit;
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from('support_approval_queue')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  const status = request.nextUrl.searchParams.get('status');
  const actionType = request.nextUrl.searchParams.get('action_type');
  if (status) query = query.eq('status', status);
  if (actionType) query = query.eq('action_type', actionType);

  const { data, error, count } = await query;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ items: data || [], total: count || 0, page, limit });
}

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'approval.request_action');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const actionType = textOrNull(body.action_type);
  const reason = textOrNull(body.reason);
  const ticketId = textOrNull(body.ticket_id);
  const storeId = textOrNull(body.store_id);
  const actionPayload =
    body.action_payload && typeof body.action_payload === 'object'
      ? (body.action_payload as Record<string, unknown>)
      : {};

  if (!actionType) return jsonError('Action type is required.');
  if (!reason) return jsonError('Reason is required.');
  if (SENSITIVE_ACTIONS.has(actionType) && (!ticketId || !storeId || !(await checkVerificationValid(ticketId, storeId)))) {
    return jsonError('A valid 30-minute verification session is required for this action.', 403);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: item, error } = await supabaseAdmin
    .from('support_approval_queue')
    .insert({
      ticket_id: ticketId,
      store_id: storeId,
      action_type: actionType,
      action_payload: actionPayload,
      reason,
      status: 'pending',
      requested_by: auth.user.id,
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  if (ticketId) {
    await insertActivity({
      ticketId,
      actorId: auth.user.id,
      activityType: 'approval_requested',
      body: `Approval requested: ${actionType}`,
      isPublic: false,
    });
  }
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.approval_requested',
    ticketId,
    storeId,
    table: 'support_approval_queue',
    recordId: String((item as { id?: string }).id || ''),
    newValues: (item || {}) as Record<string, unknown>,
    reason,
  });

  return NextResponse.json({ item, message: 'Approval requested.' });
}
