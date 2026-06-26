import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, logAdminActivity, requireAnyAdminPermission, textOrNull } from '@/app/api/admin/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['knowledge_base.view']);
  if (!auth.ok) return auth.response;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.from('support_knowledge_base').select('*').order('updated_at', { ascending: false }).limit(200);
    if (error) return NextResponse.json({ articles: [], error: 'Could not load articles' });
    return NextResponse.json({ articles: data || [] });
  } catch {
    return NextResponse.json({ articles: [], error: 'Could not load articles' });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['knowledge_base.create']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = textOrNull(body.title);
  const content = textOrNull(body.content);
  if (!title) return jsonError('Title is required.');
  if (!content) return jsonError('Content is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_knowledge_base')
    .insert({
      title,
      content,
      category: textOrNull(body.category),
      visibility: textOrNull(body.visibility) || 'internal',
      status: textOrNull(body.status) || 'draft',
      created_by: auth.user.id,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'knowledge_base.created',
    description: `Created knowledge base article "${title}".`,
    relatedType: 'knowledge_base',
    relatedId: String(data.id),
    metadata: { title },
  });

  return NextResponse.json({ article: data, message: 'Article created.' });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['knowledge_base.edit']);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = textOrNull(body.id);
  if (!id) return jsonError('Article id is required.');

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_knowledge_base')
    .update({
      title: textOrNull(body.title),
      content: textOrNull(body.content),
      category: textOrNull(body.category),
      visibility: textOrNull(body.visibility),
      status: textOrNull(body.status),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);

  await logAdminActivity({
    actorId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'knowledge_base.updated',
    description: 'Updated knowledge base article.',
    relatedType: 'knowledge_base',
    relatedId: id,
    metadata: { id },
  });

  return NextResponse.json({ article: data, message: 'Article updated.' });
}
