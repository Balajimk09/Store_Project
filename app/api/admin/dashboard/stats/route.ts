import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hasAdminPermission } from '@/lib/admin-auth';
import { requireAnyAdminPermission, safeSelect, type JsonRecord } from '@/app/api/admin/_lib';

function countRows(rows: JsonRecord[], predicate: (row: JsonRecord) => boolean) {
  return rows.filter(predicate).length;
}

function sinceDate(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function untilDate(daysAhead: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString();
}

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, []);
  if (!auth.ok) return auth.response;

  const permissions = auth.permissions;
  const can = (permission: string) => hasAdminPermission(permissions, permission);
  const supabaseAdmin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const weekAgo = sinceDate(7);
  const weekAhead = untilDate(7);
  const twoWeeksAhead = untilDate(14);

  const stats = {
    demoRequestsNew: 0,
    demoRequestsAssignedToMe: 0,
    recentDemoRequests: [] as JsonRecord[],
    newSignupsThisWeek: 0,
    recentSignups: [] as JsonRecord[],
    storesActiveToday: 0,
    storesNotLoggedIn7Days: 0,
    storesSetupIncomplete: 0,
    storesNeedingHelp: 0,
    myOpenTickets: 0,
    unassignedTickets: 0,
    followupsDueToday: 0,
    followupsDueTodayList: [] as JsonRecord[],
    pendingApprovals: 0,
    trialsEndingIn7Days: 0,
    failedPayments: 0,
    renewalsDueSoon: 0,
    expiredPlans: 0,
    productIssues: 0,
    activePromotions: 0,
    recentStoreActivity: [] as JsonRecord[],
  };

  if (can('demo_requests.view')) {
    const rows = await safeSelect({ table: 'demo_requests', order: 'created_at', limit: 100 });
    stats.demoRequestsNew = countRows(rows, (row) => row.status === 'new');
    stats.demoRequestsAssignedToMe = countRows(rows, (row) => row.assigned_to === auth.user.id);
    stats.recentDemoRequests = rows.slice(0, 5);
  }

  if (can('signups.view')) {
    try {
      const users = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
      stats.recentSignups = users.data.users
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
        .map((user) => ({
          id: user.id,
          email: user.email || null,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at || null,
        }));
      stats.newSignupsThisWeek = stats.recentSignups.filter((user) => {
        const createdAt = typeof user.created_at === 'string' ? user.created_at : '';
        return createdAt >= weekAgo;
      }).length;
    } catch {
      stats.recentSignups = [];
    }
  }

  if (can('stores.view') || can('store_activity.view')) {
    const stores = await safeSelect({ table: 'stores', order: 'created_at', limit: 500 });
    stats.storesSetupIncomplete = countRows(stores, (row) => row.setup_completed === false || row.setup_complete === false);
    stats.storesNotLoggedIn7Days = countRows(stores, (row) => {
      const lastLogin = typeof row.last_login_at === 'string' ? row.last_login_at : null;
      return !lastLogin || lastLogin < weekAgo;
    });
    stats.storesActiveToday = countRows(stores, (row) => {
      const lastLogin = typeof row.last_login_at === 'string' ? row.last_login_at : null;
      return Boolean(lastLogin && lastLogin.slice(0, 10) === now.slice(0, 10));
    });
    stats.recentStoreActivity = await safeSelect({ table: 'store_audit_logs', order: 'created_at', limit: 10 });
  }

  if (can('tickets.view')) {
    const tickets = await safeSelect({ table: 'support_tickets', order: 'updated_at', limit: 500 });
    stats.myOpenTickets = countRows(tickets, (row) => row.assigned_to === auth.user.id && !['closed', 'resolved'].includes(String(row.status || '')));
    stats.unassignedTickets = countRows(tickets, (row) => !row.assigned_to && !['closed', 'resolved'].includes(String(row.status || '')));
  }

  if (can('followups.view')) {
    const followups = await safeSelect({ table: 'admin_follow_ups', order: 'due_at', ascending: true, limit: 100 });
    stats.followupsDueTodayList = followups.filter((row) => {
      const dueAt = typeof row.due_at === 'string' ? row.due_at : '';
      return row.status === 'open' && dueAt.slice(0, 10) === now.slice(0, 10);
    });
    stats.followupsDueToday = stats.followupsDueTodayList.length;
  }

  if (can('approvals.view') || can('approval.approve_action')) {
    const approvals = await safeSelect({ table: 'support_approval_queue', order: 'created_at', limit: 500 });
    stats.pendingApprovals = countRows(approvals, (row) => row.status === 'pending');
  }

  if (can('renewals.view') || can('billing.view')) {
    const subscriptions = await safeSelect({ table: 'store_subscriptions', order: 'updated_at', limit: 500 });
    stats.trialsEndingIn7Days = countRows(subscriptions, (row) => {
      const trialEnds = typeof row.trial_ends_at === 'string' ? row.trial_ends_at : '';
      return row.status === 'trial' && trialEnds >= now && trialEnds <= weekAhead;
    });
    stats.failedPayments = countRows(subscriptions, (row) => row.payment_status === 'failed');
    stats.renewalsDueSoon = countRows(subscriptions, (row) => {
      const renewal = typeof row.renewal_due_at === 'string' ? row.renewal_due_at : '';
      return renewal >= now && renewal <= twoWeeksAhead;
    });
    stats.expiredPlans = countRows(subscriptions, (row) => row.status === 'expired');
  }

  if (can('products.view')) {
    const products = await safeSelect({ table: 'products', order: 'updated_at', limit: 1000 });
    stats.productIssues = countRows(products, (row) => Number(row.stock || 0) <= Number(row.reorder_level || 0));
  }

  if (can('promotions.view')) {
    const promotions = await safeSelect({ table: 'vendor_promotions', order: 'updated_at', limit: 500 });
    stats.activePromotions = countRows(promotions, (row) => row.status === 'active');
  }

  return NextResponse.json(stats);
}
