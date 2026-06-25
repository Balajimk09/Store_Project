import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import { auditSupportAction, jsonError, textOrNull } from '@/app/api/support/_lib';

type RouteContext = { params: { id: string } };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'billing.approve_adjustment');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const status = textOrNull(body.status);
  if (!status) return jsonError('Status is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: adjustment, error } = await supabaseAdmin
    .from('support_billing_adjustments')
    .update({
      status,
      reviewer_note: textOrNull(body.reviewer_note),
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', context.params.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.billing_adjustment_updated',
    table: 'support_billing_adjustments',
    recordId: context.params.id,
    newValues: (adjustment || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ adjustment, message: 'Billing adjustment updated.' });
}
