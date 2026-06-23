import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, generateTemporaryPassword } from '@/lib/supabase-admin';
import { logAdminAction, requirePermission } from '@/lib/admin-auth';

type CreateUserBody = {
  email: string;
  username?: string;
  fullName?: string;
  phone?: string;
  password?: string;
  accountType?: string;
  roleLabel?: string;
  status?: string;
  permissions?: Array<{
    permission_key: string;
    can_delegate?: boolean;
  }>;
};

function cleanEmail(value: string) {
  return value.trim().toLowerCase();
}

function cleanUsername(value?: string) {
  if (!value) return null;

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'users.view');

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: permissions, error: permissionsError } = await supabaseAdmin
    .from('permissions')
    .select('permission_key, category, action, label, description, is_dangerous, sort_order')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });

  if (permissionsError) {
    return NextResponse.json(
      { error: permissionsError.message },
      { status: 500 }
    );
  }

  const { data: authUsersData, error: authUsersError } =
    await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 100,
    });

  if (authUsersError) {
    return NextResponse.json(
      { error: authUsersError.message },
      { status: 500 }
    );
  }

  const authUsers = authUsersData.users || [];
  const userIds = authUsers.map((user) => user.id);

  const { data: profiles } = userIds.length
    ? await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .in('user_id', userIds)
    : { data: [] };

  const { data: userPermissions } = userIds.length
    ? await supabaseAdmin
        .from('user_permissions')
        .select('user_id, permission_key, can_delegate')
        .in('user_id', userIds)
    : { data: [] };

  const { data: stores } = userIds.length
    ? await supabaseAdmin
        .from('stores')
        .select('id, owner_id, store_name')
        .in('owner_id', userIds)
    : { data: [] };

  const profileByUserId = new Map((profiles || []).map((profile) => [profile.user_id, profile]));
  const storesByOwnerId = new Map<string, Array<{ id: string; store_name: string | null }>>();

  for (const store of stores || []) {
    const current = storesByOwnerId.get(store.owner_id) || [];
    current.push({
      id: store.id,
      store_name: store.store_name,
    });
    storesByOwnerId.set(store.owner_id, current);
  }

  const permissionsByUserId = new Map<string, Array<{ permission_key: string; can_delegate: boolean }>>();

  for (const permission of userPermissions || []) {
    const current = permissionsByUserId.get(permission.user_id) || [];
    current.push({
      permission_key: permission.permission_key,
      can_delegate: permission.can_delegate,
    });
    permissionsByUserId.set(permission.user_id, current);
  }

  const users = authUsers.map((user) => ({
    id: user.id,
    email: user.email,
    phone: user.phone,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    profile: profileByUserId.get(user.id) || null,
    stores: storesByOwnerId.get(user.id) || [],
    permissions: permissionsByUserId.get(user.id) || [],
  }));

  return NextResponse.json({
    users,
    permissions: permissions || [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'users.create');

  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json()) as CreateUserBody;

  const email = cleanEmail(body.email || '');
  const username = cleanUsername(body.username);
  const password = body.password?.trim() || generateTemporaryPassword();
  const fullName = body.fullName?.trim() || null;
  const phone = body.phone?.trim() || null;
  const accountType = body.accountType || 'store_user';
  const roleLabel = body.roleLabel?.trim() || 'User';
  const status = body.status || 'active';
  const selectedPermissions = body.permissions || [];

  if (!email) {
    return NextResponse.json(
      { error: 'Email is required.' },
      { status: 400 }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: createdUser, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username,
      },
    });

  if (createError || !createdUser.user) {
    return NextResponse.json(
      { error: createError?.message || 'Failed to create user.' },
      { status: 500 }
    );
  }

  const newUserId = createdUser.user.id;

  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        user_id: newUserId,
        username,
        email,
        full_name: fullName,
        phone,
        account_type: accountType,
        role_label: roleLabel,
        status,
        must_change_password: true,
        created_by: auth.user.id,
        last_admin_reset_at: new Date().toISOString(),
        last_admin_reset_by: auth.user.id,
      },
      { onConflict: 'user_id' }
    );

  if (profileError) {
    return NextResponse.json(
      { error: profileError.message },
      { status: 500 }
    );
  }

  if (selectedPermissions.length > 0) {
    const permissionRows = selectedPermissions.map((permission) => ({
      user_id: newUserId,
      permission_key: permission.permission_key,
      can_delegate: Boolean(permission.can_delegate),
      granted_by: auth.user.id,
    }));

    const { error: permissionError } = await supabaseAdmin
      .from('user_permissions')
      .upsert(permissionRows, { onConflict: 'user_id,permission_key' });

    if (permissionError) {
      return NextResponse.json(
        { error: permissionError.message },
        { status: 500 }
      );
    }
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    action: 'users.create',
    targetUserId: newUserId,
    targetTable: 'user_profiles',
    targetRecordId: newUserId,
    newValues: {
      email,
      username,
      accountType,
      roleLabel,
      status,
      permissions: selectedPermissions,
    },
    metadata: {
      temporary_password_created: true,
    },
    reason: 'Created from Superadmin Users page.',
  });

  return NextResponse.json({
    userId: newUserId,
    email,
    username,
    temporaryPassword: password,
    message: 'User created successfully. Share the temporary password only after verifying the user.',
  });
}