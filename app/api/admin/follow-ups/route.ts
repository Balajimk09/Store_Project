import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, requireAnyAdminPermission, textOrNull } from '@/app/api/admin/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['followups.view']);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin.from('admin_follow_ups').select('*').order('due_at', { ascending: true }).limit(200);

  const status = params.get('status');
  const relatedType = params.get('related_type');
  const assignedTo = params.get('assigned_to');
  const storeId = params.get('store_id');
  if (status) query = query.eq('status', status);
  if (relatedType) query = query.eq('related_type', relatedType);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (storeId) query = query.eq('store_id', storeId);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ followUps: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['followups.manage']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = textOrNull(body.title);
  const dueAt = textOrNull(body.due_at);
  if (!title) return jsonError('Title is required.');
  if (!dueAt) return jsonError('Due date is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('admin_follow_ups')
    .insert({
      title,
      due_at: dueAt,
      related_type: textOrNull(body.related_type) || 'other',
      related_id: textOrNull(body.related_id),
      store_id: textOrNull(body.store_id),
      assigned_to: textOrNull(body.assigned_to) || auth.user.id,
      created_by: auth.user.id,
      notes: textOrNull(body.notes),
      priority: textOrNull(body.priority) || 'normal',
      status: 'open',
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'followup.created',
    description: `Created follow-up "${title}".`,
    relatedType: 'follow_up',
    relatedId: String(data.id),
    storeId: textOrNull(body.store_id),
    metadata: { due_at: dueAt, priority: textOrNull(body.priority) || 'normal' },
  });

  return NextResponse.json({ followUp: data, message: 'Follow-up created.' });
}
