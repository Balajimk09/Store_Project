import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  '';

function createAnonSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createServiceSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(request: NextRequest) {
  const header = request.headers.get('authorization') || '';

  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return header.slice(7).trim();
}

function slugifyPosKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function requireSuperadmin(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return {
      userId: null,
      response: jsonError('Supabase admin environment variables are missing.', 500),
    };
  }

  const token = getBearerToken(request);

  if (!token) {
    return {
      userId: null,
      response: jsonError('Missing authorization token.', 401),
    };
  }

  const anonSupabase = createAnonSupabaseClient();
  const serviceSupabase = createServiceSupabaseClient();

  const {
    data: { user },
    error,
  } = await anonSupabase.auth.getUser(token);

  if (error || !user) {
    return {
      userId: null,
      response: jsonError('Invalid authorization token.', 401),
    };
  }

  const metadataRole =
    String(user.app_metadata?.role || user.user_metadata?.role || '').toLowerCase();

  if (metadataRole === 'superadmin') {
    return {
      userId: user.id,
      response: null,
    };
  }

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('role, is_superadmin')
    .eq('id', user.id)
    .maybeSingle();

  if (
    profile &&
    (profile.is_superadmin === true || String(profile.role || '').toLowerCase() === 'superadmin')
  ) {
    return {
      userId: user.id,
      response: null,
    };
  }

  const { data: adminUser } = await serviceSupabase
    .from('admin_users')
    .select('role, is_active')
    .eq('user_id', user.id)
    .maybeSingle();

  if (
    adminUser &&
    adminUser.is_active !== false &&
    String(adminUser.role || '').toLowerCase() === 'superadmin'
  ) {
    return {
      userId: user.id,
      response: null,
    };
  }

  return {
    userId: null,
    response: jsonError('Superadmin access required.', 403),
  };
}

export async function GET() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonError('Supabase admin environment variables are missing.', 500);
  }

  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('pos_types')
    .select('id, name, pos_key, description, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return jsonError(error.message, 500);
  }

  return NextResponse.json({
    posTypes: data || [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin(request);

  if (auth.response) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return jsonError('Invalid request body.');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const requestedKey = typeof body.pos_key === 'string' ? body.pos_key.trim() : '';
  const description =
    typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;

  if (!name) {
    return jsonError('POS type name is required.');
  }

  const posKey = slugifyPosKey(requestedKey || name);

  if (!posKey) {
    return jsonError('POS key is required.');
  }

  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('pos_types')
    .insert({
      name,
      pos_key: posKey,
      description,
      is_active: true,
      sort_order: 100,
      created_by: auth.userId,
    })
    .select('id, name, pos_key, description, is_active, sort_order')
    .single();

  if (error) {
    if (error.code === '23505') {
      return jsonError('A POS type with this key already exists.', 409);
    }

    return jsonError(error.message, 500);
  }

  return NextResponse.json({
    posType: data,
  });
}