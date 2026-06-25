import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import { jsonError } from '@/app/api/support/_lib';

function countBy(rows: Array<Record<string, unknown>>, field: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[field] || 'unknown');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, count]) => ({ key, count }));
}

export async function GET(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'analytics.view');
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const sinceWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sinceTwoWeeks = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const [
    ticketsResult,
    previousTicketsResult,
    billingResult,
    followUpsResult,
  ] = await Promise.all([
    supabaseAdmin.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(5000),
    supabaseAdmin.from('support_tickets').select('id, created_at').gte('created_at', sinceTwoWeeks),
    supabaseAdmin.from('support_billing_adjustments').select('id').in('status', ['reported', 'under_review']),
    supabaseAdmin.from('support_follow_ups').select('id').gte('due_at', `${today}T00:00:00`).lte('due_at', `${today}T23:59:59`).eq('is_completed', false),
  ]);

  if (ticketsResult.error) return jsonError(ticketsResult.error.message, 500);

  const tickets = (ticketsResult.data || []) as Array<Record<string, unknown>>;
  const previousTickets = (previousTicketsResult.data || []) as Array<{ created_at: string }>;
  const openTickets = tickets.filter((ticket) => !['closed', 'resolved'].includes(String(ticket.status))).length;
  const slaBreached = tickets.filter((ticket) => ticket.sla_breached === true).length;
  const ratings = tickets
    .map((ticket) => Number(ticket.satisfaction_rating))
    .filter((rating) => Number.isFinite(rating) && rating > 0);
  const satisfactionAverage = ratings.length
    ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
    : null;
  const resolvedTickets = tickets.filter((ticket) => ticket.resolved_at && ticket.created_at);
  const avgResolutionHours = resolvedTickets.length
    ? resolvedTickets.reduce((sum, ticket) => {
        const created = new Date(String(ticket.created_at)).getTime();
        const resolved = new Date(String(ticket.resolved_at)).getTime();
        return sum + Math.max(0, resolved - created) / 36e5;
      }, 0) / resolvedTickets.length
    : null;
  const thisWeek = previousTickets.filter((ticket) => ticket.created_at >= sinceWeek).length;
  const lastWeek = previousTickets.length - thisWeek;

  return NextResponse.json({
    cards: {
      open_tickets: openTickets,
      sla_breached: slaBreached,
      average_resolution_hours: avgResolutionHours,
      satisfaction_score: satisfactionAverage,
    },
    tickets_by_status: countBy(tickets, 'status'),
    tickets_by_category: countBy(tickets, 'category'),
    tickets_by_priority: countBy(tickets, 'priority'),
    tickets_per_assigned_agent: countBy(tickets, 'assigned_to'),
    open_older_than_7_days: tickets.filter(
      (ticket) =>
        !['closed', 'resolved'].includes(String(ticket.status)) &&
        new Date(String(ticket.created_at)).getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000
    ).length,
    pending_billing_adjustment_count: billingResult.data?.length || 0,
    follow_ups_due_today_count: followUpsResult.data?.length || 0,
    this_week_ticket_count: thisWeek,
    last_week_ticket_count: lastWeek,
    peak_support_hours: [],
  });
}
