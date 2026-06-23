import { NextRequest, NextResponse } from 'next/server';
import { generateTemporaryPassword, getSupabaseAdmin } from '@/lib/supabase-admin';
import { logAdminAction, requirePermission } from '@/lib/admin-auth';

type ResetPasswordBody = {
  reason?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const auth = await requirePermission(request, 'users.reset_password');

  if (!auth.ok) {
    return auth.response;
  }

  const targetUserId = params.userId;

  if (!targetUserId) {
    return NextResponse.json(
      { error: 'Missing user ID.' },
      { status: 400 }
    );
  }

  if (targetUserId === auth.user.id) {
    return NextResponse.json(
      { error: 'You cannot reset your own password from this action.' },
      { status: 400 }
    );
  }

  let body: ResetPasswordBody = {};

  try {
    body = (await request.json()) as ResetPasswordBody;
  } catch {
    body = {};
  }

  const reason = body.reason?.trim() || 'Password reset from Superadmin.';
  const temporaryPassword = generateTemporaryPassword();
  const supabaseAdmin = getSupabaseAdmin();

  const { data: targetUserData, error: targetUserError } =
    await supabaseAdmin.auth.admin.getUserById(targetUserId);

  if (targetUserError || !targetUserData.user) {
    return NextResponse.json(
      { error: targetUserError?.message || 'User not found.' },
      { status: 404 }
    );
  }

  const { data: oldProfile } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, username, full_name, phone, status, must_change_password, last_admin_reset_at, last_admin_reset_by')
    .eq('user_id', targetUserId)
    .maybeSingle();

  const { error: updateAuthError } =
    await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: temporaryPassword,
      user_metadata: {
        ...(targetUserData.user.user_metadata || {}),
        must_change_password: true,
      },
    });

  if (updateAuthError) {
    return NextResponse.json(
      { error: updateAuthError.message },
      { status: 500 }
    );
  }

  const { error: profileUpdateError } = await supabaseAdmin
    .from('user_profiles')
    .update({
      must_change_password: true,
      last_admin_reset_at: new Date().toISOString(),
      last_admin_reset_by: auth.user.id,
    })
    .eq('user_id', targetUserId);

  if (profileUpdateError) {
    return NextResponse.json(
      { error: profileUpdateError.message },
      { status: 500 }
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    action: 'users.reset_password',
    targetUserId,
    targetTable: 'user_profiles',
    targetRecordId: targetUserId,
    oldValues: oldProfile || null,
    newValues: {
      must_change_password: true,
      last_admin_reset_by: auth.user.id,
    },
    metadata: {
      temporary_password_created: true,
      target_email: targetUserData.user.email || null,
    },
    reason,
  });

  return NextResponse.json({
    temporaryPassword,
    message: 'Password reset successfully. Share the temporary password only after verifying the user.',
  });
}