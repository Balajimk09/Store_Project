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

  const body = (await request.json()) as Record<string, unknown>;
  const replyBody = textOrNull(body.body);
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!replyBody && attachments.length === 0) return jsonError('Reply text or attachment is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: reply, error } = await supabaseAdmin
    .from('support_ticket_replies')
    .insert({
      ticket_id: ticket.id,
      author_id: auth.user.id,
      author_role: 'store_owner',
      body: replyBody || '',
      attachments,
      is_internal: false,
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await supabaseAdmin
    .from('support_tickets')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', ticket.id);

  await insertActivity({
    ticketId: ticket.id,
    actorId: auth.user.id,
    activityType: 'owner_replied',
    body: 'Store owner replied.',
    isPublic: true,
  });

  return NextResponse.json({ reply, message: 'Reply sent.' });
}
