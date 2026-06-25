import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { jsonError, loadTeamConfig } from '@/app/api/superadmin/team/_lib';

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(await loadTeamConfig());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load team configuration.', 500);
  }
}
