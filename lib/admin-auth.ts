import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type AdminAuthResult =
  | {
      ok: true;
      user: {
        id: string;
        email?: string;
      };
    }
  | {
      ok: false;
      response: NextResponse;
    };

function getBearerToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.replace('Bearer ', '').trim();
}

export async function getAuthenticatedUser(request: NextRequest): Promise<AdminAuthResult> {
  const token = getBearerToken(request);

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing authorization token.' },
        { status: 401 }
      ),
    };
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid or expired session.' },
        { status: 401 }
      ),
    };
  }

  return {
    ok: true,
    user: {
      id: data.user.id,
      email: data.user.email || undefined,
    },
  };
}

export async function requirePermission(
  request: NextRequest,
  permissionKey = 'platform.superadmin'
): Promise<AdminAuthResult> {
  const authResult = await getAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult;
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin.rpc('has_permission', {
    check_user_id: authResult.user.id,
    required_permission: permissionKey,
  });

  if (error || data !== true) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You do not have permission to access this resource.' },
        { status: 403 }
      ),
    };
  }

  return authResult;
}

export async function requireSuperadmin(request: NextRequest): Promise<AdminAuthResult> {
  return requirePermission(request, 'platform.superadmin');
}

export async function logAdminAction(input: {
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  targetStoreId?: string | null;
  targetTable?: string | null;
  targetRecordId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  reason?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();

  await supabaseAdmin.from('admin_audit_logs').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    target_user_id: input.targetUserId || null,
    target_store_id: input.targetStoreId || null,
    target_table: input.targetTable || null,
    target_record_id: input.targetRecordId || null,
    old_values: input.oldValues || null,
    new_values: input.newValues || null,
    metadata: input.metadata || {},
    reason: input.reason || null,
  });
}