'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  transactions as mockTransactions,
  products as mockProducts,
  computeCashiers,
  computeDashboardStats,
  salesByCategory,
  salesByHour,
  topProducts,
  paymentTypeSplit,
  dailySales,
  type Transaction,
  type Cashier,
  type PaymentType,
  type TransactionType,
  type Product,
  type CardNetwork,
  type ExceptionReason,
} from '@/lib/mock-data';
import { supabase, type TransactionRow, type ProductRow } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

const STORAGE_KEY = 'storepulse_transactions_v1';
const STORAGE_META_KEY = 'storepulse_transactions_meta_v1';
const PRODUCTS_KEY = 'storepulse_products_v1';
const PRODUCTS_META_KEY = 'storepulse_products_meta_v1';

function mapDbTransaction(row: TransactionRow): Transaction {
  const timestamp = new Date(row.transaction_time);

  return {
    id: row.transaction_id,
    timestamp: row.transaction_time,
    hour: timestamp.getHours(),
    date: row.transaction_time.split('T')[0],
    item: row.item_name ?? 'Unknown Item',
    category: row.category ?? 'Unknown',
    cashierId: row.cashier_id ?? 'UNKNOWN',
    cashierName: row.cashier_id ?? 'UNKNOWN',
    register: row.register_id ?? 1,
    paymentType: (row.payment_type ?? 'Cash') as PaymentType,
    amount: row.total_amount,
    type: (row.transaction_type ?? 'Sale') as TransactionType,
    upc: row.upc ?? undefined,
    quantity: row.quantity ?? 1,
    unitPrice: row.unit_price ?? row.total_amount,
    discountAmount: row.discount_amount ?? 0,
    cardNetwork: (row.card_network ?? undefined) as CardNetwork | undefined,
    exceptionReason: (row.exception_reason ?? undefined) as ExceptionReason | undefined,
    fuelGrade: row.fuel_grade ?? undefined,
  };
}

function mapDbProduct(row: ProductRow): Product {
  const category = row.category ?? row.department ?? 'Uncategorized';
  const extendedRow = row as ProductRow & {
    plu?: string | null;
    product_code?: string | null;
    age_verification?: boolean | null;
    minimum_age?: number | null;
    age_restriction_type?: string | null;
  };

  return {
    upc: row.upc,
    name: row.item_name ?? '',
    category,
    department: row.department ?? category,
    sku: row.sku ?? undefined,
    plu: extendedRow.plu ?? undefined,
    productCode: extendedRow.product_code ?? undefined,
    brand: row.brand ?? 'Unknown',
    costPrice: row.cost_price,
    sellPrice: row.selling_price,
    stock: row.stock,
    reorderLevel: row.reorder_level,
    vendor: row.vendor ?? undefined,
    taxRate: row.tax_rate ?? 0,
    taxCategory: row.tax_category ?? 'standard',
    taxable: row.taxable ?? true,
    ebtEligible: row.ebt_eligible ?? false,
    ageVerification: extendedRow.age_verification ?? false,
    minimumAge: extendedRow.minimum_age ?? undefined,
    ageRestrictionType: extendedRow.age_restriction_type ?? undefined,
    isActive: row.is_active ?? true,
    notes: row.notes ?? undefined,
    unitsPerCase: Number(row.units_per_case) || 1,
    casesOnHand: Number(row.cases_on_hand) || 0,
    looseUnits: Number(row.loose_units) || 0,
  };
}

export interface UploadMeta {
  source: 'demo' | 'upload';
  fileName: string;
  importedAt: string;
  rowCount: number;
}

export interface ProductMeta {
  source: 'demo' | 'upload' | 'demo-edited' | 'upload-edited';
  fileName: string;
  importedAt: string;
  rowCount: number;
}

export interface StoreData {
  transactions: Transaction[];
  cashiers: Cashier[];
  stats: ReturnType<typeof computeDashboardStats>;
  categoryData: ReturnType<typeof salesByCategory>;
  hourData: ReturnType<typeof salesByHour>;
  productData: ReturnType<typeof topProducts>;
  paymentData: ReturnType<typeof paymentTypeSplit>;
  dailyData: ReturnType<typeof dailySales>;
  meta: UploadMeta;
  isDemo: boolean;
  loaded: boolean;
  products: Product[];
  productsMeta: ProductMeta;
  isDemoProducts: boolean;
  lowStockProducts: Product[];
  dataMode: 'demo' | 'cloud';
  cloudError: string | null;
}

export interface SaveResult {
  mode: 'cloud' | 'demo';
  error?: string;
}

const DEMO_META: UploadMeta = {
  source: 'demo',
  fileName: 'Built-in demo data',
  importedAt: '',
  rowCount: mockTransactions.length,
};

const DEMO_PRODUCTS_META: ProductMeta = {
  source: 'demo',
  fileName: 'Built-in demo pricebook',
  importedAt: '',
  rowCount: mockProducts.length,
};

const EMPTY_META: UploadMeta = {
  source: 'upload',
  fileName: 'No transactions yet',
  importedAt: '',
  rowCount: 0,
};

const EMPTY_PRODUCTS_META: ProductMeta = {
  source: 'upload',
  fileName: 'No products yet',
  importedAt: '',
  rowCount: 0,
};

function aggregations(txns: Transaction[]) {
  return {
    transactions: txns,
    cashiers: computeCashiers(txns),
    stats: computeDashboardStats(txns),
    categoryData: salesByCategory(txns),
    hourData: salesByHour(txns),
    productData: topProducts(8, txns),
    paymentData: paymentTypeSplit(txns),
    dailyData: dailySales(txns),
  };
}

function normalizeProduct(product: Product): Product {
  const category = (product.category || product.department || 'Uncategorized').trim();
  const department = (product.department || product.category || category).trim();
  const unitsPerCase = Math.max(1, Number(product.unitsPerCase) || 1);
  const casesOnHand = Math.max(0, Number(product.casesOnHand) || 0);
  const looseUnits = Math.max(0, Number(product.looseUnits) || 0);
  const calculatedStock = casesOnHand * unitsPerCase + looseUnits;
  const stock = calculatedStock > 0 ? calculatedStock : Number(product.stock) || 0;

  return {
    ...product,
    upc: product.upc.trim(),
    name: product.name.trim(),
    category,
    department,
    brand: product.brand?.trim() || 'Unknown',
    costPrice: Number(product.costPrice) || 0,
    sellPrice: Number(product.sellPrice) || 0,
    stock,
    reorderLevel: Number(product.reorderLevel) || 10,
    vendor: product.vendor?.trim() || undefined,
    sku: product.sku?.trim() || undefined,
    plu: product.plu?.trim() || undefined,
    productCode: product.productCode?.trim() || undefined,
    taxRate: Number(product.taxRate) || 0,
    taxCategory: product.taxCategory?.trim() || 'standard',
    taxable: product.taxable ?? true,
    ebtEligible: product.ebtEligible ?? false,
    ageVerification: product.ageVerification ?? false,
    minimumAge: product.ageVerification ? Number(product.minimumAge) || 21 : undefined,
    ageRestrictionType: product.ageVerification ? product.ageRestrictionType?.trim() || undefined : undefined,
    isActive: product.isActive ?? true,
    notes: product.notes?.trim() || undefined,
    unitsPerCase,
    casesOnHand,
    looseUnits,
  };
}

function productToDbFields(product: Product) {
  const normalized = normalizeProduct(product);

  return {
    item_name: normalized.name,
    category: normalized.category,
    department: normalized.department ?? normalized.category,
    sku: normalized.sku ?? null,
    plu: normalized.plu ?? null,
    product_code: normalized.productCode ?? null,
    brand: normalized.brand ?? 'Unknown',
    cost_price: normalized.costPrice,
    selling_price: normalized.sellPrice,
    stock: normalized.stock,
    reorder_level: normalized.reorderLevel,
    vendor: normalized.vendor ?? null,
    tax_rate: normalized.taxRate ?? 0,
    tax_category: normalized.taxCategory ?? 'standard',
    taxable: normalized.taxable ?? true,
    ebt_eligible: normalized.ebtEligible ?? false,
    age_verification: normalized.ageVerification ?? false,
    minimum_age: normalized.minimumAge ?? null,
    age_restriction_type: normalized.ageRestrictionType ?? null,
    is_active: normalized.isActive ?? true,
    notes: normalized.notes ?? null,
    units_per_case: normalized.unitsPerCase ?? 1,
    cases_on_hand: normalized.casesOnHand ?? 0,
    loose_units: normalized.looseUnits ?? 0,
    updated_at: new Date().toISOString(),
  };
}

function productToDbInsert(product: Product, storeId: string, batchId: string | null = null) {
  const normalized = normalizeProduct(product);

  return {
    store_id: storeId,
    batch_id: batchId,
    upc: normalized.upc,
    ...productToDbFields(normalized),
  };
}

function upsertProductList(products: Product[], product: Product): Product[] {
  const nextProduct = normalizeProduct(product);
  const exists = products.some((current) => current.upc === nextProduct.upc);

  if (exists) {
    return products.map((current) => (current.upc === nextProduct.upc ? nextProduct : current));
  }

  return [nextProduct, ...products];
}

function computeLowStock(products: Product[]): Product[] {
  return products
    .filter((product) => product.stock <= product.reorderLevel)
    .sort((a, b) => a.stock / Math.max(a.reorderLevel, 1) - b.stock / Math.max(b.reorderLevel, 1));
}

function buildDemo(): StoreData {
  return {
    ...aggregations(mockTransactions),
    meta: DEMO_META,
    isDemo: true,
    loaded: true,
    products: mockProducts,
    productsMeta: DEMO_PRODUCTS_META,
    isDemoProducts: true,
    lowStockProducts: computeLowStock(mockProducts),
    dataMode: 'demo',
    cloudError: null,
  };
}

function buildEmpty(dataMode: 'demo' | 'cloud' = 'cloud'): StoreData {
  return {
    ...aggregations([]),
    meta: EMPTY_META,
    isDemo: false,
    loaded: true,
    products: [],
    productsMeta: EMPTY_PRODUCTS_META,
    isDemoProducts: false,
    lowStockProducts: [],
    dataMode,
    cloudError: null,
  };
}

function explicitDemoModeEnabled() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('storepulse_demo_mode') === 'true';
}

export function useStoreData(): StoreData & {
  resetToDemo: () => void;
  refresh: () => void;
  resetProductsToDemo: () => void;
  updateProductPrice: (upc: string, costPrice: number, sellPrice: number) => void;
  updateProduct: (product: Product) => Promise<SaveResult>;
  createProduct: (product: Product) => Promise<SaveResult>;
} {
  const { user, store: authStore, loading: authLoading } = useAuth();
  const [data, setData] = useState<StoreData>(() => ({ ...buildEmpty(), loaded: false }));
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    if (authLoading) return;

    if (user && authStore) {
      const storeId = authStore.id;

      Promise.all([
        supabase
          .from('transactions')
          .select('*')
          .eq('store_id', storeId)
          .order('transaction_time', { ascending: false })
          .limit(5000),
        supabase
          .from('products')
          .select('*')
          .eq('store_id', storeId),
      ]).then(([txnResult, prodResult]) => {
        if (txnResult.error || prodResult.error) {
          const errorMessage = txnResult.error?.message ?? prodResult.error?.message ?? 'Unknown error';

          setData((previous) => ({
            ...previous,
            loaded: true,
            cloudError: errorMessage,
            dataMode: 'cloud',
          }));

          return;
        }

        const txns = (txnResult.data as TransactionRow[]).map(mapDbTransaction);
        const prods = (prodResult.data as ProductRow[]).map(mapDbProduct);

        const cloudMeta: UploadMeta = {
          source: 'upload',
          fileName: authStore.store_name,
          importedAt: new Date().toISOString(),
          rowCount: txns.length,
        };

        const cloudProductsMeta: ProductMeta = {
          source: 'upload',
          fileName: authStore.store_name,
          importedAt: new Date().toISOString(),
          rowCount: prods.length,
        };

        setData({
          ...aggregations(txns),
          meta: cloudMeta,
          isDemo: false,
          loaded: true,
          products: prods,
          productsMeta: cloudProductsMeta,
          isDemoProducts: false,
          lowStockProducts: computeLowStock(prods),
          dataMode: 'cloud',
          cloudError: null,
        });
      });

      return;
    }

    if (user && !authStore) {
      setData(buildEmpty('cloud'));
      return;
    }

    const demoMode = explicitDemoModeEnabled();
    let txns: Transaction[] = demoMode ? mockTransactions : [];
    let meta = demoMode ? DEMO_META : EMPTY_META;
    let isDemo = demoMode;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const metaRaw = localStorage.getItem(STORAGE_META_KEY);

      if (raw) {
        txns = JSON.parse(raw) as Transaction[];
        meta = metaRaw ? JSON.parse(metaRaw) : DEMO_META;
        isDemo = false;
      }
    } catch {
      // keep empty or explicit demo data
    }

    let products: Product[] = demoMode ? mockProducts : [];
    let productsMeta = demoMode ? DEMO_PRODUCTS_META : EMPTY_PRODUCTS_META;
    let isDemoProducts = demoMode;

    try {
      const productsRaw = localStorage.getItem(PRODUCTS_KEY);
      const productsMetaRaw = localStorage.getItem(PRODUCTS_META_KEY);

      if (productsRaw) {
        products = JSON.parse(productsRaw) as Product[];
        productsMeta = productsMetaRaw ? JSON.parse(productsMetaRaw) : DEMO_PRODUCTS_META;
        isDemoProducts = false;
      }
    } catch {
      // keep empty or explicit demo products
    }

    setData({
      ...aggregations(txns),
      meta,
      isDemo,
      loaded: true,
      products,
      productsMeta,
      isDemoProducts,
      lowStockProducts: computeLowStock(products),
      dataMode: 'demo',
      cloudError: null,
    });
  }, [user, authStore, authLoading, refreshCounter]);

  useEffect(() => {
    const handler = () => setRefreshCounter((count) => count + 1);

    window.addEventListener('storepulse:data-updated', handler);
    window.addEventListener('storage', handler);

    return () => {
      window.removeEventListener('storepulse:data-updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const resetToDemo = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_META_KEY);
    } catch {
      // ignore
    }

    setRefreshCounter((count) => count + 1);
    window.dispatchEvent(new Event('storepulse:data-updated'));
  }, []);

  const resetProductsToDemo = useCallback(() => {
    try {
      localStorage.removeItem(PRODUCTS_KEY);
      localStorage.removeItem(PRODUCTS_META_KEY);
    } catch {
      // ignore
    }

    setRefreshCounter((count) => count + 1);
    window.dispatchEvent(new Event('storepulse:data-updated'));
  }, []);

  const refresh = useCallback(() => {
    setRefreshCounter((count) => count + 1);
  }, []);

  const updateProduct = useCallback(
    async (product: Product): Promise<SaveResult> => {
      const nextProduct = normalizeProduct(product);

      if (!nextProduct.upc) return { mode: data.dataMode, error: 'UPC is required.' };
      if (!nextProduct.name) return { mode: data.dataMode, error: 'Product name is required.' };

      const previousProducts = data.products;

      setData((previous) => {
        const nextProducts = upsertProductList(previous.products, nextProduct);

        try {
          localStorage.setItem(PRODUCTS_KEY, JSON.stringify(nextProducts));
          localStorage.setItem(
            PRODUCTS_META_KEY,
            JSON.stringify({
              source: previous.isDemoProducts ? 'demo-edited' : 'upload-edited',
              fileName: previous.productsMeta.fileName,
              importedAt: previous.productsMeta.importedAt || new Date().toISOString(),
              rowCount: nextProducts.length,
            } as ProductMeta)
          );
        } catch {
          // ignore
        }

        return {
          ...previous,
          products: nextProducts,
          productsMeta: {
            ...previous.productsMeta,
            rowCount: nextProducts.length,
          },
          lowStockProducts: computeLowStock(nextProducts),
          cloudError: null,
        };
      });

      if (user && authStore && data.dataMode === 'cloud') {
        const { error } = await supabase
          .from('products')
          .update(productToDbFields(nextProduct))
          .eq('store_id', authStore.id)
          .eq('upc', nextProduct.upc);

        if (error) {
          setData((previous) => ({
            ...previous,
            products: previousProducts,
            lowStockProducts: computeLowStock(previousProducts),
            cloudError: `Product update failed: ${error.message}`,
          }));

          return { mode: 'cloud', error: error.message };
        }

        window.dispatchEvent(new Event('storepulse:data-updated'));
        return { mode: 'cloud' };
      }

      window.dispatchEvent(new Event('storepulse:data-updated'));
      return { mode: 'demo' };
    },
    [user, authStore, data.dataMode, data.products]
  );

  const createProduct = useCallback(
    async (product: Product): Promise<SaveResult> => {
      const nextProduct = normalizeProduct(product);

      if (!nextProduct.upc) return { mode: data.dataMode, error: 'UPC is required.' };
      if (!nextProduct.name) return { mode: data.dataMode, error: 'Product name is required.' };

      const previousProducts = data.products;

      setData((previous) => {
        const nextProducts = upsertProductList(previous.products, nextProduct);

        try {
          localStorage.setItem(PRODUCTS_KEY, JSON.stringify(nextProducts));
          localStorage.setItem(
            PRODUCTS_META_KEY,
            JSON.stringify({
              source: previous.isDemoProducts ? 'demo-edited' : 'upload-edited',
              fileName: previous.productsMeta.fileName,
              importedAt: previous.productsMeta.importedAt || new Date().toISOString(),
              rowCount: nextProducts.length,
            } as ProductMeta)
          );
        } catch {
          // ignore
        }

        return {
          ...previous,
          products: nextProducts,
          productsMeta: {
            ...previous.productsMeta,
            rowCount: nextProducts.length,
          },
          lowStockProducts: computeLowStock(nextProducts),
          cloudError: null,
        };
      });

      if (user && authStore && data.dataMode === 'cloud') {
        const { error } = await supabase
          .from('products')
          .upsert(productToDbInsert(nextProduct, authStore.id), { onConflict: 'store_id,upc' });

        if (error) {
          setData((previous) => ({
            ...previous,
            products: previousProducts,
            lowStockProducts: computeLowStock(previousProducts),
            cloudError: `Product create failed: ${error.message}`,
          }));

          return { mode: 'cloud', error: error.message };
        }

        window.dispatchEvent(new Event('storepulse:data-updated'));
        return { mode: 'cloud' };
      }

      window.dispatchEvent(new Event('storepulse:data-updated'));
      return { mode: 'demo' };
    },
    [user, authStore, data.dataMode, data.products]
  );

  const updateProductPrice = useCallback(
    (upc: string, costPrice: number, sellPrice: number) => {
      const product = data.products.find((item) => item.upc === upc);

      if (!product) return;

      void updateProduct({
        ...product,
        costPrice,
        sellPrice,
      });
    },
    [data.products, updateProduct]
  );

  return {
    ...data,
    resetToDemo,
    refresh,
    resetProductsToDemo,
    updateProductPrice,
    updateProduct,
    createProduct,
  };
}

export async function saveUploadedTransactions(txns: Transaction[], fileName: string): Promise<SaveResult> {
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    userId = user?.id ?? null;
  } catch {
    // treat as logged out
  }

  if (userId) {
    const { data: storeRow, error: storeErr } = await supabase
      .from('stores')
      .select('id')
      .eq('owner_id', userId)
      .limit(1)
      .maybeSingle();

    if (storeErr) return { mode: 'cloud', error: `Could not load store: ${storeErr.message}` };
    if (!storeRow) return { mode: 'cloud', error: 'No store found. Please complete store setup first.' };

    const storeId = storeRow.id;

    const { data: batch, error: batchErr } = await supabase
      .from('upload_batches')
      .insert({
        store_id: storeId,
        upload_type: 'transactions',
        file_name: fileName,
        total_rows: txns.length,
        valid_rows: txns.length,
        invalid_rows: 0,
      })
      .select('id')
      .single();

    if (batchErr) return { mode: 'cloud', error: `Could not create upload record: ${batchErr.message}` };

    const rows = txns.map((transaction) => ({
      store_id: storeId,
      batch_id: batch.id,
      transaction_id: transaction.id,
      transaction_time: transaction.timestamp,
      item_name: transaction.item ?? null,
      category: transaction.category ?? null,
      cashier_id: transaction.cashierId ?? null,
      register_id: transaction.register ?? 1,
      payment_type: transaction.paymentType ?? null,
      total_amount: transaction.amount,
      transaction_type: transaction.type,
      upc: transaction.upc ?? null,
      quantity: transaction.quantity ?? 1,
      unit_price: transaction.unitPrice ?? transaction.amount,
      discount_amount: transaction.discountAmount ?? 0,
      card_network: transaction.cardNetwork ?? null,
      exception_reason: transaction.exceptionReason ?? null,
      fuel_grade: transaction.fuelGrade ?? null,
    }));

    const { error: upsertErr } = await supabase
      .from('transactions')
      .upsert(rows, { onConflict: 'store_id,transaction_id' });

    if (upsertErr) return { mode: 'cloud', error: `Transaction upsert failed: ${upsertErr.message}` };

    const meta: UploadMeta = {
      source: 'upload',
      fileName,
      importedAt: new Date().toISOString(),
      rowCount: txns.length,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(txns));
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
    } catch {
      // ignore
    }

    window.dispatchEvent(new Event('storepulse:data-updated'));
    return { mode: 'cloud' };
  }

  const meta: UploadMeta = {
    source: 'upload',
    fileName,
    importedAt: new Date().toISOString(),
    rowCount: txns.length,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(txns));
  localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
  window.dispatchEvent(new Event('storepulse:data-updated'));

  return { mode: 'demo' };
}

export async function saveUploadedProducts(products: Product[], fileName: string): Promise<SaveResult> {
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    userId = user?.id ?? null;
  } catch {
    // treat as logged out
  }

  if (userId) {
    const { data: storeRow, error: storeErr } = await supabase
      .from('stores')
      .select('id')
      .eq('owner_id', userId)
      .limit(1)
      .maybeSingle();

    if (storeErr) return { mode: 'cloud', error: `Could not load store: ${storeErr.message}` };
    if (!storeRow) return { mode: 'cloud', error: 'No store found. Please complete store setup first.' };

    const storeId = storeRow.id;

    const { data: batch, error: batchErr } = await supabase
      .from('upload_batches')
      .insert({
        store_id: storeId,
        upload_type: 'products',
        file_name: fileName,
        total_rows: products.length,
        valid_rows: products.length,
        invalid_rows: 0,
      })
      .select('id')
      .single();

    if (batchErr) return { mode: 'cloud', error: `Could not create upload record: ${batchErr.message}` };

    const rows = products.map((product) => productToDbInsert(product, storeId, batch.id));

    const { error: upsertErr } = await supabase
      .from('products')
      .upsert(rows, { onConflict: 'store_id,upc' });

    if (upsertErr) return { mode: 'cloud', error: `Product upsert failed: ${upsertErr.message}` };

    const meta: ProductMeta = {
      source: 'upload',
      fileName,
      importedAt: new Date().toISOString(),
      rowCount: products.length,
    };

    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
      localStorage.setItem(PRODUCTS_META_KEY, JSON.stringify(meta));
    } catch {
      // ignore
    }

    window.dispatchEvent(new Event('storepulse:data-updated'));
    return { mode: 'cloud' };
  }

  const meta: ProductMeta = {
    source: 'upload',
    fileName,
    importedAt: new Date().toISOString(),
    rowCount: products.length,
  };

  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  localStorage.setItem(PRODUCTS_META_KEY, JSON.stringify(meta));
  window.dispatchEvent(new Event('storepulse:data-updated'));

  return { mode: 'demo' };
}

export function getActiveTransactions(): Transaction[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) return JSON.parse(raw) as Transaction[];
  } catch {
    // ignore
  }

  return explicitDemoModeEnabled() ? mockTransactions : [];
}

export function getActiveProducts(): Product[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(PRODUCTS_KEY);

    if (raw) return JSON.parse(raw) as Product[];
  } catch {
    // ignore
  }

  return explicitDemoModeEnabled() ? mockProducts : [];
}
