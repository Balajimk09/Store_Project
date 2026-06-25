'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Store,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';

type VendorRow = {
  id: string;
  source: 'store' | 'global';
  store_id: string | null;
  store_name: string | null;
  vendor_name: string;
  sales_rep_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  is_active: boolean;
  // Schedule fields are notification-ready for future order and delivery reminders.
  order_days: string[];
  delivery_days: string[];
  expected_invoice_amount: number | null;
  payment_terms: string | null;
  schedule_frequency?: 'weekly' | 'biweekly' | 'monthly' | null;
  notification_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type VendorFormState = {
  vendor_name: string;
  sales_rep_name: string;
  phone: string;
  email: string;
  website: string;
  category: string;
  notes: string;
  is_active: boolean;
  store_id: string;
  type: 'store' | 'global';
  order_days: string[];
  delivery_days: string[];
  expected_invoice_amount: string;
  payment_terms: string;
  custom_payment_terms: string;
  schedule_frequency: 'weekly' | 'biweekly' | 'monthly';
  notification_enabled: boolean;
};

type StoreOption = { id: string; store_name: string };
type FilterState = {
  search: string;
  storeFilter: string;
  typeFilter: string;
  activeFilter: string;
};
type VendorsResponse = {
  vendors?: VendorRow[];
  total?: number;
};
type StoresResponse = {
  stores?: Array<{
    id?: string;
    store_name?: string | null;
    business_legal_name?: string | null;
    dba_name?: string | null;
    primary_owner_email?: string | null;
  }>;
};
type ImportRow = Record<string, string | number | boolean | null | undefined>;
type ImportSummary = {
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
};

type PlatformTotals = {
  total_stores: number;
  total_vendors: number;
  total_global_vendors: number;
  total_store_vendors: number;
  total_products: number;
  total_products_with_vendor: number;
  total_products_without_vendor: number;
  vendor_coverage_pct: number;
};

type StoreSummary = {
  store_id: string;
  store_name: string;
  vendor_count: number;
  product_count: number;
  products_with_vendor: number;
  products_without_vendor: number;
  unique_vendor_names: string[];
  estimated_reorder_value: number;
};

type VendorPerformance = {
  vendor_name: string;
  store_count: number;
  product_count: number;
  total_inventory_value: number;
  estimated_reorder_spend: number;
  categories: string[];
  stores_using: string[];
};

type CategoryGap = {
  category: string;
  total_products: number;
  products_without_vendor: number;
  vendor_coverage_pct: number;
  top_vendors: string[];
};

type AnalyticsResponse = {
  platform_totals: PlatformTotals;
  store_summaries: StoreSummary[];
  vendor_performance: VendorPerformance[];
  category_gaps: CategoryGap[];
  transaction_note?: string | null;
};

const LIMIT = 50;
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const PAYMENT_TERMS = ['Cash', 'Check', 'COD', 'ACH / Bank Transfer', 'AutoPay', 'Custom'];
const KNOWN_PAYMENT_TERMS = new Set(PAYMENT_TERMS);
const SCHEDULE_FREQUENCIES: Array<{
  value: 'weekly' | 'biweekly' | 'monthly';
  label: string;
}> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
];
const IMPORT_COLUMNS = [
  'source',
  'store_id',
  'store_name',
  'vendor_name',
  'sales_rep_name',
  'phone',
  'email',
  'website',
  'category',
  'notes',
  'is_active',
  'order_days',
  'delivery_days',
  'expected_invoice_amount',
  'payment_terms',
  'schedule_frequency',
  'notification_enabled',
];

const emptyForm: VendorFormState = {
  vendor_name: '',
  sales_rep_name: '',
  phone: '',
  email: '',
  website: '',
  category: '',
  notes: '',
  is_active: true,
  store_id: '',
  type: 'store',
  order_days: [],
  delivery_days: [],
  expected_invoice_amount: '',
  payment_terms: '',
  custom_payment_terms: '',
  schedule_frequency: 'weekly',
  notification_enabled: true,
};

async function adminFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('Please log in again.');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const json = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(json.error || `Request failed with status ${response.status}.`);
  }

  return json as T;
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCurrency(value: number | null) {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function shortDays(days: string[]) {
  if (days.length === 0) return '-';
  return days.map((day) => day.slice(0, 3)).join(', ');
}

function formatScheduleFrequency(value: 'weekly' | 'biweekly' | 'monthly' | null | undefined) {
  return SCHEDULE_FREQUENCIES.find((frequency) => frequency.value === value)?.label || 'Weekly';
}

function csvCell(value: string | number | boolean | null) {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildQuery(page: number, filters: FilterState, limit = LIMIT) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.storeFilter) params.set('store_id', filters.storeFilter);
  if (filters.typeFilter) params.set('type', filters.typeFilter);
  if (filters.activeFilter) params.set('is_active', filters.activeFilter);

  return params;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string | number | boolean | null) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseCsv(text: string): ImportRow[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows.filter((csvRow) =>
    csvRow.some((cell) => cell.trim())
  );
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());

  return dataRows.map((csvRow) =>
    normalizedHeaders.reduce<ImportRow>((record, header, index) => {
      record[header] = csvRow[index]?.trim() || '';
      return record;
    }, {})
  );
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'active', '1'].includes(normalized)) return true;
    if (['false', 'no', 'inactive', '0'].includes(normalized)) return false;
  }
  return fallback;
}

function parseDays(value: unknown) {
  const raw = typeof value === 'string' ? value.split(/[|,]/) : Array.isArray(value) ? value : [];
  return raw
    .map((day) => (typeof day === 'string' ? day.trim() : ''))
    .filter((day) => WEEKDAYS.includes(day));
}

function parseScheduleFrequency(value: unknown): 'weekly' | 'biweekly' | 'monthly' {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'weekly' || normalized === 'biweekly' || normalized === 'monthly') {
      return normalized;
    }
  }

  return 'weekly';
}

function rowText(row: ImportRow, key: string) {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value).trim();
}

function exportRows(rows: VendorRow[]) {
  return rows.map((vendor) => ({
    Source: vendor.source,
    Store: vendor.store_name || '',
    VendorName: vendor.vendor_name,
    SalesRep: vendor.sales_rep_name || '',
    Phone: vendor.phone || '',
    Email: vendor.email || '',
    Website: vendor.website || '',
    Category: vendor.category || '',
    Notes: vendor.notes || '',
    OrderDays: vendor.order_days.join(','),
    DeliveryDays: vendor.delivery_days.join(','),
    ExpectedInvoiceAmount: vendor.expected_invoice_amount ?? '',
    PaymentTerms: vendor.payment_terms || '',
    ScheduleFrequency: vendor.schedule_frequency || 'weekly',
    NotificationEnabled: vendor.notification_enabled,
    Active: vendor.is_active,
    CreatedAt: vendor.created_at || '',
    UpdatedAt: vendor.updated_at || '',
  }));
}

function WeekdayPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (days: string[]) => void;
}) {
  const toggleDay = (day: string) => {
    onChange(value.includes(day) ? value.filter((item) => item !== day) : [...value, day]);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((day) => {
          const active = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              className={[
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-muted',
              ].join(' ')}
              onClick={() => toggleDay(day)}
            >
              {day.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function coverageClass(value: number) {
  if (value >= 100) return 'text-emerald-700';
  if (value >= 50) return 'text-amber-700';
  return 'text-destructive';
}

function buildOpportunityInsights(analytics: AnalyticsResponse) {
  const insights: string[] = [];
  const lowCoverageCategories = analytics.category_gaps
    .filter((category) => category.products_without_vendor > 0)
    .sort((a, b) => a.vendor_coverage_pct - b.vendor_coverage_pct)
    .slice(0, 3);
  const storesWithNoVendors = analytics.store_summaries.filter(
    (store) => store.vendor_count === 0
  ).length;
  const largestGap = [...analytics.category_gaps].sort(
    (a, b) => b.products_without_vendor - a.products_without_vendor
  )[0];

  lowCoverageCategories.forEach((category) => {
    insights.push(
      `The ${category.category} category has ${category.products_without_vendor} products without a vendor. Consider onboarding a ${category.category} vendor.`
    );
  });

  if (storesWithNoVendors > 0) {
    insights.push(`${storesWithNoVendors} stores have no vendors configured.`);
  }

  if (largestGap && largestGap.products_without_vendor > 0) {
    insights.push(
      `${largestGap.category} has the highest unassigned product count at ${largestGap.products_without_vendor}.`
    );
  }

  return insights.length > 0
    ? insights
    : ['Vendor coverage is in good shape. Keep vendor assignments current as new products are added.'];
}

function AnalyticsDashboard({
  analytics,
  loading,
  error,
  onRefresh,
}: {
  analytics: AnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading vendor analytics...
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-sm">{error}</p>
      </Card>
    );
  }

  if (!analytics) {
    return (
      <Card className="p-6">
        <Button onClick={onRefresh}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Load Analytics
        </Button>
      </Card>
    );
  }

  const topVendors = [...analytics.vendor_performance]
    .sort((a, b) => b.store_count - a.store_count || b.product_count - a.product_count)
    .slice(0, 20);
  const categoryGaps = [...analytics.category_gaps].sort(
    (a, b) => b.products_without_vendor - a.products_without_vendor
  );
  const storeCoverage = [...analytics.store_summaries].sort((a, b) => {
    const aCoverage =
      a.product_count === 0 ? 0 : (a.products_with_vendor / a.product_count) * 100;
    const bCoverage =
      b.product_count === 0 ? 0 : (b.products_with_vendor / b.product_count) * 100;
    return aCoverage - bCoverage;
  });
  const insights = buildOpportunityInsights(analytics);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="outline" onClick={onRefresh}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh Analytics
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Total Vendors</p>
          <p className="mt-2 text-2xl font-semibold">{analytics.platform_totals.total_vendors}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Vendor Coverage</p>
          <p className="mt-2 text-2xl font-semibold">
            {analytics.platform_totals.vendor_coverage_pct}%
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Total Stores</p>
          <p className="mt-2 text-2xl font-semibold">{analytics.platform_totals.total_stores}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Products Without Vendor
          </p>
          <p
            className={[
              'mt-2 text-2xl font-semibold',
              analytics.platform_totals.total_products_without_vendor > 0
                ? 'text-destructive'
                : '',
            ].join(' ')}
          >
            {analytics.platform_totals.total_products_without_vendor}
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-foreground">Vendor Performance</h2>
          <p className="text-sm text-muted-foreground">
            Which vendors serve the most stores and products.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Vendor Name</th>
                <th className="px-3 py-2">Stores Using</th>
                <th className="px-3 py-2">Products</th>
                <th className="px-3 py-2">Categories</th>
                <th className="px-3 py-2">Est. Reorder Spend</th>
                <th className="px-3 py-2">Inventory Value</th>
              </tr>
            </thead>
            <tbody>
              {topVendors.map((vendor) => (
                <tr key={vendor.vendor_name} className="border-b last:border-0">
                  <td className="px-3 py-3 font-medium text-foreground">{vendor.vendor_name}</td>
                  <td className="px-3 py-3">{vendor.store_count}</td>
                  <td className="px-3 py-3">{vendor.product_count}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {vendor.categories.slice(0, 4).join(', ') || '-'}
                  </td>
                  <td className="px-3 py-3">{formatCurrency(vendor.estimated_reorder_spend)}</td>
                  <td className="px-3 py-3">{formatCurrency(vendor.total_inventory_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-foreground">Category Gaps</h2>
          <p className="text-sm text-muted-foreground">
            Categories where products have no assigned vendor. Use this to identify opportunities
            to onboard new vendors.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Total Products</th>
                <th className="px-3 py-2">Without Vendor</th>
                <th className="px-3 py-2">Coverage %</th>
                <th className="px-3 py-2">Top Vendors in Category</th>
              </tr>
            </thead>
            <tbody>
              {categoryGaps.map((category) => (
                <tr key={category.category} className="border-b last:border-0">
                  <td className="px-3 py-3 font-medium text-foreground">{category.category}</td>
                  <td className="px-3 py-3">{category.total_products}</td>
                  <td
                    className={[
                      'px-3 py-3',
                      category.products_without_vendor > 0 ? 'text-destructive' : '',
                    ].join(' ')}
                  >
                    {category.products_without_vendor}
                  </td>
                  <td className={`px-3 py-3 font-medium ${coverageClass(category.vendor_coverage_pct)}`}>
                    {category.vendor_coverage_pct}%
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {category.top_vendors.join(', ') || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-foreground">Store Vendor Coverage</h2>
          <p className="text-sm text-muted-foreground">
            How well each store&apos;s products are assigned to vendors.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Store Name</th>
                <th className="px-3 py-2">Vendors Set Up</th>
                <th className="px-3 py-2">Products Total</th>
                <th className="px-3 py-2">With Vendor</th>
                <th className="px-3 py-2">Without Vendor</th>
                <th className="px-3 py-2">Coverage %</th>
              </tr>
            </thead>
            <tbody>
              {storeCoverage.map((store) => {
                const pct =
                  store.product_count === 0
                    ? 0
                    : Math.round((store.products_with_vendor / store.product_count) * 1000) / 10;

                return (
                  <tr key={store.store_id} className="border-b last:border-0">
                    <td className="px-3 py-3 font-medium text-foreground">{store.store_name}</td>
                    <td className="px-3 py-3">{store.vendor_count}</td>
                    <td className="px-3 py-3">{store.product_count}</td>
                    <td className="px-3 py-3">{store.products_with_vendor}</td>
                    <td
                      className={[
                        'px-3 py-3',
                        store.products_without_vendor > 0 ? 'text-destructive' : '',
                      ].join(' ')}
                    >
                      {store.products_without_vendor}
                    </td>
                    <td className={`px-3 py-3 font-medium ${coverageClass(pct)}`}>{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="border-blue-500/30 bg-blue-500/5 p-5">
        <h2 className="font-semibold text-blue-900">Vendor Opportunity Insights</h2>
        <div className="mt-3 space-y-2 text-sm text-blue-900">
          {insights.map((insight) => (
            <p key={insight}>{insight}</p>
          ))}
          {analytics.transaction_note ? (
            <p className="text-xs text-blue-800/80">{analytics.transaction_note}</p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

export default function AdminVendorsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [editingVendor, setEditingVendor] = useState<VendorRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [form, setForm] = useState<VendorFormState>(emptyForm);
  const [exportOpen, setExportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'vendors' | 'analytics'>('vendors');
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const currentFilters = useCallback(
    (): FilterState => ({ search, storeFilter, typeFilter, activeFilter }),
    [search, storeFilter, typeFilter, activeFilter]
  );

  const loadStores = useCallback(async () => {
    try {
      const data = await adminFetch<StoresResponse>('/api/admin/stores');
      const normalized =
        data.stores
          ?.filter((store) => store.id)
          .map((store) => ({
            id: store.id || '',
            store_name:
              store.store_name ||
              store.business_legal_name ||
              store.dba_name ||
              store.primary_owner_email ||
              'Unnamed Store',
          }))
          .sort((a, b) => a.store_name.localeCompare(b.store_name)) || [];

      setStores(normalized);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load stores.');
    }
  }, []);

  const load = useCallback(async (currentPage: number, filters: FilterState) => {
    setLoading(true);
    setError(null);

    try {
      const params = buildQuery(currentPage, filters);
      const data = await adminFetch<VendorsResponse>(`/api/admin/vendors?${params.toString()}`);
      setVendors(data.vendors || []);
      setTotal(data.total || 0);
      setPage(currentPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load vendors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStores();
    void load(0, { search: '', storeFilter: '', typeFilter: '', activeFilter: '' });
  }, [load, loadStores]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);

    try {
      const data = await adminFetch<AnalyticsResponse>('/api/admin/vendors/analytics');
      setAnalytics(data);
    } catch (loadError) {
      setAnalyticsError(
        loadError instanceof Error ? loadError.message : 'Failed to load vendor analytics.'
      );
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const handleTabChange = (tab: 'vendors' | 'analytics') => {
    setActiveTab(tab);
    if (tab === 'analytics' && !analytics && !analyticsLoading) {
      void loadAnalytics();
    }
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const handleSearch = () => {
    void load(0, currentFilters());
  };

  const handleClearFilters = () => {
    const filters = { search: '', storeFilter: '', typeFilter: '', activeFilter: '' };
    setSearch('');
    setStoreFilter('');
    setTypeFilter('');
    setActiveFilter('');
    void load(0, filters);
  };

  const handleRefresh = () => {
    void load(page, currentFilters());
  };

  const openCreate = () => {
    setDrawerMode('create');
    setEditingVendor(null);
    setForm(emptyForm);
    setDrawerOpen(true);
    setError(null);
  };

  const openEdit = (vendor: VendorRow) => {
    const existingPaymentTerms = vendor.payment_terms || '';
    const usesKnownPaymentTerms = KNOWN_PAYMENT_TERMS.has(existingPaymentTerms);

    setDrawerMode('edit');
    setEditingVendor(vendor);
    setForm({
      vendor_name: vendor.vendor_name,
      sales_rep_name: vendor.sales_rep_name || '',
      phone: vendor.phone || '',
      email: vendor.email || '',
      website: vendor.website || '',
      category: vendor.category || '',
      notes: vendor.notes || '',
      is_active: vendor.is_active,
      store_id: vendor.store_id || '',
      type: vendor.source,
      order_days: vendor.order_days || [],
      delivery_days: vendor.delivery_days || [],
      expected_invoice_amount:
        vendor.expected_invoice_amount === null ? '' : String(vendor.expected_invoice_amount),
      payment_terms: usesKnownPaymentTerms ? existingPaymentTerms : existingPaymentTerms ? 'Custom' : '',
      custom_payment_terms: usesKnownPaymentTerms ? '' : existingPaymentTerms,
      schedule_frequency: vendor.schedule_frequency || 'weekly',
      notification_enabled: vendor.notification_enabled,
    });
    setDrawerOpen(true);
    setError(null);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingVendor(null);
    setError(null);
  };

  const handleSubmit = async () => {
    const vendorName = form.vendor_name.trim();

    if (!vendorName) {
      setError('Vendor name is required.');
      return;
    }

    if (drawerMode === 'create' && form.type === 'store' && !form.store_id) {
      setError('Store is required for store vendors.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const paymentTerms =
        form.payment_terms === 'Custom'
          ? form.custom_payment_terms.trim() || 'Custom'
          : form.payment_terms;
      const payload = {
        ...form,
        vendor_name: vendorName,
        expected_invoice_amount: form.expected_invoice_amount.trim() || null,
        payment_terms: paymentTerms,
        source: editingVendor?.source,
      };

      if (drawerMode === 'create') {
        await adminFetch('/api/admin/vendors', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showSuccess('Vendor created.');
      } else if (editingVendor) {
        await adminFetch(`/api/admin/vendors/${editingVendor.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, source: editingVendor.source }),
        });
        showSuccess('Vendor updated.');
      }

      closeDrawer();
      await load(page, currentFilters());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save vendor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (vendor: VendorRow) => {
    const confirmed = window.confirm(
      `Delete vendor "${vendor.vendor_name}"? This cannot be undone.`
    );

    if (!confirmed) return;

    setError(null);

    try {
      await adminFetch(`/api/admin/vendors/${vendor.id}?source=${vendor.source}`, {
        method: 'DELETE',
      });
      showSuccess('Vendor deleted.');
      await load(page, currentFilters());
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete vendor.');
    }
  };

  const handleToggleActive = async (vendor: VendorRow) => {
    setError(null);

    try {
      await adminFetch(`/api/admin/vendors/${vendor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ source: vendor.source, is_active: !vendor.is_active }),
      });
      showSuccess(vendor.is_active ? 'Vendor deactivated.' : 'Vendor activated.');
      await load(page, currentFilters());
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update status.');
    }
  };

  const loadExportRows = async () => {
    const params = buildQuery(0, currentFilters(), 10000);
    const data = await adminFetch<VendorsResponse>(`/api/admin/vendors?${params.toString()}`);
    return data.vendors || [];
  };

  const handleExportCSV = async () => {
    setExportOpen(false);
    try {
      const rows = exportRows(await loadExportRows());
      const headers = Object.keys(rows[0] || exportRows([])[0] || {
        Source: '',
        Store: '',
        VendorName: '',
        SalesRep: '',
        Phone: '',
        Email: '',
        Website: '',
        Category: '',
        Notes: '',
        OrderDays: '',
        DeliveryDays: '',
        ExpectedInvoiceAmount: '',
        PaymentTerms: '',
        ScheduleFrequency: '',
        NotificationEnabled: '',
        Active: '',
        CreatedAt: '',
        UpdatedAt: '',
      });
      const csv = [
        headers.map(csvCell).join(','),
        ...rows.map((row) =>
          headers.map((header) => csvCell(row[header as keyof typeof row] ?? null)).join(',')
        ),
      ].join('\n');

      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'admin-vendors.csv');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export CSV.');
    }
  };

  const handleExportXLSX = async () => {
    setExportOpen(false);
    try {
      const rows = exportRows(await loadExportRows());
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Vendors');
      const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      downloadBlob(
        new Blob([array], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'admin-vendors.xlsx'
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export XLSX.');
    }
  };

  const handleExportPDF = async () => {
    setExportOpen(false);
    try {
      const rows = await loadExportRows();
      const printable = window.open('', '_blank');
      if (!printable) throw new Error('Unable to open print window.');

      const body = rows
        .map(
          (vendor) => `
          <tr>
            <td>${escapeHtml(vendor.source)}</td>
            <td>${escapeHtml(vendor.store_name || '')}</td>
            <td>${escapeHtml(vendor.vendor_name)}</td>
            <td>${escapeHtml(vendor.sales_rep_name || '')}</td>
            <td>${escapeHtml(vendor.phone || '')}</td>
            <td>${escapeHtml(vendor.email || '')}</td>
            <td>${escapeHtml(vendor.category || '')}</td>
            <td>${escapeHtml(vendor.order_days.join(', '))}</td>
            <td>${escapeHtml(vendor.delivery_days.join(', '))}</td>
            <td>${escapeHtml(formatCurrency(vendor.expected_invoice_amount))}</td>
            <td>${escapeHtml(vendor.payment_terms || '')}</td>
            <td>${escapeHtml(formatScheduleFrequency(vendor.schedule_frequency))}</td>
            <td>${escapeHtml(vendor.is_active ? 'Active' : 'Inactive')}</td>
          </tr>`
        )
        .join('');

      printable.document.write(`
        <html>
          <head>
            <title>Admin Vendors</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
              h1 { font-size: 22px; margin-bottom: 16px; }
              table { border-collapse: collapse; width: 100%; font-size: 11px; }
              th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
              th { background: #f3f4f6; }
            </style>
          </head>
          <body>
            <h1>Admin Vendors</h1>
            <table>
              <thead>
                <tr>
                  <th>Source</th><th>Store</th><th>Vendor Name</th><th>Sales Rep</th>
                  <th>Phone</th><th>Email</th><th>Category</th><th>Order Days</th>
                  <th>Delivery Days</th><th>Expected Invoice Amount</th>
                  <th>Payment Terms</th><th>Frequency</th><th>Active</th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
            </table>
            <script>window.onload = () => window.print();</script>
          </body>
        </html>
      `);
      printable.document.close();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export PDF.');
    }
  };

  const handleDownloadTemplate = () => {
    const csv = [
      IMPORT_COLUMNS.map(csvCell).join(','),
      [
        'store',
        '',
        stores[0]?.store_name || '',
        'Example Vendor',
        'Sales Rep',
        '555-0100',
        'rep@example.com',
        'https://example.com',
        'Grocery',
        'Imported template row',
        'true',
        'Monday,Wednesday',
        'Tuesday,Friday',
        '2500.00',
        'Net 15',
        'weekly',
        'true',
      ]
        .map(csvCell)
        .join(','),
    ].join('\n');

    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      'vendor-import-template.csv'
    );
  };

  const parseImportFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: '' });
    }

    return parseCsv(await file.text());
  };

  const buildImportPayload = (row: ImportRow) => {
    const sourceValue = (rowText(row, 'source') || rowText(row, 'type')).toLowerCase();
    const source = sourceValue === 'global' ? 'global' : 'store';
    const storeName = rowText(row, 'store_name').toLowerCase();
    const matchedStore = stores.find((store) => store.store_name.toLowerCase() === storeName);
    const storeId = rowText(row, 'store_id') || matchedStore?.id || '';
    const amountText = rowText(row, 'expected_invoice_amount');

    return {
      type: source,
      store_id: storeId,
      vendor_name: rowText(row, 'vendor_name'),
      sales_rep_name: rowText(row, 'sales_rep_name'),
      phone: rowText(row, 'phone'),
      email: rowText(row, 'email'),
      website: rowText(row, 'website'),
      category: rowText(row, 'category'),
      notes: rowText(row, 'notes'),
      is_active: parseBoolean(rowText(row, 'is_active'), true),
      order_days: parseDays(rowText(row, 'order_days')),
      delivery_days: parseDays(rowText(row, 'delivery_days')),
      expected_invoice_amount: amountText || null,
      payment_terms: rowText(row, 'payment_terms'),
      schedule_frequency: parseScheduleFrequency(rowText(row, 'schedule_frequency')),
      notification_enabled: parseBoolean(rowText(row, 'notification_enabled'), true),
    };
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;

    setImporting(true);
    setError(null);
    const summary: ImportSummary = { inserted: 0, skipped: 0, failed: 0, errors: [] };

    try {
      const rows = await parseImportFile(file);

      for (const [index, row] of rows.entries()) {
        const line = index + 2;
        const payload = buildImportPayload(row);

        if (!payload.vendor_name) {
          summary.skipped += 1;
          summary.errors.push(`Row ${line}: skipped, vendor_name is required.`);
          continue;
        }

        if (payload.type === 'store' && !payload.store_id) {
          summary.skipped += 1;
          summary.errors.push(`Row ${line}: skipped, store_id or matching store_name is required.`);
          continue;
        }

        try {
          await adminFetch('/api/admin/vendors', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          summary.inserted += 1;
        } catch (importError) {
          const message =
            importError instanceof Error ? importError.message : 'Failed to import row.';
          if (/duplicate|unique/i.test(message)) {
            summary.skipped += 1;
            summary.errors.push(`Row ${line}: skipped, duplicate vendor.`);
          } else {
            summary.failed += 1;
            summary.errors.push(`Row ${line}: ${message}`);
          }
        }
      }

      setImportSummary(summary);
      showSuccess(`Import complete. Inserted ${summary.inserted} vendor(s).`);
      await load(page, currentFilters());
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import vendors.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRow = total === 0 ? 0 : page * LIMIT + 1;
  const endRow = Math.min((page + 1) * LIMIT, total);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const storeVendorCount = vendors.filter((vendor) => vendor.source === 'store').length;
  const globalVendorCount = vendors.filter((vendor) => vendor.source === 'global').length;
  const inactiveCount = vendors.filter((vendor) => !vendor.is_active).length;

  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Vendors"
        description="All store vendors and global central vendors."
      >
        <div className="relative">
          <Button variant="outline" onClick={() => setExportOpen((open) => !open)}>
            <Download className="mr-2 h-4 w-4" />
            Export
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
          {exportOpen ? (
            <div className="absolute right-0 top-11 z-20 w-40 rounded-md border bg-background p-1 shadow-lg">
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => void handleExportCSV()}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => void handleExportXLSX()}
              >
                Export XLSX
              </button>
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => void handleExportPDF()}
              >
                Export PDF
              </button>
            </div>
          ) : null}
        </div>
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          {importing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(event) => void handleImportFile(event.target.files?.[0])}
        />
        <Button variant="outline" onClick={handleDownloadTemplate}>
          Download Template
        </Button>
        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Vendor
        </Button>
      </SuperadminPageHeader>

      <div className="mb-5 flex w-fit rounded-lg border bg-background p-1">
        <button
          type="button"
          className={[
            'rounded-md px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'vendors'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          ].join(' ')}
          onClick={() => handleTabChange('vendors')}
        >
          Vendors
        </button>
        <button
          type="button"
          className={[
            'rounded-md px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'analytics'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          ].join(' ')}
          onClick={() => handleTabChange('analytics')}
        >
          Analytics
        </button>
      </div>

      {activeTab === 'vendors' ? (
      <div className="space-y-5">
        {error ? (
          <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </Card>
        ) : null}

        {success ? (
          <Card className="border-emerald-500/30 bg-emerald-500/5 p-4 text-sm font-medium text-emerald-700">
            {success}
          </Card>
        ) : null}

        {importSummary ? (
          <Card className="p-4">
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium text-foreground">Import summary</p>
                <p className="text-muted-foreground">
                  Inserted {importSummary.inserted}, skipped {importSummary.skipped}, failed{' '}
                  {importSummary.failed}
                </p>
                {importSummary.errors.length > 0 ? (
                  <ul className="mt-2 max-h-28 overflow-y-auto text-xs text-muted-foreground">
                    {importSummary.errors.slice(0, 20).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setImportSummary(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Vendors</p>
            <p className="mt-2 text-2xl font-semibold">{total}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Store Vendors</p>
            <p className="mt-2 text-2xl font-semibold">{storeVendorCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Global Vendors</p>
            <p className="mt-2 text-2xl font-semibold">{globalVendorCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">Inactive</p>
            <p className="mt-2 text-2xl font-semibold">{inactiveCount}</p>
          </Card>
        </div>

        <Card className="p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_170px_150px_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search vendor, email, phone, rep..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearch();
                }}
              />
            </div>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={storeFilter}
              onChange={(event) => setStoreFilter(event.target.value)}
            >
              <option value="">All Stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.store_name}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">All</option>
              <option value="store">Store Vendors</option>
              <option value="global">Global Vendors</option>
            </select>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value)}
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <Button onClick={handleSearch}>
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading vendors...
            </div>
          ) : vendors.length === 0 ? (
            <div className="py-12 text-center">
              <Store className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="font-medium text-muted-foreground">No vendors found</p>
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                New Vendor
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1220px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2">Vendor</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Schedule</th>
                      <th className="px-3 py-2">Sales Rep</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((vendor) => {
                      const expanded = expandedId === vendor.id;

                      return (
                        <Fragment key={vendor.id}>
                          <tr className="border-b last:border-0">
                            <td className="px-3 py-3">
                              <p className="font-medium text-foreground">{vendor.vendor_name}</p>
                              {vendor.email ? (
                                <p className="text-xs text-muted-foreground">{vendor.email}</p>
                              ) : null}
                              {vendor.phone ? (
                                <p className="text-xs text-muted-foreground">{vendor.phone}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-3">
                              {vendor.source === 'global' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700">
                                  <Globe className="h-3.5 w-3.5" />
                                  Global
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                  <Store className="h-3.5 w-3.5" />
                                  {vendor.store_name || 'Store'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <div className="space-y-1 text-xs">
                                <span className="inline-flex rounded-full bg-sky-500/10 px-2 py-0.5 font-medium text-sky-700">
                                  Order: {shortDays(vendor.order_days)}
                                </span>
                                <br />
                                <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700">
                                  Delivery: {shortDays(vendor.delivery_days)}
                                </span>
                                <br />
                                <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700">
                                  Frequency: {formatScheduleFrequency(vendor.schedule_frequency)}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {vendor.sales_rep_name || '-'}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {vendor.category || '-'}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {vendor.email ? <p>{vendor.email}</p> : null}
                              {vendor.phone ? <p>{vendor.phone}</p> : null}
                              {vendor.website ? (
                                <a
                                  href={vendor.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline"
                                >
                                  {vendor.website}
                                </a>
                              ) : null}
                              {!vendor.email && !vendor.phone && !vendor.website ? '-' : null}
                            </td>
                            <td className="px-3 py-3">
                              {vendor.is_active ? (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                  Active
                                </span>
                              ) : (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                  Inactive
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => openEdit(vendor)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleToggleActive(vendor)}
                                  title={vendor.is_active ? 'Deactivate vendor' : 'Activate vendor'}
                                >
                                  {vendor.is_active ? (
                                    <ToggleRight className="h-3.5 w-3.5 text-emerald-600" />
                                  ) : (
                                    <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive hover:bg-destructive/10"
                                  onClick={() => void handleDelete(vendor)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setExpandedId(expanded ? null : vendor.id)}
                                >
                                  {expanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-b bg-muted/40">
                              <td colSpan={8} className="px-3 py-4">
                                <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                                  <div>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">
                                      Notes
                                    </p>
                                    <p className="mt-1 text-foreground">{vendor.notes || '-'}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">
                                      Order Days
                                    </p>
                                    <p className="mt-1 text-foreground">
                                      {vendor.order_days.join(', ') || '-'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">
                                      Delivery Days
                                    </p>
                                    <p className="mt-1 text-foreground">
                                      {vendor.delivery_days.join(', ') || '-'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">
                                      Payment
                                    </p>
                                    <p className="mt-1 text-foreground">
                                      Expected: {formatCurrency(vendor.expected_invoice_amount)}
                                    </p>
                                    <p className="text-foreground">
                                      Terms: {vendor.payment_terms || '-'}
                                    </p>
                                    <p className="text-foreground">
                                      Frequency: {formatScheduleFrequency(vendor.schedule_frequency)}
                                    </p>
                                    <p className="text-foreground">
                                      Notifications:{' '}
                                      {vendor.notification_enabled ? 'Enabled' : 'Disabled'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">
                                      Website
                                    </p>
                                    <p className="mt-1 text-foreground">{vendor.website || '-'}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">
                                      Store ID
                                    </p>
                                    <p className="mt-1 text-foreground">
                                      {vendor.source === 'store' ? vendor.store_id : '-'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">
                                      Dates
                                    </p>
                                    <p className="mt-1 text-foreground">
                                      Created: {formatDate(vendor.created_at)}
                                    </p>
                                    <p className="text-foreground">
                                      Updated: {formatDate(vendor.updated_at)}
                                    </p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Showing {startRow}-{endRow} of {total}
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => void load(Math.max(0, page - 1), currentFilters())}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={endRow >= total}
                    onClick={() => void load(page + 1, currentFilters())}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
      ) : (
        <AnalyticsDashboard
          analytics={analytics}
          loading={analyticsLoading}
          error={analyticsError}
          onRefresh={() => void loadAnalytics()}
        />
      )}

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close vendor drawer"
            className="flex-1 bg-black/50"
            onClick={closeDrawer}
          />

          <aside className="flex h-full w-full max-w-lg flex-col bg-background shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {drawerMode === 'create'
                    ? 'New Vendor'
                    : `Edit: ${editingVendor?.vendor_name || 'Vendor'}`}
                </h2>
              </div>
              <Button variant="ghost" size="icon" onClick={closeDrawer} aria-label="Close">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              {drawerMode === 'create' ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Vendor Type</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={form.type === 'store' ? 'default' : 'outline'}
                      onClick={() => setForm((current) => ({ ...current, type: 'store' }))}
                    >
                      <Store className="mr-2 h-4 w-4" />
                      Store Vendor
                    </Button>
                    <Button
                      type="button"
                      variant={form.type === 'global' ? 'default' : 'outline'}
                      onClick={() => setForm((current) => ({ ...current, type: 'global' }))}
                    >
                      <Globe className="mr-2 h-4 w-4" />
                      Global Vendor
                    </Button>
                  </div>
                  {form.type === 'store' ? (
                    <label className="block space-y-1 text-sm">
                      <span className="font-medium text-foreground">Store *</span>
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.store_id}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, store_id: event.target.value }))
                        }
                      >
                        <option value="">Select store</option>
                        {stores.map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.store_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </section>
              ) : (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Vendor Type</h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {editingVendor?.source === 'global' ? (
                      <Globe className="h-3.5 w-3.5" />
                    ) : (
                      <Store className="h-3.5 w-3.5" />
                    )}
                    {editingVendor?.source === 'global' ? 'Global' : 'Store'}
                  </span>
                </section>
              )}

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Vendor Details</h3>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-foreground">Vendor Name *</span>
                  <Input
                    value={form.vendor_name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, vendor_name: event.target.value }))
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-foreground">Sales Rep Name</span>
                  <Input
                    value={form.sales_rep_name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, sales_rep_name: event.target.value }))
                    }
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium text-foreground">Phone</span>
                    <Input
                      value={form.phone}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, phone: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium text-foreground">Email</span>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, email: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium text-foreground">Website</span>
                    <Input
                      value={form.website}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, website: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium text-foreground">Category</span>
                    <Input
                      value={form.category}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, category: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-foreground">Notes</span>
                  <textarea
                    rows={2}
                    className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, is_active: event.target.checked }))
                    }
                  />
                  <span className="font-medium text-foreground">Is Active</span>
                </label>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Vendor Schedule</h3>
                <WeekdayPicker
                  label="Sales Rep / Order Days"
                  value={form.order_days}
                  onChange={(days) => setForm((current) => ({ ...current, order_days: days }))}
                />
                <WeekdayPicker
                  label="Expected Delivery Days"
                  value={form.delivery_days}
                  onChange={(days) => setForm((current) => ({ ...current, delivery_days: days }))}
                />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Schedule Frequency</p>
                  <div className="flex flex-wrap gap-2">
                    {SCHEDULE_FREQUENCIES.map((frequency) => {
                      const active = form.schedule_frequency === frequency.value;

                      return (
                        <button
                          key={frequency.value}
                          type="button"
                          className={[
                            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input bg-background text-muted-foreground hover:bg-muted',
                          ].join(' ')}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              schedule_frequency: frequency.value,
                            }))
                          }
                        >
                          {frequency.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium text-foreground">Expected Invoice Amount</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={form.expected_invoice_amount}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          expected_invoice_amount: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium text-foreground">
                      Default Payment Method / Terms
                    </span>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.payment_terms}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          payment_terms: event.target.value,
                          custom_payment_terms:
                            event.target.value === 'Custom' ? current.custom_payment_terms : '',
                        }))
                      }
                    >
                      <option value="">Select payment method / terms</option>
                      {PAYMENT_TERMS.map((term) => (
                        <option key={term} value={term}>
                          {term}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {form.payment_terms === 'Custom' ? (
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium text-foreground">
                      Custom Payment Method / Terms
                    </span>
                    <Input
                      value={form.custom_payment_terms}
                      placeholder="e.g. Net 45, Consignment, Zelle, vendor portal, etc."
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          custom_payment_terms: event.target.value,
                        }))
                      }
                    />
                  </label>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Payment sending is not enabled yet. This is used for vendor planning and future
                  reminders.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.notification_enabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        notification_enabled: event.target.checked,
                      }))
                    }
                  />
                  <span className="font-medium text-foreground">
                    Enable future vendor reminders
                  </span>
                </label>
              </section>
            </div>

            <div className="flex items-center justify-end gap-2 border-t p-5">
              <Button variant="outline" onClick={closeDrawer} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={() => void handleSubmit()} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {drawerMode === 'create' ? 'Create Vendor' : 'Save Changes'}
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </SuperadminShell>
  );
}
