import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type StoreRow = {
  id: string;
  store_name: string | null;
  business_legal_name?: string | null;
  dba_name?: string | null;
  primary_owner_email?: string | null;
};

type StoreVendorRow = {
  id: string;
  store_id: string;
  vendor_name: string | null;
};

type GlobalVendorRow = {
  id: string;
  vendor_name: string | null;
};

type ProductRow = {
  id: string;
  store_id: string;
  vendor: string | null;
  item_name: string | null;
  category: string | null;
  cost_price: number | string | null;
  selling_price: number | string | null;
  stock: number | string | null;
  reorder_level: number | string | null;
  is_active: boolean | null;
};

type TransactionRow = {
  store_id: string | null;
  upc: string | null;
  total_amount: number | string | null;
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

function cleanText(value: string | null | undefined) {
  return String(value || '').trim();
}

function normalizedName(value: string | null | undefined) {
  return cleanText(value).toLowerCase();
}

function safeNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function storeDisplayName(store: StoreRow | undefined) {
  return (
    store?.store_name ||
    store?.business_legal_name ||
    store?.dba_name ||
    store?.primary_owner_email ||
    'Unknown Store'
  );
}

function coveragePct(withVendor: number, total: number) {
  if (total === 0) return 0;
  return Math.round((withVendor / total) * 1000) / 10;
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, 'platform.superadmin');
  if (!auth.ok) return auth.response;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [storesResult, storeVendorsResult, globalVendorsResult, productsResult] =
      await Promise.all([
        supabaseAdmin
          .from('stores')
          .select('id, store_name, business_legal_name, dba_name, primary_owner_email'),
        supabaseAdmin.from('store_vendors').select('id, store_id, vendor_name'),
        supabaseAdmin.from('global_vendors').select('id, vendor_name'),
        supabaseAdmin
          .from('products')
          .select(
            'id, store_id, vendor, item_name, category, cost_price, selling_price, stock, reorder_level, is_active'
          ),
      ]);

    if (storesResult.error) throw new Error(storesResult.error.message);
    if (storeVendorsResult.error) throw new Error(storeVendorsResult.error.message);
    if (globalVendorsResult.error) throw new Error(globalVendorsResult.error.message);
    if (productsResult.error) throw new Error(productsResult.error.message);

    let transaction_note: string | null = null;
    const transactionResult = await supabaseAdmin
      .from('transactions')
      .select('store_id, upc, total_amount')
      .eq('transaction_type', 'Sale')
      .gte('transaction_time', ninetyDaysAgo.toISOString())
      .limit(50000);

    if (transactionResult.error) {
      transaction_note = `Transaction aggregate skipped: ${transactionResult.error.message}`;
    } else {
      const transactionRows = (transactionResult.data || []) as TransactionRow[];
      transaction_note = `Loaded ${transactionRows.length} sale transaction rows from the last 90 days.`;
    }

    const stores = (storesResult.data || []) as StoreRow[];
    const storeVendors = (storeVendorsResult.data || []) as StoreVendorRow[];
    const globalVendors = (globalVendorsResult.data || []) as GlobalVendorRow[];
    const products = (productsResult.data || []) as ProductRow[];

    const storeById = new Map(stores.map((store) => [store.id, store]));
    const storeNameById = new Map(
      stores.map((store) => [store.id, storeDisplayName(store)] as const)
    );

    const storeVendorNamesByStore = new Map<string, Set<string>>();
    for (const vendor of storeVendors) {
      const vendorName = cleanText(vendor.vendor_name);
      if (!vendorName) continue;
      const current = storeVendorNamesByStore.get(vendor.store_id) || new Set<string>();
      current.add(vendorName);
      storeVendorNamesByStore.set(vendor.store_id, current);
    }

    const productsByStore = new Map<string, ProductRow[]>();
    for (const product of products) {
      const current = productsByStore.get(product.store_id) || [];
      current.push(product);
      productsByStore.set(product.store_id, current);
    }

    const store_summaries: StoreSummary[] = stores.map((store) => {
      const storeProducts = productsByStore.get(store.id) || [];
      const productsWithVendor = storeProducts.filter((product) => cleanText(product.vendor)).length;
      const vendorNames = new Set(
        storeProducts.map((product) => cleanText(product.vendor)).filter(Boolean)
      );
      const estimatedReorderValue = storeProducts.reduce((sum, product) => {
        const stock = safeNumber(product.stock);
        const reorderLevel = safeNumber(product.reorder_level);
        if (stock > reorderLevel) return sum;
        return sum + safeNumber(product.cost_price) * reorderLevel;
      }, 0);

      return {
        store_id: store.id,
        store_name: storeDisplayName(store),
        vendor_count: storeVendorNamesByStore.get(store.id)?.size || 0,
        product_count: storeProducts.length,
        products_with_vendor: productsWithVendor,
        products_without_vendor: storeProducts.length - productsWithVendor,
        unique_vendor_names: Array.from(vendorNames).sort((a, b) => a.localeCompare(b)),
        estimated_reorder_value: estimatedReorderValue,
      };
    });

    const vendorMap = new Map<
      string,
      VendorPerformance & { storeIds: Set<string>; categorySet: Set<string> }
    >();

    for (const vendor of storeVendors) {
      const vendorName = cleanText(vendor.vendor_name);
      if (!vendorName) continue;
      const key = normalizedName(vendorName);
      const current =
        vendorMap.get(key) ||
        ({
          vendor_name: vendorName,
          store_count: 0,
          product_count: 0,
          total_inventory_value: 0,
          estimated_reorder_spend: 0,
          categories: [],
          stores_using: [],
          storeIds: new Set<string>(),
          categorySet: new Set<string>(),
        } satisfies VendorPerformance & { storeIds: Set<string>; categorySet: Set<string> });

      current.storeIds.add(vendor.store_id);
      vendorMap.set(key, current);
    }

    for (const product of products) {
      const vendorName = cleanText(product.vendor);
      if (!vendorName) continue;
      const key = normalizedName(vendorName);
      const current =
        vendorMap.get(key) ||
        ({
          vendor_name: vendorName,
          store_count: 0,
          product_count: 0,
          total_inventory_value: 0,
          estimated_reorder_spend: 0,
          categories: [],
          stores_using: [],
          storeIds: new Set<string>(),
          categorySet: new Set<string>(),
        } satisfies VendorPerformance & { storeIds: Set<string>; categorySet: Set<string> });

      current.product_count += 1;
      current.total_inventory_value += safeNumber(product.cost_price) * safeNumber(product.stock);
      if (safeNumber(product.stock) <= safeNumber(product.reorder_level)) {
        current.estimated_reorder_spend +=
          safeNumber(product.cost_price) * safeNumber(product.reorder_level);
      }
      if (cleanText(product.category)) current.categorySet.add(cleanText(product.category));
      if (product.store_id) current.storeIds.add(product.store_id);
      vendorMap.set(key, current);
    }

    const vendor_performance = Array.from(vendorMap.values())
      .map((vendor) => ({
        vendor_name: vendor.vendor_name,
        store_count: vendor.storeIds.size,
        product_count: vendor.product_count,
        total_inventory_value: vendor.total_inventory_value,
        estimated_reorder_spend: vendor.estimated_reorder_spend,
        categories: Array.from(vendor.categorySet).sort((a, b) => a.localeCompare(b)),
        stores_using: Array.from(vendor.storeIds)
          .map((storeId) => storeNameById.get(storeId) || storeDisplayName(storeById.get(storeId)))
          .sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => b.store_count - a.store_count || b.product_count - a.product_count);

    const categoryMap = new Map<
      string,
      { category: string; total: number; withoutVendor: number; vendorCounts: Map<string, number> }
    >();

    for (const product of products) {
      const category = cleanText(product.category) || 'Uncategorized';
      const current =
        categoryMap.get(category) ||
        ({ category, total: 0, withoutVendor: 0, vendorCounts: new Map<string, number>() });
      const vendorName = cleanText(product.vendor);

      current.total += 1;
      if (!vendorName) {
        current.withoutVendor += 1;
      } else {
        current.vendorCounts.set(vendorName, (current.vendorCounts.get(vendorName) || 0) + 1);
      }
      categoryMap.set(category, current);
    }

    const category_gaps: CategoryGap[] = Array.from(categoryMap.values())
      .map((category) => ({
        category: category.category,
        total_products: category.total,
        products_without_vendor: category.withoutVendor,
        vendor_coverage_pct: coveragePct(category.total - category.withoutVendor, category.total),
        top_vendors: Array.from(category.vendorCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([vendorName]) => vendorName),
      }))
      .sort((a, b) => b.products_without_vendor - a.products_without_vendor);

    const totalProductsWithVendor = products.filter((product) => cleanText(product.vendor)).length;
    const platform_totals = {
      total_stores: stores.length,
      total_vendors: storeVendors.length + globalVendors.length,
      total_global_vendors: globalVendors.length,
      total_store_vendors: storeVendors.length,
      total_products: products.length,
      total_products_with_vendor: totalProductsWithVendor,
      total_products_without_vendor: products.length - totalProductsWithVendor,
      vendor_coverage_pct: coveragePct(totalProductsWithVendor, products.length),
    };

    return NextResponse.json({
      platform_totals,
      store_summaries,
      vendor_performance,
      category_gaps,
      transaction_note,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load vendor analytics.' },
      { status: 500 }
    );
  }
}
