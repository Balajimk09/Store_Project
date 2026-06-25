import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import { STORE_SAFE_SELECT, jsonError, type StoreSafeRow } from '@/app/api/support/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'stores.search');
  if (!auth.ok) return auth.response;

  const search = request.nextUrl.searchParams.get('q')?.trim();
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin.from('stores').select(STORE_SAFE_SELECT).limit(10);

  if (search) {
    const escaped = search.replace(/[%_,]/g, '\\$&');
    query = query.or(
      `id.eq.${escaped},store_name.ilike.%${escaped}%,address_line1.ilike.%${escaped}%,city.ilike.%${escaped}%,state.ilike.%${escaped}%,zip_code.ilike.%${escaped}%,primary_owner_email.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);

  const stores = ((data || []) as StoreSafeRow[]).map((store) => ({
    ...store,
    status: store.is_active === false ? 'inactive' : 'active',
    flags: [],
  }));

  return NextResponse.json({ stores });
}
