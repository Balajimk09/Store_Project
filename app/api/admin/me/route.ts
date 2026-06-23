import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requirePermission } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.dashboard.view');

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  const { data: permissions } = await supabaseAdmin
    .from('user_permissions')
    .select('permission_key, can_delegate')
    .eq('user_id', auth.user.id);

  return NextResponse.json({
    user: auth.user,
    profile,
    permissions: permissions || [],
  });
}