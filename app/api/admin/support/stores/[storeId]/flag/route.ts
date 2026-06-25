import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  auditSupportAction,
  insertActivity,
  jsonError,
  textOrNull,
} from '@/app/api/support/_lib';
import { normalizeFlagPayload } from '@/app/api/admin/support/_lib';

type RouteContext = { params: { storeId: string } };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'stores.flag');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const supabaseAdmin = getSupabaseAdmin();
  const { data: flag, error } = await supabaseAdmin
    .from('support_store_flags')
    .insert({ ...normalizeFlagPayload(body, auth.user.id), store_id: context.params.storeId })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await insertActivity({
    ticketId: textOrNull(body.ticket_id) || '',
    actorId: auth.user.id,
    activityType: 'store_flagged',
    body: `Store flagged: ${String((flag as { flag_type?: string }).flag_type || 'watch')}`,
    isPublic: false,
  }).catch(() => undefined);
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.store_flagged',
    storeId: context.params.storeId,
    table: 'support_store_flags',
    recordId: String((flag as { id?: string }).id || ''),
    newValues: (flag || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ flag, message: 'Store flag added.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'stores.flag');
  if (!auth.ok) return auth.response;

  const flagId = request.nextUrl.searchParams.get('flag_id');
  if (!flagId) return jsonError('Flag ID is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: flag, error } = await supabaseAdmin
    .from('support_store_flags')
    .update({ is_active: false, resolved_at: new Date().toISOString(), resolved_by: auth.user.id })
    .eq('id', flagId)
    .eq('store_id', context.params.storeId)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.store_unflagged',
    storeId: context.params.storeId,
    table: 'support_store_flags',
    recordId: flagId,
    newValues: (flag || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ flag, message: 'Store flag removed.' });
}
