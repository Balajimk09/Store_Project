import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  insertActivity,
  jsonError,
  requireStoreOwner,
  verifyOwnerTicket,
} from '@/app/api/support/_lib';

type RouteContext = { params: { ticketId: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireStoreOwner(request);
  if (!auth.ok) return auth.response;

  const ticket = await verifyOwnerTicket(context.params.ticketId, auth.user.id);
  if (!ticket) return jsonError('Ticket not found.', 404);

  const supabaseAdmin = getSupabaseAdmin();
  const [{ data: replies, error: repliesError }, { data: activities, error: activitiesError }] =
    await Promise.all([
      supabaseAdmin
        .from('support_ticket_replies')
        .select('*')
        .eq('ticket_id', ticket.id)
        .eq('is_internal', false)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('support_ticket_activities')
        .select('*')
        .eq('ticket_id', ticket.id)
        .eq('is_public', true)
        .order('created_at', { ascending: true }),
    ]);

  if (repliesError) return jsonError(repliesError.message, 500);
  if (activitiesError) return jsonError(activitiesError.message, 500);

  await supabaseAdmin
    .from('support_tickets')
    .update({ store_owner_read_at: new Date().toISOString() })
    .eq('id', ticket.id);

  return NextResponse.json({ ticket, replies: replies || [], activities: activities || [] });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireStoreOwner(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  if (body.status !== 'reopened') return jsonError('Store owners can only reopen tickets.');

  const ticket = await verifyOwnerTicket(context.params.ticketId, auth.user.id);
  if (!ticket) return jsonError('Ticket not found.', 404);
  if (!['resolved', 'closed'].includes(ticket.status)) {
    return jsonError('Only resolved or closed tickets can be reopened.');
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: updatedTicket, error } = await supabaseAdmin
    .from('support_tickets')
    .update({ status: 'reopened', updated_at: new Date().toISOString() })
    .eq('id', ticket.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await insertActivity({
    ticketId: ticket.id,
    actorId: auth.user.id,
    activityType: 'ticket_reopened_by_owner',
    body: 'Ticket reopened by store owner.',
    isPublic: true,
  });

  return NextResponse.json({ ticket: updatedTicket, message: 'Ticket reopened.' });
}
