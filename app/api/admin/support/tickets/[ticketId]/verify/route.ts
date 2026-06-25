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
  const auth = await requireSupportPermission(request, 'stores.view');
  if (!auth.ok) return auth.response;

  const ticket = await loadTicket(context.params.ticketId);
  if (!ticket || !ticket.store_id) return jsonError('Ticket not found.', 404);

  const body = (await request.json()) as Record<string, unknown>;
  const checklist = Array.isArray(body.checklist) ? body.checklist : [];
  const reason = textOrNull(body.reason);
  if (!reason) return jsonError('Verification reason is required.');

  const verifiedCount = checklist.filter(Boolean).length;
  const isVerified = verifiedCount >= 4;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const supabaseAdmin = getSupabaseAdmin();
  const { data: verification, error } = await supabaseAdmin
    .from('support_verifications')
    .insert({
      ticket_id: ticket.id,
      store_id: ticket.store_id,
      verified_by: auth.user.id,
      checklist,
      reason,
      is_verified: isVerified,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  if (isVerified) {
    await supabaseAdmin
      .from('support_tickets')
      .update({ verified_at: new Date().toISOString(), verified_by: auth.user.id })
      .eq('id', ticket.id);
  }

  await insertActivity({
    ticketId: ticket.id,
    actorId: auth.user.id,
    activityType: 'identity_verified',
    body: isVerified ? 'Identity verified for 30 minutes.' : 'Identity verification failed.',
    metadata: { verified_count: verifiedCount },
    isPublic: false,
  });

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.store_verified',
    ticketId: ticket.id,
    storeId: ticket.store_id,
    table: 'support_verifications',
    recordId: String((verification as { id?: string }).id || ''),
    newValues: (verification || {}) as Record<string, unknown>,
    reason,
  });

  return NextResponse.json({ verification, verified: isVerified, expires_at: expiresAt });
}
