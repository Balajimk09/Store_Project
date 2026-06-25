import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type SupportPermission =
  | 'tickets.view'
  | 'tickets.reply'
  | 'tickets.assign'
  | 'tickets.close'
  | 'tickets.reopen'
  | 'tickets.merge'
  | 'tickets.export'
  | 'tickets.bulk_action'
  | 'tickets.add_internal_note'
  | 'tickets.add_tag'
  | 'tickets.set_follow_up'
  | 'tickets.log_call'
  | 'tickets.supervisor_review'
  | 'stores.view'
  | 'stores.search'
  | 'stores.view_360'
  | 'stores.edit_profile'
  | 'stores.flag'
  | 'stores.impersonate_view'
  | 'products.view'
  | 'products.edit'
  | 'products.bulk_update'
  | 'vendors.view'
  | 'vendors.edit'
  | 'billing.view'
  | 'billing.request_adjustment'
  | 'billing.approve_adjustment'
  | 'account.view_owner_email'
  | 'account.request_email_change'
  | 'account.send_password_reset'
  | 'account.set_temp_password'
  | 'account.deactivate_user'
  | 'account.reactivate_user'
  | 'approval.request_action'
  | 'approval.approve_action'
  | 'approval.reject_action'
  | 'knowledge_base.view'
  | 'knowledge_base.create'
  | 'knowledge_base.edit'
  | 'analytics.view';

export type SupportAuthResult =
  | {
      ok: true;
      user: {
        id: string;
        email?: string;
      };
      permissions: string[];
      roleCode: string | null;
      isSuperadmin: boolean;
    }
  | {
      ok: false;
      response: NextResponse;
    };

type PermissionRow = {
  permissions: string[] | null;
  role_code: string | null;
};

async function loadSupportPermissions(userId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_agent_permissions')
    .select('permissions, role_code')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    return { permissions: [], roleCode: null };
  }

  const row = data as PermissionRow | null;
  const rawPermissions = row?.permissions;
  const permissions = Array.isArray(rawPermissions) ? rawPermissions : [];

  return {
    permissions,
    roleCode: row?.role_code || null,
  };
}

export async function checkSupportPermission(
  request: NextRequest,
  permission: SupportPermission
): Promise<SupportAuthResult> {
  const authResult = await getAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult;
  }

  const superadmin = await requirePermission(request, 'platform.superadmin');
  if (superadmin.ok) {
    return {
      ok: true,
      user: authResult.user,
      permissions: ['ALL'],
      roleCode: 'superadmin',
      isSuperadmin: true,
    };
  }

  const support = await loadSupportPermissions(authResult.user.id);

  if (!support.permissions.includes(permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You do not have support permission for this action.' },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    user: authResult.user,
    permissions: support.permissions,
    roleCode: support.roleCode,
    isSuperadmin: false,
  };
}

export async function requireSupportPermission(
  request: NextRequest,
  permission: SupportPermission
): Promise<SupportAuthResult> {
  return checkSupportPermission(request, permission);
}

export async function getCurrentSupportPermissions(request: NextRequest): Promise<SupportAuthResult> {
  const authResult = await getAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult;
  }

  const superadmin = await requirePermission(request, 'platform.superadmin');
  if (superadmin.ok) {
    return {
      ok: true,
      user: authResult.user,
      permissions: ['ALL'],
      roleCode: 'superadmin',
      isSuperadmin: true,
    };
  }

  const support = await loadSupportPermissions(authResult.user.id);
  return {
    ok: true,
    user: authResult.user,
    permissions: support.permissions,
    roleCode: support.roleCode,
    isSuperadmin: false,
  };
}

export async function checkVerificationValid(ticketId: string, storeId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_verifications')
    .select('is_verified, expires_at, invalidated_at')
    .eq('ticket_id', ticketId)
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;

  const row = data as {
    is_verified: boolean | null;
    expires_at: string | null;
    invalidated_at: string | null;
  };

  return Boolean(
    row.is_verified &&
      row.expires_at &&
      new Date(row.expires_at).getTime() > Date.now() &&
      !row.invalidated_at
  );
}
