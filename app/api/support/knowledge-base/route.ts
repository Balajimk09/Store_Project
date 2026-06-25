import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { jsonError, requireStoreOwner } from '@/app/api/support/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireStoreOwner(request);
  if (!auth.ok) return auth.response;

  const search = request.nextUrl.searchParams.get('q')?.trim();
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from('support_knowledge_base')
    .select('id, article_key, title, category, content, tags, views, created_at, updated_at')
    .eq('is_published', true)
    .eq('visibility', 'public')
    .order('updated_at', { ascending: false });

  if (search) {
    const escaped = search.replace(/[%_,]/g, '\\$&');
    query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%,category.ilike.%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ articles: data || [] });
}
