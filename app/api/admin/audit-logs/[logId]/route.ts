import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type RouteContext = { params: { logId: string } };

const EDITABLE_FIELDS = [
  'action',
  'reason',
  'metadata',
  'target_table',
  'target_record_id',
] as const;

function buildEditablePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const value = body[field];
      payload[field] = value === '' || value === undefined ? null : value;
    }
  }

  return payload;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const payload = buildEditablePayload(body);

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'No supported fields to update.' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('admin_audit_logs')
    .update(payload)
    .eq('id', context.params.logId)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ log: data });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from('admin_audit_logs')
    .delete()
    .eq('id', context.params.logId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: 'Deleted.' });
}
