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
} from '@/lib/mock-data';
import { computeMargin } from '@/lib/csv';
import { supabase, type TransactionRow, type ProductRow } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

const STORAGE_KEY = 'storepulse_transactions_v1';
const STORAGE_META_KEY = 'storepulse_transactions_meta_v1';
const PRODUCTS_KEY = 'storepulse_products_v1';
const PRODUCTS_META_KEY = 'storepulse_products_meta_v1';

function mapDbTransaction(row: TransactionRow): Transaction {
  const ts = new Date(row.transaction_time);
  return {
    id: row.transaction_id,
    timestamp: row.transaction_time,
    hour: ts.getHours(),
    date: row.transaction_time.split('T')[0],
    item: row.item_name ?? 'Unknown Item',
    category: row.category ?? 'Unknown',
    cashierId: row.cashier_id ?? 'UNKNOWN',
    cashierName: row.cashier_id ?? 'UNKNOWN',
    register: row.register_id ?? 1,
    paymentType: (row.payment_type ?? 'Cash') as PaymentType,
    amount: row.total_amount,
    type: (row.transaction_type ?? 'Sale') as TransactionType,
  };
}

function mapDbProduct(row: ProductRow): Product {
  return {
    upc: row.upc,
    name: row.item_name ?? '',
    category: row.category ?? 'Uncategorized',
    brand: row.brand ?? 'Unknown',
    costPrice: row.cost_price,
    sellPrice: row.selling_price,
    stock: row.stock,
    reorderLevel: row.reorder_level,
    vendor: row.vendor ?? undefined,
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

function computeLowStock(products: Product[]): Product[] {
  return products
    .filter((p) => p.stock <= p.reorderLevel)
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

export function useStoreData(): StoreData & {
  resetToDemo: () => void;
  refresh: () => void;
  resetProductsToDemo: () => void;
  updateProductPrice: (upc: string, costPrice: number, sellPrice: number) => void;
} {
  const { user, store: authStore, loading: authLoading } = useAuth();
  const [data, setData] = useState<StoreData>(buildDemo);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    // Wait for auth to resolve before deciding which mode to use
    if (authLoading) return;

    if (user && authStore) {
      // Cloud Mode: fetch from Supabase
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
          const errMsg = txnResult.error?.message ?? prodResult.error?.message ?? 'Unknown error';
          setData((prev) => ({ ...prev, loaded: true, cloudError: errMsg, dataMode: 'cloud' }));
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

    // Demo / logged-out Mode: read from localStorage, falling back to mock data
    let txns = mockTransactions;
    let meta = DEMO_META;
    let isDemo = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const metaRaw = localStorage.getItem(STORAGE_META_KEY);
      if (raw) {
        txns = JSON.parse(raw) as Transaction[];
        meta = metaRaw ? JSON.parse(metaRaw) : DEMO_META;
        isDemo = false;
      }
    } catch {
      // fall through to demo
    }

    let products = mockProducts;
    let productsMeta = DEMO_PRODUCTS_META;
    let isDemoProducts = true;
    try {
      const praw = localStorage.getItem(PRODUCTS_KEY);
      const pmetaRaw = localStorage.getItem(PRODUCTS_META_KEY);
      if (praw) {
        products = JSON.parse(praw) as Product[];
        productsMeta = pmetaRaw ? JSON.parse(pmetaRaw) : DEMO_PRODUCTS_META;
        isDemoProducts = false;
      }
    } catch {
      // fall through to demo
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

  // Cross-tab + same-tab sync for price edits and uploads (demo mode only)
  useEffect(() => {
    const handler = () => setRefreshCounter((c) => c + 1);
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
    setRefreshCounter((c) => c + 1);
    window.dispatchEvent(new Event('storepulse:data-updated'));
  }, []);

  const resetProductsToDemo = useCallback(() => {
    try {
      localStorage.removeItem(PRODUCTS_KEY);
      localStorage.removeItem(PRODUCTS_META_KEY);
    } catch {
      // ignore
    }
    setRefreshCounter((c) => c + 1);
    window.dispatchEvent(new Event('storepulse:data-updated'));
  }, []);

  const refresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  const updateProductPrice = useCallback((upc: string, costPrice: number, sellPrice: number) => {
    setData((prev) => {
      const next = prev.products.map((p) =>
        p.upc === upc ? { ...p, costPrice, sellPrice } : p
      );
      try {
        localStorage.setItem(PRODUCTS_KEY, JSON.stringify(next));
        const pmeta: ProductMeta = {
          source: prev.isDemoProducts ? 'demo-edited' : 'upload-edited',
          fileName: prev.productsMeta.fileName,
          importedAt: prev.productsMeta.importedAt || new Date().toISOString(),
          rowCount: next.length,
        } as ProductMeta;
        localStorage.setItem(PRODUCTS_META_KEY, JSON.stringify(pmeta));
      } catch {
        // ignore
      }
      return { ...prev, products: next, lowStockProducts: computeLowStock(next) };
    });
    window.dispatchEvent(new Event('storepulse:data-updated'));
  }, []);

  return { ...data, resetToDemo, refresh, resetProductsToDemo, updateProductPrice };
}

export interface SaveResult {
  mode: 'cloud' | 'demo';
  error?: string;
}

export async function saveUploadedTransactions(txns: Transaction[], fileName: string): Promise<SaveResult> {
  // Check auth first — outside try/catch so network errors don't mask auth state
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* network error — treat as logged out */ }

  if (userId) {
    // Authenticated path — errors are returned, not swallowed
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

    const rows = txns.map((t) => ({
      store_id: storeId,
      batch_id: batch.id,
      transaction_id: t.id,
      transaction_time: t.timestamp,
      item_name: t.item ?? null,
      category: t.category ?? null,
      cashier_id: t.cashierId ?? null,
      register_id: t.register ?? 1,
      payment_type: t.paymentType ?? null,
      total_amount: t.amount,
      transaction_type: t.type,
      upc: null,
      quantity: 1,
      unit_price: t.amount,
      discount_amount: 0,
    }));

    const { error: insertErr } = await supabase.from('transactions').insert(rows);
    if (insertErr) return { mode: 'cloud', error: `Transaction insert failed: ${insertErr.message}` };

    // Update local cache so dashboard reflects the import without a hard refresh
    const meta: UploadMeta = { source: 'upload', fileName, importedAt: new Date().toISOString(), rowCount: txns.length };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(txns));
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
    } catch { /* ignore */ }
    window.dispatchEvent(new Event('storepulse:data-updated'));
    return { mode: 'cloud' };
  }

  // Logged-out / no-auth Demo Mode fallback
  const meta: UploadMeta = { source: 'upload', fileName, importedAt: new Date().toISOString(), rowCount: txns.length };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(txns));
  localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
  window.dispatchEvent(new Event('storepulse:data-updated'));
  return { mode: 'demo' };
}

export async function saveUploadedProducts(products: Product[], fileName: string): Promise<SaveResult> {
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* network error — treat as logged out */ }

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

    const rows = products.map((p) => ({
      store_id: storeId,
      batch_id: batch.id,
      upc: p.upc,
      item_name: p.name ?? null,
      category: p.category ?? null,
      brand: p.brand ?? 'Unknown',
      cost_price: p.costPrice,
      selling_price: p.sellPrice,
      stock: p.stock ?? 0,
      reorder_level: p.reorderLevel ?? 10,
      vendor: p.vendor ?? null,
    }));

    const { error: upsertErr } = await supabase
      .from('products')
      .upsert(rows, { onConflict: 'store_id,upc' });
    if (upsertErr) return { mode: 'cloud', error: `Product upsert failed: ${upsertErr.message}` };

    const meta: ProductMeta = { source: 'upload', fileName, importedAt: new Date().toISOString(), rowCount: products.length };
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
      localStorage.setItem(PRODUCTS_META_KEY, JSON.stringify(meta));
    } catch { /* ignore */ }
    window.dispatchEvent(new Event('storepulse:data-updated'));
    return { mode: 'cloud' };
  }

  // Logged-out / no-auth Demo Mode fallback
  const meta: ProductMeta = { source: 'upload', fileName, importedAt: new Date().toISOString(), rowCount: products.length };
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  localStorage.setItem(PRODUCTS_META_KEY, JSON.stringify(meta));
  window.dispatchEvent(new Event('storepulse:data-updated'));
  return { mode: 'demo' };
}

export function getActiveTransactions(): Transaction[] {
  if (typeof window === 'undefined') return mockTransactions;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Transaction[];
  } catch {
    // ignore
  }
  return mockTransactions;
}

export function getActiveProducts(): Product[] {
  if (typeof window === 'undefined') return mockProducts;
  try {
    const raw = localStorage.getItem(PRODUCTS_KEY);
    if (raw) return JSON.parse(raw) as Product[];
  } catch {
    // ignore
  }
  return mockProducts;
}

export { mockTransactions, mockProducts, computeMargin };
export type { Transaction, Cashier, PaymentType, TransactionType, Product };
