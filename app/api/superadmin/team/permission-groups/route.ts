import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { auditStaffAction, boolValue, cleanCode, jsonError, numberValue, textOrNull } from '@/app/api/superadmin/team/_lib';

export async function POST(request: NextRequest) {
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
  const { data, error } = await supabaseAdmin.from('platform_permission_groups').insert(payload).select('*').single();
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_permission_group.created',
    targetTable: 'platform_permission_groups',
    targetRecordId: String((data as { id?: string }).id || ''),
    newValues: data as Record<string, unknown>,
  });

  return NextResponse.json({ group: data, message: 'Permission group created.' });
}
