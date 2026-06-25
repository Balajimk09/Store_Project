import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  TICKET_SELECT,
  jsonError,
  textOrNull,
  type TicketRow,
} from '@/app/api/support/_lib';
import {
  createTicketFromBody,
  hydrateTickets,
  loadStoreMap,
  parsePagination,
} from '@/app/api/admin/support/_lib';

export async function GET(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'tickets.view');
  if (!auth.ok) return auth.response;

  const { page, limit } = parsePagination(request);
  const search = request.nextUrl.searchParams.get('search')?.trim();
  const status = request.nextUrl.searchParams.get('status')?.trim();
  const priority = request.nextUrl.searchParams.get('priority')?.trim();
  const category = request.nextUrl.searchParams.get('category')?.trim();
  const assignedTo = request.nextUrl.searchParams.get('assigned_to')?.trim();
  const storeId = request.nextUrl.searchParams.get('store_id')?.trim();
  const tag = request.nextUrl.searchParams.get('tags')?.trim();
  const slaBreached = request.nextUrl.searchParams.get('sla_breached');
  const from = page * limit;
  const to = from + limit - 1;
  const supabaseAdmin = getSupabaseAdmin();

  let query = supabaseAdmin
    .from('support_tickets')
    .select(TICKET_SELECT, { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);
  if (category) query = query.eq('category', category);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (storeId) query = query.eq('store_id', storeId);
  if (slaBreached === 'true') query = query.eq('sla_breached', true);
  if (tag) query = query.contains('tags', [tag]);
  if (search) {
    const escaped = search.replace(/[%_,]/g, '\\$&');
    query = query.or(
      `ticket_number.ilike.%${escaped}%,title.ilike.%${escaped}%,description.ilike.%${escaped}%,caller_name.ilike.%${escaped}%`
    );
  }

  const { data, error, count } = await query;
  if (error) return jsonError(error.message, 500);

  const ticketRows = (data || []) as TicketRow[];
  const stores = await loadStoreMap(ticketRows.map((ticket) => ticket.store_id || ''));
  const tickets = hydrateTickets(ticketRows, stores);

  return NextResponse.json({ tickets, total: count || 0, page, limit });
}

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'tickets.reply');
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ticket = await createTicketFromBody(body, auth.user.id);
    return NextResponse.json({ ticket, message: 'Support ticket created.' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create ticket.', 500);
  }
}
