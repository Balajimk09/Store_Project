'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgePercent,
  Building2,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Download,
  FileUp,
  Globe,
  LayoutGrid,
  Loader2,
  Percent,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Tag,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { parseCsvText } from '@/lib/csv';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type TabKey = 'tax' | 'deals' | 'departments' | 'categories' | 'vendors' | 'age-restrictions' | 'payment-methods' | 'discount-rules';
type ModalType = 'tax' | 'deal' | 'department' | 'category' | 'vendor' | 'age' | null;
type ModalMode = 'add' | 'edit';
type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly';

type PaymentMethod = {
  name: string;
  enabled: boolean;
};

type DiscountRule = {
  name: string;
  percent: number;
  enabled: boolean;
};

type StoreSettingsRow = {
  id: string;
  store_id: string;
  default_tax_rate: number | null;
  default_tax_category: string | null;
  default_reorder_level: number | null;
  currency_code: string | null;
  price_rounding: string | null;
  tax_registration_number: string | null;
  payment_methods: PaymentMethod[] | null;
  discount_rules: DiscountRule[] | null;
  created_at: string | null;
  updated_at: string | null;
};

type PromotionProductRow = {
  id: string;
  store_id: string;
  promotion_id: string;
  product_id: string | null;
  upc: string | null;
  item_name: string | null;
  created_at: string;
};

type PromotionDepartmentRow = {
  id: string;
  store_id: string;
  promotion_id: string;
  department_id: string;
  created_at: string;
};

type PromotionCategoryRow = {
  id: string;
  store_id: string;
  promotion_id: string;
  category_id: string;
  created_at: string;
};

type VendorPromotionRow = {
  id: string;
  title: string;
  vendor_name: string | null;
  description: string | null;
  promotion_type: string;
  status: string;
  product_keywords: string[] | null;
  target_store_notes: string | null;
  internal_notes: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

type ProductRow = Record<string, unknown> & {
  id?: string;
};

type TaxCategory = {
  id: string;
  store_id: string;
  name: string;
  rate: number;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type Promotion = {
  id: string;
  store_id: string;
  name: string;
  deal_type: string;
  quantity_required: number;
  deal_price: number;
  start_date: string | null;
  end_date: string | null;
  tax_category_id: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type StoreDepartment = {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  ebt_eligible: boolean;
  is_active: boolean;
  tax_category_id: string | null;
  age_restriction_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StoreCategory = {
  id: string;
  store_id: string;
  name: string;
  department_id: string | null;
  ebt_eligible: boolean;
  is_active: boolean;
  tax_category_id: string | null;
  age_restriction_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StoreVendor = {
  id: string;
  store_id: string;
  vendor_name: string;
  sales_rep_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  order_days: string[] | null;
  delivery_days: string[] | null;
  expected_invoice_amount: number | null;
  payment_terms: string | null;
  notification_enabled: boolean | null;
  schedule_frequency: ScheduleFrequency | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type GlobalVendor = {
  id: string;
  vendor_name: string;
  sales_rep_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  order_days: string[] | null;
  delivery_days: string[] | null;
  expected_invoice_amount: number | null;
  payment_terms: string | null;
  notification_enabled: boolean | null;
  schedule_frequency: ScheduleFrequency | null;
  is_active: boolean;
};

type AgeRestrictionPreset = {
  id: string;
  store_id: string;
  name: string;
  minimum_age: number;
  restriction_type: string;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type TaxForm = {
  name: string;
  rate: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
};

type DealForm = {
  name: string;
  dealType: string;
  quantityRequired: string;
  dealPrice: string;
  startDate: string;
  endDate: string;
  taxCategoryId: string;
  departmentIds: string[];
  categoryIds: string[];
  isActive: boolean;
};

type DepartmentForm = {
  name: string;
  description: string;
  ebtEligible: boolean;
  isActive: boolean;
  taxCategoryId: string;
  ageRestrictionId: string;
};

type CategoryForm = {
  name: string;
  departmentId: string;
  ebtEligible: boolean;
  isActive: boolean;
  taxCategoryId: string;
  ageRestrictionId: string;
};

type VendorForm = {
  vendorName: string;
  salesRepName: string;
  phone: string;
  email: string;
  website: string;
  category: string;
  notes: string;
  orderDays: string[];
  deliveryDays: string[];
  expectedInvoiceAmount: string;
  paymentTerms: string;
  notificationEnabled: boolean;
  scheduleFrequency: ScheduleFrequency;
  isActive: boolean;
};

type AgeForm = {
  name: string;
  minimumAge: string;
  restrictionType: string;
  isActive: boolean;
};

type ImportRow = Record<string, string>;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEAL_TYPES = ['buy_x_get_y', 'fixed_price', 'percentage_off', 'bundle'];
const FREQUENCIES: ScheduleFrequency[] = ['weekly', 'biweekly', 'monthly'];

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { name: 'Cash', enabled: true },
  { name: 'Credit', enabled: true },
  { name: 'Debit', enabled: true },
  { name: 'EBT', enabled: false },
  { name: 'WIC', enabled: false },
  { name: 'Mobile Pay', enabled: false },
  { name: 'Check', enabled: false },
  { name: 'Fuel Card', enabled: false },
  { name: 'Fleet Card', enabled: false },
  { name: 'Gift Card', enabled: false },
];

const DEFAULT_DISCOUNT_RULES: DiscountRule[] = [
  { name: 'Employee Discount', percent: 10, enabled: false },
  { name: 'Senior Discount', percent: 5, enabled: false },
  { name: 'Military Discount', percent: 10, enabled: false },
];

const DEFAULT_AGE_PRESETS = [
  { name: 'Alcohol', minimum_age: 21, restriction_type: 'alcohol' },
  { name: 'Tobacco', minimum_age: 21, restriction_type: 'tobacco' },
  { name: 'Vape / E-Cigarettes', minimum_age: 21, restriction_type: 'vape' },
  { name: 'Lottery', minimum_age: 18, restriction_type: 'lottery' },
  { name: 'Adult Publications', minimum_age: 18, restriction_type: 'adult_content' },
  { name: 'CBD Products', minimum_age: 18, restriction_type: 'cbd' },
  { name: 'Energy Drinks', minimum_age: 18, restriction_type: 'energy_drinks' },
];

const emptyTax: TaxForm = { name: '', rate: '0', description: '', isDefault: false, isActive: true };
const emptyDeal: DealForm = {
  name: '',
  dealType: 'fixed_price',
  quantityRequired: '2',
  dealPrice: '',
  startDate: '',
  endDate: '',
  taxCategoryId: '',
  departmentIds: [],
  categoryIds: [],
  isActive: true,
};
const emptyDepartment: DepartmentForm = { name: '', description: '', ebtEligible: false, isActive: true, taxCategoryId: '', ageRestrictionId: '' };
const emptyCategory: CategoryForm = { name: '', departmentId: '', ebtEligible: false, isActive: true, taxCategoryId: '', ageRestrictionId: '' };
const emptyVendor: VendorForm = {
  vendorName: '',
  salesRepName: '',
  phone: '',
  email: '',
  website: '',
  category: '',
  notes: '',
  orderDays: [],
  deliveryDays: [],
  expectedInvoiceAmount: '',
  paymentTerms: '',
  notificationEnabled: true,
  scheduleFrequency: 'weekly',
  isActive: true,
};
const emptyAge: AgeForm = { name: '', minimumAge: '21', restrictionType: '', isActive: true };

function formatSupabaseError(error: unknown, fallback = 'Operation failed.') {
  if (!error) return fallback;
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const formatted = [
      e.message,
      e.details,
      e.hint,
      e.code ? `Code: ${e.code}` : null,
    ].filter(Boolean).map(String).join(' ');
    if (formatted) return formatted;
  }
  if (error instanceof Error) return error.message;
  return String(error || fallback);
}

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function percent(value: number) {
  return `${Number(value || 0).toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function dateLabel(value: string | null) {
  if (!value) return 'No date';
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function cleanText(value: string | null | undefined) {
  return String(value || '').trim();
}

function productValue(product: ProductRow, key: string) {
  const value = product[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function getProductName(product: ProductRow) {
  return productValue(product, 'item_name') || productValue(product, 'item') || productValue(product, 'name') || 'Unnamed product';
}

function getProductUpc(product: ProductRow) {
  return productValue(product, 'upc') || productValue(product, 'UPC') || productValue(product, 'barcode');
}

function getProductSearchText(product: ProductRow) {
  return [
    productValue(product, 'item_name'),
    productValue(product, 'item'),
    productValue(product, 'name'),
    productValue(product, 'upc'),
    productValue(product, 'UPC'),
    productValue(product, 'barcode'),
    productValue(product, 'category'),
    productValue(product, 'department'),
    productValue(product, 'brand'),
    productValue(product, 'vendor'),
  ].filter(Boolean).join(' ').toLowerCase();
}

function taxName(taxes: TaxCategory[], taxId: string | null | undefined) {
  if (!taxId) return 'No tax override';
  return taxes.find((tax) => tax.id === taxId)?.name || 'Unknown tax';
}

function ageRestrictionName(agePresets: AgeRestrictionPreset[], ageId: string | null | undefined) {
  if (!ageId) return 'None';
  const preset = agePresets.find((item) => item.id === ageId);
  return preset ? `${preset.name} (${preset.minimum_age}+)` : 'Unknown restriction';
}

function normalizeDealType(value: string | null | undefined) {
  const normalized = String(value || '').toLowerCase().trim();
  if (DEAL_TYPES.includes(normalized)) return normalized;
  if (normalized.includes('fixed')) return 'fixed_price';
  if (normalized.includes('bundle')) return 'bundle';
  if (normalized.includes('percent')) return 'percentage_off';
  return 'buy_x_get_y';
}

function validPaymentMethods(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PAYMENT_METHODS;
  const rows = value
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null;
      const row = item as { name?: unknown; enabled?: unknown };
      const name = String(row.name || '').trim();
      if (!name) return null;
      return { name, enabled: row.enabled === true };
    })
    .filter((item): item is PaymentMethod => Boolean(item));
  return rows.length ? rows : DEFAULT_PAYMENT_METHODS;
}

function validDiscountRules(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_DISCOUNT_RULES;
  const rows = value
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null;
      const row = item as { name?: unknown; percent?: unknown; enabled?: unknown };
      const name = String(row.name || '').trim();
      const percentValue = Number(row.percent);
      if (!name || !Number.isFinite(percentValue)) return null;
      return { name, percent: percentValue, enabled: row.enabled === true };
    })
    .filter((item): item is DiscountRule => Boolean(item));
  return rows.length ? rows : DEFAULT_DISCOUNT_RULES;
}

function parseBoolean(value: string | undefined, fallback = true) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'active'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'inactive'].includes(normalized)) return false;
  return fallback;
}

function parseDays(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/[|,]/)
    .map((day) => day.trim())
    .filter((day) => WEEKDAYS.includes(day));
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function rowsFromCsv(text: string): ImportRow[] {
  const rows = parseCsvText(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) => {
    const output: ImportRow = {};
    headers.forEach((header, index) => {
      output[header] = String(row[index] ?? '').trim();
    });
    return output;
  });
}

function rowText(row: ImportRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value) return value;
  }
  return '';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <select
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map(([optionValue, label]) => (
        <option key={`${optionValue}-${label}`} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={cn('rounded-full px-2 py-1 text-xs font-semibold', active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function StoreSettingsPage() {
  const { user, loading: authLoading, activeStoreId } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('tax');
  const [modalType, setModalType] = useState<ModalType>(null);
  const [modalMode, setModalMode] = useState<ModalMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [taxes, setTaxes] = useState<TaxCategory[]>([]);
  const [deals, setDeals] = useState<Promotion[]>([]);
  const [departments, setDepartments] = useState<StoreDepartment[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [vendors, setVendors] = useState<StoreVendor[]>([]);
  const [globalVendors, setGlobalVendors] = useState<GlobalVendor[]>([]);
  const [agePresets, setAgePresets] = useState<AgeRestrictionPreset[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettingsRow | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [dealProducts, setDealProducts] = useState<Record<string, PromotionProductRow[]>>({});
  const [dealDepartments, setDealDepartments] = useState<Record<string, PromotionDepartmentRow[]>>({});
  const [dealCategories, setDealCategories] = useState<Record<string, PromotionCategoryRow[]>>({});
  const [globalPromos, setGlobalPromos] = useState<VendorPromotionRow[]>([]);

  const [taxForm, setTaxForm] = useState<TaxForm>(emptyTax);
  const [dealForm, setDealForm] = useState<DealForm>(emptyDeal);
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm>(emptyDepartment);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategory);
  const [vendorForm, setVendorForm] = useState<VendorForm>(emptyVendor);
  const [ageForm, setAgeForm] = useState<AgeForm>(emptyAge);

  const [dealSearch, setDealSearch] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorStatus, setVendorStatus] = useState('all');
  const [vendorFrequency, setVendorFrequency] = useState('all');
  const [vendorCategory, setVendorCategory] = useState('');
  const [globalPanelOpen, setGlobalPanelOpen] = useState(false);
  const [ageImportOpen, setAgeImportOpen] = useState(false);
  const [selectedDefaultAges, setSelectedDefaultAges] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(DEFAULT_PAYMENT_METHODS);
  const [customPaymentMethod, setCustomPaymentMethod] = useState('');
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>(DEFAULT_DISCOUNT_RULES);
  const [newDiscountName, setNewDiscountName] = useState('');
  const [newDiscountPercent, setNewDiscountPercent] = useState('');
  const [managingProductsForDeal, setManagingProductsForDeal] = useState<string | null>(null);
  const [dealProductSearch, setDealProductSearch] = useState('');
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showGlobalPromos, setShowGlobalPromos] = useState(false);
  const [globalPromoSearch, setGlobalPromoSearch] = useState('');
  const [loadingGlobalPromos, setLoadingGlobalPromos] = useState(false);

  const selectedStoreId = activeStoreId;
  const blocked = !selectedStoreId;
  const activeTaxes = taxes.filter((tax) => tax.is_active);
  const activeDepartments = departments.filter((department) => department.is_active);
  const activeCategories = categories.filter((category) => category.is_active);
  const activeAgeRestrictions = agePresets.filter((preset) => preset.is_active);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    window.setTimeout(() => setSuccessMessage(null), 3000);
  };

  const setErrorFrom = (context: string, error: unknown) => {
    console.error(context, error);
    setPageError(formatSupabaseError(error));
  };

  const loadSettings = useCallback(async () => {
    if (authLoading) return;

    if (!user || !selectedStoreId) {
      setTaxes([]);
      setDeals([]);
      setDepartments([]);
      setCategories([]);
      setVendors([]);
      setGlobalVendors([]);
      setAgePresets([]);
      setStoreSettings(null);
      setProducts([]);
      setDealProducts({});
      setDealDepartments({});
      setDealCategories({});
      setTaxRegistrationNumber('');
      setPaymentMethods(DEFAULT_PAYMENT_METHODS);
      setDiscountRules(DEFAULT_DISCOUNT_RULES);
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError(null);

    try {
      const [
        taxResult,
        dealResult,
        departmentResult,
        categoryResult,
        vendorResult,
        globalVendorResult,
        ageResult,
        settingsResult,
        productResult,
        dealProductResult,
        dealDepartmentResult,
        dealCategoryResult,
      ] = await Promise.all([
        supabase.from('tax_categories').select('*').eq('store_id', selectedStoreId).order('name'),
        supabase.from('promotions').select('*').eq('store_id', selectedStoreId).order('created_at', { ascending: false }),
        supabase.from('store_departments').select('*').eq('store_id', selectedStoreId).order('name'),
        supabase.from('store_categories').select('*').eq('store_id', selectedStoreId).order('name'),
        supabase.from('store_vendors').select('*').eq('store_id', selectedStoreId).order('vendor_name'),
        supabase.from('global_vendors').select('*').eq('is_active', true).order('vendor_name'),
        supabase.from('store_age_restriction_presets').select('*').eq('store_id', selectedStoreId).order('name'),
        supabase.from('store_settings').select('*').eq('store_id', selectedStoreId).maybeSingle(),
        supabase.from('products').select('*').eq('store_id', selectedStoreId).limit(200),
        supabase.from('promotion_products').select('*').eq('store_id', selectedStoreId),
        supabase.from('promotion_departments').select('*').eq('store_id', selectedStoreId),
        supabase.from('promotion_categories').select('*').eq('store_id', selectedStoreId),
      ]);

      if (taxResult.error) throw taxResult.error;
      if (dealResult.error) throw dealResult.error;
      if (departmentResult.error) throw departmentResult.error;
      if (categoryResult.error) throw categoryResult.error;
      if (vendorResult.error) throw vendorResult.error;
      if (globalVendorResult.error) throw globalVendorResult.error;
      if (ageResult.error) throw ageResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (productResult.error) throw productResult.error;
      if (dealProductResult.error) throw dealProductResult.error;
      if (dealDepartmentResult.error) throw dealDepartmentResult.error;
      if (dealCategoryResult.error) throw dealCategoryResult.error;

      setTaxes((taxResult.data || []) as TaxCategory[]);
      setDeals((dealResult.data || []) as Promotion[]);
      setDepartments((departmentResult.data || []) as StoreDepartment[]);
      setCategories((categoryResult.data || []) as StoreCategory[]);
      setVendors((vendorResult.data || []) as StoreVendor[]);
      setGlobalVendors((globalVendorResult.data || []) as GlobalVendor[]);
      setAgePresets((ageResult.data || []) as AgeRestrictionPreset[]);
      setProducts((productResult.data || []) as ProductRow[]);

      const settings = (settingsResult.data as StoreSettingsRow | null) || null;
      setStoreSettings(settings);
      setTaxRegistrationNumber(settings?.tax_registration_number || '');
      setPaymentMethods(validPaymentMethods(settings?.payment_methods));
      setDiscountRules(validDiscountRules(settings?.discount_rules));

      const groupedProducts: Record<string, PromotionProductRow[]> = {};
      ((dealProductResult.data || []) as PromotionProductRow[]).forEach((row) => {
        groupedProducts[row.promotion_id] = [...(groupedProducts[row.promotion_id] || []), row];
      });
      setDealProducts(groupedProducts);

      const groupedDepartments: Record<string, PromotionDepartmentRow[]> = {};
      ((dealDepartmentResult.data || []) as PromotionDepartmentRow[]).forEach((row) => {
        groupedDepartments[row.promotion_id] = [...(groupedDepartments[row.promotion_id] || []), row];
      });
      setDealDepartments(groupedDepartments);

      const groupedCategories: Record<string, PromotionCategoryRow[]> = {};
      ((dealCategoryResult.data || []) as PromotionCategoryRow[]).forEach((row) => {
        groupedCategories[row.promotion_id] = [...(groupedCategories[row.promotion_id] || []), row];
      });
      setDealCategories(groupedCategories);
    } catch (error) {
      setErrorFrom('[Store Settings Load Error]', error);
    } finally {
      setLoading(false);
    }
  }, [authLoading, selectedStoreId, user]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setModalType(null);
    setEditingId(null);
    setPageError(null);
    setSuccessMessage(null);
    setAgeImportOpen(false);
    setGlobalPanelOpen(false);
    setManagingProductsForDeal(null);
    setShowImportMenu(false);
    setShowGlobalPromos(false);
    setImportSummary(null);
  }, [selectedStoreId]);

  const taxOptions: Array<[string, string]> = useMemo(
    () => [['', 'No tax override'], ...activeTaxes.map((tax): [string, string] => [tax.id, `${tax.name} (${percent(tax.rate)})`])],
    [activeTaxes]
  );

  const departmentOptions: Array<[string, string]> = useMemo(
    () => [['', 'No department'], ...activeDepartments.map((department): [string, string] => [department.id, department.name])],
    [activeDepartments]
  );

  const ageRestrictionOptions: Array<[string, string]> = useMemo(
    () => [['', 'No age restriction'], ...activeAgeRestrictions.map((preset): [string, string] => [preset.id, `${preset.name} (${preset.minimum_age}+)`])],
    [activeAgeRestrictions]
  );

  const vendorCategories = useMemo(
    () => Array.from(new Set(vendors.map((vendor) => cleanText(vendor.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [vendors]
  );

  const filteredDeals = useMemo(() => {
    const query = dealSearch.trim().toLowerCase();
    if (!query) return deals;
    return deals.filter((deal) => [deal.name, deal.deal_type, taxName(taxes, deal.tax_category_id)].join(' ').toLowerCase().includes(query));
  }, [dealSearch, deals, taxes]);

  const attachedProductsForDeal = useMemo(
    () => (managingProductsForDeal ? dealProducts[managingProductsForDeal] || [] : []),
    [dealProducts, managingProductsForDeal]
  );

  const availableDealProducts = useMemo(() => {
    const query = dealProductSearch.trim().toLowerCase();
    const source = Array.isArray(products) ? products : [];
    return source
      .filter((product) => {
        const productUpc = getProductUpc(product);
        return !attachedProductsForDeal.some((attached) => {
          if (product.id && attached.product_id === product.id) return true;
          if (productUpc && attached.upc === productUpc) return true;
          return false;
        });
      })
      .filter((product) => {
        if (!query) return true;
        return getProductSearchText(product).includes(query);
      })
      .slice(0, 50);
  }, [attachedProductsForDeal, dealProductSearch, products]);

  const filteredGlobalPromos = useMemo(() => {
    const query = globalPromoSearch.trim().toLowerCase();
    if (!query) return globalPromos;
    return globalPromos.filter((promo) => [
      promo.title,
      promo.vendor_name,
      promo.description,
      promo.promotion_type,
      promo.status,
      ...(promo.product_keywords || []),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }, [globalPromoSearch, globalPromos]);

  const filteredVendors = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase();
    return vendors.filter((vendor) => {
      if (vendorStatus === 'active' && !vendor.is_active) return false;
      if (vendorStatus === 'inactive' && vendor.is_active) return false;
      if (vendorFrequency !== 'all' && vendor.schedule_frequency !== vendorFrequency) return false;
      if (vendorCategory && vendor.category !== vendorCategory) return false;
      if (!query) return true;
      return [
        vendor.vendor_name,
        vendor.sales_rep_name,
        vendor.phone,
        vendor.email,
        vendor.website,
        vendor.category,
        vendor.notes,
      ].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [vendorCategory, vendorFrequency, vendorSearch, vendorStatus, vendors]);

  const requireStore = () => {
    if (!selectedStoreId) {
      setPageError('Select a specific store to manage store settings.');
      return null;
    }
    return selectedStoreId;
  };

  const saveStoreSettings = async (updates: Record<string, unknown>, message = 'Settings saved.') => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    setPageError(null);
    try {
      const { error } = await supabase.from('store_settings').upsert(
        {
          store_id: storeId,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'store_id' }
      );
      if (error) throw error;
      await loadSettings();
      showSuccess(message);
    } catch (error) {
      setErrorFrom('[Store Settings Save Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const openAddModal = (type: ModalType) => {
    if (!requireStore()) return;
    setModalType(type);
    setModalMode('add');
    setEditingId(null);
    setPageError(null);
    if (type === 'tax') setTaxForm(emptyTax);
    if (type === 'deal') setDealForm(emptyDeal);
    if (type === 'department') setDepartmentForm(emptyDepartment);
    if (type === 'category') setCategoryForm(emptyCategory);
    if (type === 'vendor') setVendorForm(emptyVendor);
    if (type === 'age') setAgeForm(emptyAge);
  };

  const closeModal = () => {
    if (saving) return;
    setModalType(null);
    setEditingId(null);
    setPageError(null);
  };

  const saveTax = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const name = taxForm.name.trim();
    const rate = Number(taxForm.rate);
    if (!name) return setPageError('Tax name is required.');
    if (!Number.isFinite(rate) || rate < 0) return setPageError('Tax percentage must be valid.');

    setSaving(true);
    setPageError(null);
    try {
      if (taxForm.isDefault) {
        const { error } = await supabase.from('tax_categories').update({ is_default: false, updated_at: new Date().toISOString() }).eq('store_id', storeId);
        if (error) throw error;
      }

      const payload = {
        store_id: storeId,
        name,
        rate,
        description: taxForm.description.trim() || null,
        is_default: taxForm.isDefault,
        is_active: taxForm.isActive,
        updated_at: new Date().toISOString(),
      };

      const result = modalMode === 'edit' && editingId
        ? await supabase.from('tax_categories').update(payload).eq('id', editingId).eq('store_id', storeId)
        : await supabase.from('tax_categories').upsert(payload, { onConflict: 'store_id,name' });
      if (result.error) throw result.error;

      if (taxForm.isDefault) {
        const { error } = await supabase.from('store_settings').upsert(
          {
            store_id: storeId,
            default_tax_category: name,
            default_tax_rate: rate,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'store_id' }
        );
        if (error) throw error;
      }

      closeModal();
      showSuccess(modalMode === 'edit' ? 'Tax updated.' : 'Tax saved.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Tax Save Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const setTaxAsDefault = async (tax: TaxCategory) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    setPageError(null);
    try {
      const { error: clearError } = await supabase.from('tax_categories').update({ is_default: false, updated_at: new Date().toISOString() }).eq('store_id', storeId);
      if (clearError) throw clearError;
      const { error: setError } = await supabase.from('tax_categories').update({ is_default: true, updated_at: new Date().toISOString() }).eq('id', tax.id).eq('store_id', storeId);
      if (setError) throw setError;
      const { error: settingsError } = await supabase.from('store_settings').upsert(
        { store_id: storeId, default_tax_category: tax.name, default_tax_rate: tax.rate, updated_at: new Date().toISOString() },
        { onConflict: 'store_id' }
      );
      if (settingsError) throw settingsError;
      showSuccess('Default tax updated.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Default Tax Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteTax = async (tax: TaxCategory) => {
    const storeId = requireStore();
    if (!storeId) return;
    if (tax.is_default) return setPageError('Default tax cannot be deleted. Set another tax as default first.');
    if (!window.confirm(`Delete tax category "${tax.name}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('tax_categories').delete().eq('id', tax.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Tax deleted.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Tax Delete Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleTax = async (tax: TaxCategory) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('tax_categories').update({ is_active: !tax.is_active, updated_at: new Date().toISOString() }).eq('id', tax.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Tax updated.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Tax Toggle Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const saveDeal = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const name = dealForm.name.trim();
    const quantity = Number(dealForm.quantityRequired);
    const price = Number(dealForm.dealPrice);
    if (!name) return setPageError('Deal name is required.');
    if (!Number.isFinite(quantity) || quantity < 1) return setPageError('Quantity required must be valid.');
    if (!Number.isFinite(price) || price < 0) return setPageError('Deal price must be valid.');

    setSaving(true);
    setPageError(null);
    try {
      const payload = {
        store_id: storeId,
        name,
        deal_type: dealForm.dealType,
        quantity_required: quantity,
        deal_price: price,
        start_date: dealForm.startDate || null,
        end_date: dealForm.endDate || null,
        tax_category_id: dealForm.taxCategoryId || null,
        is_active: dealForm.isActive,
        updated_at: new Date().toISOString(),
      };
      const result = modalMode === 'edit' && editingId
        ? await supabase.from('promotions').update(payload).eq('id', editingId).eq('store_id', storeId).select('id').single()
        : await supabase.from('promotions').insert(payload).select('id').single();
      if (result.error) throw result.error;
      const promotionId = editingId || (result.data as { id: string }).id;
      await replacePromotionLinks(promotionId, dealForm.departmentIds, dealForm.categoryIds);
      closeModal();
      showSuccess(modalMode === 'edit' ? 'Deal updated.' : 'Deal saved.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Deal Save Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleDeal = async (deal: Promotion) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('promotions').update({ is_active: !deal.is_active, updated_at: new Date().toISOString() }).eq('id', deal.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Deal updated.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Deal Toggle Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteDeal = async (deal: Promotion) => {
    const storeId = requireStore();
    if (!storeId) return;
    if (!window.confirm(`Delete deal "${deal.name}"?`)) return;
    setSaving(true);
    try {
      const [productDelete, departmentDelete, categoryDelete] = await Promise.all([
        supabase.from('promotion_products').delete().eq('promotion_id', deal.id).eq('store_id', storeId),
        supabase.from('promotion_departments').delete().eq('promotion_id', deal.id).eq('store_id', storeId),
        supabase.from('promotion_categories').delete().eq('promotion_id', deal.id).eq('store_id', storeId),
      ]);
      if (productDelete.error) throw productDelete.error;
      if (departmentDelete.error) throw departmentDelete.error;
      if (categoryDelete.error) throw categoryDelete.error;
      const { error } = await supabase.from('promotions').delete().eq('id', deal.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Deal deleted.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Deal Delete Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const importDealRows = async (rows: ImportRow[]) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    setPageError(null);
    try {
      let inserted = 0;
      let skipped = 0;
      const taxByName = new Map(activeTaxes.map((tax) => [tax.name.toLowerCase(), tax.id]));
      const payloads = rows.flatMap((row) => {
        const name = rowText(row, 'name');
        const dealType = rowText(row, 'deal_type') || 'fixed_price';
        const quantity = Number(rowText(row, 'quantity_required') || '1');
        const price = Number(rowText(row, 'deal_price') || '0');
        if (!name || !DEAL_TYPES.includes(dealType) || !Number.isFinite(quantity) || !Number.isFinite(price)) {
          skipped += 1;
          return [];
        }
        const taxLookup = rowText(row, 'tax', 'tax_category', 'category').toLowerCase();
        return [{
          store_id: storeId,
          name,
          deal_type: dealType,
          quantity_required: quantity,
          deal_price: price,
          start_date: rowText(row, 'start_date') || null,
          end_date: rowText(row, 'end_date') || null,
          tax_category_id: taxByName.get(taxLookup) || null,
          is_active: parseBoolean(rowText(row, 'is_active'), true),
          updated_at: new Date().toISOString(),
        }];
      });
      if (payloads.length) {
        const { error } = await supabase.from('promotions').insert(payloads);
        if (error) throw error;
        inserted = payloads.length;
      }
      setImportSummary(`Deals import complete. Inserted: ${inserted}. Skipped: ${skipped}.`);
      showSuccess('Deals imported.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Deal Import Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDealImport = async (file: File) => {
    if (!requireStore()) return;
    const lowerName = file.name.toLowerCase();
    try {
      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        await importDealRows(jsonRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), String(value ?? '').trim()]))));
        return;
      }
      await importDealRows(rowsFromCsv(await file.text()));
    } catch (error) {
      setErrorFrom('[Deal Import Parse Error]', error);
    }
  };

  const replacePromotionLinks = async (promotionId: string, departmentIds: string[], categoryIds: string[]) => {
    const storeId = requireStore();
    if (!storeId) return;

    const [deleteDepartments, deleteCategories] = await Promise.all([
      supabase.from('promotion_departments').delete().eq('promotion_id', promotionId).eq('store_id', storeId),
      supabase.from('promotion_categories').delete().eq('promotion_id', promotionId).eq('store_id', storeId),
    ]);

    if (deleteDepartments.error) throw deleteDepartments.error;
    if (deleteCategories.error) throw deleteCategories.error;

    const departmentRows = departmentIds.map((departmentId) => ({
      store_id: storeId,
      promotion_id: promotionId,
      department_id: departmentId,
    }));
    const categoryRows = categoryIds.map((categoryId) => ({
      store_id: storeId,
      promotion_id: promotionId,
      category_id: categoryId,
    }));

    if (departmentRows.length > 0) {
      const { error } = await supabase.from('promotion_departments').insert(departmentRows);
      if (error) throw error;
    }

    if (categoryRows.length > 0) {
      const { error } = await supabase.from('promotion_categories').insert(categoryRows);
      if (error) throw error;
    }
  };

  const attachProductToDeal = async (promotionId: string, product: ProductRow) => {
    const storeId = requireStore();
    if (!storeId) return;
    const productName = getProductName(product);
    const upc = getProductUpc(product);
    const existing = dealProducts[promotionId] || [];
    const duplicate = existing.some((row) => {
      if (product.id && row.product_id === product.id) return true;
      if (upc && row.upc === upc) return true;
      return false;
    });

    if (duplicate) {
      showSuccess(`${productName} is already attached.`);
      return;
    }

    setSaving(true);
    setPageError(null);
    try {
      const { error } = await supabase.from('promotion_products').insert({
        store_id: storeId,
        promotion_id: promotionId,
        product_id: product.id || null,
        upc: upc || null,
        item_name: productName,
      });
      if (error) throw error;
      showSuccess(`${productName} attached.`);
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Attach Product Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const removeDealProduct = async (promotionId: string, productRowId: string) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    setPageError(null);
    try {
      const { error } = await supabase.from('promotion_products').delete().eq('id', productRowId).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Product removed.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Remove Deal Product Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const loadGlobalPromos = async () => {
    setLoadingGlobalPromos(true);
    setPageError(null);
    try {
      const { data, error } = await supabase.from('vendor_promotions').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const rows = ((data || []) as VendorPromotionRow[]).filter((promo) => {
        const status = String(promo.status || '').toLowerCase();
        return !['archived', 'inactive', 'disabled', 'draft'].includes(status);
      });
      setGlobalPromos(rows);
    } catch (error) {
      setErrorFrom('[Load Global Promotions Error]', error);
    } finally {
      setLoadingGlobalPromos(false);
    }
  };

  const importGlobalPromo = async (promo: VendorPromotionRow) => {
    const storeId = requireStore();
    if (!storeId) return;
    const exists = deals.some((deal) => deal.name.toLowerCase() === promo.title.toLowerCase());
    if (exists) {
      showSuccess(`"${promo.title}" is already in your deals.`);
      return;
    }

    setSaving(true);
    setPageError(null);
    try {
      const { error } = await supabase.from('promotions').insert({
        store_id: storeId,
        name: promo.title,
        deal_type: normalizeDealType(promo.promotion_type),
        quantity_required: 1,
        deal_price: 0,
        start_date: promo.starts_at ? promo.starts_at.split('T')[0] : null,
        end_date: promo.ends_at ? promo.ends_at.split('T')[0] : null,
        is_active: false,
        tax_category_id: null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      showSuccess(`"${promo.title}" imported. Review quantity, price, tax, and products before activating.`);
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Import Global Promotion Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const saveDepartment = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const name = departmentForm.name.trim();
    if (!name) return setPageError('Department name is required.');
    setSaving(true);
    try {
      const payload = {
        store_id: storeId,
        name,
        description: departmentForm.description.trim() || null,
        ebt_eligible: departmentForm.ebtEligible,
        is_active: departmentForm.isActive,
        tax_category_id: departmentForm.taxCategoryId || null,
        age_restriction_id: departmentForm.ageRestrictionId || null,
        updated_at: new Date().toISOString(),
      };
      const result = modalMode === 'edit' && editingId
        ? await supabase.from('store_departments').update(payload).eq('id', editingId).eq('store_id', storeId)
        : await supabase.from('store_departments').upsert(payload, { onConflict: 'store_id,name' });
      if (result.error) throw result.error;
      closeModal();
      showSuccess(modalMode === 'edit' ? 'Department updated.' : 'Department saved.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Department Save Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleDepartment = async (department: StoreDepartment) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_departments').update({ is_active: !department.is_active, updated_at: new Date().toISOString() }).eq('id', department.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Department updated.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Department Toggle Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteDepartment = async (department: StoreDepartment) => {
    const storeId = requireStore();
    if (!storeId) return;
    if (!window.confirm(`Delete department "${department.name}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_departments').delete().eq('id', department.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Department deleted.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Department Delete Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const saveCategory = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const name = categoryForm.name.trim();
    if (!name) return setPageError('Category name is required.');
    setSaving(true);
    try {
      const payload = {
        store_id: storeId,
        name,
        department_id: categoryForm.departmentId || null,
        ebt_eligible: categoryForm.ebtEligible,
        is_active: categoryForm.isActive,
        tax_category_id: categoryForm.taxCategoryId || null,
        age_restriction_id: categoryForm.ageRestrictionId || null,
        updated_at: new Date().toISOString(),
      };
      const result = modalMode === 'edit' && editingId
        ? await supabase.from('store_categories').update(payload).eq('id', editingId).eq('store_id', storeId)
        : await supabase.from('store_categories').upsert(payload, { onConflict: 'store_id,name' });
      if (result.error) throw result.error;
      closeModal();
      showSuccess(modalMode === 'edit' ? 'Category updated.' : 'Category saved.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Category Save Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const createNegativeCash = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const exists = categories.some((category) => category.name.toLowerCase() === 'negative cash');
    if (exists) {
      showSuccess('Negative Cash category already exists.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('store_categories').insert({
        store_id: storeId,
        name: 'Negative Cash',
        department_id: null,
        ebt_eligible: false,
        is_active: true,
        tax_category_id: null,
        age_restriction_id: null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      showSuccess('Negative Cash category created.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Negative Cash Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = async (category: StoreCategory) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_categories').update({ is_active: !category.is_active, updated_at: new Date().toISOString() }).eq('id', category.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Category updated.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Category Toggle Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category: StoreCategory) => {
    const storeId = requireStore();
    if (!storeId) return;
    if (!window.confirm(`Delete category "${category.name}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_categories').delete().eq('id', category.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Category deleted.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Category Delete Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const saveVendor = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const vendorName = vendorForm.vendorName.trim();
    if (!vendorName) return setPageError('Vendor name is required.');
    setSaving(true);
    try {
      const payload = {
        store_id: storeId,
        vendor_name: vendorName,
        sales_rep_name: vendorForm.salesRepName.trim() || null,
        phone: vendorForm.phone.trim() || null,
        email: vendorForm.email.trim() || null,
        website: vendorForm.website.trim() || null,
        category: vendorForm.category.trim() || null,
        notes: vendorForm.notes.trim() || null,
        order_days: vendorForm.orderDays,
        delivery_days: vendorForm.deliveryDays,
        expected_invoice_amount: vendorForm.expectedInvoiceAmount ? Number(vendorForm.expectedInvoiceAmount) : null,
        payment_terms: vendorForm.paymentTerms.trim() || null,
        notification_enabled: vendorForm.notificationEnabled,
        schedule_frequency: vendorForm.scheduleFrequency,
        is_active: vendorForm.isActive,
        updated_at: new Date().toISOString(),
      };
      const result = modalMode === 'edit' && editingId
        ? await supabase.from('store_vendors').update(payload).eq('id', editingId).eq('store_id', storeId)
        : await supabase.from('store_vendors').upsert(payload, { onConflict: 'store_id,vendor_name' });
      if (result.error) throw result.error;
      closeModal();
      showSuccess(modalMode === 'edit' ? 'Vendor updated.' : 'Vendor saved.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Vendor Save Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const addGlobalVendor = async (vendor: GlobalVendor) => {
    const storeId = requireStore();
    if (!storeId) return;
    const exists = vendors.some((existing) => existing.vendor_name.trim().toLowerCase() === vendor.vendor_name.trim().toLowerCase());
    if (exists) return showSuccess(`${vendor.vendor_name} is already added.`);
    setSaving(true);
    try {
      const { error } = await supabase.from('store_vendors').insert({
        store_id: storeId,
        vendor_name: vendor.vendor_name,
        sales_rep_name: vendor.sales_rep_name,
        phone: vendor.phone,
        email: vendor.email,
        website: vendor.website,
        category: vendor.category,
        notes: vendor.notes,
        order_days: vendor.order_days || [],
        delivery_days: vendor.delivery_days || [],
        expected_invoice_amount: vendor.expected_invoice_amount,
        payment_terms: vendor.payment_terms,
        notification_enabled: vendor.notification_enabled !== false,
        schedule_frequency: vendor.schedule_frequency || 'weekly',
        is_active: true,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      showSuccess('Vendor added from global list.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Global Vendor Import Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleVendor = async (vendor: StoreVendor) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_vendors').update({ is_active: !vendor.is_active, updated_at: new Date().toISOString() }).eq('id', vendor.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Vendor updated.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Vendor Toggle Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteVendor = async (vendor: StoreVendor) => {
    const storeId = requireStore();
    if (!storeId) return;
    if (!window.confirm(`Delete vendor "${vendor.vendor_name}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_vendors').delete().eq('id', vendor.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Vendor deleted.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Vendor Delete Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const saveAge = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const name = ageForm.name.trim();
    const minimumAge = Number(ageForm.minimumAge);
    const restrictionType = ageForm.restrictionType.trim();
    if (!name || !restrictionType) return setPageError('Name and restriction type are required.');
    if (!Number.isFinite(minimumAge) || minimumAge < 0) return setPageError('Minimum age must be valid.');
    setSaving(true);
    try {
      const payload = {
        store_id: storeId,
        name,
        minimum_age: minimumAge,
        restriction_type: restrictionType,
        is_active: ageForm.isActive,
        updated_at: new Date().toISOString(),
      };
      const result = modalMode === 'edit' && editingId
        ? await supabase.from('store_age_restriction_presets').update(payload).eq('id', editingId).eq('store_id', storeId)
        : await supabase.from('store_age_restriction_presets').upsert(payload, { onConflict: 'store_id,name' });
      if (result.error) throw result.error;
      closeModal();
      showSuccess(modalMode === 'edit' ? 'Restriction updated.' : 'Restriction saved.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Age Restriction Save Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const addSelectedAgeDefaults = async () => {
    const storeId = requireStore();
    if (!storeId) return;
    const selected = DEFAULT_AGE_PRESETS.filter((preset) => selectedDefaultAges.includes(preset.name));
    if (!selected.length) return setPageError('Select at least one default to import.');
    setSaving(true);
    try {
      const existing = new Set(agePresets.map((preset) => preset.name.toLowerCase()));
      const rows = selected
        .filter((preset) => !existing.has(preset.name.toLowerCase()))
        .map((preset) => ({
          store_id: storeId,
          name: preset.name,
          minimum_age: preset.minimum_age,
          restriction_type: preset.restriction_type,
          is_active: true,
          updated_at: new Date().toISOString(),
        }));
      if (rows.length) {
        const { error } = await supabase.from('store_age_restriction_presets').insert(rows);
        if (error) throw error;
      }
      setAgeImportOpen(false);
      setSelectedDefaultAges([]);
      showSuccess(`Imported ${rows.length} default restriction${rows.length === 1 ? '' : 's'}.`);
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Age Defaults Import Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleAge = async (preset: AgeRestrictionPreset) => {
    const storeId = requireStore();
    if (!storeId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_age_restriction_presets').update({ is_active: !preset.is_active, updated_at: new Date().toISOString() }).eq('id', preset.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Age restriction updated.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Age Restriction Toggle Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteAge = async (preset: AgeRestrictionPreset) => {
    const storeId = requireStore();
    if (!storeId) return;
    if (!window.confirm(`Delete age restriction "${preset.name}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('store_age_restriction_presets').delete().eq('id', preset.id).eq('store_id', storeId);
      if (error) throw error;
      showSuccess('Age restriction deleted.');
      await loadSettings();
    } catch (error) {
      setErrorFrom('[Age Restriction Delete Error]', error);
    } finally {
      setSaving(false);
    }
  };

  const saveTaxProfile = () => {
    void saveStoreSettings(
      { tax_registration_number: taxRegistrationNumber.trim() || null },
      'Tax profile saved.'
    );
  };

  const addCustomPaymentMethod = () => {
    const name = customPaymentMethod.trim();
    if (!name) return setPageError('Payment method name is required.');
    const exists = paymentMethods.some((method) => method.name.toLowerCase() === name.toLowerCase());
    if (exists) return showSuccess(`${name} is already listed.`);
    setPaymentMethods((current) => [...current, { name, enabled: true }]);
    setCustomPaymentMethod('');
  };

  const savePaymentMethods = () => {
    void saveStoreSettings({ payment_methods: paymentMethods }, 'Payment methods saved.');
  };

  const addDiscountRule = () => {
    const name = newDiscountName.trim();
    const percentValue = Number(newDiscountPercent);
    if (!name) return setPageError('Discount rule name is required.');
    if (!Number.isFinite(percentValue) || percentValue < 0) return setPageError('Discount percent must be valid.');
    const exists = discountRules.some((rule) => rule.name.toLowerCase() === name.toLowerCase());
    if (exists) return showSuccess(`${name} is already listed.`);
    setDiscountRules((current) => [...current, { name, percent: percentValue, enabled: true }]);
    setNewDiscountName('');
    setNewDiscountPercent('');
  };

  const saveDiscountRules = () => {
    void saveStoreSettings({ discount_rules: discountRules }, 'Discount rules saved.');
  };

  const openEditTax = (tax: TaxCategory) => {
    setModalType('tax');
    setModalMode('edit');
    setEditingId(tax.id);
    setTaxForm({ name: tax.name, rate: String(tax.rate), description: tax.description || '', isDefault: tax.is_default, isActive: tax.is_active });
  };

  const openEditDeal = (deal: Promotion) => {
    setModalType('deal');
    setModalMode('edit');
    setEditingId(deal.id);
    setDealForm({
      name: deal.name,
      dealType: deal.deal_type || 'fixed_price',
      quantityRequired: String(deal.quantity_required),
      dealPrice: String(deal.deal_price),
      startDate: deal.start_date || '',
      endDate: deal.end_date || '',
      taxCategoryId: deal.tax_category_id || '',
      departmentIds: (dealDepartments[deal.id] || []).map((row) => row.department_id),
      categoryIds: (dealCategories[deal.id] || []).map((row) => row.category_id),
      isActive: deal.is_active,
    });
  };

  const openEditDepartment = (department: StoreDepartment) => {
    setModalType('department');
    setModalMode('edit');
    setEditingId(department.id);
    setDepartmentForm({
      name: department.name,
      description: department.description || '',
      ebtEligible: department.ebt_eligible,
      isActive: department.is_active,
      taxCategoryId: department.tax_category_id || '',
      ageRestrictionId: department.age_restriction_id || '',
    });
  };

  const openEditCategory = (category: StoreCategory) => {
    setModalType('category');
    setModalMode('edit');
    setEditingId(category.id);
    setCategoryForm({
      name: category.name,
      departmentId: category.department_id || '',
      ebtEligible: category.ebt_eligible,
      isActive: category.is_active,
      taxCategoryId: category.tax_category_id || '',
      ageRestrictionId: category.age_restriction_id || '',
    });
  };

  const openEditVendor = (vendor: StoreVendor) => {
    setModalType('vendor');
    setModalMode('edit');
    setEditingId(vendor.id);
    setVendorForm({
      vendorName: vendor.vendor_name,
      salesRepName: vendor.sales_rep_name || '',
      phone: vendor.phone || '',
      email: vendor.email || '',
      website: vendor.website || '',
      category: vendor.category || '',
      notes: vendor.notes || '',
      orderDays: vendor.order_days || [],
      deliveryDays: vendor.delivery_days || [],
      expectedInvoiceAmount: vendor.expected_invoice_amount === null || vendor.expected_invoice_amount === undefined ? '' : String(vendor.expected_invoice_amount),
      paymentTerms: vendor.payment_terms || '',
      notificationEnabled: vendor.notification_enabled !== false,
      scheduleFrequency: vendor.schedule_frequency || 'weekly',
      isActive: vendor.is_active,
    });
  };

  const openEditAge = (preset: AgeRestrictionPreset) => {
    setModalType('age');
    setModalMode('edit');
    setEditingId(preset.id);
    setAgeForm({ name: preset.name, minimumAge: String(preset.minimum_age), restrictionType: preset.restriction_type, isActive: preset.is_active });
  };

  if (authLoading || loading) {
    return (
      <DashboardShell>
        <PageLoading />
      </DashboardShell>
    );
  }

  if (!user) {
    return (
      <DashboardShell>
        <Card className="p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">Sign in required</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage store settings.</p>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Store Settings"
        description="Manage product defaults for tax, departments, categories, vendors, deals, and age restrictions."
      />

      {pageError ? <Message tone="error" message={pageError} /> : null}
      {successMessage ? <Message tone="success" message={successMessage} /> : null}
      {importSummary ? <Message tone="success" message={importSummary} /> : null}

      {blocked ? (
        <Card className="mb-6 border-dashed p-6 text-sm text-muted-foreground">
          Select a specific store to manage store settings.
        </Card>
      ) : null}

      <div className="mb-6 overflow-x-auto border-b border-border">
        <div className="flex min-w-max gap-0">
          {[
            ['tax', 'Tax', BadgePercent],
            ['deals', 'Deals / Promo', Tag],
            ['departments', 'Departments', Building2],
            ['categories', 'Categories', LayoutGrid],
            ['vendors', 'Vendors', Truck],
            ['age-restrictions', 'Age Restrictions', ShieldAlert],
            ['payment-methods', 'Payment Methods', CreditCard],
            ['discount-rules', 'Discount Rules', Percent],
          ].map(([id, label, Icon]) => {
            const TypedIcon = Icon as typeof BadgePercent;
            return (
              <button
                key={String(id)}
                type="button"
                onClick={() => setActiveTab(id as TabKey)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition',
                  activeTab === id
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <TypedIcon className="h-4 w-4" />
                {String(label)}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'tax' ? (
        <Card className="p-5">
          <SectionHeader title="Tax" description="Only one tax category can be default for a store." buttonLabel="Add Tax" onAdd={() => openAddModal('tax')} disabled={blocked} />
          <Card className="mb-5 border-primary/20 bg-primary/5 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Store Tax Profile</h3>
                <p className="mt-1 text-sm text-muted-foreground">Your state tax permit number for receipts and filings.</p>
                {storeSettings?.updated_at ? <p className="mb-2 mt-1 text-xs text-muted-foreground">Settings last updated {new Date(storeSettings.updated_at).toLocaleString()}.</p> : null}
                <Field label="Tax Registration / Permit Number">
                  <Input
                    value={taxRegistrationNumber}
                    onChange={(event) => setTaxRegistrationNumber(event.target.value)}
                    placeholder="State permit or registration number"
                    disabled={blocked || saving}
                  />
                </Field>
              </div>
              <Button disabled={blocked || saving} onClick={saveTaxProfile}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Tax Profile
              </Button>
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {taxes.map((tax) => (
              <Card key={tax.id} className={cn('p-4', !tax.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{tax.name}</h3>
                    <p className="mt-1 text-2xl font-bold text-primary">{percent(tax.rate)}</p>
                    {tax.description ? <p className="mt-1 text-sm text-muted-foreground">{tax.description}</p> : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {tax.is_default ? <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">Default</span> : null}
                    <StatusBadge active={tax.is_active} />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => openEditTax(tax)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                  {!tax.is_default ? <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => void setTaxAsDefault(tax)}>Set as Default</Button> : null}
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => void toggleTax(tax)}>{tax.is_active ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" variant="ghost" disabled={blocked || saving} onClick={() => void deleteTax(tax)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      {activeTab === 'deals' ? (
        <Card className="p-5">
          <SectionHeader title="Deals / Promo" description="Create deals, tax overrides, and product/category applicability." buttonLabel="Add Deal" onAdd={() => openAddModal('deal')} disabled={blocked} />
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={dealSearch} onChange={(event) => setDealSearch(event.target.value)} placeholder="Search deals..." className="pl-9" />
            </div>
            <div className="relative">
              <Button variant="outline" disabled={blocked || saving} onClick={() => setShowImportMenu((current) => !current)}>
                <Upload className="mr-2 h-4 w-4" />Import
              </Button>
              {showImportMenu ? (
                <Card className="absolute right-0 z-20 mt-2 w-64 p-2 shadow-lg">
                  <label className="flex cursor-pointer items-center rounded-md px-3 py-2 text-sm hover:bg-secondary">
                    <FileUp className="mr-2 h-4 w-4" />
                    Import from File
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      disabled={blocked || saving}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleDealImport(file);
                        event.target.value = '';
                        setShowImportMenu(false);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
                    onClick={() => {
                      setShowImportMenu(false);
                      setShowGlobalPromos(true);
                      void loadGlobalPromos();
                    }}
                  >
                    <Globe className="mr-2 h-4 w-4" />
                    Import from Global Promotions
                  </button>
                </Card>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {filteredDeals.length === 0 ? <EmptyState icon={Tag} title="No deals found" text="Create or import deals for this store." /> : filteredDeals.map((deal) => (
              <Card key={deal.id} className={cn('p-4', !deal.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{deal.name}</h3>
                    <p className="mt-1 text-lg font-bold text-primary">{deal.deal_type} | Qty {deal.quantity_required} | {money(deal.deal_price)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{dateLabel(deal.start_date)} to {dateLabel(deal.end_date)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Tax: {taxName(taxes, deal.tax_category_id)}</p>
                  </div>
                  <StatusBadge active={deal.is_active} />
                </div>
                <div className="mt-4 space-y-2 rounded-lg bg-secondary/40 p-3 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Products:</span> {(dealProducts[deal.id] || []).length}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(dealProducts[deal.id] || []).length === 0 ? <span>No products attached yet.</span> : (dealProducts[deal.id] || []).map((product) => (
                      <span key={product.id} className="rounded-full bg-background px-2 py-1">{product.item_name || product.upc || 'Product'}</span>
                    ))}
                  </div>
                  <p><span className="font-medium text-foreground">Departments:</span> {(dealDepartments[deal.id] || []).map((row) => departments.find((department) => department.id === row.department_id)?.name).filter(Boolean).join(', ') || 'None'}</p>
                  <p><span className="font-medium text-foreground">Categories:</span> {(dealCategories[deal.id] || []).map((row) => categories.find((category) => category.id === row.category_id)?.name).filter(Boolean).join(', ') || 'None'}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => openEditDeal(deal)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => { setManagingProductsForDeal(deal.id); setDealProductSearch(''); }}>Manage Products</Button>
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => void toggleDeal(deal)}>{deal.is_active ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" variant="ghost" disabled={blocked || saving} onClick={() => void deleteDeal(deal)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      {activeTab === 'departments' ? (
        <Card className="p-5">
          <SectionHeader title="Departments" description="Broad product groups with default tax behavior." buttonLabel="Add Department" onAdd={() => openAddModal('department')} disabled={blocked} />
          <div className="grid gap-4 md:grid-cols-2">
            {departments.length === 0 ? <EmptyState icon={Building2} title="No departments yet" text="Add departments for product defaults." /> : departments.map((department) => (
              <Card key={department.id} className={cn('p-4', !department.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{department.name}</h3>
                    {department.description ? <p className="mt-1 text-sm text-muted-foreground">{department.description}</p> : null}
                    <p className="mt-2 text-sm text-muted-foreground">Tax: {taxName(taxes, department.tax_category_id)}</p>
                    <p className="text-sm text-muted-foreground">Age restriction: {ageRestrictionName(agePresets, department.age_restriction_id)}</p>
                    <p className="text-sm text-muted-foreground">EBT eligible: {department.ebt_eligible ? 'Yes' : 'No'}</p>
                  </div>
                  <StatusBadge active={department.is_active} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => openEditDepartment(department)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => void toggleDepartment(department)}>{department.is_active ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" variant="ghost" disabled={blocked || saving} onClick={() => void deleteDepartment(department)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      {activeTab === 'categories' ? (
        <Card className="p-5">
          <SectionHeader title="Categories" description="Detailed product analytics groups under departments." buttonLabel="Add Category" onAdd={() => openAddModal('category')} disabled={blocked} />
          <div className="mb-4">
            <Button variant="outline" disabled={blocked || saving} onClick={() => void createNegativeCash()}><Plus className="mr-2 h-4 w-4" />Negative Cash</Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {categories.length === 0 ? <EmptyState icon={LayoutGrid} title="No categories yet" text="Add detailed categories like Energy Drinks." /> : categories.map((category) => {
              const department = departments.find((item) => item.id === category.department_id);
              return (
                <Card key={category.id} className={cn('p-4', !category.is_active && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{category.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Department: {department?.name || 'None'}</p>
                      <p className="text-sm text-muted-foreground">Tax: {taxName(taxes, category.tax_category_id)}</p>
                      <p className="text-sm text-muted-foreground">Age restriction: {ageRestrictionName(agePresets, category.age_restriction_id)}</p>
                      <p className="text-sm text-muted-foreground">EBT eligible: {category.ebt_eligible ? 'Yes' : 'No'}</p>
                    </div>
                    <StatusBadge active={category.is_active} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => openEditCategory(category)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                    <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => void toggleCategory(category)}>{category.is_active ? 'Disable' : 'Enable'}</Button>
                    <Button size="sm" variant="ghost" disabled={blocked || saving} onClick={() => void deleteCategory(category)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </Card>
      ) : null}

      {activeTab === 'vendors' ? (
        <Card className="p-5">
          <SectionHeader title="Vendors" description="Store-level vendors shared with Superadmin vendor oversight." buttonLabel="Add Vendor" onAdd={() => openAddModal('vendor')} disabled={blocked} />
          <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_160px_160px_180px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={vendorSearch} onChange={(event) => setVendorSearch(event.target.value)} placeholder="Search vendors..." className="pl-9" />
            </div>
            <Select value={vendorStatus} onChange={setVendorStatus} options={[['all', 'All status'], ['active', 'Active'], ['inactive', 'Inactive']]} />
            <Select value={vendorFrequency} onChange={setVendorFrequency} options={[['all', 'All frequency'], ...FREQUENCIES.map((frequency): [string, string] => [frequency, frequency])]} />
            <Select value={vendorCategory} onChange={setVendorCategory} options={[['', 'All categories'], ...vendorCategories.map((category): [string, string] => [category, category])]} />
            <Button variant="outline" disabled={blocked || saving} onClick={() => setGlobalPanelOpen(true)}><Download className="mr-2 h-4 w-4" />Import from Global List</Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {filteredVendors.length === 0 ? <EmptyState icon={Truck} title="No vendors found" text="Add vendors or import them from the global list." /> : filteredVendors.map((vendor) => (
              <Card key={vendor.id} className={cn('p-4', !vendor.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{vendor.vendor_name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{vendor.category || 'No category'} | {vendor.schedule_frequency || 'weekly'}</p>
                    <p className="text-sm text-muted-foreground">{vendor.sales_rep_name || 'No rep'} {vendor.phone ? `| ${vendor.phone}` : ''} {vendor.email ? `| ${vendor.email}` : ''}</p>
                    <p className="text-sm text-muted-foreground">Terms: {vendor.payment_terms || 'Not set'} | Expected: {money(vendor.expected_invoice_amount)}</p>
                  </div>
                  <StatusBadge active={vendor.is_active} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(vendor.order_days || []).map((day) => <span key={`order-${day}`} className="rounded-full border border-primary/30 px-2 py-0.5 text-xs">Order {day.slice(0, 3)}</span>)}
                  {(vendor.delivery_days || []).map((day) => <span key={`delivery-${day}`} className="rounded-full border border-amber-300 px-2 py-0.5 text-xs">Delivery {day.slice(0, 3)}</span>)}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => openEditVendor(vendor)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => void toggleVendor(vendor)}>{vendor.is_active ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" variant="ghost" disabled={blocked || saving} onClick={() => void deleteVendor(vendor)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      {activeTab === 'age-restrictions' ? (
        <Card className="p-5">
          <SectionHeader title="Age Restrictions" description="Manage product age restriction defaults." buttonLabel="Add Restriction" onAdd={() => openAddModal('age')} disabled={blocked} />
          <p className="mb-4 rounded-xl bg-secondary/60 p-3 text-sm text-muted-foreground">
            Assign restrictions to departments or categories so products can inherit ID-check rules.
          </p>
          <div className="mb-4">
            <Button variant="outline" disabled={blocked || saving} onClick={() => setAgeImportOpen(true)}><Download className="mr-2 h-4 w-4" />Import Defaults</Button>
          </div>
          {ageImportOpen ? (
            <Card className="mb-5 p-4">
              <h3 className="font-semibold text-foreground">Select Defaults</h3>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {DEFAULT_AGE_PRESETS.map((preset) => {
                  const added = agePresets.some((existing) => existing.name.toLowerCase() === preset.name.toLowerCase());
                  const selected = selectedDefaultAges.includes(preset.name);
                  return (
                    <label key={preset.name} className={cn('flex items-center justify-between rounded-lg border p-3 text-sm', added && 'bg-secondary/50 text-muted-foreground')}>
                      <span>{preset.name} ({preset.minimum_age}+)</span>
                      {added ? <span className="text-xs font-semibold">Already added</span> : <input type="checkbox" checked={selected} onChange={(event) => setSelectedDefaultAges((current) => event.target.checked ? [...current, preset.name] : current.filter((name) => name !== preset.name))} />}
                    </label>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAgeImportOpen(false)}>Cancel</Button>
                <Button disabled={saving} onClick={() => void addSelectedAgeDefaults()}>{saving ? 'Adding...' : 'Add Selected'}</Button>
              </div>
            </Card>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            {agePresets.length === 0 ? <EmptyState icon={ShieldAlert} title="No restrictions yet" text="Add custom restrictions or import defaults." /> : agePresets.map((preset) => (
              <Card key={preset.id} className={cn('p-4', !preset.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{preset.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{preset.minimum_age}+ | {preset.restriction_type}</p>
                  </div>
                  <StatusBadge active={preset.is_active} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => openEditAge(preset)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                  <Button size="sm" variant="outline" disabled={blocked || saving} onClick={() => void toggleAge(preset)}>{preset.is_active ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" variant="ghost" disabled={blocked || saving} onClick={() => void deleteAge(preset)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      {activeTab === 'payment-methods' ? (
        <Card className="p-5">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-foreground">Payment Methods</h2>
            <p className="mt-1 text-sm text-muted-foreground">Configure accepted payment methods for planning and future POS defaults. This does not process payments.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {paymentMethods.map((method) => (
              <label key={method.name} className="flex items-center justify-between rounded-xl border border-border p-4">
                <span className="text-sm font-medium text-foreground">{method.name}</span>
                <input
                  type="checkbox"
                  checked={method.enabled}
                  disabled={blocked || saving}
                  onChange={(event) => setPaymentMethods((current) => current.map((item) => item.name === method.name ? { ...item, enabled: event.target.checked } : item))}
                />
              </label>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Input value={customPaymentMethod} onChange={(event) => setCustomPaymentMethod(event.target.value)} placeholder="Custom payment method" disabled={blocked || saving} />
            <Button variant="outline" disabled={blocked || saving} onClick={addCustomPaymentMethod}><Plus className="mr-2 h-4 w-4" />Add Method</Button>
            <Button disabled={blocked || saving} onClick={savePaymentMethods}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save Payment Methods</Button>
          </div>
        </Card>
      ) : null}

      {activeTab === 'discount-rules' ? (
        <Card className="p-5">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-foreground">Discount Rules</h2>
            <p className="mt-1 text-sm text-muted-foreground">Configure discount defaults for future workflows. This does not apply discounts to transactions yet.</p>
          </div>
          <div className="space-y-3">
            {discountRules.map((rule) => (
              <div key={rule.name} className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-[1fr_140px_90px] md:items-center">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={blocked || saving}
                    onChange={(event) => setDiscountRules((current) => current.map((item) => item.name === rule.name ? { ...item, enabled: event.target.checked } : item))}
                  />
                  <span className="text-sm font-medium text-foreground">{rule.name}</span>
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(rule.percent)}
                  disabled={blocked || saving}
                  onChange={(event) => setDiscountRules((current) => current.map((item) => item.name === rule.name ? { ...item, percent: Number(event.target.value) || 0 } : item))}
                />
                <span className="text-sm text-muted-foreground">% off</span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_160px_auto_auto]">
            <Input value={newDiscountName} onChange={(event) => setNewDiscountName(event.target.value)} placeholder="Custom discount rule" disabled={blocked || saving} />
            <Input type="number" min="0" step="0.01" value={newDiscountPercent} onChange={(event) => setNewDiscountPercent(event.target.value)} placeholder="Percent" disabled={blocked || saving} />
            <Button variant="outline" disabled={blocked || saving} onClick={addDiscountRule}><Plus className="mr-2 h-4 w-4" />Add Rule</Button>
            <Button disabled={blocked || saving} onClick={saveDiscountRules}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save Discount Rules</Button>
          </div>
        </Card>
      ) : null}

      {showGlobalPromos ? (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" aria-label="Close global promotions" className="flex-1 bg-black/50" onClick={() => setShowGlobalPromos(false)} />
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-background p-5 shadow-xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Global Promotions</h2>
                <p className="mt-1 text-sm text-muted-foreground">Copy company/vendor promotion templates into this store as inactive deals.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowGlobalPromos(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={globalPromoSearch} onChange={(event) => setGlobalPromoSearch(event.target.value)} placeholder="Search global promotions..." className="pl-9" />
            </div>
            {loadingGlobalPromos ? (
              <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading global promotions...
              </div>
            ) : null}
            <div className="space-y-3">
              {!loadingGlobalPromos && filteredGlobalPromos.length === 0 ? <EmptyState icon={Globe} title="No global promotions" text="No active global promotions are available right now." /> : null}
              {filteredGlobalPromos.map((promo) => {
                const added = deals.some((deal) => deal.name.toLowerCase() === promo.title.toLowerCase());
                return (
                  <Card key={promo.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{promo.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{promo.vendor_name || 'Company promotion'} | {promo.promotion_type} | {promo.status}</p>
                        {promo.description ? <p className="mt-2 text-sm text-muted-foreground">{promo.description}</p> : null}
                        {promo.product_keywords?.length ? <p className="mt-2 text-xs text-muted-foreground">Keywords: {promo.product_keywords.join(', ')}</p> : null}
                      </div>
                      <Button size="sm" disabled={added || saving} onClick={() => void importGlobalPromo(promo)}>{added ? 'Already Added' : 'Add to My Store'}</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}

      {managingProductsForDeal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-background shadow-xl">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Manage Deal Products</h2>
                <p className="mt-1 text-sm text-muted-foreground">Attach products from this store to the selected deal.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setManagingProductsForDeal(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
              <section className="flex min-h-0 flex-col rounded-xl border border-border">
                <div className="border-b border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground">Available Products</h3>
                  <div className="relative mt-3">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={dealProductSearch} onChange={(event) => setDealProductSearch(event.target.value)} placeholder="Search by item, UPC, category, brand, vendor..." className="pl-9" />
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                  {products.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No products found. Upload or add products before attaching products to deals.
                    </p>
                  ) : null}
                  {products.length > 0 && availableDealProducts.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No available products found.
                    </p>
                  ) : null}
                  {availableDealProducts.map((product, index) => {
                    const productName = getProductName(product);
                    const upc = getProductUpc(product);
                    return (
                      <div key={`${product.id || upc || productName}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{productName}</p>
                          <p className="text-xs text-muted-foreground">UPC: {upc || 'None'} | {productValue(product, 'category') || productValue(product, 'department') || 'No category'}</p>
                        </div>
                        <Button size="sm" disabled={saving} onClick={() => void attachProductToDeal(managingProductsForDeal, product)}>Add</Button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="flex min-h-0 flex-col rounded-xl border border-border">
                <div className="border-b border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground">Attached Products ({attachedProductsForDeal.length})</h3>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                  {attachedProductsForDeal.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No products attached yet.
                    </p>
                  ) : null}
                  {attachedProductsForDeal.map((product) => (
                    <div key={product.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{product.item_name || product.upc || 'Product'}</p>
                          {product.upc ? <p className="text-xs text-muted-foreground">UPC: {product.upc}</p> : null}
                        </div>
                        <Button size="sm" variant="ghost" disabled={saving} onClick={() => void removeDealProduct(managingProductsForDeal, product.id)}>Remove</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </Card>
        </div>
      ) : null}

      {globalPanelOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" aria-label="Close global vendors" className="flex-1 bg-black/50" onClick={() => setGlobalPanelOpen(false)} />
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-background p-5 shadow-xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Import from Global List</h2>
                <p className="mt-1 text-sm text-muted-foreground">Add central vendors to this store.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setGlobalPanelOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-3">
              {globalVendors.length === 0 ? <EmptyState icon={Truck} title="No global vendors" text="Global vendors have not been configured yet." /> : globalVendors.map((vendor) => {
                const added = vendors.some((existing) => existing.vendor_name.toLowerCase() === vendor.vendor_name.toLowerCase());
                return (
                  <Card key={vendor.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{vendor.vendor_name}</h3>
                        <p className="text-sm text-muted-foreground">{vendor.category || 'No category'} {vendor.email ? `| ${vendor.email}` : ''}</p>
                      </div>
                      <Button size="sm" disabled={added || saving} onClick={() => void addGlobalVendor(vendor)}>{added ? 'Added' : 'Add to My Store'}</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}

      {modalType ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="max-h-[92vh] w-full max-w-3xl overflow-hidden">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {modalMode === 'add' ? 'Add' : 'Edit'} {modalTitle(modalType)}
                </h2>
              </div>
              <Button variant="ghost" size="icon" onClick={closeModal} disabled={saving}><X className="h-4 w-4" /></Button>
            </div>
            <div className="max-h-[calc(92vh-150px)] overflow-y-auto p-5">
              {modalType === 'tax' ? <TaxFormView form={taxForm} onChange={setTaxForm} /> : null}
              {modalType === 'deal' ? <DealFormView form={dealForm} taxes={taxOptions} departments={activeDepartments} categories={activeCategories} onChange={setDealForm} /> : null}
              {modalType === 'department' ? <DepartmentFormView form={departmentForm} taxes={taxOptions} ageRestrictions={ageRestrictionOptions} onChange={setDepartmentForm} /> : null}
              {modalType === 'category' ? <CategoryFormView form={categoryForm} taxes={taxOptions} departments={departmentOptions} ageRestrictions={ageRestrictionOptions} onChange={setCategoryForm} /> : null}
              {modalType === 'vendor' ? <VendorFormView form={vendorForm} onChange={setVendorForm} /> : null}
              {modalType === 'age' ? <AgeFormView form={ageForm} onChange={setAgeForm} /> : null}
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={closeModal} disabled={saving}>Cancel</Button>
              <Button disabled={saving} onClick={() => {
                if (modalType === 'tax') void saveTax();
                if (modalType === 'deal') void saveDeal();
                if (modalType === 'department') void saveDepartment();
                if (modalType === 'category') void saveCategory();
                if (modalType === 'vendor') void saveVendor();
                if (modalType === 'age') void saveAge();
              }}>{saving ? 'Saving...' : modalMode === 'edit' ? 'Update' : 'Save'}</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </DashboardShell>
  );
}

function modalTitle(type: Exclude<ModalType, null>) {
  if (type === 'tax') return 'Tax';
  if (type === 'deal') return 'Deal / Promo';
  if (type === 'department') return 'Department';
  if (type === 'category') return 'Category';
  if (type === 'vendor') return 'Vendor';
  return 'Age Restriction';
}

function Message({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const Icon = tone === 'success' ? CheckCircle2 : CircleAlert;
  return (
    <div className={cn('mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-destructive/30 bg-destructive/10 text-destructive')}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Tag; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center md:col-span-2">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
      <h3 className="mt-3 font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function SectionHeader({ title, description, buttonLabel, onAdd, disabled }: { title: string; description: string; buttonLabel: string; onAdd: () => void; disabled: boolean }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Button onClick={onAdd} disabled={disabled}><Plus className="mr-2 h-4 w-4" />{buttonLabel}</Button>
    </div>
  );
}

function TaxFormView({ form, onChange }: { form: TaxForm; onChange: (form: TaxForm) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="Tax Name"><Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></Field>
      <Field label="Rate (%)"><Input type="number" min="0" step="0.01" value={form.rate} onChange={(event) => onChange({ ...form, rate: event.target.value })} /></Field>
      <Field label="Description"><Input value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></Field>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.isDefault} onChange={(event) => onChange({ ...form, isDefault: event.target.checked })} /><span className="text-sm font-medium">Set as default tax</span></label>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} /><span className="text-sm font-medium">Active tax</span></label>
    </div>
  );
}

function DealFormView({
  form,
  taxes,
  departments,
  categories,
  onChange,
}: {
  form: DealForm;
  taxes: Array<[string, string]>;
  departments: StoreDepartment[];
  categories: StoreCategory[];
  onChange: (form: DealForm) => void;
}) {
  const toggle = (key: 'departmentIds' | 'categoryIds', id: string) => {
    const current = form[key];
    onChange({ ...form, [key]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Deal Name"><Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></Field>
      <Field label="Deal Type"><Select value={form.dealType} onChange={(value) => onChange({ ...form, dealType: value })} options={DEAL_TYPES.map((type): [string, string] => [type, type])} /></Field>
      <Field label="Quantity Required"><Input type="number" min="1" value={form.quantityRequired} onChange={(event) => onChange({ ...form, quantityRequired: event.target.value })} /></Field>
      <Field label="Deal Price"><Input type="number" min="0" step="0.01" value={form.dealPrice} onChange={(event) => onChange({ ...form, dealPrice: event.target.value })} /></Field>
      <Field label="Start Date"><Input type="date" value={form.startDate} onChange={(event) => onChange({ ...form, startDate: event.target.value })} /></Field>
      <Field label="End Date"><Input type="date" value={form.endDate} onChange={(event) => onChange({ ...form, endDate: event.target.value })} /></Field>
      <Field label="Tax Override"><Select value={form.taxCategoryId} onChange={(value) => onChange({ ...form, taxCategoryId: value })} options={taxes} /></Field>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} /><span className="text-sm font-medium">Active deal</span></label>
      <div className="md:col-span-2">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Applies To Departments</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {departments.length === 0 ? <p className="text-sm text-muted-foreground">No active departments.</p> : departments.map((department) => (
            <label key={department.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <input type="checkbox" checked={form.departmentIds.includes(department.id)} onChange={() => toggle('departmentIds', department.id)} />
              {department.name}
            </label>
          ))}
        </div>
      </div>
      <div className="md:col-span-2">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Applies To Categories</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {categories.length === 0 ? <p className="text-sm text-muted-foreground">No active categories.</p> : categories.map((category) => (
            <label key={category.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <input type="checkbox" checked={form.categoryIds.includes(category.id)} onChange={() => toggle('categoryIds', category.id)} />
              {category.name}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function DepartmentFormView({ form, taxes, ageRestrictions, onChange }: { form: DepartmentForm; taxes: Array<[string, string]>; ageRestrictions: Array<[string, string]>; onChange: (form: DepartmentForm) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="Department Name"><Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></Field>
      <Field label="Description"><Input value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></Field>
      <Field label="Default Tax Category"><Select value={form.taxCategoryId} onChange={(value) => onChange({ ...form, taxCategoryId: value })} options={taxes} /></Field>
      <Field label="Age Restriction"><Select value={form.ageRestrictionId} onChange={(value) => onChange({ ...form, ageRestrictionId: value })} options={ageRestrictions} /></Field>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.ebtEligible} onChange={(event) => onChange({ ...form, ebtEligible: event.target.checked })} /><span className="text-sm font-medium">EBT eligible</span></label>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} /><span className="text-sm font-medium">Active department</span></label>
    </div>
  );
}

function CategoryFormView({ form, taxes, departments, ageRestrictions, onChange }: { form: CategoryForm; taxes: Array<[string, string]>; departments: Array<[string, string]>; ageRestrictions: Array<[string, string]>; onChange: (form: CategoryForm) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="Category Name"><Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></Field>
      <Field label="Department"><Select value={form.departmentId} onChange={(value) => onChange({ ...form, departmentId: value })} options={departments} /></Field>
      <Field label="Tax Category"><Select value={form.taxCategoryId} onChange={(value) => onChange({ ...form, taxCategoryId: value })} options={taxes} /></Field>
      <Field label="Age Restriction"><Select value={form.ageRestrictionId} onChange={(value) => onChange({ ...form, ageRestrictionId: value })} options={ageRestrictions} /></Field>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.ebtEligible} onChange={(event) => onChange({ ...form, ebtEligible: event.target.checked })} /><span className="text-sm font-medium">EBT eligible</span></label>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} /><span className="text-sm font-medium">Active category</span></label>
    </div>
  );
}

function VendorFormView({ form, onChange }: { form: VendorForm; onChange: (form: VendorForm) => void }) {
  const toggleDay = (key: 'orderDays' | 'deliveryDays', day: string) => {
    const current = form[key];
    onChange({ ...form, [key]: current.includes(day) ? current.filter((item) => item !== day) : [...current, day] });
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Vendor Name"><Input value={form.vendorName} onChange={(event) => onChange({ ...form, vendorName: event.target.value })} /></Field>
      <Field label="Sales Rep Name"><Input value={form.salesRepName} onChange={(event) => onChange({ ...form, salesRepName: event.target.value })} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={(event) => onChange({ ...form, phone: event.target.value })} /></Field>
      <Field label="Email"><Input value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} /></Field>
      <Field label="Website"><Input value={form.website} onChange={(event) => onChange({ ...form, website: event.target.value })} /></Field>
      <Field label="Category"><Input value={form.category} onChange={(event) => onChange({ ...form, category: event.target.value })} /></Field>
      <Field label="Schedule Frequency"><Select value={form.scheduleFrequency} onChange={(value) => onChange({ ...form, scheduleFrequency: value as ScheduleFrequency })} options={FREQUENCIES.map((frequency): [string, string] => [frequency, frequency])} /></Field>
      <Field label="Expected Invoice Amount"><Input type="number" min="0" step="0.01" value={form.expectedInvoiceAmount} onChange={(event) => onChange({ ...form, expectedInvoiceAmount: event.target.value })} /></Field>
      <Field label="Payment Method / Terms"><Input value={form.paymentTerms} onChange={(event) => onChange({ ...form, paymentTerms: event.target.value })} /></Field>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.notificationEnabled} onChange={(event) => onChange({ ...form, notificationEnabled: event.target.checked })} /><span className="text-sm font-medium">Future vendor reminders</span></label>
      <div className="md:col-span-2">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Order / Visiting Days</p>
        <div className="flex flex-wrap gap-2">{WEEKDAYS.map((day) => <Button key={day} type="button" size="sm" variant={form.orderDays.includes(day) ? 'default' : 'outline'} onClick={() => toggleDay('orderDays', day)}>{day.slice(0, 3)}</Button>)}</div>
      </div>
      <div className="md:col-span-2">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Delivery Days</p>
        <div className="flex flex-wrap gap-2">{WEEKDAYS.map((day) => <Button key={day} type="button" size="sm" variant={form.deliveryDays.includes(day) ? 'default' : 'outline'} onClick={() => toggleDay('deliveryDays', day)}>{day.slice(0, 3)}</Button>)}</div>
      </div>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} /><span className="text-sm font-medium">Active vendor</span></label>
      <div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(value) => onChange({ ...form, notes: value })} /></Field></div>
    </div>
  );
}

function AgeFormView({ form, onChange }: { form: AgeForm; onChange: (form: AgeForm) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="Name"><Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></Field>
      <Field label="Minimum Age"><Input type="number" min="0" value={form.minimumAge} onChange={(event) => onChange({ ...form, minimumAge: event.target.value })} /></Field>
      <Field label="Restriction Type"><Input value={form.restrictionType} onChange={(event) => onChange({ ...form, restrictionType: event.target.value })} /></Field>
      <label className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} /><span className="text-sm font-medium">Active restriction</span></label>
    </div>
  );
}
