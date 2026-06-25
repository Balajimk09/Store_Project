import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, boolValue, cleanCode, jsonError, numberValue, textOrNull } from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    groupId: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = textOrNull(body.name);
  const code = cleanCode(body.code || name);
  if (!name) return jsonError('Permission group name is required.');
  if (!code) return jsonError('Permission group code is required.');

  const payload = {
    name,
    code,
    description: textOrNull(body.description),
    sort_order: numberValue(body.sort_order),
    is_active: boolValue(body.is_active, true),
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data: oldRow } = await supabaseAdmin.from('platform_permission_groups').select('*').eq('id', context.params.groupId).maybeSingle();
  const { data, error } = await supabaseAdmin
    .from('platform_permission_groups')
    .update(payload)
    .eq('id', context.params.groupId)
    .select('*')
    .single();
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: boolValue(body.is_active, true) ? 'platform_permission_group.updated' : 'platform_permission_group.deactivated',
    targetTable: 'platform_permission_groups',
    targetRecordId: context.params.groupId,
    oldValues: (oldRow || null) as Record<string, unknown> | null,
    newValues: data as Record<string, unknown>,
  });

  return NextResponse.json({ group: data, message: 'Permission group updated.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { count } = await supabaseAdmin
    .from('platform_permissions')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', context.params.groupId);

  if ((count || 0) > 0) {
    const { error } = await supabaseAdmin
      .from('platform_permission_groups')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', context.params.groupId);
    if (error) return jsonError(error.message, 500);
    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'platform_permission_group.deactivated',
      targetTable: 'platform_permission_groups',
      targetRecordId: context.params.groupId,
      metadata: { permission_count: count || 0 },
    });
    return NextResponse.json({ message: 'Permission group is in use, so it was deactivated instead of deleted.' });
  }

  const { error } = await supabaseAdmin.from('platform_permission_groups').delete().eq('id', context.params.groupId);
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_permission_group.deleted',
    targetTable: 'platform_permission_groups',
    targetRecordId: context.params.groupId,
  });

  return NextResponse.json({ message: 'Permission group deleted.' });
}
