import { NextRequest, NextResponse } from 'next/server';
import { jsonError, loadOwnerStores, requireStoreOwner } from '@/app/api/support/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireStoreOwner(request);
  if (!auth.ok) return auth.response;

  try {
    const stores = await loadOwnerStores(auth.user.id);
    return NextResponse.json({ stores });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load stores.', 500);
  }
}
