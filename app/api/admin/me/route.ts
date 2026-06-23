import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getAuthenticatedUser } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  const { data: permissions, error: permissionsError } = await supabaseAdmin
    .from('user_permissions')
    .select('permission_key, can_delegate')
    .eq('user_id', auth.user.id);

  if (permissionsError) {
    return NextResponse.json(
      { error: permissionsError.message },
      { status: 500 }
    );
  }

  const { data: isSuperadmin } = await supabaseAdmin.rpc('is_superadmin', {
    check_user_id: auth.user.id,
  });

  return NextResponse.json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
    },
    profile: profile || null,
    permissions: permissions || [],
    permissionKeys: (permissions || []).map((permission) => permission.permission_key),
    isSuperadmin: isSuperadmin === true,
  });
}