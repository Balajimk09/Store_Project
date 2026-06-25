import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import { auditSupportAction, insertActivity, jsonError, textOrNull } from '@/app/api/support/_lib';

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'tickets.bulk_action');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const ticketIds = Array.isArray(body.ticket_ids)
    ? body.ticket_ids.filter((id): id is string => typeof id === 'string')
    : [];
  const action = textOrNull(body.action);
  const value = body.value;
  const reason = textOrNull(body.reason);
  if (ticketIds.length === 0) return jsonError('Select at least one ticket.');
  if (!action) return jsonError('Bulk action is required.');
  if (!reason) return jsonError('Bulk action reason is required.');

  const supabaseAdmin = getSupabaseAdmin();

  if (action === 'add_tag') {
    const tag = textOrNull(value);
    if (!tag) return jsonError('Tag value is required.');
    const { data: currentTickets, error: loadError } = await supabaseAdmin
      .from('support_tickets')
      .select('id, store_id, tags')
      .in('id', ticketIds);
    if (loadError) return jsonError(loadError.message, 500);

    const updatedRows: Array<{ id: string; store_id: string | null }> = [];
    for (const ticket of (currentTickets || []) as Array<{ id: string; store_id: string | null; tags: string[] | null }>) {
      const tags = Array.from(new Set([...(Array.isArray(ticket.tags) ? ticket.tags : []), tag]));
      const { error: updateError } = await supabaseAdmin
        .from('support_tickets')
        .update({ tags, updated_at: new Date().toISOString() })
        .eq('id', ticket.id);
      if (updateError) return jsonError(updateError.message, 500);
      updatedRows.push({ id: ticket.id, store_id: ticket.store_id });
    }

    await Promise.all(
      updatedRows.map(async (ticket) => {
        await insertActivity({
          ticketId: ticket.id,
          actorId: auth.user.id,
          activityType: 'bulk_action_applied',
          body: `Bulk action add_tag: ${reason}`,
          isPublic: false,
        });
      })
    );

    await auditSupportAction({
      actorUserId: auth.user.id,
      action: 'support.bulk_action',
      metadata: { ticket_ids: ticketIds, action, value },
      reason,
    });

    return NextResponse.json({ updated: updatedRows.length, message: 'Bulk action applied.' });
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (action === 'assign') payload.assigned_to = textOrNull(value);
  else if (action === 'close') {
    payload.status = 'closed';
    payload.closed_at = new Date().toISOString();
  } else if (action === 'set_priority') payload.priority = textOrNull(value) || 'normal';
  else return jsonError('Unsupported bulk action.');

  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .update(payload)
    .in('id', ticketIds)
    .select('id, store_id');

  if (error) return jsonError(error.message, 500);

  await Promise.all(
    ((data || []) as Array<{ id: string; store_id: string | null }>).map(async (ticket) => {
      await insertActivity({
        ticketId: ticket.id,
        actorId: auth.user.id,
        activityType: 'bulk_action_applied',
        body: `Bulk action ${action}: ${reason}`,
        isPublic: false,
      });
    })
  );

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.bulk_action',
    metadata: { ticket_ids: ticketIds, action, value },
    reason,
  });

  return NextResponse.json({ updated: data?.length || 0, message: 'Bulk action applied.' });
}
