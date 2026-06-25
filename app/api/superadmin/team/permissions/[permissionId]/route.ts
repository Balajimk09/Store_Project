import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, boolValue, jsonError, numberValue, textOrNull } from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    permissionId: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const permissionKey = textOrNull(body.permission_key);
  const label = textOrNull(body.label);
  if (!permissionKey) return jsonError('Permission key is required.');
  if (!label) return jsonError('Permission label is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data: oldRow } = await supabaseAdmin.from('platform_permissions').select('*').eq('id', context.params.permissionId).maybeSingle();
  const oldPermissionKey = textOrNull(((oldRow || {}) as Record<string, unknown>).permission_key) || '';

  if (oldPermissionKey === 'platform.superadmin' && boolValue(body.is_active, true) === false) {
    return jsonError('platform.superadmin cannot be deactivated from this screen.', 400);
  }

  const payload = {
    permission_key: oldPermissionKey === 'platform.superadmin' ? 'platform.superadmin' : permissionKey,
    label,
    group_id: textOrNull(body.group_id),
    group_name: textOrNull(body.group_name) || 'Custom',
    module_key: textOrNull(body.module_key),
    description: textOrNull(body.description),
    is_system_permission: oldPermissionKey === 'platform.superadmin' || boolValue(body.is_system_permission, false),
    is_dangerous: oldPermissionKey === 'platform.superadmin' || boolValue(body.is_dangerous, false),
    is_active: boolValue(body.is_active, true),
    sort_order: numberValue(body.sort_order),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('platform_permissions')
    .update(payload)
    .eq('id', context.params.permissionId)
    .select('*')
    .single();
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: boolValue(body.is_active, true) ? 'platform_permission.updated' : 'platform_permission.deactivated',
    targetTable: 'platform_permissions',
    targetRecordId: context.params.permissionId,
    oldValues: (oldRow || null) as Record<string, unknown> | null,
    newValues: data as Record<string, unknown>,
  });

  return NextResponse.json({ permission: data, message: 'Permission updated.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: permission, error: permissionError } = await supabaseAdmin
    .from('platform_permissions')
    .select('*')
    .eq('id', context.params.permissionId)
    .maybeSingle();

  if (permissionError) return jsonError(permissionError.message, 500);
  const row = (permission || {}) as Record<string, unknown>;
  const permissionKey = textOrNull(row.permission_key);
  if (!permissionKey) return jsonError('Permission not found.', 404);
  if (permissionKey === 'platform.superadmin') return jsonError('platform.superadmin cannot be deleted.', 400);

  const [{ count: userCount }, { count: roleCount }] = await Promise.all([
    supabaseAdmin.from('user_permissions').select('user_id', { count: 'exact', head: true }).eq('permission_key', permissionKey),
    supabaseAdmin.from('platform_role_permissions').select('role_id', { count: 'exact', head: true }).eq('permission_key', permissionKey),
  ]);

  if ((userCount || 0) > 0 || (roleCount || 0) > 0) {
    const { error } = await supabaseAdmin
      .from('platform_permissions')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', context.params.permissionId);
    if (error) return jsonError(error.message, 500);
    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'platform_permission.deactivated',
      targetTable: 'platform_permissions',
      targetRecordId: context.params.permissionId,
      metadata: { assigned_user_count: userCount || 0, assigned_role_count: roleCount || 0 },
    });
    return NextResponse.json({ message: 'Permission is in use, so it was deactivated instead of deleted.' });
  }

  const { error } = await supabaseAdmin.from('platform_permissions').delete().eq('id', context.params.permissionId);
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_permission.deleted',
    targetTable: 'platform_permissions',
    targetRecordId: context.params.permissionId,
  });

  return NextResponse.json({ message: 'Permission deleted.' });
}
