import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, boolValue, cleanCode, jsonError, numberValue, textOrNull } from '@/app/api/superadmin/team/_lib';

type RouteContext = {
  params: {
    departmentId: string;
  };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = textOrNull(body.name);
  const code = cleanCode(body.code || name);
  if (!name) return jsonError('Department name is required.');
  if (!code) return jsonError('Department code is required.');

  const payload = {
    name,
    code,
    color: textOrNull(body.color) || 'gray',
    description: textOrNull(body.description),
    sort_order: numberValue(body.sort_order),
    is_active: boolValue(body.is_active, true),
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data: oldRow } = await supabaseAdmin.from('platform_departments').select('*').eq('id', context.params.departmentId).maybeSingle();
  const { data, error } = await supabaseAdmin
    .from('platform_departments')
    .update(payload)
    .eq('id', context.params.departmentId)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: boolValue(body.is_active, true) ? 'platform_department.updated' : 'platform_department.deactivated',
    targetTable: 'platform_departments',
    targetRecordId: context.params.departmentId,
    oldValues: (oldRow || null) as Record<string, unknown> | null,
    newValues: data as Record<string, unknown>,
  });

  return NextResponse.json({ department: data, message: 'Department updated.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const [{ count: staffCount }, { count: roleCount }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id', { count: 'exact', head: true }).eq('platform_department_id', context.params.departmentId),
    supabaseAdmin.from('platform_roles').select('id', { count: 'exact', head: true }).eq('department_id', context.params.departmentId),
  ]);

  if ((staffCount || 0) > 0 || (roleCount || 0) > 0) {
    const { error } = await supabaseAdmin
      .from('platform_departments')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', context.params.departmentId);
    if (error) return jsonError(error.message, 500);
    await auditStaffAction({
      actorUserId: auth.user.id,
      action: 'platform_department.deactivated',
      targetTable: 'platform_departments',
      targetRecordId: context.params.departmentId,
      metadata: { staff_count: staffCount || 0, role_count: roleCount || 0 },
    });
    return NextResponse.json({ message: 'Department is in use, so it was deactivated instead of deleted.' });
  }

  const { error } = await supabaseAdmin.from('platform_departments').delete().eq('id', context.params.departmentId);
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_department.deleted',
    targetTable: 'platform_departments',
    targetRecordId: context.params.departmentId,
  });

  return NextResponse.json({ message: 'Department deleted.' });
}
