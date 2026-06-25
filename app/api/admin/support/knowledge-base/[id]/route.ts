import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  arrayOfStrings,
  auditSupportAction,
  jsonError,
  textOrNull,
} from '@/app/api/support/_lib';

type RouteContext = { params: { id: string } };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'knowledge_base.edit');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  for (const field of ['title', 'category', 'visibility', 'content', 'article_key']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = textOrNull(body[field]);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tags')) payload.tags = arrayOfStrings(body.tags);
  if (Object.prototype.hasOwnProperty.call(body, 'is_published')) payload.is_published = body.is_published !== false;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: article, error } = await supabaseAdmin
    .from('support_knowledge_base')
    .update(payload)
    .eq('id', context.params.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.kb_updated',
    table: 'support_knowledge_base',
    recordId: context.params.id,
    newValues: (article || {}) as Record<string, unknown>,
  });
  return NextResponse.json({ article, message: 'Article updated.' });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireSupportPermission(request, 'knowledge_base.edit');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: article, error } = await supabaseAdmin
    .from('support_knowledge_base')
    .update({ is_published: false, updated_by: auth.user.id, updated_at: new Date().toISOString() })
    .eq('id', context.params.id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.kb_unpublished',
    table: 'support_knowledge_base',
    recordId: context.params.id,
    newValues: (article || {}) as Record<string, unknown>,
  });
  return NextResponse.json({ article, message: 'Article unpublished.' });
}
