import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type SupabaseRouteClient = ReturnType<typeof createRouteClient>;
type DiscoveryStatus = 'existing' | 'needs_review';
type DiscoverySectionKey =
  | 'products'
  | 'departments'
  | 'categories'
  | 'tax_categories'
  | 'deals'
  | 'fuel_dcr'
  | 'payment_methods'
  | 'age_restrictions';

type DiscoveryDetail = {
  label: string;
  value: string;
};

type DiscoveryRow = {
  id: string;
  primary: string;
  secondary: string | null;
  details: DiscoveryDetail[];
  status: DiscoveryStatus;
};

type DiscoverySection = {
  key: DiscoverySectionKey;
  title: string;
  totalDiscovered: number;
  needsReviewCount: number;
  alreadyExistsCount: number;
  lastSourceImport: string | null;
  lastSourceFile: string | null;
  rows: DiscoveryRow[];
  emptyMessage: string;
  error: string | null;
};

type ProductRow = {
  plu_raw: string | null;
  upc_normalized: string | null;
  description: string | null;
  unit_price: number | string | null;
  items_sold: number | string | null;
  total_sales: number | string | null;
  promotion_id: string | null;
};

type DepartmentRow = {
  department_number: string | null;
  department_name: string | null;
  items_sold: number | string | null;
  net_sales: number | string | null;
};

type CategoryRow = {
  category_number: string | null;
  category_name: string | null;
  items_sold: number | string | null;
  net_sales: number | string | null;
};

type TaxRow = {
  tax_name: string | null;
  tax_rate: number | string | null;
  taxable_sales: number | string | null;
  sales_taxes: number | string | null;
  total_taxes: number | string | null;
};

type DealRow = {
  deal_type: string | null;
  promotion_id: string | null;
  description: string | null;
  customer_count: number | string | null;
  match_count: number | string | null;
  combo_count: number | string | null;
  total_sales: number | string | null;
};

type FuelDcrRow = {
  dcr_number: string | null;
  sale_count: number | string | null;
  amount: number | string | null;
  volume: number | string | null;
  pump_percent: number | string | null;
  all_dcr_percent: number | string | null;
  all_fuel_percent: number | string | null;
};

type ReportFileRow = {
  file_name: string | null;
  created_at: string | null;
};

function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Discovery is read-only and does not need to persist refreshed auth cookies here.
        },
      },
    }
  );
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const formatted = [
      record.message,
      record.details,
      record.hint,
      record.code ? `Code: ${record.code}` : null,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ');

    if (formatted) return formatted;
  }
  return String(error || 'Unknown error');
}

function text(value: unknown, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return numberValue(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function decimal(value: unknown) {
  return numberValue(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function statusRows(rows: DiscoveryRow[]) {
  return {
    needsReviewCount: rows.filter((row) => row.status === 'needs_review').length,
    alreadyExistsCount: rows.filter((row) => row.status === 'existing').length,
  };
}

async function lastSourceImport(client: SupabaseRouteClient, storeId: string, reportTypes: string[]) {
  const { data, error } = await client
    .from('pos_report_files')
    .select('file_name, created_at')
    .eq('store_id', storeId)
    .in('report_type', reportTypes)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const row = (data?.[0] || null) as ReportFileRow | null;
  return {
    lastSourceImport: row?.created_at || null,
    lastSourceFile: row?.file_name || null,
  };
}

function emptySection(key: DiscoverySectionKey, title: string, emptyMessage: string): DiscoverySection {
  return {
    key,
    title,
    totalDiscovered: 0,
    needsReviewCount: 0,
    alreadyExistsCount: 0,
    lastSourceImport: null,
    lastSourceFile: null,
    rows: [],
    emptyMessage,
    error: null,
  };
}

async function sectionWithError(
  key: DiscoverySectionKey,
  title: string,
  emptyMessage: string,
  error: unknown
): Promise<DiscoverySection> {
  console.error(`[POS Discovery ${key} Error]`, error);
  return {
    ...emptySection(key, title, emptyMessage),
    error: formatError(error),
  };
}

async function productsSection(client: SupabaseRouteClient, storeId: string): Promise<DiscoverySection> {
  const title = 'Products';
  const emptyMessage = 'No products discovered yet. Import a PLU report to find product setup items.';
  try {
    const [rowsResult, source] = await Promise.all([
      client
        .from('pos_plu_sales')
        .select('plu_raw, upc_normalized, description, unit_price, items_sold, total_sales, promotion_id')
        .eq('store_id', storeId)
        .limit(5000),
      lastSourceImport(client, storeId, ['plu_sales']),
    ]);
    if (rowsResult.error) throw rowsResult.error;

    const grouped = new Map<string, ProductRow & { items_sold_total: number; total_sales_total: number }>();
    ((rowsResult.data || []) as ProductRow[]).forEach((row) => {
      const key = text(row.upc_normalized || row.plu_raw || row.description, 'unknown');
      const existing = grouped.get(key);
      if (existing) {
        existing.items_sold_total += numberValue(row.items_sold);
        existing.total_sales_total += numberValue(row.total_sales);
        return;
      }
      grouped.set(key, {
        ...row,
        items_sold_total: numberValue(row.items_sold),
        total_sales_total: numberValue(row.total_sales),
      });
    });

    const rows = Array.from(grouped.entries()).map(([key, row]): DiscoveryRow => ({
      id: `product-${key}`,
      primary: text(row.description, 'Unnamed product'),
      secondary: text(row.upc_normalized || row.plu_raw, 'No UPC/PLU'),
      status: 'needs_review',
      details: [
        { label: 'PLU', value: text(row.plu_raw, '-') },
        { label: 'Unit price', value: money(row.unit_price) },
        { label: 'Items sold', value: decimal(row.items_sold_total) },
        { label: 'Total sales', value: money(row.total_sales_total) },
        { label: 'Promotion', value: text(row.promotion_id, '-') },
      ],
    }));
    const counts = statusRows(rows);
    return { key: 'products', title, totalDiscovered: rows.length, ...counts, ...source, rows: rows.slice(0, 10), emptyMessage, error: null };
  } catch (error) {
    return sectionWithError('products', title, emptyMessage, error);
  }
}

async function departmentsSection(client: SupabaseRouteClient, storeId: string): Promise<DiscoverySection> {
  const title = 'Departments';
  const emptyMessage = 'No departments discovered yet. Import a Department report to find department setup items.';
  try {
    const [rowsResult, source] = await Promise.all([
      client
        .from('pos_department_sales')
        .select('department_number, department_name, items_sold, net_sales')
        .eq('store_id', storeId)
        .limit(5000),
      lastSourceImport(client, storeId, ['department_sales']),
    ]);
    if (rowsResult.error) throw rowsResult.error;

    const grouped = new Map<string, DepartmentRow & { items_sold_total: number; net_sales_total: number }>();
    ((rowsResult.data || []) as DepartmentRow[]).forEach((row) => {
      const key = text(row.department_number || row.department_name, 'unknown');
      const existing = grouped.get(key);
      if (existing) {
        existing.items_sold_total += numberValue(row.items_sold);
        existing.net_sales_total += numberValue(row.net_sales);
        return;
      }
      grouped.set(key, {
        ...row,
        items_sold_total: numberValue(row.items_sold),
        net_sales_total: numberValue(row.net_sales),
      });
    });

    const rows = Array.from(grouped.entries()).map(([key, row]): DiscoveryRow => ({
      id: `department-${key}`,
      primary: text(row.department_name, 'Unnamed department'),
      secondary: `Department #${text(row.department_number, '-')}`,
      status: 'needs_review',
      details: [
        { label: 'Items sold', value: decimal(row.items_sold_total) },
        { label: 'Net sales', value: money(row.net_sales_total) },
      ],
    }));
    const counts = statusRows(rows);
    return { key: 'departments', title, totalDiscovered: rows.length, ...counts, ...source, rows: rows.slice(0, 10), emptyMessage, error: null };
  } catch (error) {
    return sectionWithError('departments', title, emptyMessage, error);
  }
}

async function categoriesSection(client: SupabaseRouteClient, storeId: string): Promise<DiscoverySection> {
  const title = 'Categories';
  const emptyMessage = 'No categories discovered yet. Import a Category report to find category setup items.';
  try {
    const [rowsResult, source] = await Promise.all([
      client
        .from('pos_category_sales')
        .select('category_number, category_name, items_sold, net_sales')
        .eq('store_id', storeId)
        .limit(5000),
      lastSourceImport(client, storeId, ['category_sales']),
    ]);
    if (rowsResult.error) throw rowsResult.error;

    const grouped = new Map<string, CategoryRow & { items_sold_total: number; net_sales_total: number }>();
    ((rowsResult.data || []) as CategoryRow[]).forEach((row) => {
      const key = text(row.category_number || row.category_name, 'unknown');
      const existing = grouped.get(key);
      if (existing) {
        existing.items_sold_total += numberValue(row.items_sold);
        existing.net_sales_total += numberValue(row.net_sales);
        return;
      }
      grouped.set(key, {
        ...row,
        items_sold_total: numberValue(row.items_sold),
        net_sales_total: numberValue(row.net_sales),
      });
    });

    const rows = Array.from(grouped.entries()).map(([key, row]): DiscoveryRow => ({
      id: `category-${key}`,
      primary: text(row.category_name, 'Unnamed category'),
      secondary: `Category #${text(row.category_number, '-')}`,
      status: 'needs_review',
      details: [
        { label: 'Items sold', value: decimal(row.items_sold_total) },
        { label: 'Net sales', value: money(row.net_sales_total) },
      ],
    }));
    const counts = statusRows(rows);
    return { key: 'categories', title, totalDiscovered: rows.length, ...counts, ...source, rows: rows.slice(0, 10), emptyMessage, error: null };
  } catch (error) {
    return sectionWithError('categories', title, emptyMessage, error);
  }
}

async function taxSection(client: SupabaseRouteClient, storeId: string): Promise<DiscoverySection> {
  const title = 'Tax Categories';
  const emptyMessage = 'No tax categories discovered yet. Import a Tax report to find tax setup items.';
  try {
    const [rowsResult, source] = await Promise.all([
      client
        .from('pos_tax_summary')
        .select('tax_name, tax_rate, taxable_sales, sales_taxes, total_taxes')
        .eq('store_id', storeId)
        .limit(5000),
      lastSourceImport(client, storeId, ['tax_summary']),
    ]);
    if (rowsResult.error) throw rowsResult.error;

    const grouped = new Map<string, TaxRow & { taxable_sales_total: number; sales_taxes_total: number; total_taxes_total: number }>();
    ((rowsResult.data || []) as TaxRow[]).forEach((row) => {
      const key = `${text(row.tax_name, 'unknown')}|${text(row.tax_rate, '')}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.taxable_sales_total += numberValue(row.taxable_sales);
        existing.sales_taxes_total += numberValue(row.sales_taxes);
        existing.total_taxes_total += numberValue(row.total_taxes);
        return;
      }
      grouped.set(key, {
        ...row,
        taxable_sales_total: numberValue(row.taxable_sales),
        sales_taxes_total: numberValue(row.sales_taxes),
        total_taxes_total: numberValue(row.total_taxes),
      });
    });

    const rows = Array.from(grouped.entries()).map(([key, row]): DiscoveryRow => ({
      id: `tax-${key}`,
      primary: text(row.tax_name, 'Unnamed tax'),
      secondary: `${decimal(row.tax_rate)}%`,
      status: 'needs_review',
      details: [
        { label: 'Taxable sales', value: money(row.taxable_sales_total) },
        { label: 'Sales taxes', value: money(row.sales_taxes_total) },
        { label: 'Total taxes', value: money(row.total_taxes_total) },
      ],
    }));
    const counts = statusRows(rows);
    return { key: 'tax_categories', title, totalDiscovered: rows.length, ...counts, ...source, rows: rows.slice(0, 10), emptyMessage, error: null };
  } catch (error) {
    return sectionWithError('tax_categories', title, emptyMessage, error);
  }
}

async function dealsSection(client: SupabaseRouteClient, storeId: string): Promise<DiscoverySection> {
  const title = 'Deals / Promotions';
  const emptyMessage = 'No deals discovered yet. Import a Deal report to find promotion setup items.';
  try {
    const [rowsResult, source] = await Promise.all([
      client
        .from('pos_deal_sales')
        .select('deal_type, promotion_id, description, customer_count, match_count, combo_count, total_sales')
        .eq('store_id', storeId)
        .limit(5000),
      lastSourceImport(client, storeId, ['deal_sales']),
    ]);
    if (rowsResult.error) throw rowsResult.error;

    const grouped = new Map<string, DealRow & { customer_total: number; match_total: number; combo_total: number; sales_total: number }>();
    ((rowsResult.data || []) as DealRow[]).forEach((row) => {
      const key = `${text(row.promotion_id, 'unknown')}|${text(row.description, '')}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.customer_total += numberValue(row.customer_count);
        existing.match_total += numberValue(row.match_count);
        existing.combo_total += numberValue(row.combo_count);
        existing.sales_total += numberValue(row.total_sales);
        return;
      }
      grouped.set(key, {
        ...row,
        customer_total: numberValue(row.customer_count),
        match_total: numberValue(row.match_count),
        combo_total: numberValue(row.combo_count),
        sales_total: numberValue(row.total_sales),
      });
    });

    const rows = Array.from(grouped.entries()).map(([key, row]): DiscoveryRow => ({
      id: `deal-${key}`,
      primary: text(row.description, 'Unnamed promotion'),
      secondary: `${text(row.deal_type, 'unknown')} | Promotion ${text(row.promotion_id, '-')}`,
      status: 'needs_review',
      details: [
        { label: 'Customers', value: decimal(row.customer_total) },
        { label: 'Matches', value: decimal(row.match_total) },
        { label: 'Combos', value: decimal(row.combo_total) },
        { label: 'Total sales', value: money(row.sales_total) },
      ],
    }));
    const counts = statusRows(rows);
    return { key: 'deals', title, totalDiscovered: rows.length, ...counts, ...source, rows: rows.slice(0, 10), emptyMessage, error: null };
  } catch (error) {
    return sectionWithError('deals', title, emptyMessage, error);
  }
}

async function fuelDcrSection(client: SupabaseRouteClient, storeId: string): Promise<DiscoverySection> {
  const title = 'Fuel / DCR';
  const emptyMessage = 'No fuel/DCR items discovered yet.';
  try {
    const [rowsResult, source] = await Promise.all([
      client
        .from('pos_fuel_dcr_summary')
        .select('dcr_number, sale_count, amount, volume, pump_percent, all_dcr_percent, all_fuel_percent')
        .eq('store_id', storeId)
        .limit(5000),
      lastSourceImport(client, storeId, ['fuel_dcr_summary']),
    ]);
    if (rowsResult.error) throw rowsResult.error;

    const rows = ((rowsResult.data || []) as FuelDcrRow[]).map((row): DiscoveryRow => ({
      id: `fuel-dcr-${text(row.dcr_number, 'unknown')}`,
      primary: `DCR ${text(row.dcr_number, '-')}`,
      secondary: `${decimal(row.sale_count)} sales`,
      status: 'needs_review',
      details: [
        { label: 'Amount', value: money(row.amount) },
        { label: 'Volume', value: decimal(row.volume) },
        { label: 'Pump %', value: `${decimal(row.pump_percent)}%` },
        { label: 'All DCR %', value: `${decimal(row.all_dcr_percent)}%` },
        { label: 'All fuel %', value: `${decimal(row.all_fuel_percent)}%` },
      ],
    }));
    const counts = statusRows(rows);
    return { key: 'fuel_dcr', title, totalDiscovered: rows.length, ...counts, ...source, rows: rows.slice(0, 10), emptyMessage, error: null };
  } catch (error) {
    return sectionWithError('fuel_dcr', title, emptyMessage, error);
  }
}

export async function GET(request: NextRequest) {
  const client = createRouteClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return jsonError('You must be signed in.', 401);

  const storeId = request.nextUrl.searchParams.get('storeId') || '';
  if (!storeId) return jsonError('Select a specific store to review discovered POS setup items.');

  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (storeError) return jsonError(formatError(storeError), 500);
  if (!store) return jsonError('Store not found or you do not have access.', 403);

  const [
    products,
    departments,
    categories,
    taxCategories,
    deals,
    fuelDcr,
  ] = await Promise.all([
    productsSection(client, storeId),
    departmentsSection(client, storeId),
    categoriesSection(client, storeId),
    taxSection(client, storeId),
    dealsSection(client, storeId),
    fuelDcrSection(client, storeId),
  ]);

  return NextResponse.json({
    ok: true,
    sections: [
      products,
      departments,
      categories,
      taxCategories,
      deals,
      fuelDcr,
      emptySection('payment_methods', 'Payment Methods', 'Coming later.'),
      emptySection('age_restrictions', 'Age Restriction Suggestions', 'No suggestions yet.'),
    ],
  });
}
