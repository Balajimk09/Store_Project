import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction, requirePermission, requireSuperadmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type StoreRow = Record<string, any>;

type UserProfile = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  username?: string | null;
  account_type_key?: string | null;
};

type PlatformPlan = {
  id: string;
  plan_key: string;
  name: string;
  description?: string | null;
  monthly_price?: number | null;
  annual_price?: number | null;
  included_store_count?: number | null;
  included_user_count?: number | null;
  included_owner_count?: number | null;
  included_manager_count?: number | null;
  included_cashier_count?: number | null;
  extra_user_price?: number | null;
  extra_cashier_price?: number | null;
  max_products?: number | null;
  max_monthly_uploads?: number | null;
  max_ai_requests?: number | null;
  allow_csv_upload?: boolean | null;
  allow_ai_assistant?: boolean | null;
  allow_reports_export?: boolean | null;
  allow_multi_store?: boolean | null;
  allow_vendor_management?: boolean | null;
  allow_product_management?: boolean | null;
  allow_cashier_management?: boolean | null;
  is_active?: boolean | null;
  sort_order?: number | null;
};

type StoreSubscription = {
  id: string;
  store_id: string;
  plan_id?: string | null;
  subscription_status?: string | null;
  billing_status?: string | null;
  billing_provider?: string | null;
  billing_customer_id?: string | null;
  billing_subscription_id?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  cancel_at?: string | null;
  notes?: string | null;
};

type StorePlanLimitSummary = {
  store_id: string;
  plan_id?: string | null;
  plan_key?: string | null;
  plan_name?: string | null;
  subscription_status?: string | null;
  billing_status?: string | null;

  included_user_count?: number | null;
  included_owner_count?: number | null;
  included_manager_count?: number | null;
  included_cashier_count?: number | null;

  max_products?: number | null;
  max_monthly_uploads?: number | null;
  max_ai_requests?: number | null;

  allow_csv_upload?: boolean | null;
  allow_ai_assistant?: boolean | null;
  allow_reports_export?: boolean | null;
  allow_multi_store?: boolean | null;
  allow_vendor_management?: boolean | null;
  allow_product_management?: boolean | null;
  allow_cashier_management?: boolean | null;

  current_active_users?: number | null;
  current_active_cashiers?: number | null;
  current_active_managers?: number | null;
  current_active_owners?: number | null;
};

function clampPage(value: string | null) {
  const parsed = Number(value || '1');
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function clampPageSize(value: string | null) {
  const parsed = Number(value || '25');
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(50, Math.floor(parsed));
}

function cleanSearch(value: string | null) {
  return String(value || '')
    .trim()
    .replace(/[%_,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function cleanText(value: unknown, maxLength = 255) {
  const text = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);

  return text || null;
}

function cleanStatus(value: unknown) {
  const status = String(value || 'active').trim().toLowerCase();

  if (status === 'inactive') return 'inactive';
  if (status === 'active') return 'active';

  return 'active';
}

function cleanSubscriptionStatus(value: unknown) {
  const status = String(value || 'trial').trim().toLowerCase();

  if (
    [
      'trial',
      'active',
      'past_due',
      'cancelled',
      'paused',
      'manual',
      'inactive',
    ].includes(status)
  ) {
    return status;
  }

  return 'trial';
}

function cleanBillingStatus(value: unknown) {
  const status = String(value || 'not_connected').trim().toLowerCase();

  if (
    [
      'not_connected',
      'active',
      'past_due',
      'cancelled',
      'manual',
      'comped',
      'failed',
    ].includes(status)
  ) {
    return status;
  }

  return 'not_connected';
}

function cleanRegisterCount(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.floor(parsed);
}

function cleanBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;

  const text = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'on', 'enabled'].includes(text)) return true;
  if (['false', '0', 'no', 'off', 'disabled'].includes(text)) return false;

  return fallback;
}

function cleanNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return null;

  return parsed;
}

function cleanDateOrNull(value: unknown) {
  const text = cleanText(value, 80);

  if (!text) return null;

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function cleanJsonObject(value: unknown) {
  if (!value) return {};

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

function cleanJsonArray(value: unknown) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function getStoreSetupStatus(store: StoreRow) {
  const requiredFields = [
    store.store_name,
    store.address_line1 || store.address,
    store.city,
    store.state,
    store.zip_code,
    store.phone_number,
    store.country,
    store.timezone,
  ];

  const completedFields = requiredFields.filter(
    (field) => field !== null && field !== undefined && String(field).trim() !== ''
  ).length;

  if (completedFields === requiredFields.length) return 'complete';
  if (completedFields > 0) return 'partial';

  return 'missing';
}

function buildStorePayload(input: Record<string, unknown>) {
  const storeName = cleanText(input.store_name || input.storeName, 160);

  if (!storeName) {
    throw new Error('Store name is required.');
  }

  const ownerId = cleanText(input.owner_id || input.ownerId, 80);
  const addressLine1 = cleanText(
    input.address_line1 || input.addressLine1 || input.address,
    255
  );

  return {
    owner_id: ownerId,

    store_name: storeName,
    store_code: cleanText(input.store_code || input.storeCode, 80),

    manager_name: cleanText(input.manager_name || input.managerName, 160),
    manager_phone: cleanText(input.manager_phone || input.managerPhone, 40),
    manager_email: cleanText(input.manager_email || input.managerEmail, 160),

    address: addressLine1,
    address_line1: addressLine1,
    address_line2: cleanText(input.address_line2 || input.addressLine2, 255),
    city: cleanText(input.city, 120),
    state: cleanText(input.state, 80),
    zip_code: cleanText(input.zip_code || input.zipCode, 20),
    country: cleanText(input.country, 80) || 'United States',
    timezone: cleanText(input.timezone, 80) || 'America/Chicago',

    store_type: cleanText(input.store_type || input.storeType, 120),
    pos_type: cleanText(input.pos_type || input.posType, 120),
    register_count: cleanRegisterCount(input.register_count || input.registerCount),

    has_fuel: cleanBoolean(input.has_fuel || input.hasFuel, false),
    fuel_brand: cleanText(input.fuel_brand || input.fuelBrand, 120),

    status: cleanStatus(input.status),
    notes: cleanText(input.notes, 2000),

    business_legal_name: cleanText(
      input.business_legal_name || input.businessLegalName,
      200
    ),
    dba_name: cleanText(input.dba_name || input.dbaName, 200),
    ein_tax_id: cleanText(input.ein_tax_id || input.einTaxId, 80),

    sales_tax_permit: cleanText(input.sales_tax_permit || input.salesTaxPermit, 120),
    tobacco_license: cleanText(input.tobacco_license || input.tobaccoLicense, 120),
    alcohol_license: cleanText(input.alcohol_license || input.alcoholLicense, 120),

    lottery_enabled: cleanBoolean(input.lottery_enabled || input.lotteryEnabled, false),
    atm_enabled: cleanBoolean(input.atm_enabled || input.atmEnabled, false),
    money_order_enabled: cleanBoolean(
      input.money_order_enabled || input.moneyOrderEnabled,
      false
    ),
    ebt_accepted: cleanBoolean(input.ebt_accepted || input.ebtAccepted, false),

    operating_hours: cleanJsonObject(input.operating_hours || input.operatingHours),
    latitude: cleanNumberOrNull(input.latitude),
    longitude: cleanNumberOrNull(input.longitude),

    logo_url: cleanText(input.logo_url || input.logoUrl, 1000),
    vendor_accounts: cleanJsonArray(input.vendor_accounts || input.vendorAccounts),

    updated_at: new Date().toISOString(),
  };
}

function buildSubscriptionPayload(input: Record<string, unknown>, actorUserId: string) {
  const planId = cleanText(input.plan_id || input.planId, 80);

  return {
    plan_id: planId,
    subscription_status: cleanSubscriptionStatus(
      input.subscription_status || input.subscriptionStatus
    ),
    billing_status: cleanBillingStatus(input.billing_status || input.billingStatus),
    trial_ends_at: cleanDateOrNull(input.trial_ends_at || input.trialEndsAt),
    notes: cleanText(input.subscription_notes || input.subscriptionNotes, 1000),
    created_by: actorUserId,
    updated_at: new Date().toISOString(),
  };
}

function normalizePlan(plan: PlatformPlan) {
  return {
    id: plan.id,
    plan_key: plan.plan_key,
    planKey: plan.plan_key,
    name: plan.name,
    description: plan.description || '',

    monthly_price: Number(plan.monthly_price || 0),
    monthlyPrice: Number(plan.monthly_price || 0),
    annual_price: Number(plan.annual_price || 0),
    annualPrice: Number(plan.annual_price || 0),

    included_store_count: Number(plan.included_store_count || 0),
    includedStoreCount: Number(plan.included_store_count || 0),
    included_user_count: Number(plan.included_user_count || 0),
    includedUserCount: Number(plan.included_user_count || 0),
    included_owner_count: Number(plan.included_owner_count || 0),
    includedOwnerCount: Number(plan.included_owner_count || 0),
    included_manager_count: Number(plan.included_manager_count || 0),
    includedManagerCount: Number(plan.included_manager_count || 0),
    included_cashier_count: Number(plan.included_cashier_count || 0),
    includedCashierCount: Number(plan.included_cashier_count || 0),

    extra_user_price: Number(plan.extra_user_price || 0),
    extraUserPrice: Number(plan.extra_user_price || 0),
    extra_cashier_price: Number(plan.extra_cashier_price || 0),
    extraCashierPrice: Number(plan.extra_cashier_price || 0),

    max_products: plan.max_products ?? null,
    maxProducts: plan.max_products ?? null,
    max_monthly_uploads: plan.max_monthly_uploads ?? null,
    maxMonthlyUploads: plan.max_monthly_uploads ?? null,
    max_ai_requests: plan.max_ai_requests ?? null,
    maxAiRequests: plan.max_ai_requests ?? null,

    allow_csv_upload: Boolean(plan.allow_csv_upload),
    allowCsvUpload: Boolean(plan.allow_csv_upload),
    allow_ai_assistant: Boolean(plan.allow_ai_assistant),
    allowAiAssistant: Boolean(plan.allow_ai_assistant),
    allow_reports_export: Boolean(plan.allow_reports_export),
    allowReportsExport: Boolean(plan.allow_reports_export),
    allow_multi_store: Boolean(plan.allow_multi_store),
    allowMultiStore: Boolean(plan.allow_multi_store),
    allow_vendor_management: Boolean(plan.allow_vendor_management),
    allowVendorManagement: Boolean(plan.allow_vendor_management),
    allow_product_management: Boolean(plan.allow_product_management),
    allowProductManagement: Boolean(plan.allow_product_management),
    allow_cashier_management: Boolean(plan.allow_cashier_management),
    allowCashierManagement: Boolean(plan.allow_cashier_management),

    is_active: Boolean(plan.is_active),
    isActive: Boolean(plan.is_active),
    sort_order: Number(plan.sort_order || 100),
    sortOrder: Number(plan.sort_order || 100),
  };
}

function normalizeSubscription(subscription: StoreSubscription | null) {
  if (!subscription) return null;

  return {
    id: subscription.id,
    store_id: subscription.store_id,
    storeId: subscription.store_id,
    plan_id: subscription.plan_id || null,
    planId: subscription.plan_id || null,

    subscription_status: subscription.subscription_status || 'trial',
    subscriptionStatus: subscription.subscription_status || 'trial',
    billing_status: subscription.billing_status || 'not_connected',
    billingStatus: subscription.billing_status || 'not_connected',

    billing_provider: subscription.billing_provider || '',
    billingProvider: subscription.billing_provider || '',
    billing_customer_id: subscription.billing_customer_id || '',
    billingCustomerId: subscription.billing_customer_id || '',
    billing_subscription_id: subscription.billing_subscription_id || '',
    billingSubscriptionId: subscription.billing_subscription_id || '',

    current_period_start: subscription.current_period_start || null,
    currentPeriodStart: subscription.current_period_start || null,
    current_period_end: subscription.current_period_end || null,
    currentPeriodEnd: subscription.current_period_end || null,
    trial_ends_at: subscription.trial_ends_at || null,
    trialEndsAt: subscription.trial_ends_at || null,
    cancel_at: subscription.cancel_at || null,
    cancelAt: subscription.cancel_at || null,

    notes: subscription.notes || '',
  };
}

function normalizePlanLimits(limits: StorePlanLimitSummary | null) {
  if (!limits) return null;

  const includedUserCount = Number(limits.included_user_count || 0);
  const includedCashierCount = Number(limits.included_cashier_count || 0);
  const currentActiveUsers = Number(limits.current_active_users || 0);
  const currentActiveCashiers = Number(limits.current_active_cashiers || 0);

  return {
    store_id: limits.store_id,
    storeId: limits.store_id,

    plan_id: limits.plan_id || null,
    planId: limits.plan_id || null,
    plan_key: limits.plan_key || null,
    planKey: limits.plan_key || null,
    plan_name: limits.plan_name || null,
    planName: limits.plan_name || null,

    subscription_status: limits.subscription_status || null,
    subscriptionStatus: limits.subscription_status || null,
    billing_status: limits.billing_status || null,
    billingStatus: limits.billing_status || null,

    included_user_count: includedUserCount,
    includedUserCount,
    included_owner_count: Number(limits.included_owner_count || 0),
    includedOwnerCount: Number(limits.included_owner_count || 0),
    included_manager_count: Number(limits.included_manager_count || 0),
    includedManagerCount: Number(limits.included_manager_count || 0),
    included_cashier_count: includedCashierCount,
    includedCashierCount,

    max_products: limits.max_products ?? null,
    maxProducts: limits.max_products ?? null,
    max_monthly_uploads: limits.max_monthly_uploads ?? null,
    maxMonthlyUploads: limits.max_monthly_uploads ?? null,
    max_ai_requests: limits.max_ai_requests ?? null,
    maxAiRequests: limits.max_ai_requests ?? null,

    allow_csv_upload: Boolean(limits.allow_csv_upload),
    allowCsvUpload: Boolean(limits.allow_csv_upload),
    allow_ai_assistant: Boolean(limits.allow_ai_assistant),
    allowAiAssistant: Boolean(limits.allow_ai_assistant),
    allow_reports_export: Boolean(limits.allow_reports_export),
    allowReportsExport: Boolean(limits.allow_reports_export),
    allow_multi_store: Boolean(limits.allow_multi_store),
    allowMultiStore: Boolean(limits.allow_multi_store),
    allow_vendor_management: Boolean(limits.allow_vendor_management),
    allowVendorManagement: Boolean(limits.allow_vendor_management),
    allow_product_management: Boolean(limits.allow_product_management),
    allowProductManagement: Boolean(limits.allow_product_management),
    allow_cashier_management: Boolean(limits.allow_cashier_management),
    allowCashierManagement: Boolean(limits.allow_cashier_management),

    current_active_users: currentActiveUsers,
    currentActiveUsers,
    current_active_cashiers: currentActiveCashiers,
    currentActiveCashiers,
    current_active_managers: Number(limits.current_active_managers || 0),
    currentActiveManagers: Number(limits.current_active_managers || 0),
    current_active_owners: Number(limits.current_active_owners || 0),
    currentActiveOwners: Number(limits.current_active_owners || 0),

    user_limit_reached: includedUserCount > 0 && currentActiveUsers >= includedUserCount,
    userLimitReached: includedUserCount > 0 && currentActiveUsers >= includedUserCount,
    cashier_limit_reached:
      includedCashierCount > 0 && currentActiveCashiers >= includedCashierCount,
    cashierLimitReached:
      includedCashierCount > 0 && currentActiveCashiers >= includedCashierCount,
  };
}

function normalizeStore(
  store: StoreRow,
  ownerMap: Map<string, UserProfile>,
  productCounts: Map<string, number>,
  transactionCounts: Map<string, number>,
  subscriptionMap: Map<string, StoreSubscription>,
  planMap: Map<string, PlatformPlan>,
  limitsMap: Map<string, StorePlanLimitSummary>
) {
  const ownerId = store.owner_id ? String(store.owner_id) : null;
  const storeId = String(store.id);
  const status = cleanStatus(store.status);
  const setupStatus = getStoreSetupStatus(store);
  const productCount = productCounts.get(storeId) || 0;
  const transactionCount = transactionCounts.get(storeId) || 0;
  const subscription = subscriptionMap.get(storeId) || null;
  const plan = subscription?.plan_id ? planMap.get(subscription.plan_id) || null : null;
  const limits = limitsMap.get(storeId) || null;

  const planLimits = normalizePlanLimits(limits);

  return {
    id: storeId,

    owner_id: ownerId,
    ownerId,
    owner: ownerId ? ownerMap.get(ownerId) || null : null,

    store_name: store.store_name || '',
    storeName: store.store_name || '',
    store_code: store.store_code || '',
    storeCode: store.store_code || '',

    manager_name: store.manager_name || '',
    managerName: store.manager_name || '',
    manager_phone: store.manager_phone || '',
    managerPhone: store.manager_phone || '',
    manager_email: store.manager_email || '',
    managerEmail: store.manager_email || '',

    address: store.address_line1 || store.address || '',
    address_line1: store.address_line1 || store.address || '',
    addressLine1: store.address_line1 || store.address || '',
    address_line2: store.address_line2 || '',
    addressLine2: store.address_line2 || '',
    city: store.city || '',
    state: store.state || '',
    zip_code: store.zip_code || '',
    zipCode: store.zip_code || '',
    country: store.country || 'United States',
    timezone: store.timezone || 'America/Chicago',

    phone_number: store.phone_number || '',
    phoneNumber: store.phone_number || '',

    store_type: store.store_type || '',
    storeType: store.store_type || '',
    pos_type: store.pos_type || '',
    posType: store.pos_type || '',
    register_count: Number(store.register_count || 0),
    registerCount: Number(store.register_count || 0),

    has_fuel: Boolean(store.has_fuel),
    hasFuel: Boolean(store.has_fuel),
    fuel_brand: store.fuel_brand || '',
    fuelBrand: store.fuel_brand || '',

    status,
    is_active: status === 'active',
    isActive: status === 'active',

    notes: store.notes || '',

    business_legal_name: store.business_legal_name || '',
    businessLegalName: store.business_legal_name || '',
    dba_name: store.dba_name || '',
    dbaName: store.dba_name || '',
    ein_tax_id: store.ein_tax_id || '',
    einTaxId: store.ein_tax_id || '',

    sales_tax_permit: store.sales_tax_permit || '',
    salesTaxPermit: store.sales_tax_permit || '',
    tobacco_license: store.tobacco_license || '',
    tobaccoLicense: store.tobacco_license || '',
    alcohol_license: store.alcohol_license || '',
    alcoholLicense: store.alcohol_license || '',

    lottery_enabled: Boolean(store.lottery_enabled),
    lotteryEnabled: Boolean(store.lottery_enabled),
    atm_enabled: Boolean(store.atm_enabled),
    atmEnabled: Boolean(store.atm_enabled),
    money_order_enabled: Boolean(store.money_order_enabled),
    moneyOrderEnabled: Boolean(store.money_order_enabled),
    ebt_accepted: Boolean(store.ebt_accepted),
    ebtAccepted: Boolean(store.ebt_accepted),

    operating_hours: store.operating_hours || {},
    operatingHours: store.operating_hours || {},
    latitude: store.latitude ?? null,
    longitude: store.longitude ?? null,

    logo_url: store.logo_url || '',
    logoUrl: store.logo_url || '',
    vendor_accounts: store.vendor_accounts || [],
    vendorAccounts: store.vendor_accounts || [],

    setup_status: setupStatus,
    setupStatus,

    product_count: productCount,
    productCount,
    transaction_count: transactionCount,
    transactionCount,

    subscription: normalizeSubscription(subscription),
    plan: plan ? normalizePlan(plan) : null,
    plan_limits: planLimits,
    planLimits,

    created_by: store.created_by || null,
    created_at: store.created_at || null,
    createdAt: store.created_at || null,
    updated_at: store.updated_at || null,
    updatedAt: store.updated_at || null,
    deactivated_at: store.deactivated_at || null,
    deactivatedAt: store.deactivated_at || null,
    deactivated_by: store.deactivated_by || null,
  };
}

async function getOwnerMap(ownerIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const ownerMap = new Map<string, UserProfile>();

  if (ownerIds.length === 0) return ownerMap;

  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, email, username, account_type_key')
    .in('user_id', ownerIds);

  (data || []).forEach((profile: UserProfile) => {
    ownerMap.set(profile.user_id, profile);
  });

  return ownerMap;
}

async function getOwnerOptions() {
  const supabaseAdmin = getSupabaseAdmin();
  const profileMap = new Map<string, UserProfile>();

  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, email, username, account_type_key')
    .limit(500);

  (profiles || []).forEach((profile: UserProfile) => {
    profileMap.set(profile.user_id, profile);
  });

  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });

  (authUsers?.users || []).forEach((user) => {
    if (profileMap.has(user.id)) return;

    profileMap.set(user.id, {
      user_id: user.id,
      full_name:
        typeof user.user_metadata?.full_name === 'string'
          ? user.user_metadata.full_name
          : null,
      email: user.email || null,
      username: null,
      account_type_key: null,
    });
  });

  return Array.from(profileMap.values()).sort((a, b) => {
    const aLabel = a.full_name || a.email || a.username || a.user_id;
    const bLabel = b.full_name || b.email || b.username || b.user_id;
    return aLabel.localeCompare(bLabel);
  });
}

async function getProductCounts(storeIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const counts = new Map<string, number>();

  if (storeIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin
    .from('products')
    .select('store_id')
    .in('store_id', storeIds);

  if (error) return counts;

  (data || []).forEach((row: { store_id?: string | null }) => {
    if (!row.store_id) return;
    counts.set(row.store_id, (counts.get(row.store_id) || 0) + 1);
  });

  return counts;
}

async function getTransactionCounts(storeIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const counts = new Map<string, number>();

  if (storeIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('store_id')
    .in('store_id', storeIds)
    .limit(5000);

  if (error) return counts;

  (data || []).forEach((row: { store_id?: string | null }) => {
    if (!row.store_id) return;
    counts.set(row.store_id, (counts.get(row.store_id) || 0) + 1);
  });

  return counts;
}

async function getPlanOptions() {
  const supabaseAdmin = getSupabaseAdmin();

  const { data } = await supabaseAdmin
    .from('platform_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return (data || []).map((plan: PlatformPlan) => normalizePlan(plan));
}

async function getPlanMap() {
  const supabaseAdmin = getSupabaseAdmin();
  const planMap = new Map<string, PlatformPlan>();

  const { data } = await supabaseAdmin.from('platform_plans').select('*');

  (data || []).forEach((plan: PlatformPlan) => {
    planMap.set(plan.id, plan);
  });

  return planMap;
}

async function getSubscriptionMap(storeIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const subscriptionMap = new Map<string, StoreSubscription>();

  if (storeIds.length === 0) return subscriptionMap;

  const { data } = await supabaseAdmin
    .from('store_subscriptions')
    .select('*')
    .in('store_id', storeIds);

  (data || []).forEach((subscription: StoreSubscription) => {
    subscriptionMap.set(subscription.store_id, subscription);
  });

  return subscriptionMap;
}

async function getPlanLimitMap(storeIds: string[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const limitsMap = new Map<string, StorePlanLimitSummary>();

  if (storeIds.length === 0) return limitsMap;

  const { data } = await supabaseAdmin
    .from('store_plan_limit_summary')
    .select('*')
    .in('store_id', storeIds);

  (data || []).forEach((limits: StorePlanLimitSummary) => {
    limitsMap.set(limits.store_id, limits);
  });

  return limitsMap;
}

async function upsertStoreSubscription(input: {
  storeId: string;
  actorUserId: string;
  body: Record<string, unknown>;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const subscriptionPayload = buildSubscriptionPayload(input.body, input.actorUserId);

  const { data, error } = await supabaseAdmin
    .from('store_subscriptions')
    .upsert(
      {
        store_id: input.storeId,
        ...subscriptionPayload,
      },
      {
        onConflict: 'store_id',
      }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'stores.view_all');

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;

  const page = clampPage(searchParams.get('page'));
  const pageSize = clampPageSize(searchParams.get('pageSize'));
  const search = cleanSearch(searchParams.get('search'));
  const status = String(searchParams.get('status') || 'all').trim().toLowerCase();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from('stores')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (status === 'active' || status === 'inactive') {
    query = query.eq('status', status);
  }

  if (search) {
    query = query.or(
      [
        `store_name.ilike.%${search}%`,
        `store_code.ilike.%${search}%`,
        `manager_name.ilike.%${search}%`,
        `manager_email.ilike.%${search}%`,
        `manager_phone.ilike.%${search}%`,
        `city.ilike.%${search}%`,
        `state.ilike.%${search}%`,
        `zip_code.ilike.%${search}%`,
        `phone_number.ilike.%${search}%`,
        `pos_type.ilike.%${search}%`,
        `store_type.ilike.%${search}%`,
        `fuel_brand.ilike.%${search}%`,
        `business_legal_name.ilike.%${search}%`,
        `dba_name.ilike.%${search}%`,
        `address.ilike.%${search}%`,
        `address_line1.ilike.%${search}%`,
        `address_line2.ilike.%${search}%`,
      ].join(',')
    );
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stores = data || [];
  const storeIds = stores.map((store: StoreRow) => String(store.id));
  const ownerIds = Array.from(
    new Set(stores.map((store: StoreRow) => store.owner_id).filter(Boolean).map(String))
  );

  const [
    ownerMap,
    productCounts,
    transactionCounts,
    ownerOptions,
    planOptions,
    planMap,
    subscriptionMap,
    limitsMap,
  ] = await Promise.all([
    getOwnerMap(ownerIds),
    getProductCounts(storeIds),
    getTransactionCounts(storeIds),
    getOwnerOptions(),
    getPlanOptions(),
    getPlanMap(),
    getSubscriptionMap(storeIds),
    getPlanLimitMap(storeIds),
  ]);

  const normalizedStores = stores.map((store: StoreRow) =>
    normalizeStore(
      store,
      ownerMap,
      productCounts,
      transactionCounts,
      subscriptionMap,
      planMap,
      limitsMap
    )
  );

  const { count: totalActiveStores } = await supabaseAdmin
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: totalInactiveStores } = await supabaseAdmin
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'inactive');

  return NextResponse.json({
    summary: {
      totalStores: count || 0,
      activeStores: totalActiveStores || 0,
      inactiveStores: totalInactiveStores || 0,
      storesOnPage: normalizedStores.length,
      setupCompleteStores: normalizedStores.filter((store) => store.setupStatus === 'complete')
        .length,
      totalProductsOnPage: normalizedStores.reduce((sum, store) => sum + store.productCount, 0),
      totalTransactionsOnPage: normalizedStores.reduce(
        (sum, store) => sum + store.transactionCount,
        0
      ),
      storesWithPlansOnPage: normalizedStores.filter((store) => store.plan).length,
      storesWithoutPlansOnPage: normalizedStores.filter((store) => !store.plan).length,
      ownerOptionsCount: ownerOptions.length,
      planOptionsCount: planOptions.length,
    },
    stores: normalizedStores,
    ownerOptions,
    planOptions,
    pagination: {
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin(request);

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    const body = await request.json();
    const payload = {
      ...buildStorePayload(body),
      created_by: auth.user.id,
      status: cleanStatus(body.status || 'active'),
    };

    const { data, error } = await supabaseAdmin
      .from('stores')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let subscription = null;

    if (
      body.plan_id !== undefined ||
      body.planId !== undefined ||
      body.subscription_status !== undefined ||
      body.subscriptionStatus !== undefined ||
      body.billing_status !== undefined ||
      body.billingStatus !== undefined ||
      body.trial_ends_at !== undefined ||
      body.trialEndsAt !== undefined ||
      body.subscription_notes !== undefined ||
      body.subscriptionNotes !== undefined
    ) {
      subscription = await upsertStoreSubscription({
        storeId: data.id,
        actorUserId: auth.user.id,
        body,
      });
    }

    await logAdminAction({
      actorUserId: auth.user.id,
      action: 'store.created',
      targetStoreId: data.id,
      targetTable: 'stores',
      targetRecordId: data.id,
      newValues: {
        store: data,
        subscription,
      },
      reason: cleanText(body.reason, 500),
      metadata: {
        source: 'superadmin_stores_page',
      },
    });

    return NextResponse.json({ store: data, subscription }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create store.' },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperadmin(request);

  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    const body = await request.json();
    const storeId = cleanText(body.id || body.store_id || body.storeId, 80);
    const action = String(body.action || 'update').trim().toLowerCase();

    if (!storeId) {
      return NextResponse.json({ error: 'Store ID is required.' }, { status: 400 });
    }

    const { data: existingStore, error: existingError } = await supabaseAdmin
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    if (existingError || !existingStore) {
      return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
    }

    const { data: existingSubscription } = await supabaseAdmin
      .from('store_subscriptions')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle();

    if (action === 'deactivate') {
      const updatePayload = {
        status: 'inactive',
        deactivated_at: new Date().toISOString(),
        deactivated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from('stores')
        .update(updatePayload)
        .eq('id', storeId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      await logAdminAction({
        actorUserId: auth.user.id,
        action: 'store.deactivated',
        targetStoreId: storeId,
        targetTable: 'stores',
        targetRecordId: storeId,
        oldValues: existingStore,
        newValues: data,
        reason: cleanText(body.reason, 500),
        metadata: {
          source: 'superadmin_stores_page',
        },
      });

      return NextResponse.json({ store: data });
    }

    if (action === 'reactivate') {
      const updatePayload = {
        status: 'active',
        deactivated_at: null,
        deactivated_by: null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from('stores')
        .update(updatePayload)
        .eq('id', storeId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      await logAdminAction({
        actorUserId: auth.user.id,
        action: 'store.reactivated',
        targetStoreId: storeId,
        targetTable: 'stores',
        targetRecordId: storeId,
        oldValues: existingStore,
        newValues: data,
        reason: cleanText(body.reason, 500),
        metadata: {
          source: 'superadmin_stores_page',
        },
      });

      return NextResponse.json({ store: data });
    }

    const updatePayload = buildStorePayload(body);

    const { data, error } = await supabaseAdmin
      .from('stores')
      .update(updatePayload)
      .eq('id', storeId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let subscription = existingSubscription || null;

    if (
      body.plan_id !== undefined ||
      body.planId !== undefined ||
      body.subscription_status !== undefined ||
      body.subscriptionStatus !== undefined ||
      body.billing_status !== undefined ||
      body.billingStatus !== undefined ||
      body.trial_ends_at !== undefined ||
      body.trialEndsAt !== undefined ||
      body.subscription_notes !== undefined ||
      body.subscriptionNotes !== undefined
    ) {
      subscription = await upsertStoreSubscription({
        storeId,
        actorUserId: auth.user.id,
        body,
      });
    }

    await logAdminAction({
      actorUserId: auth.user.id,
      action: 'store.updated',
      targetStoreId: storeId,
      targetTable: 'stores',
      targetRecordId: storeId,
      oldValues: {
        store: existingStore,
        subscription: existingSubscription,
      },
      newValues: {
        store: data,
        subscription,
      },
      reason: cleanText(body.reason, 500),
      metadata: {
        source: 'superadmin_stores_page',
      },
    });

    return NextResponse.json({ store: data, subscription });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update store.' },
      { status: 400 }
    );
  }
}