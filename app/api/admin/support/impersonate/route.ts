import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { checkVerificationValid, requireSupportPermission } from '@/lib/support-auth';
import {
  auditSupportAction,
  insertActivity,
  jsonError,
  textOrNull,
} from '@/app/api/support/_lib';
import { loadTicket } from '@/app/api/admin/support/_lib';

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'stores.impersonate_view');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const storeId = textOrNull(body.store_id);
  const ticketId = textOrNull(body.ticket_id);
  const reason = textOrNull(body.reason);
  if (!storeId || !ticketId) return jsonError('Store and ticket are required.');
  if (!reason) return jsonError('Reason is required.');

  const ticket = await loadTicket(ticketId);
  if (!ticket || ticket.store_id !== storeId) return jsonError('Ticket/store mismatch.', 400);
  if (!(await checkVerificationValid(ticketId, storeId))) {
    return jsonError('Valid verification is required.', 403);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: existing } = await supabaseAdmin
    .from('support_impersonation_sessions')
    .select('id')
    .eq('agent_id', auth.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (existing) return jsonError('An active view session already exists.');

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: session, error } = await supabaseAdmin
    .from('support_impersonation_sessions')
    .insert({
      store_id: storeId,
      ticket_id: ticketId,
      agent_id: auth.user.id,
      reason,
      is_view_only: true,
      is_active: true,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await insertActivity({
    ticketId,
    actorId: auth.user.id,
    activityType: 'impersonation_started',
    body: 'Read-only support view mode started.',
    isPublic: false,
  });
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.impersonation_started',
    ticketId,
    storeId,
    table: 'support_impersonation_sessions',
    recordId: String((session as { id?: string }).id || ''),
    reason,
  });

  return NextResponse.json({
    sessionId: (session as { id: string }).id,
    expiresAt,
    message: 'Support view mode started.',
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'stores.impersonate_view');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = textOrNull(body.session_id);
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from('support_impersonation_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('agent_id', auth.user.id)
    .eq('is_active', true);
  if (sessionId) query = query.eq('id', sessionId);

  const { data, error } = await query.select('*');
  if (error) return jsonError(error.message, 500);

  const sessions = (data || []) as Array<{ ticket_id: string | null; store_id: string | null; id: string }>;
  await Promise.all(
    sessions.map(async (session) => {
      if (session.ticket_id) {
        await insertActivity({
          ticketId: session.ticket_id,
          actorId: auth.user.id,
          activityType: 'impersonation_ended',
          body: 'Read-only support view mode ended.',
          isPublic: false,
        });
      }
    })
  );

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.impersonation_ended',
    metadata: { session_ids: sessions.map((session) => session.id) },
  });

  return NextResponse.json({ message: 'Support view mode ended.' });
}
