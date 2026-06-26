import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, requireAnyAdminPermission, textOrNull } from '@/app/api/admin/_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAnyAdminPermission(request, ['demo_requests.manage']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payload = {
    status: textOrNull(body.status),
    notes: textOrNull(body.notes),
    assigned_to: textOrNull(body.assigned_to),
    next_follow_up_at: textOrNull(body.next_follow_up_at),
    last_contacted_at: textOrNull(body.last_contacted_at),
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('demo_requests')
    .update(payload)
    .eq('id', context.params.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'demo_request.updated',
    description: 'Updated demo request.',
    relatedType: 'demo_request',
    relatedId: context.params.id,
    metadata: payload,
  });

  return NextResponse.json({ demoRequest: data, message: 'Demo request updated.' });
}
