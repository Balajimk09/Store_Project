import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import { auditSupportAction, insertActivity, jsonError } from '@/app/api/support/_lib';
import { loadTicket } from '@/app/api/admin/support/_lib';

type RouteContext = { params: { ticketId: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'tickets.export');
  if (!auth.ok) return auth.response;

  const ticket = await loadTicket(context.params.ticketId);
  if (!ticket) return jsonError('Ticket not found.', 404);

  const supabaseAdmin = getSupabaseAdmin();
  const [{ data: replies }, { data: activities }] = await Promise.all([
    supabaseAdmin.from('support_ticket_replies').select('*').eq('ticket_id', ticket.id).order('created_at'),
    supabaseAdmin.from('support_ticket_activities').select('*').eq('ticket_id', ticket.id).order('created_at'),
  ]);

  const lines = [
    `Ticket: ${ticket.ticket_number}`,
    `Title: ${ticket.title}`,
    `Status: ${ticket.status}`,
    `Priority: ${ticket.priority}`,
    `Category: ${ticket.category}`,
    '',
    ticket.description,
    '',
    'Replies',
    '-------',
    ...(replies || []).map(
      (reply) =>
        `[${reply.created_at}] ${reply.author_role}${reply.is_internal ? ' internal' : ''}: ${reply.body}`
    ),
    '',
    'Activities',
    '----------',
    ...(activities || []).map(
      (activity) => `[${activity.created_at}] ${activity.activity_type}: ${activity.body || ''}`
    ),
  ];

  await insertActivity({
    ticketId: ticket.id,
    actorId: auth.user.id,
    activityType: 'ticket_exported',
    body: 'Ticket was exported.',
    isPublic: false,
  });
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.ticket_exported',
    ticketId: ticket.id,
    storeId: ticket.store_id,
    table: 'support_tickets',
    recordId: ticket.id,
  });

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ticket.ticket_number}.txt"`,
    },
  });
}
