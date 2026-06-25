import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  auditSupportAction,
  insertActivity,
  jsonError,
} from '@/app/api/support/_lib';
import { normalizeAdjustmentPayload, parsePagination } from '@/app/api/admin/support/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'billing.view');
  if (!auth.ok) return auth.response;

  const { page, limit } = parsePagination(request);
  const from = page * limit;
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error, count } = await supabaseAdmin
    .from('support_billing_adjustments')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ adjustments: data || [], total: count || 0, page, limit });
}

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'billing.request_adjustment');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const payload = normalizeAdjustmentPayload(body, auth.user.id);
  if (!payload.reason) return jsonError('Reason is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: adjustment, error } = await supabaseAdmin
    .from('support_billing_adjustments')
    .insert(payload)
    .select('*')
    .single();
  if (error) return jsonError(error.message, 500);

  const { data: approval } = await supabaseAdmin
    .from('support_approval_queue')
    .insert({
      ticket_id: payload.ticket_id,
      store_id: payload.store_id,
      action_type: 'billing_adjustment',
      action_payload: { billing_adjustment_id: (adjustment as { id?: string }).id },
      reason: payload.reason,
      status: 'pending',
      requested_by: auth.user.id,
    })
    .select('id')
    .single();

  if ((adjustment as { id?: string }).id && approval?.id) {
    await supabaseAdmin
      .from('support_billing_adjustments')
      .update({ approval_queue_id: approval.id })
      .eq('id', (adjustment as { id: string }).id);
  }

  if (payload.ticket_id) {
    await insertActivity({
      ticketId: payload.ticket_id,
      actorId: auth.user.id,
      activityType: 'billing_issue_added',
      body: payload.reason,
      isPublic: false,
    });
  }
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.billing_adjustment_requested',
    ticketId: payload.ticket_id,
    storeId: payload.store_id,
    table: 'support_billing_adjustments',
    recordId: String((adjustment as { id?: string }).id || ''),
    newValues: (adjustment || {}) as Record<string, unknown>,
    reason: payload.reason,
  });

  return NextResponse.json({ adjustment, approval_queue_id: approval?.id || null, message: 'Billing issue recorded.' });
}
