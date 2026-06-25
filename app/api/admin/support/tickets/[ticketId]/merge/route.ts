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
  const auth = await requireSupportPermission(request, 'tickets.merge');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const targetTicketId = textOrNull(body.target_ticket_id);
  const reason = textOrNull(body.reason);
  if (!targetTicketId) return jsonError('Target ticket is required.');
  if (!reason) return jsonError('Merge reason is required.');
  if (targetTicketId === context.params.ticketId) return jsonError('A ticket cannot merge into itself.');

  const [sourceTicket, targetTicket] = await Promise.all([
    loadTicket(context.params.ticketId),
    loadTicket(targetTicketId),
  ]);
  if (!sourceTicket || !targetTicket) return jsonError('Ticket not found.', 404);

  const supabaseAdmin = getSupabaseAdmin();
  const { data: ticket, error } = await supabaseAdmin
    .from('support_tickets')
    .update({
      merged_into: targetTicket.id,
      status: 'closed',
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceTicket.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await Promise.all([
    insertActivity({
      ticketId: sourceTicket.id,
      actorId: auth.user.id,
      activityType: 'merge_started',
      body: `Merged into ${targetTicket.ticket_number}. Reason: ${reason}`,
      isPublic: false,
    }),
    insertActivity({
      ticketId: targetTicket.id,
      actorId: auth.user.id,
      activityType: 'merge_started',
      body: `${sourceTicket.ticket_number} was merged into this ticket. Reason: ${reason}`,
      isPublic: false,
    }),
  ]);

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.ticket_merged',
    ticketId: sourceTicket.id,
    storeId: sourceTicket.store_id,
    table: 'support_tickets',
    recordId: sourceTicket.id,
    oldValues: sourceTicket,
    newValues: (ticket || {}) as Record<string, unknown>,
    reason,
  });

  return NextResponse.json({ ticket, message: 'Ticket merged.' });
}
