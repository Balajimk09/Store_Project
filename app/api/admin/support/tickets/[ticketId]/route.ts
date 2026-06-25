import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { checkVerificationValid, requireSupportPermission } from '@/lib/support-auth';
import {
  auditSupportAction,
  insertActivity,
  jsonError,
  type JsonRecord,
} from '@/app/api/support/_lib';
import {
  buildTicketUpdate,
  loadStoreMap,
  loadTicket,
  maybeBreachTicket,
} from '@/app/api/admin/support/_lib';

type RouteContext = { params: { ticketId: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'tickets.view');
  if (!auth.ok) return auth.response;

  const ticket = await loadTicket(context.params.ticketId);
  if (!ticket) return jsonError('Ticket not found.', 404);
  await maybeBreachTicket(ticket, auth.user.id);

  const supabaseAdmin = getSupabaseAdmin();
  const includeInternal =
    auth.permissions.includes('ALL') || auth.permissions.includes('tickets.add_internal_note');

  const [
    repliesResult,
    activitiesResult,
    verificationResult,
    followUpsResult,
    callLogsResult,
    billingResult,
    approvalsResult,
    flagsResult,
    storeMap,
  ] = await Promise.all([
    supabaseAdmin
      .from('support_ticket_replies')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('support_ticket_activities')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('support_verifications')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from('support_follow_ups').select('*').eq('ticket_id', ticket.id).order('due_at'),
    supabaseAdmin.from('support_call_logs').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: false }),
    supabaseAdmin.from('support_billing_adjustments').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: false }),
    supabaseAdmin.from('support_approval_queue').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: false }),
    ticket.store_id
      ? supabaseAdmin.from('support_store_flags').select('*').eq('store_id', ticket.store_id).eq('is_active', true)
      : Promise.resolve({ data: [], error: null }),
    loadStoreMap(ticket.store_id ? [ticket.store_id] : []),
  ]);

  if (repliesResult.error) return jsonError(repliesResult.error.message, 500);
  if (activitiesResult.error) return jsonError(activitiesResult.error.message, 500);

  const store = ticket.store_id ? storeMap.get(ticket.store_id) || null : null;
  const verificationValid =
    ticket.store_id ? await checkVerificationValid(ticket.id, ticket.store_id) : false;
  const replies = includeInternal
    ? repliesResult.data || []
    : (repliesResult.data || []).filter((reply) => reply.is_internal === false);

  return NextResponse.json({
    ticket: {
      ...ticket,
      store_name: store?.store_name || store?.primary_owner_email || 'Unknown Store',
      owner_email: store?.primary_owner_email || null,
    },
    replies,
    activities: activitiesResult.data || [],
    latest_verification: verificationResult.data || null,
    verification_valid: verificationValid,
    follow_ups: followUpsResult.data || [],
    call_logs: callLogsResult.data || [],
    billing_adjustments: billingResult.data || [],
    approval_queue: approvalsResult.data || [],
    store_flags: flagsResult.data || [],
    store_360_summary: { store },
    related_records: [],
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'tickets.view');
  if (!auth.ok) return auth.response;

  const oldTicket = await loadTicket(context.params.ticketId);
  if (!oldTicket) return jsonError('Ticket not found.', 404);

  const body = (await request.json()) as JsonRecord;
  const { payload, denied } = buildTicketUpdate(body, auth);
  if (denied.length > 0) return jsonError(`Missing permission: ${denied[0]}`, 403);
  if (Object.keys(payload).length <= 1) return jsonError('No supported fields to update.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: ticket, error } = await supabaseAdmin
    .from('support_tickets')
    .update(payload)
    .eq('id', oldTicket.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  const updated = ticket as JsonRecord;
  const status = typeof payload.status === 'string' ? payload.status : null;
  if (status) {
    await insertActivity({
      ticketId: oldTicket.id,
      actorId: auth.user.id,
      activityType:
        status === 'resolved'
          ? 'status_changed_to_resolved'
          : status === 'closed'
            ? 'status_changed_to_closed'
            : 'ticket_status_updated',
      body: `Status changed from ${oldTicket.status} to ${status}.`,
      metadata: { old_status: oldTicket.status, new_status: status },
      isPublic: status === 'resolved' || status === 'closed',
    });
  }

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.ticket_updated',
    ticketId: oldTicket.id,
    storeId: oldTicket.store_id,
    table: 'support_tickets',
    recordId: oldTicket.id,
    oldValues: oldTicket,
    newValues: updated,
  });

  return NextResponse.json({ ticket, message: 'Ticket updated.' });
}
