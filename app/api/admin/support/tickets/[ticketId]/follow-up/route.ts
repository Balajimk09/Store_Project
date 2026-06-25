import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  auditSupportAction,
  insertActivity,
  jsonError,
  textOrNull,
} from '@/app/api/support/_lib';
import { loadTicket } from '@/app/api/admin/support/_lib';

type RouteContext = { params: { ticketId: string } };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'tickets.set_follow_up');
  if (!auth.ok) return auth.response;

  const ticket = await loadTicket(context.params.ticketId);
  if (!ticket) return jsonError('Ticket not found.', 404);

  const body = (await request.json()) as Record<string, unknown>;
  const dueAt = textOrNull(body.due_at);
  if (!dueAt) return jsonError('Follow-up due date is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: followUp, error } = await supabaseAdmin
    .from('support_follow_ups')
    .insert({
      ticket_id: ticket.id,
      store_id: ticket.store_id,
      due_at: dueAt,
      note: textOrNull(body.note),
      assigned_to: textOrNull(body.assigned_to) || auth.user.id,
      created_by: auth.user.id,
      is_completed: false,
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await insertActivity({
    ticketId: ticket.id,
    actorId: auth.user.id,
    activityType: 'follow_up_set',
    body: 'Follow-up was set.',
    isPublic: false,
  });
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.follow_up_set',
    ticketId: ticket.id,
    storeId: ticket.store_id,
    table: 'support_follow_ups',
    recordId: String((followUp as { id?: string }).id || ''),
    newValues: (followUp || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ follow_up: followUp, message: 'Follow-up set.' });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'tickets.set_follow_up');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const followUpId = textOrNull(body.follow_up_id);
  if (!followUpId) return jsonError('Follow-up ID is required.');

  const ticket = await loadTicket(context.params.ticketId);
  if (!ticket) return jsonError('Ticket not found.', 404);

  const supabaseAdmin = getSupabaseAdmin();
  const { data: followUp, error } = await supabaseAdmin
    .from('support_follow_ups')
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      completed_by: auth.user.id,
    })
    .eq('id', followUpId)
    .eq('ticket_id', ticket.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.follow_up_completed',
    ticketId: ticket.id,
    storeId: ticket.store_id,
    table: 'support_follow_ups',
    recordId: followUpId,
    newValues: (followUp || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ follow_up: followUp, message: 'Follow-up completed.' });
}
