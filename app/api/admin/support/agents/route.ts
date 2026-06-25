import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { createAdminAuditLog } from '@/lib/audit-log';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { ALL_SUPPORT_PERMISSIONS, ROLE_PRESETS } from '@/app/api/admin/support/_lib';
import { arrayOfStrings, jsonError, textOrNull } from '@/app/api/support/_lib';

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_agent_permissions')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) return jsonError(error.message, 500);

  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const users = new Map(usersData.users.map((user) => [user.id, user]));
  const agents = (data || []).map((agent) => {
    const user = users.get(agent.user_id);
    return {
      ...agent,
      email: user?.email || agent.email || null,
      name: user?.user_metadata?.full_name || user?.email || agent.user_id,
    };
  });

  return NextResponse.json({ agents, roles: ROLE_PRESETS, permissions: ALL_SUPPORT_PERMISSIONS });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const userId = textOrNull(body.user_id);
  const email = textOrNull(body.email);
  const roleCode = textOrNull(body.role_code) || 'agent';
  if (!userId && !email) return jsonError('User ID or email is required.');

  const supabaseAdmin = getSupabaseAdmin();
  let resolvedUserId = userId;
  let resolvedEmail = email;

  if (!resolvedUserId && email) {
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = usersData.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (!found) return jsonError('User not found for that email.', 404);
    resolvedUserId = found.id;
    resolvedEmail = found.email || email;
  }

  const permissions = arrayOfStrings(body.permissions);
  const fallbackPermissions = ROLE_PRESETS[roleCode] || [];
  const cleanPermissions = (permissions.length ? permissions : fallbackPermissions).filter((permission) =>
    ALL_SUPPORT_PERMISSIONS.includes(permission as (typeof ALL_SUPPORT_PERMISSIONS)[number])
  );

  const { data: agent, error } = await supabaseAdmin
    .from('support_agent_permissions')
    .upsert(
      {
        user_id: resolvedUserId,
        email: resolvedEmail,
        role_code: roleCode,
        permissions: cleanPermissions,
        is_active: body.is_active !== false,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await createAdminAuditLog({
    actorUserId: auth.user.id,
    action: 'support.agent_updated',
    targetUserId: resolvedUserId,
    targetTable: 'support_agent_permissions',
    targetRecordId: String((agent as { id?: string }).id || resolvedUserId),
    newValues: (agent || {}) as Record<string, unknown>,
    metadata: {},
  });

  return NextResponse.json({ agent, message: 'Support agent permissions saved.' });
}
