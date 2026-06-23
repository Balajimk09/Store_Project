import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function isEmail(value: string) {
  return value.includes('@');
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export async function GET(request: NextRequest) {
  try {
    const identifier = normalizeIdentifier(
      request.nextUrl.searchParams.get('identifier') || ''
    );

    if (!identifier) {
      return NextResponse.json(
        { error: 'Missing login identifier.' },
        { status: 400 }
      );
    }

    if (isEmail(identifier)) {
      return NextResponse.json({
        type: 'email',
        email: identifier,
      });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, username, email, status')
      .eq('username', identifier)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: 'Unable to resolve login.' },
        { status: 500 }
      );
    }

    if (!profile?.email || profile.status === 'disabled' || profile.status === 'inactive') {
      return NextResponse.json(
        { error: 'Incorrect username/email/phone or password.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      type: 'username',
      email: profile.email,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected server error.' },
      { status: 500 }
    );
  }
}