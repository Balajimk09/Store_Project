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

const VALID_ACCOUNT_TYPES = new Set([
  'store_user',
  'store_owner',
  'platform_internal',
  'support_user',
  'marketing_user',
  'sales_user',
]);

const VALID_STATUSES = new Set(['active', 'inactive', 'disabled']);

function cleanEmail(value: string) {
  return value.trim().toLowerCase();
}

function cleanUsername(value?: string) {
  if (!value) return null;

  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  return cleaned || null;
}

function cleanPhone(value?: string) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function normalizePhoneForAuth(value?: string) {
  if (!value?.trim()) return null;

  const trimmed = value.trim();

  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');

  if (!digits) return null;

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  if (digits.length >= 7) {
    return `+${digits}`;
  }

  return null;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function uniquePermissions(
  permissions: CreateUserBody['permissions']
): Array<{ permission_key: string; can_delegate: boolean }> {
  const map = new Map<string, { permission_key: string; can_delegate: boolean }>();

  for (const permission of permissions || []) {
    const permissionKey = permission.permission_key?.trim();

    if (!permissionKey) continue;

    const existing = map.get(permissionKey);

    map.set(permissionKey, {
      permission_key: permissionKey,
      can_delegate: Boolean(existing?.can_delegate || permission.can_delegate),
    });
  }

  return Array.from(map.values());
}

async function rollbackCreatedAuthUser(userId: string) {
  const supabaseAdmin = getSupabaseAdmin();

  try {
    await supabaseAdmin.auth.admin.deleteUser(userId);
  } catch {
    // Best-effort cleanup only.
  }
}

async function actorIsSuperadmin(actorUserId: string) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data } = await supabaseAdmin.rpc('is_superadmin', {
    check_user_id: actorUserId,
  });

  return data === true;
}

async function actorHasPermission(actorUserId: string, permissionKey: string) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data } = await supabaseAdmin.rpc('has_permission', {
    check_user_id: actorUserId,
    required_permission: permissionKey,
  });

  return data === true;
}

async function validatePermissionGrant(
  actorUserId: string,
  selectedPermissions: Array<{ permission_key: string; can_delegate: boolean }>
) {
  if (selectedPermissions.length === 0) {
    return null;
  }

  const supabaseAdmin = getSupabaseAdmin();

  const isSuperadmin = await actorIsSuperadmin(actorUserId);

  if (isSuperadmin) {
    return null;
  }

  const canAssignPermissions = await actorHasPermission(actorUserId, 'team.assign_permissions');

  if (!canAssignPermissions) {
    return 'You can create users, but you do not have permission to assign permissions.';
  }

  const requestedPermissionKeys = selectedPermissions.map(
    (permission) => permission.permission_key
  );

  const { data: actorDelegations, error } = await supabaseAdmin
    .from('user_permissions')
    .select('permission_key, can_delegate')
    .eq('user_id', actorUserId)
    .in('permission_key', requestedPermissionKeys);

  if (error) {
    return error.message;
  }

  const delegableKeys = new Set(
    (actorDelegations || [])
      .filter((permission) => permission.can_delegate)
      .map((permission) => permission.permission_key)
  );

  const missingDelegation = selectedPermissions.find(
    (permission) => !delegableKeys.has(permission.permission_key)
  );

  if (missingDelegation) {
    return `You cannot grant "${missingDelegation.permission_key}" because you are not allowed to delegate it.`;
  }

  const requestedCanDelegate = selectedPermissions.some(
    (permission) => permission.can_delegate
  );

  if (requestedCanDelegate) {
    const canDelegatePermissions = await actorHasPermission(
      actorUserId,
      'team.delegate_permissions'
    );

    if (!canDelegatePermissions) {
      return 'You cannot mark permissions as delegable.';
    }
  }

  return null;
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

  const { data: profiles, error: profilesError } = userIds.length
    ? await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .in('user_id', userIds)
    : { data: [], error: null };

  if (profilesError) {
    return NextResponse.json(
      { error: profilesError.message },
      { status: 500 }
    );
  }

  const { data: userPermissions, error: userPermissionsError } = userIds.length
    ? await supabaseAdmin
        .from('user_permissions')
        .select('user_id, permission_key, can_delegate')
        .in('user_id', userIds)
    : { data: [], error: null };

  if (userPermissionsError) {
    return NextResponse.json(
      { error: userPermissionsError.message },
      { status: 500 }
    );
  }

  const { data: ownerStores, error: ownerStoresError } = userIds.length
    ? await supabaseAdmin
        .from('stores')
        .select('id, owner_id, store_name')
        .in('owner_id', userIds)
    : { data: [], error: null };

  if (ownerStoresError) {
    return NextResponse.json(
      { error: ownerStoresError.message },
      { status: 500 }
    );
  }

  const { data: storeAccessRows, error: storeAccessError } = userIds.length
    ? await supabaseAdmin
        .from('user_store_access')
        .select('user_id, store_id')
        .in('user_id', userIds)
    : { data: [], error: null };

  if (storeAccessError) {
    return NextResponse.json(
      { error: storeAccessError.message },
      { status: 500 }
    );
  }

  const accessStoreIds = Array.from(
    new Set((storeAccessRows || []).map((row) => row.store_id).filter(Boolean))
  );

  const { data: accessStores, error: accessStoresError } = accessStoreIds.length
    ? await supabaseAdmin
        .from('stores')
        .select('id, store_name')
        .in('id', accessStoreIds)
    : { data: [], error: null };

  if (accessStoresError) {
    return NextResponse.json(
      { error: accessStoresError.message },
      { status: 500 }
    );
  }

  const profileByUserId = new Map(
    (profiles || []).map((profile) => [profile.user_id, profile])
  );

  const storeById = new Map(
    (accessStores || []).map((store) => [store.id, store])
  );

  const storesByUserId = new Map<
    string,
    Array<{ id: string; store_name: string | null }>
  >();

  for (const store of ownerStores || []) {
    const current = storesByUserId.get(store.owner_id) || [];
    current.push({
      id: store.id,
      store_name: store.store_name,
    });
    storesByUserId.set(store.owner_id, current);
  }

  for (const access of storeAccessRows || []) {
    const store = storeById.get(access.store_id);

    if (!store) continue;

    const current = storesByUserId.get(access.user_id) || [];
    const alreadyAdded = current.some((item) => item.id === store.id);

    if (!alreadyAdded) {
      current.push({
        id: store.id,
        store_name: store.store_name,
      });
    }

    storesByUserId.set(access.user_id, current);
  }

  const permissionsByUserId = new Map<
    string,
    Array<{ permission_key: string; can_delegate: boolean }>
  >();

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
    stores: storesByUserId.get(user.id) || [],
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

  let body: CreateUserBody;

  try {
    body = (await request.json()) as CreateUserBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400 }
    );
  }

  const email = cleanEmail(body.email || '');
  const username = cleanUsername(body.username);
  const password = body.password?.trim() || generateTemporaryPassword();
  const fullName = body.fullName?.trim() || null;
  const phone = cleanPhone(body.phone);
  const authPhone = normalizePhoneForAuth(body.phone);
  const requestedAccountType = body.accountType?.trim() || 'store_user';
  const supabaseAdmin = getSupabaseAdmin();

const { data: accountTypeRow, error: accountTypeError } = await supabaseAdmin
  .from('platform_account_types')
  .select('account_type_key, label')
  .eq('account_type_key', requestedAccountType)
  .eq('is_active', true)
  .maybeSingle();

if (accountTypeError) {
  return NextResponse.json(
    { error: accountTypeError.message },
    { status: 500 }
  );
}

if (!accountTypeRow) {
  return NextResponse.json(
    { error: 'Select a valid account type.' },
    { status: 400 }
  );
}

const accountType = accountTypeRow.account_type_key;
const roleLabel = accountTypeRow.label;
  const status = VALID_STATUSES.has(body.status || '')
    ? body.status || 'active'
    : 'active';
  const selectedPermissions = uniquePermissions(body.permissions);

  if (!email) {
    return NextResponse.json(
      { error: 'Email is required.' },
      { status: 400 }
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: 'Enter a valid email address.' },
      { status: 400 }
    );
  }

  if (username && username.length < 3) {
    return NextResponse.json(
      { error: 'Username must be at least 3 characters.' },
      { status: 400 }
    );
  }

  if (body.password?.trim() && password.length < 8) {
    return NextResponse.json(
      { error: 'Temporary password must be at least 8 characters.' },
      { status: 400 }
    );
  }

  const permissionGrantError = await validatePermissionGrant(
    auth.user.id,
    selectedPermissions
  );

  if (permissionGrantError) {
    return NextResponse.json(
      { error: permissionGrantError },
      { status: 403 }
    );
  }


  const { data: existingEmailProfile, error: existingEmailError } =
    await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('email', email)
      .maybeSingle();

  if (existingEmailError) {
    return NextResponse.json(
      { error: existingEmailError.message },
      { status: 500 }
    );
  }

  if (existingEmailProfile) {
    return NextResponse.json(
      { error: 'A user profile already exists with this email.' },
      { status: 409 }
    );
  }

  if (username) {
    const { data: existingUsernameProfile, error: existingUsernameError } =
      await supabaseAdmin
        .from('user_profiles')
        .select('user_id')
        .eq('username', username)
        .maybeSingle();

    if (existingUsernameError) {
      return NextResponse.json(
        { error: existingUsernameError.message },
        { status: 500 }
      );
    }

    if (existingUsernameProfile) {
      return NextResponse.json(
        { error: 'This username is already taken.' },
        { status: 409 }
      );
    }
  }

  const { data: createdUser, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      phone: authPhone || undefined,
      phone_confirm: Boolean(authPhone),
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
    await rollbackCreatedAuthUser(newUserId);

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
      await rollbackCreatedAuthUser(newUserId);

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
      phone,
      accountType,
      roleLabel,
      status,
      permissions: selectedPermissions,
    },
    metadata: {
      temporary_password_created: true,
      auth_phone_added: Boolean(authPhone),
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