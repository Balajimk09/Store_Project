import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  arrayOfStrings,
  auditSupportAction,
  jsonError,
  textOrNull,
} from '@/app/api/support/_lib';

function articleKey(value: unknown, title: string) {
  const raw = textOrNull(value) || title;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

export async function GET(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'knowledge_base.view');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from('support_knowledge_base')
    .select('*')
    .order('updated_at', { ascending: false });
  const visibility = request.nextUrl.searchParams.get('visibility');
  const category = request.nextUrl.searchParams.get('category');
  const search = request.nextUrl.searchParams.get('q')?.trim();
  if (visibility) query = query.eq('visibility', visibility);
  if (category) query = query.eq('category', category);
  if (search) {
    const escaped = search.replace(/[%_,]/g, '\\$&');
    query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%,category.ilike.%${escaped}%`);
  }
  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ articles: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'knowledge_base.create');
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const title = textOrNull(body.title);
  const content = textOrNull(body.content);
  if (!title) return jsonError('Title is required.');
  if (!content) return jsonError('Content is required.');

  const payload = {
    article_key: articleKey(body.article_key, title),
    title,
    category: textOrNull(body.category) || 'general',
    visibility: textOrNull(body.visibility) || 'internal',
    content,
    tags: arrayOfStrings(body.tags),
    is_published: body.is_published !== false,
    created_by: auth.user.id,
    updated_by: auth.user.id,
  };

  const supabaseAdmin = getSupabaseAdmin();
  const { data: article, error } = await supabaseAdmin
    .from('support_knowledge_base')
    .insert(payload)
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);
  await auditSupportAction({
    actorUserId: auth.user.id,
    action: 'support.kb_created',
    table: 'support_knowledge_base',
    recordId: String((article as { id?: string }).id || ''),
    newValues: (article || {}) as Record<string, unknown>,
  });

  return NextResponse.json({ article, message: 'Article created.' });
}
