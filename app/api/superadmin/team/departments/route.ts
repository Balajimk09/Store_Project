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
  const { data, error } = await supabaseAdmin.from('platform_departments').insert(payload).select('*').single();
  if (error) return jsonError(error.message, 500);

  await auditStaffAction({
    actorUserId: auth.user.id,
    action: 'platform_department.created',
    targetTable: 'platform_departments',
    targetRecordId: String((data as { id?: string }).id || ''),
    newValues: data as Record<string, unknown>,
  });

  return NextResponse.json({ department: data, message: 'Department created.' });
}
