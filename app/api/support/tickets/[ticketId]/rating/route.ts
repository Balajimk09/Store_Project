import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  insertActivity,
  jsonError,
  requireStoreOwner,
  textOrNull,
  verifyOwnerTicket,
} from '@/app/api/support/_lib';

type RouteContext = { params: { ticketId: string } };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireStoreOwner(request);
  if (!auth.ok) return auth.response;

  const ticket = await verifyOwnerTicket(context.params.ticketId, auth.user.id);
  if (!ticket) return jsonError('Ticket not found.', 404);
  if (!['resolved', 'closed'].includes(ticket.status)) {
    return jsonError('Only resolved or closed tickets can be rated.');
  }

  const body = (await request.json()) as Record<string, unknown>;
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return jsonError('Rating must be between 1 and 5.');
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: updatedTicket, error } = await supabaseAdmin
    .from('support_tickets')
    .update({
      satisfaction_rating: rating,
      satisfaction_comment: textOrNull(body.comment),
      rated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', ticket.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await insertActivity({
    ticketId: ticket.id,
    actorId: auth.user.id,
    activityType: 'satisfaction_rated',
    body: `Store owner rated this ticket ${rating} out of 5.`,
    isPublic: true,
  });

  return NextResponse.json({ ticket: updatedTicket, message: 'Rating saved.' });
}
