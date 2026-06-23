import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logAdminAction, requirePermission } from '@/lib/admin-auth';

type CreateAccountTypeBody = {
  label?: string;
  description?: string;
};

function cleanLabel(value?: string) {
  return value?.trim() || '';
}

function createAccountTypeKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'users.view');

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from('platform_account_types')
    .select('id, account_type_key, label, description, is_active, is_system, sort_order, created_at, updated_at')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    accountTypes: data || [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, 'settings.edit');

  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateAccountTypeBody;

  try {
    body = (await request.json()) as CreateAccountTypeBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400 }
    );
  }

  const label = cleanLabel(body.label);
  const description = body.description?.trim() || null;
  const accountTypeKey = createAccountTypeKey(label);

  if (!label) {
    return NextResponse.json(
      { error: 'Account type name is required.' },
      { status: 400 }
    );
  }

  if (label.length < 2) {
    return NextResponse.json(
      { error: 'Account type name must be at least 2 characters.' },
      { status: 400 }
    );
  }

  if (!accountTypeKey) {
    return NextResponse.json(
      { error: 'Account type name must include letters or numbers.' },
      { status: 400 }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing } = await supabaseAdmin
    .from('platform_account_types')
    .select('id, account_type_key, label, is_active')
    .eq('account_type_key', accountTypeKey)
    .maybeSingle();

  if (existing) {
    if (!existing.is_active) {
      const { data: reactivated, error: reactivateError } = await supabaseAdmin
        .from('platform_account_types')
        .update({
          label,
          description,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id, account_type_key, label, description, is_active, is_system, sort_order, created_at, updated_at')
        .single();

      if (reactivateError) {
        return NextResponse.json(
          { error: reactivateError.message },
          { status: 500 }
        );
      }

      await logAdminAction({
        actorUserId: auth.user.id,
        action: 'account_types.reactivate',
        targetTable: 'platform_account_types',
        targetRecordId: existing.id,
        newValues: reactivated || {},
        reason: 'Reactivated account type from Superadmin Users page.',
      });

      return NextResponse.json({
        accountType: reactivated,
        message: 'Account type added successfully.',
      });
    }

    return NextResponse.json(
      { error: 'This account type already exists.' },
      { status: 409 }
    );
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('platform_account_types')
    .insert({
      account_type_key: accountTypeKey,
      label,
      description,
      is_active: true,
      is_system: false,
      sort_order: 100,
      created_by: auth.user.id,
    })
    .select('id, account_type_key, label, description, is_active, is_system, sort_order, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    action: 'account_types.create',
    targetTable: 'platform_account_types',
    targetRecordId: inserted.id,
    newValues: inserted,
    reason: 'Created account type from Superadmin Users page.',
  });

  return NextResponse.json({
    accountType: inserted,
    message: 'Account type added successfully.',
  });
}