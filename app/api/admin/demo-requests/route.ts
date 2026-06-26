import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, requireAnyAdminPermission, textOrNull } from '@/app/api/admin/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['demo_requests.view', 'signups.view']);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const search = request.nextUrl.searchParams.get('search')?.trim().toLowerCase() || '';
  const status = request.nextUrl.searchParams.get('status') || '';
  let query = supabaseAdmin.from('demo_requests').select('*').order('created_at', { ascending: false }).limit(200);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);

  const rows = ((data || []) as Record<string, unknown>[]).filter((row) => {
    if (!search) return true;
    return [row.name, row.email, row.business_name, row.phone].filter(Boolean).join(' ').toLowerCase().includes(search);
  });

  return NextResponse.json({ demoRequests: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['demo_requests.manage']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = textOrNull(body.name);
  const email = textOrNull(body.email);
  if (!name) return jsonError('Name is required.');
  if (!email) return jsonError('Email is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('demo_requests')
    .insert({
      name,
      email,
      phone: textOrNull(body.phone),
      business_name: textOrNull(body.business_name),
      city: textOrNull(body.city),
      state: textOrNull(body.state),
      source: textOrNull(body.source) || 'manual',
      message: textOrNull(body.message),
      assigned_to: textOrNull(body.assigned_to),
      next_follow_up_at: textOrNull(body.next_follow_up_at),
      created_by: auth.user.id,
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'demo_request.created',
    description: `Created demo request for ${name}.`,
    relatedType: 'demo_request',
    relatedId: String(data.id),
    metadata: { email, business_name: textOrNull(body.business_name) },
  });

  return NextResponse.json({ demoRequest: data, message: 'Demo request created.' });
}
