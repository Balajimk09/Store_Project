import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  auditSupportAction,
  insertActivity,
  jsonError,
  textOrNull,
} from '@/app/api/support/_lib';
import { approvalStatusPermission, executeApprovalAction } from '@/app/api/admin/support/_lib';

type RouteContext = { params: { itemId: string } };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const body = (await request.json()) as Record<string, unknown>;
  const status = textOrNull(body.status);
  const permission = approvalStatusPermission(status);
  const auth = await requireSupportPermission(request, permission);
  if (!auth.ok) return auth.response;

  const reviewerNote = textOrNull(body.reviewer_note);
  if (status !== 'approved' && status !== 'rejected') return jsonError('Status must be approved or rejected.');
  if (!reviewerNote) return jsonError('Reviewer note is required.');

  const supabaseAdmin = getSupabaseAdmin();
  let approvalResponse: Record<string, unknown> = {};
  if (status === 'approved') {
    approvalResponse = await executeApprovalAction(context.params.itemId, auth.user.id);
  }

  const finalStatus = status === 'approved' ? 'completed' : 'rejected';
  const { data: item, error } = await supabaseAdmin
    .from('support_approval_queue')
    .update({
      status: finalStatus,
      reviewer_note: reviewerNote,
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
      completed_at: status === 'approved' ? new Date().toISOString() : null,
    })
    .eq('id', context.params.itemId)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  const typedItem = item as { ticket_id?: string | null; store_id?: string | null };
  if (typedItem.ticket_id) {
    await insertActivity({
      ticketId: typedItem.ticket_id,
      actorId: auth.user.id,
      activityType: status === 'approved' ? 'approval_approved' : 'approval_rejected',
      body: reviewerNote,
      isPublic: false,
    });
  }

  await auditSupportAction({
    actorUserId: auth.user.id,
    action: status === 'approved' ? 'support.approval_approved' : 'support.approval_rejected',
    ticketId: typedItem.ticket_id || null,
    storeId: typedItem.store_id || null,
    table: 'support_approval_queue',
    recordId: context.params.itemId,
    newValues: (item || {}) as Record<string, unknown>,
    reason: reviewerNote,
  });

  return NextResponse.json({
    item,
    ...approvalResponse,
    message: status === 'approved' ? 'Approval completed.' : 'Approval rejected.',
  });
}
