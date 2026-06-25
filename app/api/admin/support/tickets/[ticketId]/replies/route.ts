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
  const body = (await request.json()) as Record<string, unknown>;
  const isInternal = body.is_internal === true;
  const auth = await requireSupportPermission(
    request,
    isInternal ? 'tickets.add_internal_note' : 'tickets.reply'
  );
  if (!auth.ok) return auth.response;

  const ticket = await loadTicket(context.params.ticketId);
  if (!ticket) return jsonError('Ticket not found.', 404);

  const replyBody = textOrNull(body.body);
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!replyBody && attachments.length === 0) return jsonError('Reply text or attachment is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: reply, error } = await supabaseAdmin
    .from('support_ticket_replies')
    .insert({
      ticket_id: ticket.id,
      author_id: auth.user.id,
      author_role: 'support',
      body: replyBody || '',
      is_internal: isInternal,
      attachments,
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await supabaseAdmin
    .from('support_tickets')
    .update({
      updated_at: new Date().toISOString(),
      store_owner_read_at: isInternal ? ticket.store_owner_read_at : null,
    })
    .eq('id', ticket.id);

  await insertActivity({
    ticketId: ticket.id,
    actorId: auth.user.id,
    activityType: isInternal ? 'internal_note_added' : 'support_replied',
    body: isInternal ? 'Internal note added.' : 'Support replied.',
    isPublic: !isInternal,
  });

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: isInternal ? 'support.internal_note_added' : 'support.ticket_replied',
    ticketId: ticket.id,
    storeId: ticket.store_id,
    table: 'support_ticket_replies',
    recordId: String((reply as { id?: string }).id || ''),
    newValues: (reply || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ reply, message: isInternal ? 'Internal note saved.' : 'Reply sent.' });
}
