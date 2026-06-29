'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  History,
  Package,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { ProductForm, type ProductFormState } from '@/components/products/ProductForm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useStoreData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/lib/mock-data';
import { CHART_COLORS } from '@/lib/mock-data';
import {
  computeMargin,
  normalizeHeader as normalizeProductHeader,
  parseProductsCsv,
  type ProductImportMode,
} from '@/lib/csv';
import { exportToCsv, formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'products' | 'newProducts' | 'receiving' | 'reorder' | 'history';

type DuplicateImportMode = 'skip' | 'update' | 'new-only';

type ProductImportSummary = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  duplicates: number;
  unmatched: number;
  errorRows: number;
} | null;

type NewProductStatus = 'ready_to_add' | 'missing_upc' | 'duplicate_found' | 'price_conflict';

type NewProductCounts = {
  total: number;
  readyToAdd: number;
  missingUpc: number;
  duplicateFound: number;
  priceConflict: number;
  needsReview: number;
};

type NewProductDraftProduct = {
  upc: string;
  item_name: string;
  category: string;
  department: string;
  brand: string;
  cost_price: number;
  selling_price: number;
  stock: number;
  reorder_level: number;
  vendor: string;
  tax_rate: number;
  tax_category: string;
  taxable: boolean;
  ebt_eligible: boolean;
  units_per_case: number;
  cases_on_hand: number;
  loose_units: number;
  plu: string;
  product_code: string;
  age_verification: boolean;
  minimum_age: number | null;
  age_restriction_type: string | null;
  notes: string;
};

type NewProductCandidate = {
  sourceType: 'pos_import';
  candidateKey: string;
  sourceRef: {
    candidateKey: string;
    pos_plu_sale_ids: string[];
    report_period_ids: string[];
    report_file_ids: string[];
    pos_plu_sale_count: number;
    report_period_count: number;
    report_file_count: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
  };
  pluRaw: string | null;
  pluNormalized: string | null;
  upcNormalized: string | null;
  description: string | null;
  unitPrice: number;
  timesSold: number;
  totalRevenue: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latestImport: string | null;
  promotionId: string | null;
  confidenceScore: number;
  status: NewProductStatus;
  existingProduct: {
    id: string;
    upc: string;
    item_name: string | null;
    selling_price: number | string | null;
    plu: string | null;
    product_code: string | null;
  } | null;
  priceConflict: {
    posPrice: number;
    existingPrice: number;
    percentDifference: number;
  } | null;
  draftProduct: NewProductDraftProduct;
};

type NewProductsResponse =
  | { ok: true; candidates: NewProductCandidate[]; counts: NewProductCounts }
  | { ok: false; error: string };

type SaveNewProductResponse =
  | {
      ok: true;
      inserted: {
        id: string;
        upc: string | null;
        item_name: string | null;
      };
    }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        | 'duplicate_upc'
        | 'duplicate_plu'
        | 'duplicate_product_code'
        | 'missing_identifier'
        | 'missing_item_name'
        | 'invalid_store'
        | 'invalid_source'
        | 'insert_failed';
      message: string;
      existingProduct?: {
        id: string;
        upc: string | null;
        item_name: string | null;
      };
    };

type NewProductReviewFieldErrors = {
  upc?: string;
  name?: string;
};

type NewProductSaveProductPayload = {
  upc: string;
  item_name: string;
  category: string;
  department: string;
  brand: string;
  selling_price: string;
  cost_price: string;
  tax_rate: string;
  tax_category: string;
  taxable: boolean;
  is_active: boolean;
  ebt_eligible: boolean;
  age_verification: boolean;
  minimum_age: string | null;
  age_restriction_type: string | null;
  vendor: string;
  plu: string;
  product_code: string;
  sku: string;
  stock: string;
  reorder_level: string;
  units_per_case: string;
  cases_on_hand: string;
  loose_units: string;
  notes: string;
};

type TaxCategoryOption = {
  id: string;
  name: string;
  rate: number;
  is_active: boolean;
};

type AgeRestrictionPreset = {
  id: string;
  name: string;
  minimum_age: number;
  restriction_type: string;
  is_active: boolean;
};

type ReceivingLineStatus = 'Matched' | 'New Product' | 'Needs Review';
type InvoiceSourceKind = 'pdf' | 'image' | 'csv' | 'unknown';
type ReorderPriority = 'Critical' | 'Soon' | 'Watch';

type ReceivingLine = {
  id: string;
  upc: string;
  name: string;
  department: string;
  vendor: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  status: ReceivingLineStatus;
};

type ReceivingHistoryItem = {
  id: string;
  date: string;
  fileName: string;
  receiptName?: string;
  invoiceNumber?: string;
  vendor: string;
  itemCount: number;
  totalAmount: number;
  lines?: ReceivingLine[];
  sourceUrl?: string;
  sourcePath?: string;
  sourceKind?: InvoiceSourceKind;
};

type InventoryReceiptItemRow = {
  id: string;
  upc: string | null;
  item_name: string | null;
  department: string | null;
  vendor: string | null;
  quantity: number | string | null;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  match_status: string | null;
};

type InventoryReceiptRow = {
  id: string;
  receipt_date: string | null;
  created_at: string;
  file_name: string;
  receipt_name: string | null;
  invoice_number: string | null;
  vendor: string | null;
  item_count: number | string | null;
  total_amount: number | string | null;
  source_path: string | null;
  source_kind: InvoiceSourceKind | null;
  inventory_receipt_items?: InventoryReceiptItemRow[] | null;
};

type ReorderInsight = {
  product: Product;
  salesLast30Days: number;
  averageDailySales: number;
  daysLeft: number | null;
  suggestedQty: number;
  lastDeliveryDate: string | null;
  lastDeliveryQty: number;
  priority: ReorderPriority;
};

type VendorOrderGroup = {
  vendor: string;
  insights: ReorderInsight[];
  itemCount: number;
  suggestedUnits: number;
  orderUnits: number;
  estimatedCost: number;
  criticalCount: number;
  soonCount: number;
  watchCount: number;
};

type VendorOrderItem = {
  product: Product;
  insight?: ReorderInsight;
  unitsPerCase: number;
  suggestedQty: number;
  orderUnits: number;
  orderCases: number;
  estimatedCost: number;
};

type StoreVendorData = {
  vendor_name: string;
  expected_invoice_amount?: number | null;
  payment_terms?: string | null;
  order_days?: string[];
  delivery_days?: string[];
  notification_enabled?: boolean;
};

const RECEIVING_HISTORY_KEY = 'storepulse_receiving_history_v1';
const INVOICE_BUCKET = 'inventory-invoices';
const PRODUCTS_MANAGE_STORE_MESSAGE = 'Select a specific store to manage products.';
const PRODUCTS_ALL_STORES_READONLY_MESSAGE =
  'All Stores product aggregation is not available yet. Select a specific store to view and manage products.';
const PRESET_AGE_TYPES = ['Tobacco', 'Alcohol', 'Lottery', 'Vape'];
const EMPTY_NEW_PRODUCT_COUNTS: NewProductCounts = {
  total: 0,
  readyToAdd: 0,
  missingUpc: 0,
  duplicateFound: 0,
  priceConflict: 0,
  needsReview: 0,
};
const NEW_PRODUCT_STATUS_LABELS: Record<NewProductStatus, string> = {
  ready_to_add: 'Ready to Add',
  missing_upc: 'Missing UPC',
  duplicate_found: 'Duplicate Found',
  price_conflict: 'Price Conflict',
};

const EMPTY_NEW_PRODUCT_REVIEW_FORM: ProductFormState = {
  upc: '',
  plu: '',
  productCode: '',
  sku: '',
  name: '',
  department: '',
  customDepartment: '',
  category: 'Uncategorized',
  brand: 'Unknown',
  vendor: '',
  customVendor: '',
  costPrice: '0',
  sellPrice: '0',
  stock: '0',
  reorderLevel: '10',
  unitsPerCase: '1',
  casesOnHand: '0',
  looseUnits: '0',
  taxCategory: 'standard',
  taxRate: '0',
  taxable: true,
  ebtEligible: false,
  ageVerification: false,
  minimumAge: '',
  ageRestrictionType: '',
  customAgeRestrictionType: '',
  isActive: true,
  notes: 'Discovered from POS PLU report',
};

const EMPTY_PRODUCT_FORM: ProductFormState = {
  upc: '',
  plu: '',
  productCode: '',
  sku: '',
  name: '',
  department: '',
  customDepartment: '',
  category: '',
  brand: '',
  vendor: '',
  customVendor: '',
  costPrice: '',
  sellPrice: '',
  stock: '0',
  reorderLevel: '10',
  unitsPerCase: '1',
  casesOnHand: '0',
  looseUnits: '0',
  taxCategory: 'standard',
  taxRate: '0',
  taxable: true,
  ebtEligible: false,
  ageVerification: false,
  minimumAge: '',
  ageRestrictionType: '',
  customAgeRestrictionType: '',
  isActive: true,
  notes: '',
};

const DEFAULT_DEPARTMENTS = [
  'Beverages',
  'Snacks',
  'Candy',
  'Grocery',
  'Tobacco',
  'Beer',
  'Fuel',
  'Automotive',
  'Health & Beauty',
  'General Merchandise',
];

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'products', label: 'Products' },
  { key: 'newProducts', label: 'New Products' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'reorder', label: 'Reorder' },
  { key: 'history', label: 'History' },
];

function safeNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function newProductStatusRank(status: NewProductStatus) {
  return status === 'ready_to_add' ? 0 : status === 'price_conflict' ? 1 : status === 'missing_upc' ? 2 : 3;
}

function newProductStatusClass(status: NewProductStatus) {
  if (status === 'ready_to_add') return 'bg-success/10 text-success';
  if (status === 'price_conflict') return 'bg-orange-100 text-orange-700';
  if (status === 'missing_upc') return 'bg-amber-100 text-amber-800';
  return 'bg-secondary text-muted-foreground';
}

function formatCandidateDate(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

function formatPercentDifference(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeAgeRestrictionType(value: string | null | undefined) {
  const ageRestrictionTypeValue = value?.trim() || '';
  const ageRestrictionType = PRESET_AGE_TYPES.includes(ageRestrictionTypeValue)
    ? ageRestrictionTypeValue
    : ageRestrictionTypeValue
      ? 'Custom'
      : '';
  const customAgeRestrictionType =
    ageRestrictionTypeValue && !PRESET_AGE_TYPES.includes(ageRestrictionTypeValue)
      ? ageRestrictionTypeValue
      : '';

  return { ageRestrictionType, customAgeRestrictionType };
}

function newProductDraftToReviewForm(draft: NewProductDraftProduct): ProductFormState {
  const { ageRestrictionType, customAgeRestrictionType } = normalizeAgeRestrictionType(draft.age_restriction_type);

  return {
    upc: draft.upc || '',
    plu: draft.plu || '',
    productCode: draft.product_code || '',
    sku: '',
    name: draft.item_name || '',
    department: draft.department || '',
    customDepartment: '',
    category: draft.category || 'Uncategorized',
    brand: draft.brand || 'Unknown',
    vendor: draft.vendor || '',
    customVendor: '',
    costPrice: String(draft.cost_price ?? 0),
    sellPrice: String(draft.selling_price ?? 0),
    stock: String(draft.stock ?? 0),
    reorderLevel: String(draft.reorder_level ?? 10),
    unitsPerCase: String(draft.units_per_case ?? 1),
    casesOnHand: String(draft.cases_on_hand ?? 0),
    looseUnits: String(draft.loose_units ?? 0),
    taxCategory: draft.tax_category || 'standard',
    taxRate: String(draft.tax_rate ?? 0),
    taxable: draft.taxable,
    ebtEligible: draft.ebt_eligible,
    ageVerification: draft.age_verification,
    minimumAge: draft.minimum_age === null ? '' : String(draft.minimum_age),
    ageRestrictionType,
    customAgeRestrictionType,
    isActive: true,
    notes: draft.notes || 'Discovered from POS PLU report',
  };
}

function productFormToNewProductSavePayload(form: ProductFormState): NewProductSaveProductPayload {
  const unitsPerCase = Math.max(1, safeNumber(form.unitsPerCase, 1));
  const casesOnHand = Math.max(0, safeNumber(form.casesOnHand));
  const looseUnits = Math.max(0, safeNumber(form.looseUnits));
  const calculatedStock = casesOnHand * unitsPerCase + looseUnits;
  const department =
    form.department === '__other__'
      ? form.customDepartment.trim()
      : form.department.trim();
  const vendor =
    form.vendor === '__other__'
      ? form.customVendor.trim()
      : form.vendor.trim();
  const ageRestrictionType =
    form.ageRestrictionType === 'Custom'
      ? form.customAgeRestrictionType.trim()
      : form.ageRestrictionType.trim();

  return {
    upc: form.upc.trim(),
    item_name: form.name.trim(),
    category: form.category.trim() || 'Uncategorized',
    department,
    brand: form.brand.trim() || 'Unknown',
    selling_price: form.sellPrice,
    cost_price: form.costPrice,
    tax_rate: form.taxable ? form.taxRate : '0',
    tax_category: form.taxable ? form.taxCategory.trim() || 'standard' : 'non-taxable',
    taxable: form.taxable,
    is_active: form.isActive,
    ebt_eligible: form.ebtEligible,
    age_verification: form.ageVerification,
    minimum_age: form.ageVerification ? form.minimumAge : null,
    age_restriction_type: form.ageVerification ? ageRestrictionType || null : null,
    vendor,
    plu: form.plu.trim(),
    product_code: form.productCode.trim(),
    sku: form.sku.trim(),
    stock: String(calculatedStock),
    reorder_level: form.reorderLevel,
    units_per_case: String(unitsPerCase),
    cases_on_hand: String(casesOnHand),
    loose_units: String(looseUnits),
    notes: form.notes.trim() || 'Discovered from POS PLU report',
  };
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsArrayBuffer(file);
  });
}

function quoteCsvValue(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function normalizeText(value: string | undefined | null) {
  return String(value || '').trim().toLowerCase();
}

function getProductIdentity(product: Product) {
  return product.id || product.upc || product.productCode || product.plu || '';
}

function hasProductFormIdentifier(form: ProductFormState) {
  return Boolean(form.upc.trim() || form.plu.trim() || form.productCode.trim());
}

function findProductDuplicate(products: Product[], product: Product) {
  const upc = normalizeText(product.upc);
  const plu = normalizeText(product.plu);
  const productCode = normalizeText(product.productCode);

  return products.find((current) => {
    if (upc && normalizeText(current.upc) === upc) return true;
    if (plu && normalizeText(current.plu) === plu) return true;
    if (productCode && normalizeText(current.productCode) === productCode) return true;
    return false;
  }) || null;
}

function dateOnly(value: string) {
  return value.split('T')[0];
}

function formatShortDate(value: string | null) {
  if (!value) return 'No delivery yet';
  return new Date(value).toLocaleDateString();
}

function formatDayAbbreviation(day: string) {
  return day.slice(0, 3);
}

function getReorderPriority(product: Product, daysLeft: number | null): ReorderPriority {
  if (product.stock <= 0) return 'Critical';
  if (product.stock <= product.reorderLevel) return 'Critical';
  if (daysLeft !== null && daysLeft <= 3) return 'Critical';
  if (daysLeft !== null && daysLeft <= 7) return 'Soon';
  return 'Watch';
}

function priorityClass(priority: ReorderPriority) {
  if (priority === 'Critical') return 'bg-destructive/10 text-destructive';
  if (priority === 'Soon') return 'bg-primary/10 text-primary';
  return 'bg-secondary text-muted-foreground';
}

function getCaseBreakdown(totalUnits: number, unitsPerCase: number) {
  const safeUnitsPerCase = Math.max(1, Number(unitsPerCase) || 1);
  const safeTotalUnits = Math.max(0, Number(totalUnits) || 0);

  return {
    cases: Math.floor(safeTotalUnits / safeUnitsPerCase),
    looseUnits: safeTotalUnits % safeUnitsPerCase,
  };
}

function formatCaseBreakdown(totalUnits: number, unitsPerCase: number) {
  const breakdown = getCaseBreakdown(totalUnits, unitsPerCase);

  if (unitsPerCase <= 1) return `${formatNumber(totalUnits)} units`;

  return `${formatNumber(breakdown.cases)} cases + ${formatNumber(breakdown.looseUnits)} loose`;
}

function getCaseOrderPlan(suggestedUnits: number, unitsPerCase: number) {
  const safeUnitsPerCase = Math.max(1, Number(unitsPerCase) || 1);
  const safeSuggestedUnits = Math.max(0, Number(suggestedUnits) || 0);

  if (safeUnitsPerCase <= 1) {
    return {
      casesToOrder: 0,
      orderUnits: safeSuggestedUnits,
      extraUnits: 0,
    };
  }

  const casesToOrder = Math.ceil(safeSuggestedUnits / safeUnitsPerCase);
  const orderUnits = casesToOrder * safeUnitsPerCase;

  return {
    casesToOrder,
    orderUnits,
    extraUnits: Math.max(0, orderUnits - safeSuggestedUnits),
  };
}

function productToForm(product: Product): ProductFormState {
  const unitsPerCase = Math.max(1, Number(product.unitsPerCase) || 1);
  const casesOnHand =
    product.casesOnHand !== undefined
      ? Number(product.casesOnHand) || 0
      : Math.floor(product.stock / unitsPerCase);
  const looseUnits =
    product.looseUnits !== undefined
      ? Number(product.looseUnits) || 0
      : product.stock % unitsPerCase;
  const ageRestrictionTypeValue = product.ageRestrictionType?.trim() || '';
  const ageRestrictionType = PRESET_AGE_TYPES.includes(ageRestrictionTypeValue)
    ? ageRestrictionTypeValue
    : ageRestrictionTypeValue
      ? 'Custom'
      : '';
  const customAgeRestrictionType =
    ageRestrictionTypeValue && !PRESET_AGE_TYPES.includes(ageRestrictionTypeValue)
      ? ageRestrictionTypeValue
      : '';

  return {
    upc: product.upc,
    plu: product.plu || '',
    productCode: product.productCode || '',
    sku: product.sku || '',
    name: product.name,
    department: product.department || product.category || '',
    customDepartment: '',
    category: product.category || product.department || '',
    brand: product.brand || '',
    vendor: product.vendor || '',
    customVendor: '',
    costPrice: product.costPrice.toFixed(2),
    sellPrice: product.sellPrice.toFixed(2),
    stock: String(product.stock),
    reorderLevel: String(product.reorderLevel),
    unitsPerCase: String(unitsPerCase),
    casesOnHand: String(casesOnHand),
    looseUnits: String(looseUnits),
    taxCategory: product.taxCategory || ((product.taxable ?? true) ? 'standard' : 'non-taxable'),
    taxRate: String(product.taxRate ?? 0),
    taxable: product.taxable ?? true,
    ebtEligible: product.ebtEligible ?? false,
    ageVerification: product.ageVerification ?? false,
    minimumAge: product.minimumAge ? String(product.minimumAge) : '',
    ageRestrictionType,
    customAgeRestrictionType,
    isActive: product.isActive ?? true,
    notes: product.notes || '',
  };
}

function formToProduct(form: ProductFormState): Product {
  const department =
    form.department === '__other__'
      ? form.customDepartment.trim() || 'General Merchandise'
      : form.department.trim() || 'General Merchandise';
  const category = form.category.trim() || department;
  const vendor =
    form.vendor === '__other__'
      ? form.customVendor.trim() || undefined
      : form.vendor.trim() || undefined;
  const unitsPerCase = Math.max(1, safeNumber(form.unitsPerCase, 1));
  const casesOnHand = Math.max(0, safeNumber(form.casesOnHand));
  const looseUnits = Math.max(0, safeNumber(form.looseUnits));
  const calculatedStock = casesOnHand * unitsPerCase + looseUnits;

  return {
    upc: form.upc.trim(),
    name: form.name.trim(),
    category,
    department,
    brand: form.brand.trim() || 'Unknown',
    vendor,
    costPrice: safeNumber(form.costPrice),
    sellPrice: safeNumber(form.sellPrice),
    stock: calculatedStock,
    reorderLevel: safeNumber(form.reorderLevel, 10),
    unitsPerCase,
    casesOnHand,
    looseUnits,
    plu: form.plu.trim() || undefined,
    productCode: form.productCode.trim() || undefined,
    sku: form.sku.trim() || undefined,
    taxCategory: form.taxable ? form.taxCategory.trim() || 'standard' : 'non-taxable',
    taxRate: form.taxable ? safeNumber(form.taxRate) : 0,
    taxable: form.taxable,
    ebtEligible: form.ebtEligible,
    ageVerification: form.ageVerification,
    minimumAge: form.ageVerification
      ? (safeNumber(form.minimumAge) || 21)
      : undefined,
    ageRestrictionType: form.ageVerification
      ? (form.ageRestrictionType === 'Custom'
          ? form.customAgeRestrictionType.trim() || undefined
          : form.ageRestrictionType || undefined)
      : undefined,
    isActive: form.isActive,
    notes: form.notes.trim() || undefined,
  };
}

function validateProductForm(form: ProductFormState) {
  if (!hasProductFormIdentifier(form)) return 'Enter a UPC, PLU, or Product Code.';
  if (!form.name.trim()) return 'Product name is required.';
  if (form.department === '__other__' && !form.customDepartment.trim()) return 'Department is required.';
  if (!form.department.trim()) return 'Department is required.';
  if (safeNumber(form.costPrice) < 0) return 'Cost price must be zero or more.';
  if (safeNumber(form.sellPrice) < 0) return 'Selling price must be zero or more.';
  if (safeNumber(form.unitsPerCase, 1) <= 0) return 'Units per case must be at least 1.';
  if (safeNumber(form.casesOnHand) < 0) return 'Cases on hand must be zero or more.';
  if (safeNumber(form.looseUnits) < 0) return 'Loose units must be zero or more.';
  return null;
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findProductMatch(products: Product[], upc: string, name: string) {
  return products.find((product) => {
    const sameUpc = Boolean(upc) && product.upc === upc;
    const sameName = Boolean(name) && product.name.toLowerCase() === name.toLowerCase();
    return sameUpc || sameName;
  });
}

function parseReceivingCsv(text: string, products: Product[]): ReceivingLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);

  const findValue = (cells: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? cells[index]?.trim() || '' : '';
  };

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);

    const upc = findValue(cells, ['upc', 'barcode', 'itemcode', 'sku']);
    const name = findValue(cells, ['productname', 'itemname', 'item', 'description', 'product', 'name']);
    const department = findValue(cells, ['department', 'category']);
    const vendor = findValue(cells, ['vendor', 'supplier']);
    const quantity = safeNumber(findValue(cells, ['quantity', 'qty', 'receivedquantity', 'units', 'cases']), 0);
    const unitCost = safeNumber(findValue(cells, ['unitcost', 'cost', 'costprice', 'price']), 0);
    const totalCost = safeNumber(findValue(cells, ['totalcost', 'extendedcost', 'total', 'amount']), quantity * unitCost);

    const matched = findProductMatch(products, upc, name);
    const status: ReceivingLineStatus = matched ? 'Matched' : upc || name ? 'New Product' : 'Needs Review';

    return {
      id: `CSV-${Date.now()}-${index}`,
      upc,
      name: name || matched?.name || '',
      department: department || matched?.department || matched?.category || 'General Merchandise',
      vendor: vendor || matched?.vendor || '',
      quantity,
      unitCost: unitCost || matched?.costPrice || 0,
      totalCost,
      status,
    };
  });
}

function ProductModal({
  open,
  mode,
  form,
  setForm,
  onClose,
  onSave,
  saving,
  error,
  departments,
  vendors,
  taxCategoryOptions,
  ageRestrictionPresets,
  upcDuplicate,
  pluDuplicate,
  productCodeDuplicate,
  onUpcChange,
  onNameChange,
  onUpcBlur,
  onPluBlur,
  onProductCodeBlur,
  writeBlocked,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  form: ProductFormState;
  setForm: Dispatch<SetStateAction<ProductFormState>>;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  departments: string[];
  vendors: string[];
  taxCategoryOptions: TaxCategoryOption[];
  ageRestrictionPresets: AgeRestrictionPreset[];
  upcDuplicate: Product | null;
  pluDuplicate: Product | null;
  productCodeDuplicate: Product | null;
  onUpcChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onUpcBlur: () => void;
  onPluBlur: () => void;
  onProductCodeBlur: () => void;
  writeBlocked?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{mode === 'add' ? 'Add Product' : 'Edit Product'}</h2>
            <p className="text-xs text-muted-foreground">Compact product profile, pricing, tax, and age rules.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ProductForm
          mode={mode}
          form={form}
          setForm={setForm}
          onSubmit={onSave}
          onCancel={onClose}
          saving={saving}
          error={error}
          departmentOptions={departments}
          vendorOptions={vendors}
          taxCategoryOptions={taxCategoryOptions}
          ageRestrictionOptions={ageRestrictionPresets}
          upcDuplicate={upcDuplicate}
          pluDuplicate={pluDuplicate}
          productCodeDuplicate={productCodeDuplicate}
          onUpcChange={onUpcChange}
          onNameChange={onNameChange}
          onUpcBlur={onUpcBlur}
          onPluBlur={onPluBlur}
          onProductCodeBlur={onProductCodeBlur}
          writeBlocked={writeBlocked}
          disableUpc={mode === 'edit'}
          submitLabel={
            saving
              ? 'Saving...'
              : mode === 'add'
                ? 'Add Product'
                : 'Save Changes'
          }
        />
      </div>
    </div>
  );
}
export default function ProductsPage() {
  const { user, store, activeStoreId, storeScope } = useAuth();

  const {
    products: storeProducts,
    transactions: storeTransactions,
    updateProduct,
    createProduct,
    isDemoProducts,
    productsMeta,
    cloudError,
    loaded,
    refresh: refreshStoreData,
  } = useStoreData();

  const [items, setItems] = useState<Product[]>(storeProducts);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [ebtFilter, setEbtFilter] = useState(false);
  const [ageVerificationFilter, setAgeVerificationFilter] = useState(false);
  const [taxableFilter, setTaxableFilter] = useState(false);
  const [stockFilter, setStockFilter] = useState('All');
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [upcDuplicate, setUpcDuplicate] = useState<Product | null>(null);
  const [pluDuplicate, setPluDuplicate] = useState<Product | null>(null);
  const [productCodeDuplicate, setProductCodeDuplicate] = useState<Product | null>(null);
  const [productImportResult, setProductImportResult] = useState<ReturnType<typeof parseProductsCsv> | null>(null);
  const [productImportFileName, setProductImportFileName] = useState('');
  const [productImportError, setProductImportError] = useState<string | null>(null);
  const [productImportSummary, setProductImportSummary] = useState<ProductImportSummary>(null);
  const [productImportMode, setProductImportMode] = useState<ProductImportMode>('add_update');
  const [duplicateImportMode, setDuplicateImportMode] = useState<DuplicateImportMode>('skip');
  const [importingProducts, setImportingProducts] = useState(false);
  const [newProductCandidates, setNewProductCandidates] = useState<NewProductCandidate[]>([]);
  const [newProductCounts, setNewProductCounts] = useState<NewProductCounts>(EMPTY_NEW_PRODUCT_COUNTS);
  const [newProductsLoading, setNewProductsLoading] = useState(false);
  const [newProductsError, setNewProductsError] = useState<string | null>(null);
  const [newProductsMessage, setNewProductsMessage] = useState<string | null>(null);
  const [reviewingNewProduct, setReviewingNewProduct] = useState<NewProductCandidate | null>(null);
  const [newProductReviewForm, setNewProductReviewForm] = useState<ProductFormState>(EMPTY_NEW_PRODUCT_REVIEW_FORM);
  const [newProductReviewFieldErrors, setNewProductReviewFieldErrors] = useState<NewProductReviewFieldErrors>({});
  const [newProductReviewError, setNewProductReviewError] = useState<string | null>(null);
  const [savingNewProduct, setSavingNewProduct] = useState(false);
  const newProductUpcInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [selectedProductKeys, setSelectedProductKeys] = useState<Set<string>>(new Set());
  const [bulkDepartment, setBulkDepartment] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkVendor, setBulkVendor] = useState('');
  const [bulkCustomVendor, setBulkCustomVendor] = useState('');
  const [bulkBrand, setBulkBrand] = useState('');
  const [bulkCostPrice, setBulkCostPrice] = useState('');
  const [bulkSellPrice, setBulkSellPrice] = useState('');
  const [bulkTaxCategory, setBulkTaxCategory] = useState('');
  const [bulkTaxable, setBulkTaxable] = useState('');
  const [bulkEbt, setBulkEbt] = useState('');
  const [bulkActive, setBulkActive] = useState('');
  const [bulkAgeVerification, setBulkAgeVerification] = useState('');
  const [bulkMinimumAge, setBulkMinimumAge] = useState('');
  const [bulkAgeRestrictionType, setBulkAgeRestrictionType] = useState('');
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [taxCategoryOptions, setTaxCategoryOptions] = useState<TaxCategoryOption[]>([]);
  const [ageRestrictionPresets, setAgeRestrictionPresets] = useState<AgeRestrictionPreset[]>([]);

  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceFileName, setInvoiceFileName] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [receiptInvoiceNumber, setReceiptInvoiceNumber] = useState('');
  const [receiptVendor, setReceiptVendor] = useState('');
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState('');
  const [invoiceSourceKind, setInvoiceSourceKind] = useState<InvoiceSourceKind>('unknown');
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([]);
  const [receivingMessage, setReceivingMessage] = useState<string | null>(null);
  const [extractingInvoice, setExtractingInvoice] = useState(false);
  const [savingReceiving, setSavingReceiving] = useState(false);
  const [receivingHistory, setReceivingHistory] = useState<ReceivingHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<ReceivingHistoryItem | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyVendorFilter, setHistoryVendorFilter] = useState('All');
  const [storeVendors, setStoreVendors] = useState<string[]>([]);
  const [storeVendorMap, setStoreVendorMap] = useState<Map<string, StoreVendorData>>(new Map());
  const [reorderSearch, setReorderSearch] = useState('');
  const [reorderPriorityFilter, setReorderPriorityFilter] = useState<'All' | ReorderPriority>('All');
  const [selectedReorderProductKeys, setSelectedReorderProductKeys] = useState<string[]>([]);
  const [purchaseOrderMessage, setPurchaseOrderMessage] = useState<string | null>(null);
  const [openVendorOrder, setOpenVendorOrder] = useState<string | null>(null);
  const [vendorProductSearch, setVendorProductSearch] = useState('');
  const [orderUnitOverrides, setOrderUnitOverrides] = useState<Record<string, string>>({});
  const [todayVendorNoticeDismissed, setTodayVendorNoticeDismissed] = useState(false);
  const productsWriteBlocked = Boolean(user && (storeScope === 'all' || !activeStoreId));
  const selectedStoreId = activeStoreId ?? store?.id ?? null;
  const requireSelectedStoreForWrite = useCallback(
    (setMessage: (message: string | null) => void) => {
      if (!productsWriteBlocked) return true;
      setMessage(PRODUCTS_MANAGE_STORE_MESSAGE);
      return false;
    },
    [productsWriteBlocked]
  );

  const loadNewProductCandidates = useCallback(async () => {
    if (!activeStoreId) {
      setNewProductCandidates([]);
      setNewProductCounts(EMPTY_NEW_PRODUCT_COUNTS);
      setNewProductsError(null);
      setNewProductsLoading(false);
      return;
    }

    setNewProductsLoading(true);
    setNewProductsError(null);
    setNewProductCandidates([]);
    setNewProductCounts(EMPTY_NEW_PRODUCT_COUNTS);

    try {
      const response = await fetch(`/api/products/new-products?storeId=${encodeURIComponent(activeStoreId)}`);
      const json = (await response.json()) as NewProductsResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.ok ? 'Could not load new products.' : json.error);
      }

      setNewProductCandidates(json.candidates);
      setNewProductCounts(json.counts);
    } catch (error) {
      setNewProductCandidates([]);
      setNewProductCounts(EMPTY_NEW_PRODUCT_COUNTS);
      setNewProductsError(error instanceof Error ? error.message : 'Could not load new products.');
    } finally {
      setNewProductsLoading(false);
    }
  }, [activeStoreId]);

  const resetNewProductReviewModal = useCallback(() => {
    setReviewingNewProduct(null);
    setNewProductReviewForm(EMPTY_NEW_PRODUCT_REVIEW_FORM);
    setNewProductReviewFieldErrors({});
    setNewProductReviewError(null);
    setSavingNewProduct(false);
  }, []);

  const openNewProductReviewModal = (candidate: NewProductCandidate) => {
    setReviewingNewProduct(candidate);
    setNewProductReviewForm(newProductDraftToReviewForm(candidate.draftProduct));
    setNewProductReviewFieldErrors({});
    setNewProductReviewError(null);
  };

  const handleNewProductReviewUpcChange = (value: string) => {
    setNewProductReviewForm((current) => ({ ...current, upc: value }));
    if (value.trim() || newProductReviewForm.plu.trim() || newProductReviewForm.productCode.trim()) {
      setNewProductReviewFieldErrors((current) => ({ ...current, upc: undefined }));
    }
    setNewProductReviewError(null);
  };

  const handleNewProductReviewNameChange = (value: string) => {
    if (value.trim()) {
      setNewProductReviewFieldErrors((current) => ({ ...current, name: undefined }));
    }
    setNewProductReviewError(null);
  };

  const saveReviewedNewProduct = async () => {
    if (!activeStoreId || !reviewingNewProduct) return;

    const fieldErrors: NewProductReviewFieldErrors = {};
    if (!hasProductFormIdentifier(newProductReviewForm)) {
      fieldErrors.upc = 'Enter a UPC, PLU, or Product Code.';
    }
    if (!newProductReviewForm.name.trim()) {
      fieldErrors.name = 'Item name is required before saving this product.';
    }

    if (fieldErrors.upc || fieldErrors.name) {
      setNewProductReviewFieldErrors(fieldErrors);
      return;
    }

    setSavingNewProduct(true);
    setNewProductReviewError(null);
    setNewProductReviewFieldErrors({});

    try {
      const productPayload = productFormToNewProductSavePayload(newProductReviewForm);

      const response = await fetch('/api/products/new-products/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: activeStoreId,
          sourceType: reviewingNewProduct.sourceType,
          sourceRef: reviewingNewProduct.sourceRef,
          candidateKey: reviewingNewProduct.candidateKey,
          product: productPayload,
        }),
      });
      const payload = (await response.json().catch(() => null)) as SaveNewProductResponse | null;

      if (!payload) {
        throw new Error('Could not save product.');
      }

      if (!payload.ok) {
        if (payload.reason === 'missing_identifier') {
          setNewProductReviewFieldErrors({ upc: payload.message });
          return;
        }

        if (payload.reason === 'missing_item_name') {
          setNewProductReviewFieldErrors({ name: payload.message });
          return;
        }

        if (payload.reason === 'duplicate_upc') {
          setNewProductReviewError('A product with this UPC already exists for this store. No changes were made.');
          return;
        }

        if (payload.reason === 'duplicate_plu') {
          setNewProductReviewError('A product with this PLU already exists for this store. No changes were made.');
          return;
        }

        if (payload.reason === 'duplicate_product_code') {
          setNewProductReviewError('A product with this Product Code already exists for this store. No changes were made.');
          return;
        }

        setNewProductReviewError(payload.message || 'Could not save product.');
        return;
      }

      resetNewProductReviewModal();
      setNewProductsMessage('Product saved successfully.');
      refreshStoreData();
      await loadNewProductCandidates();
      window.setTimeout(() => setNewProductsMessage(null), 3000);
    } catch (error) {
      setNewProductReviewError(error instanceof Error ? error.message : 'Could not save product.');
    } finally {
      setSavingNewProduct(false);
    }
  };

  useEffect(() => {
    setItems(storeProducts);
  }, [storeProducts]);

  useEffect(() => {
    if (activeTab !== 'newProducts') return;
    void loadNewProductCandidates();
  }, [activeTab, loadNewProductCandidates]);

  useEffect(() => {
    if (!reviewingNewProduct) return;
    resetNewProductReviewModal();
  }, [activeStoreId]);

  useEffect(() => {
    if (!reviewingNewProduct || savingNewProduct) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetNewProductReviewModal();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetNewProductReviewModal, reviewingNewProduct, savingNewProduct]);

  useEffect(() => {
    if (reviewingNewProduct?.status !== 'missing_upc') return;
    const timeoutId = window.setTimeout(() => newProductUpcInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [reviewingNewProduct]);

  const loadCloudReceivingHistory = async () => {
    if (!store?.id) {
      if (user) {
        setReceivingHistory([]);
        return;
      }

      try {
        const raw = localStorage.getItem(RECEIVING_HISTORY_KEY);
        if (raw) setReceivingHistory(JSON.parse(raw) as ReceivingHistoryItem[]);
      } catch {
        setReceivingHistory([]);
      }
      return;
    }

    setHistoryLoading(true);

    const { data, error } = await supabase
      .from('inventory_receipts')
      .select('*, inventory_receipt_items(*)')
      .eq('store_id', store.id)
      .order('receipt_date', { ascending: false });

    setHistoryLoading(false);

    if (error) {
      setReceivingMessage(error.message);
      return;
    }

    const history: ReceivingHistoryItem[] = ((data || []) as InventoryReceiptRow[]).map((receipt) => {
      const receiptItems = receipt.inventory_receipt_items || [];

      return {
        id: receipt.id,
        date: receipt.receipt_date || receipt.created_at,
        fileName: receipt.file_name,
        receiptName: receipt.receipt_name || receipt.file_name,
        invoiceNumber: receipt.invoice_number || '',
        vendor: receipt.vendor || 'Mixed vendors',
        itemCount: Number(receipt.item_count) || receiptItems.length,
        totalAmount: Number(receipt.total_amount) || 0,
        sourcePath: receipt.source_path || '',
        sourceKind: receipt.source_kind || 'unknown',
        lines: receiptItems.map((item) => ({
          id: item.id,
          upc: item.upc || '',
          name: item.item_name || '',
          department: item.department || 'General Merchandise',
          vendor: item.vendor || '',
          quantity: Number(item.quantity) || 0,
          unitCost: Number(item.unit_cost) || 0,
          totalCost: Number(item.total_cost) || 0,
          status: (item.match_status || 'New Product') as ReceivingLineStatus,
        })),
      };
    });

    setReceivingHistory(history);
  };

  useEffect(() => {
    void loadCloudReceivingHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.id]);

  useEffect(() => {
    const loadStoreVendors = async () => {
      if (!store?.id) {
        setStoreVendors([]);
        setStoreVendorMap(new Map());
        return;
      }

      const { data, error } = await supabase
        .from('store_vendors')
        .select(
          'vendor_name, expected_invoice_amount, payment_terms, order_days, delivery_days, notification_enabled'
        )
        .eq('store_id', store.id)
        .eq('is_active', true)
        .order('vendor_name', { ascending: true });

      if (error) {
        setStoreVendors([]);
        setStoreVendorMap(new Map());
        return;
      }

      const vendorMap = new Map<string, StoreVendorData>();
      const vendorOptions = ((data || []) as StoreVendorData[])
        .map((vendor) => {
          const vendorName = String(vendor.vendor_name || '').trim();
          if (vendorName) vendorMap.set(vendorName, { ...vendor, vendor_name: vendorName });
          return vendorName;
        })
        .filter(Boolean);

      setStoreVendors(vendorOptions);
      setStoreVendorMap(vendorMap);
    };

    void loadStoreVendors();
  }, [store?.id]);

  const departments = useMemo(() => {
    const set = new Set(DEFAULT_DEPARTMENTS);

    items.forEach((product) => {
      if (product.department) set.add(product.department);
      if (product.category) set.add(product.category);
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const vendors = useMemo(() => {
    const set = new Set<string>();

    items.forEach((product) => {
      if (product.vendor) set.add(product.vendor);
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const allVendorOptions = useMemo(() => {
    const set = new Set<string>();

    storeVendors.forEach((vendor) => {
      if (vendor.trim()) set.add(vendor.trim());
    });

    vendors.forEach((vendor) => {
      if (vendor.trim()) set.add(vendor.trim());
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [storeVendors, vendors]);

  const categories = useMemo(() => {
    const set = new Set<string>();

    items.forEach((product) => {
      if (product.category) set.add(product.category);
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const vendorOptions = useMemo(() => {
    const set = new Set<string>();

    storeVendors.forEach((vendor) => {
      if (vendor.trim()) set.add(vendor.trim());
    });

    vendors.forEach((vendor) => {
      if (vendor.trim()) set.add(vendor.trim());
    });

    receivingLines.forEach((line) => {
      if (line.vendor.trim()) set.add(line.vendor.trim());
    });

    if (receiptVendor.trim()) set.add(receiptVendor.trim());

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [storeVendors, vendors, receivingLines, receiptVendor]);

  const loadTaxCategories = useCallback(async () => {
    if (!store?.id) {
      setTaxCategoryOptions([]);
      return;
    }

    const { data, error } = await supabase
      .from('tax_categories')
      .select('id, name, rate, is_active')
      .eq('store_id', store.id)
      .eq('is_active', true)
      .order('name', { ascending: true });

    setTaxCategoryOptions(error ? [] : ((data || []) as TaxCategoryOption[]));
  }, [store?.id]);

  const loadAgeRestrictionPresets = useCallback(async () => {
    if (!store?.id) {
      setAgeRestrictionPresets([]);
      return;
    }

    const { data, error } = await supabase
      .from('store_age_restriction_presets')
      .select('id, name, minimum_age, restriction_type, is_active')
      .eq('store_id', store.id)
      .eq('is_active', true)
      .order('name', { ascending: true });

    setAgeRestrictionPresets(error ? [] : ((data || []) as AgeRestrictionPreset[]));
  }, [store?.id]);

  useEffect(() => {
    if (!store?.id) return;
    void loadTaxCategories();
    void loadAgeRestrictionPresets();
  }, [store?.id, loadTaxCategories, loadAgeRestrictionPresets]);

  const filteredReceivingHistory = useMemo(() => {
    const search = historyQuery.trim().toLowerCase();

    return receivingHistory.filter((entry) => {
      const haystack = [
        entry.receiptName,
        entry.invoiceNumber,
        entry.fileName,
        entry.vendor,
        entry.date,
        String(entry.totalAmount),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (search && !haystack.includes(search)) return false;
      if (historyVendorFilter !== 'All' && entry.vendor !== historyVendorFilter) return false;

      return true;
    });
  }, [receivingHistory, historyQuery, historyVendorFilter]);

  const historyVendorOptions = useMemo(() => {
    const set = new Set<string>();

    receivingHistory.forEach((entry) => {
      if (entry.vendor) set.add(entry.vendor);
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [receivingHistory]);

  const summary = useMemo(() => {
    const activeProducts = items.filter((product) => product.isActive ?? true);
    const totalUnits = activeProducts.reduce((sum, product) => sum + product.stock, 0);
    const totalCost = activeProducts.reduce((sum, product) => sum + product.stock * product.costPrice, 0);
    const potentialRevenue = activeProducts.reduce((sum, product) => sum + product.stock * product.sellPrice, 0);
    const potentialProfit = potentialRevenue - totalCost;
    const lowStock = activeProducts.filter((product) => product.stock <= product.reorderLevel);

    return {
      totalProducts: activeProducts.length,
      totalUnits,
      totalCost,
      potentialRevenue,
      potentialProfit,
      averageMargin: potentialRevenue > 0 ? (potentialProfit / potentialRevenue) * 100 : 0,
      lowStockCount: lowStock.length,
    };
  }, [items]);

  const departmentData = useMemo(() => {
    const map = new Map<string, { name: string; value: number; profit: number }>();

    items
      .filter((product) => product.isActive ?? true)
      .forEach((product) => {
        const department = product.department || product.category || 'Uncategorized';
        const current = map.get(department) || { name: department, value: 0, profit: 0 };

        current.value += product.stock * product.costPrice;
        current.profit += product.stock * (product.sellPrice - product.costPrice);
        map.set(department, current);
      });

    return Array.from(map.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [items]);

  const lowStockProducts = useMemo(() => {
    return items
      .filter((product) => (product.isActive ?? true) && product.stock <= product.reorderLevel)
      .sort((a, b) => a.stock / Math.max(a.reorderLevel, 1) - b.stock / Math.max(b.reorderLevel, 1));
  }, [items]);

  const reorderInsights = useMemo<ReorderInsight[]>(() => {
    const today = new Date();
    const todayKey = today.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const thirtyDaysAgoKey = thirtyDaysAgo.toISOString().split('T')[0];

    return items
      .filter((product) => product.isActive ?? true)
      .map((product) => {
        const productUpc = normalizeText(product.upc);
        const productName = normalizeText(product.name);

        const salesLast30Days = storeTransactions
          .filter((transaction) => {
            const transactionDate = transaction.date || dateOnly(transaction.timestamp);
            const sameUpc = productUpc && normalizeText(transaction.upc) === productUpc;
            const sameName = productName && normalizeText(transaction.item) === productName;
            const isSale = transaction.type === 'Sale';

            return isSale && transactionDate >= thirtyDaysAgoKey && transactionDate <= todayKey && (sameUpc || sameName);
          })
          .reduce((sum, transaction) => sum + Math.max(0, Number(transaction.quantity) || 0), 0);

        const averageDailySales = salesLast30Days > 0 ? salesLast30Days / 30 : 0;

        const matchingReceipts = receivingHistory
          .map((receipt) => {
            const matchingLines = (receipt.lines || []).filter((line) => {
              const sameUpc = productUpc && normalizeText(line.upc) === productUpc;
              const sameName = productName && normalizeText(line.name) === productName;
              return sameUpc || sameName;
            });

            const quantity = matchingLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);

            return {
              date: receipt.date,
              quantity,
            };
          })
          .filter((receipt) => receipt.quantity > 0)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const lastDelivery = matchingReceipts[0] || null;
        const daysLeft = averageDailySales > 0 ? Math.floor(product.stock / averageDailySales) : null;

        const suggestedQtyFromSales = averageDailySales > 0 ? Math.ceil(averageDailySales * 14) : product.reorderLevel * 2;
        const suggestedQty = Math.max(product.reorderLevel * 2 - product.stock, suggestedQtyFromSales, product.reorderLevel);

        return {
          product,
          salesLast30Days,
          averageDailySales,
          daysLeft,
          suggestedQty,
          lastDeliveryDate: lastDelivery?.date || null,
          lastDeliveryQty: lastDelivery?.quantity || 0,
          priority: getReorderPriority(product, daysLeft),
        };
      })
      .filter((item) => {
        const needsReorder = item.product.stock <= item.product.reorderLevel;
        const sellingFast = item.daysLeft !== null && item.daysLeft <= 14;
        return needsReorder || sellingFast;
      })
      .sort((a, b) => {
        const priorityRank: Record<ReorderPriority, number> = {
          Critical: 0,
          Soon: 1,
          Watch: 2,
        };

        return priorityRank[a.priority] - priorityRank[b.priority];
      });
  }, [items, receivingHistory, storeTransactions]);

  const filteredReorderInsights = useMemo(() => {
    const search = reorderSearch.trim().toLowerCase();

    return reorderInsights.filter((insight) => {
      const haystack = [
        insight.product.name,
        insight.product.upc,
        insight.product.department,
        insight.product.category,
        insight.product.vendor,
        insight.priority,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (search && !haystack.includes(search)) return false;
      if (reorderPriorityFilter !== 'All' && insight.priority !== reorderPriorityFilter) return false;

      return true;
    });
  }, [reorderInsights, reorderSearch, reorderPriorityFilter]);

  const reorderSummary = useMemo(() => {
    return {
      critical: reorderInsights.filter((item) => item.priority === 'Critical').length,
      soon: reorderInsights.filter((item) => item.priority === 'Soon').length,
      watch: reorderInsights.filter((item) => item.priority === 'Watch').length,
      suggestedUnits: reorderInsights.reduce((sum, item) => sum + item.suggestedQty, 0),
    };
  }, [reorderInsights]);

  const selectedReorderSet = useMemo(() => {
    return new Set(selectedReorderProductKeys);
  }, [selectedReorderProductKeys]);

  const selectedPurchaseOrderInsights = useMemo(() => {
    if (selectedReorderProductKeys.length === 0) return filteredReorderInsights;

    return filteredReorderInsights.filter((insight) =>
      selectedReorderSet.has(getProductIdentity(insight.product))
    );
  }, [filteredReorderInsights, selectedReorderSet, selectedReorderProductKeys.length]);

  const getOrderUnitsForProduct = useCallback(
    (product: Product, suggestedUnits: number) => {
      const overrideValue = orderUnitOverrides[getProductIdentity(product)];

      if (overrideValue !== undefined && overrideValue.trim() !== '') {
        return Math.max(0, safeNumber(overrideValue));
      }

      const unitsPerCase = Number(product.unitsPerCase) || 1;
      return getCaseOrderPlan(suggestedUnits, unitsPerCase).orderUnits;
    },
    [orderUnitOverrides]
  );

  const getOrderCasesForProduct = useCallback(
    (product: Product, suggestedUnits: number) => {
      const unitsPerCase = Math.max(1, Number(product.unitsPerCase) || 1);
      const orderUnits = getOrderUnitsForProduct(product, suggestedUnits);

      if (unitsPerCase <= 1) return 0;

      return Math.ceil(orderUnits / unitsPerCase);
    },
    [getOrderUnitsForProduct]
  );

  const updateOrderUnits = (productKey: string, units: string) => {
    setOrderUnitOverrides((previous) => ({
      ...previous,
      [productKey]: units,
    }));
  };

  const updateOrderCases = (product: Product, cases: string) => {
    const unitsPerCase = Math.max(1, Number(product.unitsPerCase) || 1);
    const caseCount = Math.max(0, safeNumber(cases));
    const orderUnits = unitsPerCase <= 1 ? safeNumber(cases) : caseCount * unitsPerCase;

    setOrderUnitOverrides((previous) => ({
      ...previous,
      [getProductIdentity(product)]: String(orderUnits),
    }));
  };

  const vendorOrderGroups = useMemo<VendorOrderGroup[]>(() => {
    const map = new Map<string, VendorOrderGroup>();

    filteredReorderInsights.forEach((insight) => {
      const vendor = insight.product.vendor || 'No vendor';
      const orderUnits = getOrderUnitsForProduct(insight.product, insight.suggestedQty);

      const current = map.get(vendor) || {
        vendor,
        insights: [],
        itemCount: 0,
        suggestedUnits: 0,
        orderUnits: 0,
        estimatedCost: 0,
        criticalCount: 0,
        soonCount: 0,
        watchCount: 0,
      };

      current.insights.push(insight);
      current.itemCount += 1;
      current.suggestedUnits += insight.suggestedQty;
      current.orderUnits += orderUnits;
      current.estimatedCost += orderUnits * insight.product.costPrice;

      if (insight.priority === 'Critical') current.criticalCount += 1;
      if (insight.priority === 'Soon') current.soonCount += 1;
      if (insight.priority === 'Watch') current.watchCount += 1;

      map.set(vendor, current);
    });

    return Array.from(map.values()).sort((a, b) => {
      if (b.criticalCount !== a.criticalCount) return b.criticalCount - a.criticalCount;
      return b.estimatedCost - a.estimatedCost;
    });
  }, [filteredReorderInsights, getOrderUnitsForProduct]);

  const todayVendorReminders = useMemo(() => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const reminders: string[] = [];

    storeVendorMap.forEach((vendor) => {
      if (vendor.order_days?.includes(today)) {
        reminders.push(`${vendor.vendor_name} order`);
      }

      if (vendor.delivery_days?.includes(today)) {
        reminders.push(`${vendor.vendor_name} delivery expected`);
      }
    });

    return reminders;
  }, [storeVendorMap]);

  const activeVendorOrder = useMemo(() => {
    if (!openVendorOrder) return null;
    return vendorOrderGroups.find((group) => group.vendor === openVendorOrder) || null;
  }, [openVendorOrder, vendorOrderGroups]);

  const openVendorProducts = useMemo(() => {
    if (!openVendorOrder) return [];

    const search = vendorProductSearch.trim().toLowerCase();

    return items
      .filter((product) => {
        const vendor = product.vendor || 'No vendor';
        if (vendor !== openVendorOrder) return false;

        const haystack = [
          product.name,
          product.upc,
          product.department,
          product.category,
          product.brand,
          product.vendor,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (search && !haystack.includes(search)) return false;

        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, openVendorOrder, vendorProductSearch]);

  const activeVendorOrderItems = useMemo<VendorOrderItem[]>(() => {
    if (!openVendorOrder) return [];

    const insightByProductKey = new Map<string, ReorderInsight>(
      (activeVendorOrder?.insights || []).map((insight) => [getProductIdentity(insight.product), insight])
    );

    return items
      .filter((product) => {
        const vendor = product.vendor || 'No vendor';
        return vendor === openVendorOrder && selectedReorderSet.has(getProductIdentity(product));
      })
      .map((product) => {
        const insight = insightByProductKey.get(getProductIdentity(product));
        const unitsPerCase = Math.max(1, Number(product.unitsPerCase) || 1);
        const suggestedQty =
          insight?.suggestedQty ||
          Math.max(product.reorderLevel * 2 - product.stock, product.reorderLevel);

        const orderUnits = getOrderUnitsForProduct(product, suggestedQty);
        const orderCases = getOrderCasesForProduct(product, suggestedQty);

        return {
          product,
          insight,
          unitsPerCase,
          suggestedQty,
          orderUnits,
          orderCases,
          estimatedCost: orderUnits * product.costPrice,
        };
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [
    activeVendorOrder,
    getOrderCasesForProduct,
    getOrderUnitsForProduct,
    items,
    openVendorOrder,
    selectedReorderSet,
  ]);

  const activeVendorOrderTotals = useMemo(() => {
    return {
      items: activeVendorOrderItems.length,
      units: activeVendorOrderItems.reduce((sum, item) => sum + item.orderUnits, 0),
      cost: activeVendorOrderItems.reduce((sum, item) => sum + item.estimatedCost, 0),
    };
  }, [activeVendorOrderItems]);

  const toggleReorderSelection = (productKey: string) => {
    setSelectedReorderProductKeys((previous) =>
      previous.includes(productKey)
        ? previous.filter((item) => item !== productKey)
        : [...previous, productKey]
    );
  };

  const selectCriticalReorders = () => {
    setSelectedReorderProductKeys(
      filteredReorderInsights
        .filter((insight) => insight.priority === 'Critical')
        .map((insight) => getProductIdentity(insight.product))
        .filter(Boolean)
    );
  };

  const selectAllReorders = () => {
    setSelectedReorderProductKeys(
      filteredReorderInsights.map((insight) => getProductIdentity(insight.product)).filter(Boolean)
    );
  };

  const clearReorderSelection = () => {
    setSelectedReorderProductKeys([]);
  };

  const clearActiveVendorOrder = () => {
    if (!activeVendorOrder) return;

    setSelectedReorderProductKeys((previous) =>
      previous.filter(
        (productKey) =>
          !items.some(
            (product) =>
              (product.vendor || 'No vendor') === activeVendorOrder.vendor &&
              getProductIdentity(product) === productKey
          )
      )
    );
  };

  const exportPurchaseOrder = () => {
    const rows = selectedPurchaseOrderInsights;

    if (!rows.length) {
      setPurchaseOrderMessage('No reorder items selected or available to export.');
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    exportToCsv(
      `storepulse-purchase-order-${today}.csv`,
      rows.map((insight) => {
        const unitsPerCase = Number(insight.product.unitsPerCase) || 1;
        const orderUnits = getOrderUnitsForProduct(insight.product, insight.suggestedQty);
        const casesToOrder = unitsPerCase <= 1 ? 0 : Math.ceil(orderUnits / unitsPerCase);
        const extraUnits = Math.max(0, orderUnits - insight.suggestedQty);

        return {
          Vendor: insight.product.vendor || 'No vendor',
          Priority: insight.priority,
          Product: insight.product.name,
          UPC: insight.product.upc,
          Department: insight.product.department || insight.product.category,
          CurrentStockUnits: insight.product.stock,
          UnitsPerCase: unitsPerCase,
          CurrentStockCases: formatCaseBreakdown(insight.product.stock, unitsPerCase),
          SoldLast30Days: insight.salesLast30Days,
          AverageDailySales: insight.averageDailySales.toFixed(2),
          EstimatedDaysLeft: insight.daysLeft === null ? 'No sales trend' : insight.daysLeft,
          SuggestedUnits: insight.suggestedQty,
          CasesToOrder: casesToOrder,
          OrderUnits: orderUnits,
          ExtraUnitsFromFullCases: extraUnits,
          UnitCost: insight.product.costPrice.toFixed(2),
          EstimatedOrderCost: (orderUnits * insight.product.costPrice).toFixed(2),
          LastDeliveryDate: insight.lastDeliveryDate || '',
          LastDeliveryQty: insight.lastDeliveryQty,
        };
      })
    );

    setPurchaseOrderMessage(
      selectedReorderProductKeys.length > 0
        ? `Purchase order exported for ${rows.length} selected item(s).`
        : `Purchase order exported for ${rows.length} filtered reorder item(s).`
    );
  };

  const exportVendorPurchaseOrder = (vendor: string) => {
    const group = vendorOrderGroups.find((item) => item.vendor === vendor);

    if (!group) {
      setPurchaseOrderMessage('No vendor order found to export.');
      return;
    }

    const insightByProductKey = new Map<string, ReorderInsight>(
      group.insights.map((insight) => [getProductIdentity(insight.product), insight])
    );

    const selectedVendorProducts = items.filter((product) => {
      const productVendor = product.vendor || 'No vendor';
      return productVendor === vendor && selectedReorderSet.has(getProductIdentity(product));
    });

    const rows =
      selectedVendorProducts.length > 0
        ? selectedVendorProducts
        : group.insights.map((insight) => insight.product);

    if (!rows.length) {
      setPurchaseOrderMessage('No items found for this vendor.');
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    exportToCsv(
      `storepulse-${safeFileName(vendor)}-purchase-order-${today}.csv`,
      rows.map((product) => {
        const insight = insightByProductKey.get(getProductIdentity(product));
        const unitsPerCase = Number(product.unitsPerCase) || 1;
        const suggestedUnits =
          insight?.suggestedQty ||
          Math.max(product.reorderLevel * 2 - product.stock, product.reorderLevel);

        const orderUnits = getOrderUnitsForProduct(product, suggestedUnits);
        const casesToOrder = unitsPerCase <= 1 ? 0 : Math.ceil(orderUnits / unitsPerCase);
        const extraUnits = Math.max(0, orderUnits - suggestedUnits);

        return {
          Vendor: product.vendor || 'No vendor',
          Priority: insight?.priority || 'Manual Add',
          Product: product.name,
          UPC: product.upc,
          Department: product.department || product.category,
          CurrentStockUnits: product.stock,
          UnitsPerCase: unitsPerCase,
          CurrentStockCases: formatCaseBreakdown(product.stock, unitsPerCase),
          SoldLast30Days: insight?.salesLast30Days ?? '',
          AverageDailySales: insight ? insight.averageDailySales.toFixed(2) : '',
          EstimatedDaysLeft: insight?.daysLeft === null ? 'No sales trend' : insight?.daysLeft ?? '',
          SuggestedUnits: suggestedUnits,
          CasesToOrder: casesToOrder,
          OrderUnits: orderUnits,
          ExtraUnitsFromFullCases: extraUnits,
          UnitCost: product.costPrice.toFixed(2),
          EstimatedOrderCost: (orderUnits * product.costPrice).toFixed(2),
          LastDeliveryDate: insight?.lastDeliveryDate || '',
          LastDeliveryQty: insight?.lastDeliveryQty || '',
        };
      })
    );

    setPurchaseOrderMessage(
      selectedVendorProducts.length > 0
        ? `${vendor} purchase order exported for ${rows.length} order item(s).`
        : `${vendor} purchase order exported for all ${rows.length} reorder item(s).`
    );
  };

  const filteredProducts = useMemo(() => {
    return items.filter((product) => {
      const stockStatus = product.stock <= product.reorderLevel ? 'Reorder' : 'In Stock';
      const haystack = [
        product.upc,
        product.plu,
        product.productCode,
        product.sku,
        product.name,
        product.department,
        product.category,
        product.brand,
        product.vendor,
        product.taxCategory,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
      if (departmentFilter !== 'All' && (product.department || product.category) !== departmentFilter) return false;
      if (vendorFilter !== 'All' && product.vendor !== vendorFilter) return false;
      if (stockFilter !== 'All' && stockStatus !== stockFilter) return false;
      if (minPrice.trim() && product.sellPrice < Number(minPrice)) return false;
      if (maxPrice.trim() && product.sellPrice > Number(maxPrice)) return false;
      if (ebtFilter && product.ebtEligible !== true) return false;
      if (ageVerificationFilter && product.ageVerification !== true) return false;
      if (taxableFilter && product.taxable !== true) return false;

      return true;
    });
  }, [
    items,
    query,
    departmentFilter,
    vendorFilter,
    stockFilter,
    minPrice,
    maxPrice,
    ebtFilter,
    ageVerificationFilter,
    taxableFilter,
  ]);

  const orderedNewProductCandidates = useMemo(() => {
    return [...newProductCandidates].sort((a, b) => {
      const statusDifference = newProductStatusRank(a.status) - newProductStatusRank(b.status);
      if (statusDifference !== 0) return statusDifference;
      if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
      return b.timesSold - a.timesSold;
    });
  }, [newProductCandidates]);

  const invoiceTotal = receivingLines.reduce((sum, line) => sum + line.totalCost, 0);

  const getReceivingLineStatus = (line: ReceivingLine): ReceivingLineStatus => {
    const matched = findProductMatch(items, line.upc, line.name);

    if (matched) return 'Matched';
    if (line.name || line.upc) return 'New Product';
    return 'Needs Review';
  };

  const updateReceivingLine = (id: string, changes: Partial<ReceivingLine>) => {
    setReceivingLines((previous) =>
      previous.map((line) => {
        if (line.id !== id) return line;

        const nextLine: ReceivingLine = {
          ...line,
          ...changes,
        };

        if ('quantity' in changes || 'unitCost' in changes) {
          nextLine.totalCost = Number((nextLine.quantity * nextLine.unitCost).toFixed(2));
        }

        nextLine.status = getReceivingLineStatus(nextLine);

        return nextLine;
      })
    );
  };

  const removeReceivingLine = (id: string) => {
    if (!requireSelectedStoreForWrite(setReceivingMessage)) return;
    setReceivingLines((previous) => previous.filter((line) => line.id !== id));
  };

  const addManualReceivingLine = () => {
    if (!requireSelectedStoreForWrite(setReceivingMessage)) return;
    setReceivingLines((previous) => [
      ...previous,
      {
        id: `MANUAL-${Date.now()}`,
        upc: '',
        name: '',
        department: 'General Merchandise',
        vendor: receiptVendor || '',
        quantity: 1,
        unitCost: 0,
        totalCost: 0,
        status: 'Needs Review',
      },
    ]);
  };

  const handleInvoiceFile = (file: File | null) => {
    if (!file) return;
    if (!requireSelectedStoreForWrite(setReceivingMessage)) return;

    const lowerName = file.name.toLowerCase();
    const sourceKind: InvoiceSourceKind = lowerName.endsWith('.pdf')
      ? 'pdf'
      : file.type.startsWith('image/')
        ? 'image'
        : lowerName.endsWith('.csv')
          ? 'csv'
          : 'unknown';

    setInvoiceFile(file);
    setInvoiceFileName(file.name);
    setReceiptName(file.name.replace(/\.[^/.]+$/, ''));
    setReceiptInvoiceNumber('');
    setReceiptVendor('');
    setInvoicePreviewUrl(URL.createObjectURL(file));
    setInvoiceSourceKind(sourceKind);
    setEditingHistoryId(null);
    setReceivingLines([]);
    setReceivingMessage('File selected. Click Upload & Extract to read the invoice.');
  };

  const extractSelectedInvoice = async () => {
    if (!requireSelectedStoreForWrite(setReceivingMessage)) return;

    if (!invoiceFile) {
      setReceivingMessage('Please choose an invoice file first.');
      return;
    }

    setExtractingInvoice(true);
    setReceivingMessage(null);
    setReceivingLines([]);

    try {
      const isCsv =
        invoiceFile.name.toLowerCase().endsWith('.csv') ||
        invoiceFile.type.includes('csv');

      if (isCsv) {
        const text = await invoiceFile.text();
        const rows = parseReceivingCsv(text, items);

        setReceivingLines(rows);
        setReceivingMessage(
          rows.length
            ? `${rows.length} invoice lines extracted for review.`
            : 'No invoice lines found in this CSV.'
        );

        return;
      }

      const formData = new FormData();
      formData.append('file', invoiceFile);

      const response = await fetch('/api/extract-invoice', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Invoice extraction failed.');
      }

      const rows: ReceivingLine[] = (payload.lines || []).map(
        (
          line: {
            upc?: string;
            name?: string;
            department?: string;
            vendor?: string;
            quantity?: number;
            unitCost?: number;
            totalCost?: number;
          },
          index: number
        ) => {
          const upc = line.upc || '';
          const name = line.name || '';
          const quantity = Number(line.quantity) || 0;
          const unitCost = Number(line.unitCost) || 0;
          const totalCost = Number(line.totalCost) || quantity * unitCost;
          const matched = findProductMatch(items, upc, name);
          const status: ReceivingLineStatus = matched ? 'Matched' : name || upc ? 'New Product' : 'Needs Review';

          return {
            id: `PDF-${Date.now()}-${index}`,
            upc,
            name: name || matched?.name || '',
            department: line.department || matched?.department || matched?.category || 'General Merchandise',
            vendor: line.vendor || receiptVendor || matched?.vendor || '',
            quantity,
            unitCost: unitCost || matched?.costPrice || 0,
            totalCost,
            status,
          };
        }
      );

      setReceivingLines(rows);
      setReceivingMessage(
        rows.length
          ? `${rows.length} invoice lines extracted for review.`
          : payload.message || 'No product lines were found. You can enter receiving manually.'
      );
    } catch (error) {
      setReceivingMessage(error instanceof Error ? error.message : 'Could not extract invoice.');
    } finally {
      setExtractingInvoice(false);
    }
  };

  const openAddModal = () => {
    if (!requireSelectedStoreForWrite(setFormError)) return;

    setModalMode('add');
    setEditingProduct(null);
    setForm(EMPTY_PRODUCT_FORM);
    setFormError(null);
    setUpcDuplicate(null);
    setPluDuplicate(null);
    setProductCodeDuplicate(null);
    void loadTaxCategories();
    void loadAgeRestrictionPresets();
    setModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    if (!requireSelectedStoreForWrite(setFormError)) return;

    setModalMode('edit');
    setEditingProduct(product);
    setForm(productToForm(product));
    setFormError(null);
    setUpcDuplicate(null);
    setPluDuplicate(null);
    setProductCodeDuplicate(null);
    void loadTaxCategories();
    void loadAgeRestrictionPresets();
    setModalOpen(true);
  };

  const closeProductModal = () => {
    setModalOpen(false);
    setEditingProduct(null);
    setFormError(null);
    setUpcDuplicate(null);
    setPluDuplicate(null);
    setProductCodeDuplicate(null);
  };

  const checkUpcDuplicate = (value = form.upc) => {
    if (modalMode !== 'add') return;
    const trimmed = value.trim();
    setUpcDuplicate(trimmed ? items.find((product) => product.upc.trim() === trimmed) || null : null);
  };

  const checkPluDuplicate = () => {
    if (modalMode !== 'add') return;
    const trimmed = form.plu.trim();
    if (trimmed && formError === 'Enter a UPC, PLU, or Product Code.') {
      setFormError(null);
    }
    setPluDuplicate(trimmed ? items.find((product) => product.plu?.trim() === trimmed) || null : null);
  };

  const checkProductCodeDuplicate = () => {
    if (modalMode !== 'add') return;
    const trimmed = form.productCode.trim();
    if (trimmed && formError === 'Enter a UPC, PLU, or Product Code.') {
      setFormError(null);
    }
    setProductCodeDuplicate(trimmed ? items.find((product) => product.productCode?.trim() === trimmed) || null : null);
  };

  const handleProductUpcChange = (value: string) => {
    setForm((current) => ({ ...current, upc: value }));
    if (value.trim() && formError === 'Enter a UPC, PLU, or Product Code.') {
      setFormError(null);
    }
    if (modalMode === 'add') checkUpcDuplicate(value);
  };

  const handleProductNameChange = (value: string) => {
    if (value.trim() && formError === 'Product name is required.') {
      setFormError(null);
    }
  };

  const saveProduct = async () => {
    if (!requireSelectedStoreForWrite(setFormError)) return;

    const validationError = validateProductForm(form);

    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (modalMode === 'add') {
      const upc = form.upc.trim();
      const plu = form.plu.trim();
      const productCode = form.productCode.trim();
      const duplicateUpc = upc ? items.find((product) => product.upc.trim() === upc) || null : null;
      const duplicatePlu = plu ? items.find((product) => product.plu?.trim() === plu) || null : null;
      const duplicateProductCode = productCode
        ? items.find((product) => product.productCode?.trim() === productCode) || null
        : null;

      setUpcDuplicate(duplicateUpc);
      setPluDuplicate(duplicatePlu);
      setProductCodeDuplicate(duplicateProductCode);

      if (duplicateUpc) {
        setFormError('A product with this UPC already exists for this store.');
        return;
      }

      if (duplicatePlu) {
        setFormError('A product with this PLU already exists for this store.');
        return;
      }

      if (duplicateProductCode) {
        setFormError('A product with this Product Code already exists for this store.');
        return;
      }
    }

    setSaving(true);
    setFormError(null);

    const product = formToProduct(form);
    const productToSave =
      modalMode === 'edit' && editingProduct
          ? { ...editingProduct, ...product, id: editingProduct.id, upc: editingProduct.upc }
          : product;
    const result = modalMode === 'add' ? await createProduct(productToSave) : await updateProduct(productToSave);

    setSaving(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    closeProductModal();
  };

  const handleProductImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (!requireSelectedStoreForWrite(setProductImportError)) {
      setProductImportFileName('');
      setProductImportResult(null);
      setProductImportSummary(null);
      return;
    }

    setProductImportFileName(file.name);
    setProductImportError(null);
    setProductImportSummary(null);

    try {
      const lowerName = file.name.toLowerCase();
      const isSpreadsheet = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
      let csvText = '';

      if (isSpreadsheet) {
        const XLSX = await import('xlsx');
        const buffer = await readFileAsArrayBuffer(file);
        const workbook = XLSX.read(buffer, { type: 'array', raw: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, {
          raw: false,
          defval: '',
          header: 1,
        }) as string[][];

        if (!rows.length) {
          throw new Error('No rows found in this spreadsheet.');
        }

        const normalizedRows = rows.map((row, index) =>
          row.map((cell) => (index === 0 ? normalizeProductHeader(String(cell ?? '')) : String(cell ?? '')))
        );

        csvText = normalizedRows
          .map((row) => row.map((cell) => quoteCsvValue(cell)).join(','))
          .join('\n');
      } else {
        csvText = await file.text();
      }

      const parsed = parseProductsCsv(csvText, { mode: productImportMode });
      setProductImportResult(parsed);

      if (!parsed.ok) {
        setProductImportError('Missing required columns. Review the parser summary before importing.');
      }
    } catch (error) {
      setProductImportResult(null);
      setProductImportError(error instanceof Error ? error.message : 'Could not parse this product file.');
    }
  };

  const importParsedProducts = async () => {
    if (!requireSelectedStoreForWrite(setProductImportError)) return;
    if (!productImportResult || productImportResult.products.length === 0) return;

    setImportingProducts(true);
    setProductImportError(null);

    const summary: NonNullable<ProductImportSummary> = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      duplicates: 0,
      unmatched: 0,
      errorRows: productImportResult.invalidRows,
    };

    let workingProducts = [...items];
    const updateMode = productImportMode !== 'add_update';
    const validRows = productImportResult.rows.filter((row) => row.valid && row.product);

    for (const row of validRows) {
      const product = row.product as Product;
      const duplicate =
        productImportMode === 'update_by_upc'
          ? workingProducts.find((current) => normalizeText(current.upc) === normalizeText(product.upc)) || null
          : productImportMode === 'update_by_plu'
            ? workingProducts.find((current) => normalizeText(current.plu) === normalizeText(product.plu)) || null
            : productImportMode === 'update_by_product_code'
              ? workingProducts.find((current) => normalizeText(current.productCode) === normalizeText(product.productCode)) || null
              : findProductDuplicate(workingProducts, product);

      try {
        if (updateMode) {
          if (!duplicate) {
            summary.unmatched += 1;
            continue;
          }

          const present = new Set(row.presentFields || []);
          const patch: Partial<Product> = {};
          if (present.has('item_name')) patch.name = product.name;
          if (present.has('category')) patch.category = product.category;
          if (present.has('department')) patch.department = product.department;
          if (present.has('brand')) patch.brand = product.brand;
          if (present.has('vendor')) patch.vendor = product.vendor;
          if (present.has('sku')) patch.sku = product.sku;
          if (present.has('plu')) patch.plu = product.plu;
          if (present.has('product_code')) patch.productCode = product.productCode;
          if (present.has('cost_price')) patch.costPrice = product.costPrice;
          if (present.has('selling_price')) patch.sellPrice = product.sellPrice;
          if (present.has('stock')) patch.stock = product.stock;
          if (present.has('reorder_level')) patch.reorderLevel = product.reorderLevel;
          if (present.has('tax_rate')) patch.taxRate = product.taxRate;
          if (present.has('tax_category')) patch.taxCategory = product.taxCategory;
          if (present.has('taxable')) patch.taxable = product.taxable;
          if (present.has('ebt_eligible')) patch.ebtEligible = product.ebtEligible;
          if (present.has('age_verification')) patch.ageVerification = product.ageVerification;
          if (present.has('minimum_age')) patch.minimumAge = product.minimumAge;
          if (present.has('age_restriction_type')) patch.ageRestrictionType = product.ageRestrictionType;
          if (present.has('is_active')) patch.isActive = product.isActive;
          if (present.has('notes')) patch.notes = product.notes;

          const updatedProduct = { ...duplicate, ...patch, upc: duplicate.upc };
          const result = await updateProduct(updatedProduct);
          if (result.error) throw new Error(result.error);
          workingProducts = workingProducts.map((current) =>
            current.upc === duplicate.upc ? updatedProduct : current
          );
          summary.updated += 1;
          continue;
        }

        if (duplicate) {
          summary.duplicates += 1;

          if (duplicateImportMode === 'update') {
            const updatedProduct = { ...duplicate, ...product, upc: duplicate.upc };
            const result = await updateProduct(updatedProduct);
            if (result.error) throw new Error(result.error);
            workingProducts = workingProducts.map((current) =>
              current.upc === duplicate.upc ? updatedProduct : current
            );
            summary.updated += 1;
          } else {
            summary.skipped += 1;
          }
        } else {
          const result = await createProduct(product);
          if (result.error) throw new Error(result.error);
          workingProducts = [product, ...workingProducts];
          summary.inserted += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }

    setItems(workingProducts);
    setProductImportSummary(summary);
    setImportingProducts(false);
  };

  const resetBulkFields = () => {
    setBulkDepartment('');
    setBulkCategory('');
    setBulkVendor('');
    setBulkCustomVendor('');
    setBulkBrand('');
    setBulkCostPrice('');
    setBulkSellPrice('');
    setBulkTaxCategory('');
    setBulkTaxable('');
    setBulkEbt('');
    setBulkActive('');
    setBulkAgeVerification('');
    setBulkMinimumAge('');
    setBulkAgeRestrictionType('');
  };

  const exitBulkEdit = () => {
    setBulkEditMode(false);
    setSelectedProductKeys(new Set());
    resetBulkFields();
  };

  const toggleBulkEdit = () => {
    if (bulkEditMode) {
      exitBulkEdit();
    } else {
      if (!requireSelectedStoreForWrite(setBulkMessage)) return;
      setBulkEditMode(true);
      setBulkMessage(null);
    }
  };

  const toggleSelectedProduct = (productKey: string) => {
    setSelectedProductKeys((previous) => {
      const next = new Set(previous);
      if (next.has(productKey)) {
        next.delete(productKey);
      } else {
        next.add(productKey);
      }
      return next;
    });
  };

  const toggleAllFilteredProducts = () => {
    setSelectedProductKeys((previous) => {
      const allSelected =
        filteredProducts.length > 0 &&
        filteredProducts.every((product) => previous.has(getProductIdentity(product)));
      if (allSelected) return new Set();
      return new Set(filteredProducts.map((product) => getProductIdentity(product)).filter(Boolean));
    });
  };

  const applyBulkChanges = async () => {
    if (!requireSelectedStoreForWrite(setBulkMessage)) return;

    const changes: Partial<Product> = {};

    if (bulkDepartment.trim()) changes.department = bulkDepartment.trim();
    if (bulkCategory.trim()) changes.category = bulkCategory.trim();
    if (bulkVendor === '__other__' && bulkCustomVendor.trim()) changes.vendor = bulkCustomVendor.trim();
    if (bulkVendor && bulkVendor !== '__other__') changes.vendor = bulkVendor;
    if (bulkBrand.trim()) changes.brand = bulkBrand.trim();
    if (bulkCostPrice.trim() && Number.isFinite(Number(bulkCostPrice))) changes.costPrice = Number(bulkCostPrice);
    if (bulkSellPrice.trim() && Number.isFinite(Number(bulkSellPrice))) changes.sellPrice = Number(bulkSellPrice);
    if (bulkTaxCategory) changes.taxCategory = bulkTaxCategory;
    if (bulkTaxable) changes.taxable = bulkTaxable === 'true';
    if (bulkEbt) changes.ebtEligible = bulkEbt === 'true';
    if (bulkActive) changes.isActive = bulkActive === 'true';
    if (bulkAgeVerification) {
      changes.ageVerification = bulkAgeVerification === 'true';
      if (bulkAgeVerification === 'false') {
        changes.minimumAge = undefined;
        changes.ageRestrictionType = undefined;
      }
    }
    if (bulkMinimumAge.trim()) changes.minimumAge = safeNumber(bulkMinimumAge, 21);
    if (bulkAgeRestrictionType) changes.ageRestrictionType = bulkAgeRestrictionType;

    if (Object.keys(changes).length === 0) {
      setBulkMessage('Choose at least one change before applying.');
      return;
    }

    const count = selectedProductKeys.size;
    if (!window.confirm(`Update ${count} products with these changes?`)) return;

    let updatedCount = 0;
    let nextItems = [...items];

    for (const productKey of selectedProductKeys) {
      const existing = nextItems.find((product) => getProductIdentity(product) === productKey);
      if (!existing) continue;

      const updatedProduct: Product = {
        ...existing,
        ...changes,
      };

      const result = await updateProduct(updatedProduct);
      if (!result.error) {
        updatedCount += 1;
        nextItems = nextItems.map((product) => (getProductIdentity(product) === productKey ? updatedProduct : product));
      }
    }

    setItems(nextItems);
    setBulkMessage(`${updatedCount} products updated successfully.`);
    exitBulkEdit();
  };

  const exportProducts = () => {
    exportToCsv(
      'storepulse-products-inventory.csv',
      filteredProducts.map((product) => ({
        UPC: product.upc,
        PLU: product.plu || '',
        ProductCode: product.productCode || '',
        Product: product.name,
        SKU: product.sku || '',
        Department: product.department || product.category,
        Brand: product.brand || '',
        Vendor: product.vendor || '',
        CostPrice: product.costPrice.toFixed(2),
        SellPrice: product.sellPrice.toFixed(2),
        Margin: computeMargin(product.sellPrice, product.costPrice).toFixed(1),
        Stock: product.stock,
        ReorderLevel: product.reorderLevel,
        Taxable: (product.taxable ?? true) ? 'Yes' : 'No',
        TaxCategory: product.taxCategory || '',
        EBT: product.ebtEligible ? 'Yes' : 'No',
        EBTEligible: product.ebtEligible ? 'Yes' : 'No',
        AgeVerification: product.ageVerification ? 'Yes' : 'No',
        MinimumAge: product.minimumAge || '',
        AgeRestrictionType: product.ageRestrictionType || '',
        Active: (product.isActive ?? true) ? 'Yes' : 'No',
      }))
    );
  };

  const uploadInvoiceSource = async (existingPath?: string) => {
    if (productsWriteBlocked) throw new Error(PRODUCTS_MANAGE_STORE_MESSAGE);
    if (!selectedStoreId) return existingPath || '';
    if (!invoiceFile) return existingPath || '';

    const path = `${selectedStoreId}/${Date.now()}-${safeFileName(invoiceFile.name)}`;

    const { error } = await supabase.storage.from(INVOICE_BUCKET).upload(path, invoiceFile, {
      upsert: true,
      contentType: invoiceFile.type || undefined,
    });

    if (error) throw new Error(error.message);

    return path;
  };

  const applyReceivingLinesToProducts = async (
    workingProducts: Product[],
    lines: ReceivingLine[],
    mode: 'add' | 'subtract'
  ) => {
    if (productsWriteBlocked) throw new Error(PRODUCTS_MANAGE_STORE_MESSAGE);

    let nextProducts = [...workingProducts];
    const savedLines: ReceivingLine[] = [];

    for (const line of lines) {
      if (!line.name.trim() || line.quantity <= 0) continue;

      const matched = findProductMatch(nextProducts, line.upc, line.name);

      if (matched) {
        const nextStock =
          mode === 'add'
            ? matched.stock + line.quantity
            : Math.max(0, matched.stock - line.quantity);

        const unitsPerCase = Math.max(1, Number(matched.unitsPerCase) || 1);
const nextBreakdown = getCaseBreakdown(nextStock, unitsPerCase);

    const updatedProduct: Product = {
    ...matched,
    stock: nextStock,
    unitsPerCase,
    casesOnHand: nextBreakdown.cases,
    looseUnits: nextBreakdown.looseUnits,
    costPrice: mode === 'add' ? line.unitCost || matched.costPrice : matched.costPrice,
    vendor: mode === 'add' ? line.vendor || matched.vendor : matched.vendor,
    department: mode === 'add' ? line.department || matched.department || matched.category : matched.department,
    category: mode === 'add' ? line.department || matched.department || matched.category : matched.category,
    };

        nextProducts = nextProducts.map((product) =>
          product.upc === matched.upc ? updatedProduct : product
        );

        await updateProduct(updatedProduct);

        savedLines.push({
          ...line,
          upc: matched.upc,
          status: 'Matched',
        });
      } else if (mode === 'add') {
        const newProductUpc = line.upc || `INV-${Date.now()}-${Math.round(Math.random() * 10000)}`;

        const newProduct: Product = {
        upc: newProductUpc,
        name: line.name,
        category: line.department || 'General Merchandise',
        department: line.department || 'General Merchandise',
        brand: 'Unknown',
        vendor: line.vendor || receiptVendor || undefined,
        costPrice: line.unitCost,
        sellPrice: line.unitCost > 0 ? Number((line.unitCost * 1.35).toFixed(2)) : 0,
        stock: line.quantity,
        unitsPerCase: 1,
        casesOnHand: line.quantity,
        looseUnits: 0,
        reorderLevel: 10,
        taxCategory: 'standard',
        taxRate: 0,
        taxable: true,
        ebtEligible: false,
        isActive: true,
        };

        nextProducts = [newProduct, ...nextProducts];
        await createProduct(newProduct);

        savedLines.push({
          ...line,
          upc: newProductUpc,
          status: 'Matched',
          vendor: line.vendor || receiptVendor,
        });
      }
    }

    return { nextProducts, savedLines };
  };

  const saveCloudReceipt = async (entry: ReceivingHistoryItem) => {
    if (!selectedStoreId) return entry;

    const receiptPayload = {
      store_id: selectedStoreId,
      file_name: entry.fileName,
      receipt_name: entry.receiptName || entry.fileName,
      invoice_number: entry.invoiceNumber || null,
      source_path: entry.sourcePath || null,
      source_kind: entry.sourceKind || 'unknown',
      vendor: entry.vendor,
      item_count: entry.itemCount,
      total_amount: entry.totalAmount,
      receipt_date: entry.date,
      updated_at: new Date().toISOString(),
    };

    let receiptId = entry.id;

    if (editingHistoryId) {
      const { error } = await supabase
        .from('inventory_receipts')
        .update(receiptPayload)
        .eq('id', editingHistoryId)
        .eq('store_id', selectedStoreId);

      if (error) throw new Error(error.message);

      const { error: deleteItemsError } = await supabase
        .from('inventory_receipt_items')
        .delete()
        .eq('receipt_id', editingHistoryId)
        .eq('store_id', selectedStoreId);

      if (deleteItemsError) throw new Error(deleteItemsError.message);
    } else {
      const { data, error } = await supabase
        .from('inventory_receipts')
        .insert(receiptPayload)
        .select('id')
        .single();

      if (error) throw new Error(error.message);
      receiptId = data.id;
    }

    const itemPayload = (entry.lines || []).map((line) => ({
      receipt_id: receiptId,
      store_id: selectedStoreId,
      upc: line.upc || null,
      item_name: line.name,
      department: line.department || null,
      vendor: line.vendor || entry.vendor || null,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      total_cost: line.totalCost,
      match_status: line.status,
    }));

    if (itemPayload.length) {
      const { error } = await supabase.from('inventory_receipt_items').insert(itemPayload);
      if (error) throw new Error(error.message);
    }

    return {
      ...entry,
      id: receiptId,
    };
  };

  const saveReceiving = async () => {
    if (!requireSelectedStoreForWrite(setReceivingMessage)) return;

    const validLines = receivingLines.filter((line) => line.name.trim() && line.quantity > 0);

    if (!validLines.length) {
      setReceivingMessage('No valid invoice lines to save.');
      return;
    }

    setSavingReceiving(true);
    setReceivingMessage(null);

    try {
      const existingEntry = editingHistoryId
        ? receivingHistory.find((entry) => entry.id === editingHistoryId)
        : null;

      let workingProducts = [...items];

      if (existingEntry?.lines?.length) {
        const reversed = await applyReceivingLinesToProducts(workingProducts, existingEntry.lines, 'subtract');
        workingProducts = reversed.nextProducts;
      }

      const selectedVendor =
        receiptVendor ||
        validLines.find((line) => line.vendor)?.vendor ||
        existingEntry?.vendor ||
        'Mixed vendors';

      const linesWithVendor = validLines.map((line) => ({
        ...line,
        vendor: line.vendor || selectedVendor,
      }));

      const applied = await applyReceivingLinesToProducts(workingProducts, linesWithVendor, 'add');
      workingProducts = applied.nextProducts;

      setItems(workingProducts);

      const normalizedLines = applied.savedLines.map((line) => ({
        ...line,
        vendor: line.vendor || selectedVendor,
      }));

      const savedTotal = normalizedLines.reduce((sum, line) => sum + line.totalCost, 0);
      const sourcePath = await uploadInvoiceSource(existingEntry?.sourcePath);

      const nextHistoryDraft: ReceivingHistoryItem = {
        id: editingHistoryId || `${Date.now()}`,
        date: existingEntry?.date || new Date().toISOString(),
        fileName: invoiceFileName || existingEntry?.fileName || 'Manual receiving',
        receiptName:
          receiptName.trim() ||
          existingEntry?.receiptName ||
          invoiceFileName ||
          'Inventory receiving',
        invoiceNumber: receiptInvoiceNumber.trim() || existingEntry?.invoiceNumber || '',
        vendor: selectedVendor,
        itemCount: normalizedLines.length,
        totalAmount: savedTotal,
        lines: normalizedLines,
        sourceUrl: invoicePreviewUrl || existingEntry?.sourceUrl || '',
        sourcePath,
        sourceKind: invoiceSourceKind || existingEntry?.sourceKind || 'unknown',
      };

      const nextHistory = await saveCloudReceipt(nextHistoryDraft);

      const history = editingHistoryId
        ? receivingHistory.map((entry) => (entry.id === editingHistoryId ? nextHistory : entry))
        : [nextHistory, ...receivingHistory];

      const limitedHistory = history.slice(0, 25);

      setReceivingHistory(limitedHistory);

      if (!selectedStoreId) {
        localStorage.setItem(RECEIVING_HISTORY_KEY, JSON.stringify(limitedHistory));
      }

      setEditingHistoryId(null);
      setInvoiceFile(null);
      setReceiptName('');
      setReceiptInvoiceNumber('');
      setReceiptVendor('');
      setReceivingLines([]);
      setReceivingMessage('Receiving saved. Product stock was updated.');
      setActiveTab('history');
    } catch (error) {
      setReceivingMessage(error instanceof Error ? error.message : 'Could not save receiving.');
    } finally {
      setSavingReceiving(false);
    }
  };

  const openHistorySource = async (entry: ReceivingHistoryItem) => {
    if (entry.sourcePath) {
      const { data, error } = await supabase.storage
        .from(INVOICE_BUCKET)
        .createSignedUrl(entry.sourcePath, 60 * 60);

      if (error) {
        setReceivingMessage(error.message);
        return;
      }

      setSelectedHistoryEntry({
        ...entry,
        sourceUrl: data.signedUrl,
      });
      return;
    }

    setSelectedHistoryEntry(entry);
  };

  const deleteHistoryEntry = async (entry: ReceivingHistoryItem) => {
    if (!requireSelectedStoreForWrite(setReceivingMessage)) return;

    setReceivingMessage(null);

    try {
      if (entry.lines?.length) {
        const reversed = await applyReceivingLinesToProducts(items, entry.lines, 'subtract');
        setItems(reversed.nextProducts);
      }

      if (selectedStoreId) {
        const { error } = await supabase
          .from('inventory_receipts')
          .delete()
          .eq('id', entry.id)
          .eq('store_id', selectedStoreId);
        if (error) throw new Error(error.message);

        if (entry.sourcePath) {
          await supabase.storage.from(INVOICE_BUCKET).remove([entry.sourcePath]);
        }
      }

      const nextHistory = receivingHistory.filter((item) => item.id !== entry.id);
      setReceivingHistory(nextHistory);

      if (!selectedStoreId) {
        localStorage.setItem(RECEIVING_HISTORY_KEY, JSON.stringify(nextHistory));
      }
    } catch (error) {
      setReceivingMessage(error instanceof Error ? error.message : 'Could not delete receiving.');
    }
  };

  if (!loaded) {
    return (
      <DashboardShell>
        <PageLoading />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Products & Inventory"
        description={`${summary.totalProducts} active products · ${formatNumber(summary.totalUnits)} units in stock · ${summary.lowStockCount} low stock · ${
          isDemoProducts ? 'demo data' : productsMeta.fileName
        }`}
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportProducts}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>

          <Button size="sm" onClick={openAddModal} disabled={productsWriteBlocked}>
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>
      </PageHeader>

      {productsWriteBlocked && (
        <Card className="mb-5 border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold">All Stores product view</h2>
              <p className="mt-1 text-sm text-amber-900">{PRODUCTS_ALL_STORES_READONLY_MESSAGE}</p>
            </div>
          </div>
        </Card>
      )}

      {(cloudError || receivingMessage || purchaseOrderMessage) && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{cloudError || receivingMessage || purchaseOrderMessage}</span>
        </div>
      )}

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <button
          onClick={openAddModal}
          disabled={productsWriteBlocked}
          className={cn(
            'rounded-lg border bg-card p-4 text-left shadow-sm transition hover:bg-secondary/40',
            productsWriteBlocked && 'cursor-not-allowed opacity-60 hover:bg-card'
          )}
        >
          <Plus className="mb-3 h-5 w-5 text-primary" />
          <p className="font-semibold text-foreground">Add Product</p>
          <p className="mt-1 text-xs text-muted-foreground">Create a new item.</p>
        </button>

        <button onClick={() => setActiveTab('products')} className="rounded-lg border bg-card p-4 text-left shadow-sm transition hover:bg-secondary/40">
          <Pencil className="mb-3 h-5 w-5 text-primary" />
          <p className="font-semibold text-foreground">Change Prices</p>
          <p className="mt-1 text-xs text-muted-foreground">Edit cost, sell price, or tax.</p>
        </button>

        <button onClick={() => setActiveTab('receiving')} className="rounded-lg border bg-card p-4 text-left shadow-sm transition hover:bg-secondary/40">
          <Receipt className="mb-3 h-5 w-5 text-primary" />
          <p className="font-semibold text-foreground">Receive Inventory</p>
          <p className="mt-1 text-xs text-muted-foreground">Upload invoice or delivery CSV.</p>
        </button>

        <button onClick={() => setActiveTab('reorder')} className="rounded-lg border bg-card p-4 text-left shadow-sm transition hover:bg-secondary/40">
          <AlertTriangle className="mb-3 h-5 w-5 text-destructive" />
          <p className="font-semibold text-foreground">Low Stock</p>
          <p className="mt-1 text-xs text-muted-foreground">{summary.lowStockCount} items need review.</p>
        </button>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={activeTab === tab.key ? 'default' : 'outline'}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-5">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Products</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(summary.totalProducts)}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Units In Stock</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(summary.totalUnits)}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inventory Cost</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(summary.totalCost, { compact: true })}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Potential Revenue</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(summary.potentialRevenue, { compact: true })}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Profit If Sold All</p>
              <p className="mt-2 text-2xl font-bold text-success">{formatCurrency(summary.potentialProfit, { compact: true })}</p>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <Card className="p-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-foreground">Inventory Value by Department</h2>
                <p className="text-sm text-muted-foreground">Shows where your store inventory money is currently sitting.</p>
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={departmentData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={115} paddingAngle={2}>
                      {departmentData.map((entry, index) => (
                        <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 rounded-lg bg-secondary/40 p-4">
                <p className="text-sm text-muted-foreground">Profit if all current products are sold</p>
                <p className="mt-1 text-3xl font-bold text-foreground">{formatCurrency(summary.potentialProfit)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Average margin: {summary.averageMargin.toFixed(1)}%</p>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-lg font-semibold text-foreground">Needs Attention</h2>

              <div className="mt-4 space-y-3">
                {lowStockProducts.slice(0, 6).map((product) => (
                  <div key={getProductIdentity(product)} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.stock} left · reorder at {product.reorderLevel}
                      </p>
                    </div>

                    <Button size="sm" variant="outline" onClick={() => openEditModal(product)} disabled={productsWriteBlocked}>
                      Edit
                    </Button>
                  </div>
                ))}

                {!lowStockProducts.length && (
                  <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                    No low-stock products right now.
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'products' && (
        <div className="space-y-5">
          <Card className="p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_180px_150px_120px_120px_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, UPC, PLU, code, SKU, brand, vendor, department..."
                  className="pl-9"
                />
              </div>

              <select
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="All">All departments</option>
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>

              <select
                value={vendorFilter}
                onChange={(event) => setVendorFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="All">All Vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>

              <select
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="All">All stock</option>
                <option value="In Stock">In Stock</option>
                <option value="Reorder">Reorder</option>
              </select>

              <Input
                type="number"
                min="0"
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
                placeholder="Min $"
              />

              <Input
                type="number"
                min="0"
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                placeholder="Max $"
              />

              <Button variant="outline" onClick={toggleBulkEdit} disabled={productsWriteBlocked}>
                {bulkEditMode ? 'Exit Bulk Edit' : 'Bulk Edit'}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={ebtFilter} onChange={(event) => setEbtFilter(event.target.checked)} />
                EBT Only
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ageVerificationFilter}
                  onChange={(event) => setAgeVerificationFilter(event.target.checked)}
                />
                Age Restricted Only
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={taxableFilter} onChange={(event) => setTaxableFilter(event.target.checked)} />
                Taxable Only
              </label>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Import Products</h2>
                <p className="text-sm text-muted-foreground">Upload a CSV or XLSX pricebook and choose how duplicates are handled.</p>
              </div>

              <label
                className={cn(
                  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-secondary/50',
                  productsWriteBlocked && 'cursor-not-allowed opacity-60 hover:bg-background'
                )}
              >
                <Upload className="h-4 w-4" />
                CSV or XLSX
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={handleProductImportFile}
                  disabled={productsWriteBlocked}
                />
              </label>
            </div>

            {productImportFileName && (
              <p className="mt-3 text-sm text-muted-foreground">
                Selected product file: <span className="font-medium text-foreground">{productImportFileName}</span>
              </p>
            )}

            {productImportError && (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {productImportError}
              </div>
            )}

            {productImportResult && (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {productImportResult.validRows} valid row(s), {productImportResult.invalidRows} error row(s)
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Duplicate matches use UPC first, then PLU, then Product Code.
                  </p>

                  <div className="mt-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Import Mode</p>
                    <div className="flex flex-wrap gap-3">
                      {[
                        ['add_update', 'Add / Update Products'],
                        ['update_by_upc', 'Update Existing by UPC'],
                        ['update_by_plu', 'Update Existing by PLU'],
                        ['update_by_product_code', 'Update Existing by Product Code'],
                      ].map(([value, label]) => (
                        <label key={value} className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="productImportMode"
                            value={value}
                            checked={productImportMode === value}
                            onChange={() => setProductImportMode(value as ProductImportMode)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-3">
                    {[
                      ['skip', 'Skip duplicates'],
                      ['update', 'Update existing products'],
                      ['new-only', 'Add only new products'],
                    ].map(([value, label]) => (
                      <label key={value} className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="duplicateImportMode"
                          value={value}
                          checked={duplicateImportMode === value}
                          onChange={() => setDuplicateImportMode(value as DuplicateImportMode)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <Button onClick={() => void importParsedProducts()} disabled={importingProducts || productsWriteBlocked || productImportResult.validRows === 0}>
                  {importingProducts ? 'Importing...' : 'Import Products'}
                </Button>
              </div>
            )}

            {productImportSummary && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    <span>Inserted: {productImportSummary.inserted}</span>
                    <span>Updated: {productImportSummary.updated}</span>
                    <span>Skipped: {productImportSummary.skipped}</span>
                    <span>Failed: {productImportSummary.failed}</span>
                    <span>Duplicates found: {productImportSummary.duplicates}</span>
                    <span>Unmatched: {productImportSummary.unmatched}</span>
                    <span>Error rows: {productImportSummary.errorRows}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setProductImportSummary(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {bulkMessage && (
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              {bulkMessage}
            </div>
          )}

          {bulkEditMode && selectedProductKeys.size > 0 && (
            <Card className="sticky top-3 z-20 border-primary/30 p-4 shadow-md">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-foreground">{selectedProductKeys.size} products selected</p>
                <Button size="sm" onClick={() => void applyBulkChanges()} disabled={productsWriteBlocked}>
                  Apply Changes
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                <select value={bulkDepartment} onChange={(event) => setBulkDepartment(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Department: No change</option>
                  {departments.map((department) => (
                    <option key={department} value={department}>{department}</option>
                  ))}
                </select>
                <select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Category: No change</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <select value={bulkVendor} onChange={(event) => setBulkVendor(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Vendor: No change</option>
                  {allVendorOptions.map((vendor) => (
                    <option key={vendor} value={vendor}>{vendor}</option>
                  ))}
                  <option value="__other__">Other</option>
                </select>
                {bulkVendor === '__other__' && (
                  <Input value={bulkCustomVendor} onChange={(event) => setBulkCustomVendor(event.target.value)} placeholder="Vendor name" />
                )}
                <Input value={bulkBrand} onChange={(event) => setBulkBrand(event.target.value)} placeholder="Brand" />
                <Input type="number" min="0" step="0.01" value={bulkCostPrice} onChange={(event) => setBulkCostPrice(event.target.value)} placeholder="New cost $" />
                <Input type="number" min="0" step="0.01" value={bulkSellPrice} onChange={(event) => setBulkSellPrice(event.target.value)} placeholder="New sell $" />
                <select value={bulkTaxCategory} onChange={(event) => setBulkTaxCategory(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Tax Category</option>
                  <option value="standard">standard</option>
                  <option value="non-taxable">non-taxable</option>
                  <option value="tobacco">tobacco</option>
                  <option value="alcohol">alcohol</option>
                  <option value="fuel">fuel</option>
                </select>
                <select value={bulkTaxable} onChange={(event) => setBulkTaxable(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Taxable: No change</option>
                  <option value="true">Taxable: Yes</option>
                  <option value="false">Taxable: No</option>
                </select>
                <select value={bulkEbt} onChange={(event) => setBulkEbt(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">EBT: No change</option>
                  <option value="true">EBT: Yes</option>
                  <option value="false">EBT: No</option>
                </select>
                <select value={bulkActive} onChange={(event) => setBulkActive(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Active: No change</option>
                  <option value="true">Active: Yes</option>
                  <option value="false">Active: No</option>
                </select>
                <select value={bulkAgeVerification} onChange={(event) => setBulkAgeVerification(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Age Verification: No change</option>
                  <option value="true">Age Verification: Yes</option>
                  <option value="false">Age Verification: No</option>
                </select>
                <Input type="number" min="0" max="100" value={bulkMinimumAge} onChange={(event) => setBulkMinimumAge(event.target.value)} placeholder="Minimum Age" />
                <select value={bulkAgeRestrictionType} onChange={(event) => setBulkAgeRestrictionType(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Restriction Type</option>
                  {PRESET_AGE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {bulkEditMode && (
                      <th className="w-12 px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={
                            filteredProducts.length > 0 &&
                            filteredProducts.every((product) => selectedProductKeys.has(getProductIdentity(product)))
                          }
                          onChange={toggleAllFilteredProducts}
                          aria-label="Select all products"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Department</th>
                    <th className="px-4 py-3 text-left">Price</th>
                    <th className="px-4 py-3 text-left">Stock</th>
                    <th className="px-4 py-3 text-left">Tax / EBT</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredProducts.map((product) => {
                    const lowStock = product.stock <= product.reorderLevel;
                    const margin = computeMargin(product.sellPrice, product.costPrice);
                    const productKey = getProductIdentity(product);

                    return (
                      <tr key={productKey} className="border-t border-border/70 hover:bg-secondary/30">
                        {bulkEditMode && (
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selectedProductKeys.has(productKey)}
                              onChange={() => toggleSelectedProduct(productKey)}
                              aria-label={`Select ${product.name}`}
                            />
                          </td>
                        )}
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                              <Package className="h-4 w-4" />
                            </div>

                            <div>
                              <p className="font-semibold text-foreground">{product.name}</p>
                              <p className="font-mono text-xs text-muted-foreground">UPC {product.upc}</p>
                              {product.plu && (
                                <p className="font-mono text-xs text-muted-foreground">PLU: {product.plu}</p>
                              )}
                              {product.productCode && (
                                <p className="font-mono text-xs text-muted-foreground">Code: {product.productCode}</p>
                              )}
                              <p className="text-xs text-muted-foreground">{product.brand || 'Unknown brand'}</p>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <p className="font-medium text-foreground">{product.department || product.category}</p>
                          <p className="text-xs text-muted-foreground">{product.vendor || 'No vendor'}</p>
                        </td>

                        <td className="px-4 py-4">
                          <p className="font-semibold text-foreground">{formatCurrency(product.sellPrice)}</p>
                          <p className="text-xs text-muted-foreground">Cost {formatCurrency(product.costPrice)}</p>
                          <span
                            className={cn(
                              'mt-1 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                              margin >= 20 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                            )}
                          >
                            {margin.toFixed(1)}%
                          </span>
                        </td>

                        <td className="px-4 py-4">
                          <p className={cn('font-semibold', lowStock ? 'text-destructive' : 'text-foreground')}>
                            {formatNumber(product.stock)}
                          </p>
                          <p className="text-xs text-muted-foreground">Reorder at {product.reorderLevel}</p>
                        </td>

                        <td className="px-4 py-4">
                          <p className="text-xs text-muted-foreground">{product.taxCategory || 'standard'}</p>
                          {product.ebtEligible && (
                            <span className="mt-1 inline-flex rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                              EBT
                            </span>
                          )}
                          {product.ageVerification && (
                            <span className="mt-1 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                              Age {product.minimumAge || 21}
                              {product.ageRestrictionType ? ` · ${product.ageRestrictionType}` : ''}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-4 text-right">
                          <Button variant="outline" size="sm" onClick={() => openEditModal(product)} disabled={productsWriteBlocked}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'newProducts' && (
        <div className="space-y-5">
          {!activeStoreId ? (
            <Card className="border-amber-200 bg-amber-50 p-5 text-amber-950">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <h2 className="font-semibold">Select a specific store</h2>
                  <p className="mt-1 text-sm text-amber-900">
                    Select a specific store to review and approve new products.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <Card className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">New Product Candidates</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Review POS-discovered product candidates one at a time before adding them to this store.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void loadNewProductCandidates()} disabled={newProductsLoading}>
                    {newProductsLoading ? 'Loading...' : 'Retry'}
                  </Button>
                </div>
              </Card>

              {newProductsMessage && (
                <Card className="border-success/20 bg-success/5 p-4 text-sm font-medium text-success">
                  {newProductsMessage}
                </Card>
              )}

              {newProductsLoading ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Loading new product candidates...
                </Card>
              ) : newProductsError ? (
                <Card className="border-destructive/30 bg-destructive/10 p-5 text-destructive">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <h3 className="font-semibold">Could not load new products</h3>
                        <p className="mt-1 text-sm">{newProductsError}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void loadNewProductCandidates()}>
                      Retry
                    </Button>
                  </div>
                </Card>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-5">
                    <Card className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ready to Add</p>
                      <p className="mt-2 text-2xl font-bold text-success">{formatNumber(newProductCounts.readyToAdd)}</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Missing UPC</p>
                      <p className="mt-2 text-2xl font-bold text-amber-700">{formatNumber(newProductCounts.missingUpc)}</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duplicates</p>
                      <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(newProductCounts.duplicateFound)}</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Price Conflicts</p>
                      <p className="mt-2 text-2xl font-bold text-orange-700">{formatNumber(newProductCounts.priceConflict)}</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Needs Review</p>
                      <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(newProductCounts.needsReview)}</p>
                    </Card>
                  </div>

                  {newProductCandidates.length === 0 ? (
                    <Card className="p-8 text-center">
                      <Package className="mx-auto h-8 w-8 text-muted-foreground" />
                      <h3 className="mt-3 font-semibold text-foreground">No POS data found for this store.</h3>
                      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
                        Upload Verifone reports in POS Import to discover new products.
                      </p>
                      <Button asChild className="mt-4">
                        <Link href="/app/reports/pos-import">Open POS Import</Link>
                      </Button>
                    </Card>
                  ) : newProductCounts.duplicateFound === newProductCounts.total ? (
                    <Card className="border-success/20 bg-success/5 p-4 text-sm text-foreground">
                      All discovered products have already been added. Import more POS reports to find new products.
                    </Card>
                  ) : null}

                  {orderedNewProductCandidates.length > 0 && (
                    <Card className="overflow-hidden">
                      <div className="border-b border-border p-5">
                        <h3 className="font-semibold text-foreground">Candidate Details</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Save eligible candidates into Products after reviewing the source details and product fields.
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1180px] text-sm">
                          <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="px-4 py-3 text-left">Source</th>
                              <th className="px-4 py-3 text-left">Product</th>
                              <th className="px-4 py-3 text-left">Identifiers</th>
                              <th className="px-4 py-3 text-left">Sales Context</th>
                              <th className="px-4 py-3 text-left">Seen</th>
                              <th className="px-4 py-3 text-left">Status</th>
                              <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderedNewProductCandidates.map((candidate) => (
                              <tr key={candidate.candidateKey} className="border-t border-border/70 hover:bg-secondary/30">
                                <td className="px-4 py-4 align-top">
                                  <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                                    POS Import
                                  </span>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    {candidate.sourceRef.pos_plu_sale_count} PLU row(s)
                                  </p>
                                </td>
                                <td className="px-4 py-4 align-top">
                                  <p className="font-semibold text-foreground">{candidate.description || 'Unnamed product'}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">POS price {formatCurrency(candidate.unitPrice)}</p>
                                  {candidate.promotionId && (
                                    <p className="mt-1 text-xs text-muted-foreground">Promotion {candidate.promotionId}</p>
                                  )}
                                  {candidate.priceConflict && (
                                    <div className="mt-2 rounded-md bg-orange-100 px-2 py-1 text-xs text-orange-800">
                                      POS {formatCurrency(candidate.priceConflict.posPrice)} vs current {formatCurrency(candidate.priceConflict.existingPrice)}
                                      {' '}({formatPercentDifference(candidate.priceConflict.percentDifference)} difference)
                                    </div>
                                  )}
                                  {candidate.existingProduct && candidate.status === 'duplicate_found' && (
                                    <div className="mt-2 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
                                      Existing: {candidate.existingProduct.item_name || 'Unnamed product'}
                                      <br />
                                      UPC: {candidate.existingProduct.upc}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-4 align-top font-mono text-xs text-muted-foreground">
                                  <p>UPC: {candidate.upcNormalized || '-'}</p>
                                  <p>PLU: {candidate.pluRaw || candidate.pluNormalized || '-'}</p>
                                </td>
                                <td className="px-4 py-4 align-top">
                                  <p className="font-semibold text-foreground">{formatNumber(candidate.timesSold)} sold</p>
                                  <p className="text-xs text-muted-foreground">{formatCurrency(candidate.totalRevenue)} revenue</p>
                                </td>
                                <td className="px-4 py-4 align-top text-xs text-muted-foreground">
                                  <p>First: {formatCandidateDate(candidate.firstSeenAt)}</p>
                                  <p>Last: {formatCandidateDate(candidate.lastSeenAt)}</p>
                                </td>
                                <td className="px-4 py-4 align-top">
                                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', newProductStatusClass(candidate.status))}>
                                    {NEW_PRODUCT_STATUS_LABELS[candidate.status]}
                                  </span>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    Confidence {candidate.confidenceScore}
                                  </p>
                                </td>
                                <td className="px-4 py-4 text-right align-top">
                                  {candidate.status === 'ready_to_add' || candidate.status === 'missing_upc' ? (
                                    <Button variant="outline" size="sm" onClick={() => openNewProductReviewModal(candidate)}>
                                      Review &amp; Save
                                    </Button>
                                  ) : candidate.status === 'duplicate_found' ? (
                                    <span className="inline-flex rounded-full bg-secondary px-2 py-1 text-xs font-semibold text-muted-foreground">
                                      Already in Products
                                    </span>
                                  ) : (
                                    <span className="inline-flex rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">
                                      Price Conflict
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'receiving' && (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Upload Invoice / Delivery</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a delivery CSV or text-based PDF. Photo OCR will be added as the next low-cost extraction step.
                </p>

                <div className="mt-5 grid gap-3">
                  <label
                    className={cn(
                      'flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center transition hover:bg-secondary/50',
                      productsWriteBlocked && 'cursor-not-allowed opacity-60 hover:bg-secondary/30'
                    )}
                  >
                    <Upload className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium text-foreground">Choose CSV, PDF, or image invoice</span>
                    <input
                      type="file"
                      accept=".csv,text/csv,application/pdf,image/*"
                      className="hidden"
                      onChange={(event) => handleInvoiceFile(event.target.files?.[0] || null)}
                      disabled={productsWriteBlocked}
                    />
                  </label>

                  <label
                    className={cn(
                      'flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-border p-4 text-center transition hover:bg-secondary/40',
                      productsWriteBlocked && 'cursor-not-allowed opacity-60 hover:bg-background'
                    )}
                  >
                    <Camera className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium text-foreground">Take invoice photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(event) => handleInvoiceFile(event.target.files?.[0] || null)}
                      disabled={productsWriteBlocked}
                    />
                  </label>
                </div>

                {invoiceFileName && (
                  <div className="mt-4 rounded-lg bg-secondary/40 p-3 text-sm">
                    <span className="font-medium text-foreground">Selected file: </span>
                    <span className="text-muted-foreground">{invoiceFileName}</span>
                  </div>
                )}

                <Button
                  className="mt-4 w-full"
                  onClick={() => void extractSelectedInvoice()}
                  disabled={!invoiceFile || extractingInvoice || productsWriteBlocked}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {extractingInvoice ? 'Extracting...' : 'Upload & Extract'}
                </Button>
              </div>

              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Invoice Total</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{formatCurrency(invoiceTotal)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{receivingLines.length} extracted lines</p>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Matched</p>
                    <p className="text-xl font-bold text-foreground">
                      {receivingLines.filter((line) => line.status === 'Matched').length}
                    </p>
                  </div>

                  <div className="rounded-lg bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">New</p>
                    <p className="text-xl font-bold text-foreground">
                      {receivingLines.filter((line) => line.status === 'New Product').length}
                    </p>
                  </div>

                  <div className="rounded-lg bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Review</p>
                    <p className="text-xl font-bold text-foreground">
                      {receivingLines.filter((line) => line.status === 'Needs Review').length}
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </Card>

          {receivingLines.length > 0 && (
            <Card className="p-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-foreground">Invoice Details</h2>
                <p className="text-sm text-muted-foreground">Name this invoice so you can find it later.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Invoice Name</span>
                  <Input
                    value={receiptName}
                    onChange={(event) => setReceiptName(event.target.value)}
                    placeholder="OK Wholesale delivery"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Invoice Number</span>
                  <Input
                    value={receiptInvoiceNumber}
                    onChange={(event) => setReceiptInvoiceNumber(event.target.value)}
                    placeholder="27225"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Invoice Vendor</span>
                  <select
                    value={receiptVendor}
                    onChange={(event) => {
                      const vendor = event.target.value;
                      setReceiptVendor(vendor);

                      setReceivingLines((previous) =>
                        previous.map((line) => ({
                          ...line,
                          vendor: line.vendor || vendor,
                        }))
                      );
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select vendor</option>
                    {vendorOptions.map((vendor) => (
                      <option key={vendor} value={vendor}>
                        {vendor}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Card>
          )}

          {receivingLines.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-foreground">
                    {editingHistoryId ? 'Edit Saved Invoice Items' : 'Review Extracted Items'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Correct rows before saving. Stock updates only after Save Receiving.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={addManualReceivingLine} disabled={productsWriteBlocked}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Row
                  </Button>

                  <Button onClick={() => void saveReceiving()} disabled={savingReceiving || productsWriteBlocked}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {savingReceiving ? 'Saving...' : editingHistoryId ? 'Update Receiving' : 'Save Receiving'}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 p-4">
                {receivingLines.map((line, index) => (
                  <Card key={line.id} className="p-4">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Item {index + 1}</p>
                        <p className="text-xs text-muted-foreground">Review and correct before saving.</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex rounded-md px-2 py-1 text-xs font-semibold',
                            line.status === 'Matched'
                              ? 'bg-success/10 text-success'
                              : line.status === 'New Product'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-destructive/10 text-destructive'
                          )}
                        >
                          {line.status}
                        </span>

                        <Button variant="outline" size="sm" onClick={() => removeReceivingLine(line.id)} disabled={productsWriteBlocked}>
                          <X className="mr-2 h-4 w-4" />
                          Remove
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <label className="space-y-1.5 xl:col-span-2">
                        <span className="text-xs font-medium text-muted-foreground">Product Name</span>
                        <Input
                          value={line.name}
                          onChange={(event) =>
                            updateReceivingLine(line.id, {
                              name: event.target.value,
                            })
                          }
                          placeholder="Product name"
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">UPC / Item Code</span>
                        <Input
                          value={line.upc}
                          onChange={(event) =>
                            updateReceivingLine(line.id, {
                              upc: event.target.value,
                            })
                          }
                          placeholder="UPC or item code"
                          className="font-mono"
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Department</span>
                        <select
                          value={line.department}
                          onChange={(event) =>
                            updateReceivingLine(line.id, {
                              department: event.target.value,
                            })
                          }
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {departments.map((department) => (
                            <option key={department} value={department}>
                              {department}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Vendor</span>
                        <select
                          value={line.vendor}
                          onChange={(event) =>
                            updateReceivingLine(line.id, {
                              vendor: event.target.value,
                            })
                          }
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">No vendor selected</option>
                          {vendorOptions.map((vendor) => (
                            <option key={vendor} value={vendor}>
                              {vendor}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Quantity</span>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={line.quantity}
                          onChange={(event) =>
                            updateReceivingLine(line.id, {
                              quantity: safeNumber(event.target.value),
                            })
                          }
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Unit Cost</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(event) =>
                            updateReceivingLine(line.id, {
                              unitCost: safeNumber(event.target.value),
                            })
                          }
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Total Cost</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.totalCost}
                          onChange={(event) =>
                            updateReceivingLine(line.id, {
                              totalCost: safeNumber(event.target.value),
                            })
                          }
                          className="font-semibold"
                        />
                      </label>
                    </div>
                  </Card>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'reorder' && (
        <div className="space-y-5">
          {!todayVendorNoticeDismissed && todayVendorReminders.length > 0 && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <Bell className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">Today:</span> {todayVendorReminders.join(' · ')}
                </p>
              </div>
              <button
                type="button"
                className="rounded p-0.5 text-amber-800 hover:bg-amber-100"
                onClick={() => setTodayVendorNoticeDismissed(true)}
                aria-label="Dismiss vendor reminder"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Critical</p>
              <p className="mt-2 text-2xl font-bold text-destructive">{reorderSummary.critical}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Soon</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{reorderSummary.soon}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Watch</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{reorderSummary.watch}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested Units</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(reorderSummary.suggestedUnits)}</p>
            </Card>
          </div>

          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={reorderSearch}
                  onChange={(event) => {
                    setReorderSearch(event.target.value);
                    setOpenVendorOrder(null);
                  }}
                  placeholder="Search vendor order by product, UPC, department, vendor, or priority..."
                  className="pl-9"
                />
              </div>

              <select
                value={reorderPriorityFilter}
                onChange={(event) => {
                  setReorderPriorityFilter(event.target.value as 'All' | ReorderPriority);
                  setOpenVendorOrder(null);
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="All">All priorities</option>
                <option value="Critical">Critical</option>
                <option value="Soon">Soon</option>
                <option value="Watch">Watch</option>
              </select>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Vendor Order List</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open a dedicated vendor order window and build a real order list.
                </p>

                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedReorderProductKeys.length > 0
                    ? `${selectedReorderProductKeys.length} item(s) currently added to order lists`
                    : 'No items added yet. Open a vendor and click Add to Order.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={selectCriticalReorders}>
                  Add Critical
                </Button>

                <Button variant="outline" size="sm" onClick={selectAllReorders}>
                  Add All Reorders
                </Button>

                <Button variant="outline" size="sm" onClick={clearReorderSelection}>
                  Clear All
                </Button>

                <Button size="sm" onClick={exportPurchaseOrder}>
                  <Download className="mr-2 h-4 w-4" />
                  Export All PO
                </Button>
              </div>
            </div>

            {vendorOrderGroups.length > 0 ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {vendorOrderGroups.map((group) => {
                  const selectedCount = items.filter((product) => {
                    const vendor = product.vendor || 'No vendor';
                    return vendor === group.vendor && selectedReorderSet.has(getProductIdentity(product));
                  }).length;

                  const isOpen = openVendorOrder === group.vendor;
                  const vendorSchedule = storeVendorMap.get(group.vendor);
                  const hasSchedule =
                    Boolean(vendorSchedule) &&
                    ((vendorSchedule?.order_days?.length || 0) > 0 ||
                      (vendorSchedule?.delivery_days?.length || 0) > 0 ||
                      vendorSchedule?.expected_invoice_amount != null ||
                      Boolean(vendorSchedule?.payment_terms));

                  return (
                    <Card
                      key={group.vendor}
                      className={cn(
                        'p-4 transition hover:bg-secondary/30',
                        isOpen && 'border-primary'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-foreground">{group.vendor}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {group.itemCount} reorder item(s) · {formatNumber(group.orderUnits)} suggested units
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            Estimated reorder cost: {formatCurrency(group.estimatedCost)}
                          </p>
                        </div>

                        {group.criticalCount > 0 && (
                          <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
                            {group.criticalCount} critical
                          </span>
                        )}
                      </div>

                      <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
                        <p>
                          Suggested: {formatNumber(group.suggestedUnits)} units · Current order list:{' '}
                          {selectedCount} item(s)
                        </p>
                        <p>Open vendor to add products, edit cases, and export.</p>
                      </div>

                      {vendorSchedule && hasSchedule && (
                        <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
                          {vendorSchedule.order_days && vendorSchedule.order_days.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-muted-foreground">Order:</span>
                              {vendorSchedule.order_days.map((day) => (
                                <span
                                  key={day}
                                  className="rounded-full border border-primary/40 px-1.5 py-0.5 font-medium text-primary"
                                >
                                  {formatDayAbbreviation(day)}
                                </span>
                              ))}
                            </div>
                          )}

                          {vendorSchedule.delivery_days &&
                            vendorSchedule.delivery_days.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium text-muted-foreground">Delivery:</span>
                                {vendorSchedule.delivery_days.map((day) => (
                                  <span
                                    key={day}
                                    className="rounded-full border border-amber-400/70 px-1.5 py-0.5 font-medium text-amber-700"
                                  >
                                    {formatDayAbbreviation(day)}
                                  </span>
                                ))}
                              </div>
                            )}

                          {(vendorSchedule.expected_invoice_amount != null ||
                            vendorSchedule.payment_terms) && (
                            <p className="text-muted-foreground">
                              {vendorSchedule.expected_invoice_amount != null && (
                                <span className="font-semibold text-emerald-700">
                                  Expected Invoice:{' '}
                                  {formatCurrency(vendorSchedule.expected_invoice_amount || 0)}
                                </span>
                              )}
                              {vendorSchedule.payment_terms && (
                                <span>
                                  {vendorSchedule.expected_invoice_amount != null ? ' · ' : ''}
                                  Terms: {vendorSchedule.payment_terms}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={isOpen ? 'default' : 'outline'}
                          onClick={() => {
                            setVendorProductSearch('');
                            setOpenVendorOrder(group.vendor);
                          }}
                        >
                          Open Vendor
                        </Button>

                        <Button size="sm" variant="outline" onClick={() => exportVendorPurchaseOrder(group.vendor)}>
                          <Download className="mr-2 h-4 w-4" />
                          Export
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No vendor order items match the current filters.
              </div>
            )}
          </Card>
        </div>
      )}

      {activeVendorOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-border p-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {activeVendorOrder.vendor} Order Window
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Search vendor products, add items to the order list, edit quantities, and export.
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  Current order list: {activeVendorOrderTotals.items} item(s) · {formatNumber(activeVendorOrderTotals.units)} units ·{' '}
                  {formatCurrency(activeVendorOrderTotals.cost)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedReorderProductKeys((previous) =>
                      Array.from(
                        new Set([
                          ...previous,
                          ...activeVendorOrder.insights.map((insight) => getProductIdentity(insight.product)).filter(Boolean),
                        ])
                      )
                    )
                  }
                >
                  Add Reorder Items
                </Button>

                <Button size="sm" variant="outline" onClick={clearActiveVendorOrder}>
                  Clear Vendor Order
                </Button>

                <Button size="sm" onClick={() => exportVendorPurchaseOrder(activeVendorOrder.vendor)}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Vendor PO
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setVendorProductSearch('');
                    setOpenVendorOrder(null);
                  }}
                >
                  <X className="mr-2 h-4 w-4" />
                  Close
                </Button>
              </div>
            </div>

            <div className="border-b border-border p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={vendorProductSearch}
                  onChange={(event) => setVendorProductSearch(event.target.value)}
                  placeholder={`Search ${activeVendorOrder.vendor} products by name, UPC, brand, or department...`}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden p-4">
              <div className="grid h-full gap-4 xl:grid-cols-[1fr_420px]">
                <div className="min-h-0 overflow-y-auto pr-1">
                  <div className="grid gap-4">
                    {openVendorProducts.length > 0 ? (
                      openVendorProducts.map((product) => {
                        const existingInsight = activeVendorOrder.insights.find(
                          (insight) => getProductIdentity(insight.product) === getProductIdentity(product)
                        );

                        const productKey = getProductIdentity(product);
                        const selected = selectedReorderSet.has(productKey);
                        const unitsPerCase = Number(product.unitsPerCase) || 1;

                        const suggestedQty =
                          existingInsight?.suggestedQty ||
                          Math.max(product.reorderLevel * 2 - product.stock, product.reorderLevel);

                        const defaultPlan = getCaseOrderPlan(suggestedQty, unitsPerCase);

                        return (
                          <Card
                            key={productKey}
                            className={cn(
                              'p-4',
                              selected && 'border-primary bg-primary/5',
                              !existingInsight && 'border-dashed'
                            )}
                          >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-semibold text-foreground">{product.name}</h3>

                                  {existingInsight ? (
                                    <span
                                      className={cn(
                                        'rounded-full px-2 py-1 text-xs font-semibold',
                                        priorityClass(existingInsight.priority)
                                      )}
                                    >
                                      {existingInsight.priority}
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-secondary px-2 py-1 text-xs font-semibold text-muted-foreground">
                                      Manual Add
                                    </span>
                                  )}

                                  {selected && (
                                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                                      In Order
                                    </span>
                                  )}
                                </div>

                                <p className="mt-1 font-mono text-xs text-muted-foreground">UPC {product.upc}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {product.department || product.category} · {product.brand || 'Unknown brand'}
                                </p>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant={selected ? 'default' : 'outline'}
                                  onClick={() => toggleReorderSelection(productKey)}
                                >
                                  {selected ? 'In Order' : 'Add to Order'}
                                </Button>

                                <Button size="sm" variant="outline" onClick={() => openEditModal(product)} disabled={productsWriteBlocked}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit
                                </Button>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              <div className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs text-muted-foreground">Current Stock</p>
                                <p className="mt-1 text-xl font-bold text-foreground">
                                  {formatNumber(product.stock)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatCaseBreakdown(product.stock, unitsPerCase)}
                                </p>
                              </div>

                              <div className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs text-muted-foreground">Units Per Case</p>
                                <p className="mt-1 text-xl font-bold text-foreground">
                                  {formatNumber(unitsPerCase)}
                                </p>
                                <p className="text-xs text-muted-foreground">Case pack size</p>
                              </div>

                              <div className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs text-muted-foreground">Suggested Order</p>
                                <p className="mt-1 text-xl font-bold text-foreground">
                                  {unitsPerCase <= 1
                                    ? `${formatNumber(defaultPlan.orderUnits)} units`
                                    : `${formatNumber(defaultPlan.casesToOrder)} cases`}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatNumber(defaultPlan.orderUnits)} units suggested
                                </p>
                              </div>

                              <div className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs text-muted-foreground">Estimated Cost</p>
                                <p className="mt-1 text-xl font-bold text-foreground">
                                  {formatCurrency(defaultPlan.orderUnits * product.costPrice)}
                                </p>
                                <p className="text-xs text-muted-foreground">Suggested cost</p>
                              </div>
                            </div>

                            {existingInsight && (
                              <div className="mt-3 rounded-lg border border-border p-3 text-sm">
                                <p className="font-medium text-foreground">Sales and delivery</p>
                                <p className="mt-1 text-muted-foreground">
                                  Sold last 30 days: {formatNumber(existingInsight.salesLast30Days)} · Days left:{' '}
                                  {existingInsight.daysLeft === null ? 'No trend' : `${existingInsight.daysLeft} days`}
                                </p>
                                <p className="mt-1 text-muted-foreground">
                                  Last delivery: {formatShortDate(existingInsight.lastDeliveryDate)}
                                  {existingInsight.lastDeliveryQty > 0
                                    ? ` · ${formatCaseBreakdown(existingInsight.lastDeliveryQty, unitsPerCase)} received`
                                    : ''}
                                </p>
                              </div>
                            )}
                          </Card>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        No products found for this vendor.
                      </div>
                    )}
                  </div>
                </div>

                <Card className="flex min-h-[420px] flex-col overflow-hidden">
                  <div className="border-b border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">Current Order List</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Items added for {activeVendorOrder.vendor}.
                        </p>
                      </div>

                      <Button size="sm" variant="outline" onClick={clearActiveVendorOrder}>
                        Clear
                      </Button>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-secondary/40 p-2">
                        <p className="text-xs text-muted-foreground">Items</p>
                        <p className="font-bold text-foreground">{activeVendorOrderTotals.items}</p>
                      </div>

                      <div className="rounded-lg bg-secondary/40 p-2">
                        <p className="text-xs text-muted-foreground">Units</p>
                        <p className="font-bold text-foreground">{formatNumber(activeVendorOrderTotals.units)}</p>
                      </div>

                      <div className="rounded-lg bg-secondary/40 p-2">
                        <p className="text-xs text-muted-foreground">Cost</p>
                        <p className="font-bold text-foreground">{formatCurrency(activeVendorOrderTotals.cost)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4">
                    {activeVendorOrderItems.length > 0 ? (
                      <div className="space-y-3">
                        {activeVendorOrderItems.map((item) => {
                          const productKey = getProductIdentity(item.product);

                          return (
                          <Card key={productKey} className="p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-foreground">{item.product.name}</p>
                                <p className="font-mono text-xs text-muted-foreground">UPC {item.product.upc}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {item.insight?.priority || 'Manual Add'} · {item.product.department || item.product.category}
                                </p>
                              </div>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => toggleReorderSelection(productKey)}
                              >
                                Remove
                              </Button>
                            </div>

                            <div className="mt-3 grid gap-3">
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1.5">
                                  <span className="text-xs font-medium text-muted-foreground">Cases</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="1"
                                    disabled={item.unitsPerCase <= 1}
                                    value={item.unitsPerCase <= 1 ? '0' : String(item.orderCases)}
                                    onChange={(event) => updateOrderCases(item.product, event.target.value)}
                                  />
                                </label>

                                <label className="space-y-1.5">
                                  <span className="text-xs font-medium text-muted-foreground">Units</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={String(item.orderUnits)}
                                    onChange={(event) => updateOrderUnits(productKey, event.target.value)}
                                  />
                                </label>
                              </div>

                              <div className="rounded-lg bg-secondary/40 p-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Order units</span>
                                  <span className="font-semibold text-foreground">{formatNumber(item.orderUnits)}</span>
                                </div>

                                <div className="mt-1 flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Estimated cost</span>
                                  <span className="font-semibold text-foreground">
                                    {formatCurrency(item.estimatedCost)}
                                  </span>
                                </div>

                                <p className="mt-2 text-xs text-muted-foreground">
                                  {item.unitsPerCase <= 1
                                    ? 'Ordered by unit.'
                                    : `${formatNumber(item.unitsPerCase)} units per case.`}
                                </p>
                              </div>
                            </div>
                          </Card>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        No items in this order yet. Click Add to Order on products from the left side.
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border p-4">
                    <Button
                      className="w-full"
                      disabled={!activeVendorOrderItems.length}
                      onClick={() => exportVendorPurchaseOrder(activeVendorOrder.vendor)}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Export Current Order
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'history' && (
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold text-foreground">Receiving History</h2>
            <p className="text-sm text-muted-foreground">
              {historyLoading ? 'Loading saved invoices...' : 'Review saved invoices, source files, and received items.'}
            </p>
          </div>

          <div className="border-b border-border p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="Search by invoice name, invoice number, vendor, or file name..."
                  className="pl-9"
                />
              </div>

              <select
                value={historyVendorFilter}
                onChange={(event) => setHistoryVendorFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="All">All vendors</option>
                {historyVendorOptions.map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredReceivingHistory.length > 0 ? (
            <div className="divide-y divide-border">
              {filteredReceivingHistory.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                      <History className="h-4 w-4" />
                    </div>

                    <div>
                      <p className="font-semibold text-foreground">{entry.receiptName || entry.fileName}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(entry.date).toLocaleDateString()} · {entry.vendor} · {entry.itemCount} items
                        {entry.invoiceNumber ? ` · Invoice #${entry.invoiceNumber}` : ''}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{formatCurrency(entry.totalAmount)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!entry.sourcePath && !entry.sourceUrl}
                      onClick={() => void openHistorySource(entry)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View Source
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={productsWriteBlocked}
                      onClick={() => {
                        setReceivingLines(entry.lines || []);
                        setInvoiceFileName(entry.fileName);
                        setReceiptName(entry.receiptName || entry.fileName);
                        setReceiptInvoiceNumber(entry.invoiceNumber || '');
                        setReceiptVendor(entry.vendor || '');
                        setInvoicePreviewUrl(entry.sourceUrl || '');
                        setInvoiceSourceKind(entry.sourceKind || 'unknown');
                        setEditingHistoryId(entry.id);
                        setReceivingMessage('Loaded saved invoice for editing. Review changes before updating receiving.');
                        setActiveTab('receiving');
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Items
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={productsWriteBlocked}
                      onClick={() => void deleteHistoryEntry(entry)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">No receiving history found.</div>
          )}
        </Card>
      )}

      {selectedHistoryEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Invoice Source</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedHistoryEntry.receiptName || selectedHistoryEntry.fileName}
                </p>
              </div>

              <Button variant="ghost" size="icon" onClick={() => setSelectedHistoryEntry(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-[70vh] overflow-auto bg-secondary/30 p-4">
              {selectedHistoryEntry.sourceUrl ? (
                selectedHistoryEntry.sourceKind === 'image' ? (
                  <img
                    src={selectedHistoryEntry.sourceUrl}
                    alt={selectedHistoryEntry.fileName}
                    className="mx-auto max-h-[75vh] max-w-full rounded-lg border border-border bg-background object-contain"
                  />
                ) : (
                  <iframe
                    src={selectedHistoryEntry.sourceUrl}
                    title={selectedHistoryEntry.fileName}
                    className="h-[75vh] w-full rounded-lg border border-border bg-background"
                  />
                )
              ) : (
                <div className="rounded-lg border border-border bg-background p-6 text-sm text-muted-foreground">
                  Source preview is not available for this saved invoice.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {reviewingNewProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget && !savingNewProduct) resetNewProductReviewModal();
          }}
        >
          <Card className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Review New Product</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Confirm POS source details and complete the product fields before saving.
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={resetNewProductReviewModal}
                disabled={savingNewProduct}
                aria-label="Close review modal"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                <section className="rounded-xl border border-border bg-secondary/30 p-4">
                  <h3 className="font-semibold text-foreground">From POS Import</h3>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PLU</dt>
                      <dd className="mt-1 font-medium text-foreground">{reviewingNewProduct.pluRaw || reviewingNewProduct.pluNormalized || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">UPC from POS</dt>
                      <dd className="mt-1 font-medium text-foreground">{reviewingNewProduct.upcNormalized || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">POS description</dt>
                      <dd className="mt-1 font-medium text-foreground">{reviewingNewProduct.description || '-'}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">POS price</dt>
                        <dd className="mt-1 font-medium text-foreground">{formatCurrency(reviewingNewProduct.unitPrice)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Times sold</dt>
                        <dd className="mt-1 font-medium text-foreground">{formatNumber(reviewingNewProduct.timesSold)}</dd>
                      </div>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total revenue</dt>
                      <dd className="mt-1 font-medium text-foreground">{formatCurrency(reviewingNewProduct.totalRevenue)}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">First seen</dt>
                        <dd className="mt-1 font-medium text-foreground">{formatCandidateDate(reviewingNewProduct.firstSeenAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last seen</dt>
                        <dd className="mt-1 font-medium text-foreground">{formatCandidateDate(reviewingNewProduct.lastSeenAt)}</dd>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Confidence</dt>
                        <dd className="mt-1 font-medium text-foreground">{reviewingNewProduct.confidenceScore} / 100</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
                        <dd className="mt-1">
                          <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', newProductStatusClass(reviewingNewProduct.status))}>
                            {NEW_PRODUCT_STATUS_LABELS[reviewingNewProduct.status]}
                          </span>
                        </dd>
                      </div>
                    </div>
                  </dl>
                </section>

                <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="font-semibold text-foreground">Product Details</h3>
                  </div>
                  <ProductForm
                    mode="new_product_review"
                    form={newProductReviewForm}
                    setForm={setNewProductReviewForm}
                    onSubmit={() => void saveReviewedNewProduct()}
                    onCancel={resetNewProductReviewModal}
                    saving={savingNewProduct}
                    error={newProductReviewError}
                    departmentOptions={departments}
                    vendorOptions={allVendorOptions}
                    taxCategoryOptions={taxCategoryOptions}
                    ageRestrictionOptions={ageRestrictionPresets}
                    upcDuplicate={null}
                    pluDuplicate={null}
                    productCodeDuplicate={null}
                    onUpcChange={handleNewProductReviewUpcChange}
                    onNameChange={handleNewProductReviewNameChange}
                    onUpcBlur={() => undefined}
                    onPluBlur={() => undefined}
                    onProductCodeBlur={() => undefined}
                    submitLabel={savingNewProduct ? 'Saving...' : 'Save Product'}
                    fieldErrors={newProductReviewFieldErrors}
                    upcInputRef={newProductUpcInputRef}
                    upcHelperText={
                      reviewingNewProduct.status === 'missing_upc'
                        ? 'This product has no UPC from the POS report. Enter a UPC, PLU, or Product Code to save it to your store.'
                        : undefined
                    }
                  />
                </section>
              </div>
            </div>
          </Card>
        </div>
      )}

      <ProductModal
        open={modalOpen}
        mode={modalMode}
        form={form}
        setForm={setForm}
        onClose={() => {
          if (!saving) closeProductModal();
        }}
        onSave={saveProduct}
        saving={saving}
        error={formError}
        departments={departments}
        vendors={allVendorOptions}
        taxCategoryOptions={taxCategoryOptions}
        ageRestrictionPresets={ageRestrictionPresets}
        upcDuplicate={upcDuplicate}
        pluDuplicate={pluDuplicate}
        productCodeDuplicate={productCodeDuplicate}
        onUpcChange={handleProductUpcChange}
        onNameChange={handleProductNameChange}
        onUpcBlur={() => checkUpcDuplicate()}
        onPluBlur={checkPluDuplicate}
        onProductCodeBlur={checkProductCodeDuplicate}
        writeBlocked={productsWriteBlocked}
      />
    </DashboardShell>
  );
}

