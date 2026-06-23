import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, generateTemporaryPassword } from '@/lib/supabase-admin';
import { logAdminAction, requirePermission } from '@/lib/admin-auth';

type RouteContext = {
  params: {
    userId: string;
  };
};

type ResetPasswordBody = {
  password?: string;
  reason?: string;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'users.reset_password');

  if (!auth.ok) {
    return auth.response;
  }

  const targetUserId = context.params.userId;
  const body = (await request.json()) as ResetPasswordBody;
  const temporaryPassword = body.password?.trim() || generateTemporaryPassword();

  const supabaseAdmin = getSupabaseAdmin();

  const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(
    targetUserId,
    {
      password: temporaryPassword,
    }
  );

  if (resetError) {
    return NextResponse.json(
      { error: resetError.message },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from('user_profiles')
    .update({
      must_change_password: true,
      last_admin_reset_at: new Date().toISOString(),
      last_admin_reset_by: auth.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', targetUserId);

  await logAdminAction({
    actorUserId: auth.user.id,
    action: 'users.reset_password',
    targetUserId,
    targetTable: 'auth.users',
    targetRecordId: targetUserId,
    metadata: {
      temporary_password_created: true,
      must_change_password: true,
    },
    reason: body.reason || 'Password reset from Superadmin.',
  });

  return NextResponse.json({
    temporaryPassword,
    message: 'Temporary password created. User must change password after login.',
  });
}