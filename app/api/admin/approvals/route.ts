import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, requireAnyAdminPermission, textOrNull } from '@/app/api/admin/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['approvals.view', 'approval.request_action']);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from('support_approval_queue').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ approvals: [] });
  return NextResponse.json({ approvals: data || [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['approval.approve_action', 'approvals.manage']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = textOrNull(body.id);
  if (!id) return jsonError('Approval id is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_approval_queue')
    .update({
      status: textOrNull(body.status) || 'pending',
      reviewer_note: textOrNull(body.reviewer_note),
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'approval.updated',
    description: 'Updated approval request.',
    relatedType: 'approval',
    relatedId: id,
    metadata: { status: textOrNull(body.status), reviewer_note: textOrNull(body.reviewer_note) },
  });

  return NextResponse.json({ approval: data, message: 'Approval updated.' });
}
