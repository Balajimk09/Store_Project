import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, requireAnyAdminPermission, textOrNull } from '@/app/api/admin/_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAnyAdminPermission(request, ['followups.manage']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = textOrNull(body.status);
  const payload = {
    status,
    completed_at: status === 'completed' ? new Date().toISOString() : textOrNull(body.completed_at),
    snoozed_until: textOrNull(body.snoozed_until),
    notes: textOrNull(body.notes),
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('admin_follow_ups')
    .update(payload)
    .eq('id', context.params.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'followup.updated',
    description: 'Updated follow-up.',
    relatedType: 'follow_up',
    relatedId: context.params.id,
    metadata: payload,
  });

  return NextResponse.json({ followUp: data, message: 'Follow-up updated.' });
}
