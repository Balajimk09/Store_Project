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

const STORAGE_KEY = 'storepulse_transactions_v1';
const STORAGE_META_KEY = 'storepulse_transactions_meta_v1';
const PRODUCTS_KEY = 'storepulse_products_v1';
const PRODUCTS_META_KEY = 'storepulse_products_meta_v1';

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
  };
}

export function useStoreData(): StoreData & {
  resetToDemo: () => void;
  refresh: () => void;
  resetProductsToDemo: () => void;
  updateProductPrice: (upc: string, costPrice: number, sellPrice: number) => void;
} {
  const [data, setData] = useState<StoreData>(buildDemo);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
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
    });
  }, [refreshCounter]);

  // Cross-tab + same-tab sync for price edits and uploads
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

export function saveUploadedTransactions(txns: Transaction[], fileName: string) {
  const meta: UploadMeta = {
    source: 'upload',
    fileName,
    importedAt: new Date().toISOString(),
    rowCount: txns.length,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(txns));
  localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
  // Notify other open tabs / hook instances
  window.dispatchEvent(new Event('storepulse:data-updated'));
}

export function saveUploadedProducts(products: Product[], fileName: string) {
  const meta: ProductMeta = {
    source: 'upload',
    fileName,
    importedAt: new Date().toISOString(),
    rowCount: products.length,
  };
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  localStorage.setItem(PRODUCTS_META_KEY, JSON.stringify(meta));
  window.dispatchEvent(new Event('storepulse:data-updated'));
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
