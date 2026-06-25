import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  TICKET_SELECT,
  calculateSlaBreachAt,
  generateTicketNumber,
  insertActivity,
  jsonError,
  loadOwnerStores,
  requireStoreOwner,
  textOrNull,
  type TicketRow,
} from '@/app/api/support/_lib';

const VALID_CATEGORIES = new Set([
  'account_access',
  'billing',
  'technical',
  'products_pricebook',
  'vendors',
  'csv_upload',
  'pos_register',
  'ai_assistant',
  'reports',
  'general',
]);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

export async function GET(request: NextRequest) {
  const auth = await requireStoreOwner(request);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(TICKET_SELECT)
    .eq('owner_id', auth.user.id)
    .order('updated_at', { ascending: false });

  if (error) return jsonError(error.message, 500);

  const tickets = ((data || []) as TicketRow[]).map((ticket) => ({
    ...ticket,
    public_reply_count: 0,
  }));

  return NextResponse.json({ tickets });
}

export async function POST(request: NextRequest) {
  const auth = await requireStoreOwner(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Record<string, unknown>;
  const title = textOrNull(body.title);
  const description = textOrNull(body.description);
  const category = textOrNull(body.category) || 'general';
  const priority = textOrNull(body.priority) || 'normal';
  let storeId = textOrNull(body.store_id);

  if (!title) return jsonError('Title is required.');
  if (!description) return jsonError('Description is required.');
  if (!VALID_CATEGORIES.has(category)) return jsonError('Invalid category.');
  if (!VALID_PRIORITIES.has(priority)) return jsonError('Invalid priority.');

  const stores = await loadOwnerStores(auth.user.id);
  if (stores.length === 0) return jsonError('No store is linked to your account.', 403);
  if (!storeId && stores.length === 1) storeId = stores[0].id;
  if (!storeId) return jsonError('Please select a store for this support ticket.');
  if (!stores.some((store) => store.id === storeId)) return jsonError('Store not found.', 403);

  const supabaseAdmin = getSupabaseAdmin();
  const ticketNumber = await generateTicketNumber();
  const slaBreachAt = await calculateSlaBreachAt(priority);
  const { data: ticket, error } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      ticket_number: ticketNumber,
      owner_id: auth.user.id,
      submitted_by: auth.user.id,
      store_id: storeId,
      title,
      description,
      category,
      priority,
      status: 'open',
      source: 'web',
      sla_breach_at: slaBreachAt,
      tags: [],
    })
    .select(TICKET_SELECT)
    .single();

  if (error) return jsonError(error.message, 500);

  await insertActivity({
    ticketId: (ticket as TicketRow).id,
    actorId: auth.user.id,
    activityType: 'ticket_created',
    body: 'Ticket created by store owner.',
    isPublic: true,
  });

  return NextResponse.json({ ticket, message: 'Support ticket created.' });
}
