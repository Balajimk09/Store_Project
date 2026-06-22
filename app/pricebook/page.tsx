'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStoreData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import {
  supabase,
  type StoreDepartmentRow,
  type StoreVendorRow,
  type TaxCategoryRow,
} from '@/lib/supabase';
import type { Product } from '@/lib/mock-data';
import { computeMargin } from '@/lib/csv';
import { formatCurrency, exportToCsv } from '@/lib/format';
import {
  AlertTriangle,
  CircleAlert,
  Download,
  Package,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type TaxOption = {
  name: string;
  rate: number;
};

type DepartmentOption = {
  name: string;
  ebtEligible: boolean;
};

type VendorOption = {
  name: string;
};

type ProductFormState = {
  upc: string;
  name: string;
  department: string;
  brand: string;
  costPrice: string;
  sellPrice: string;
  stock: string;
  reorderLevel: string;
  vendor: string;
  taxCategory: string;
  taxRate: string;
  taxable: boolean;
  ebtEligible: boolean;
  isActive: boolean;
  notes: string;
};

const DEFAULT_DEPARTMENTS: DepartmentOption[] = [
  { name: 'Beverages', ebtEligible: false },
  { name: 'Snacks', ebtEligible: true },
  { name: 'Candy', ebtEligible: true },
  { name: 'Grocery', ebtEligible: true },
  { name: 'Tobacco', ebtEligible: false },
  { name: 'Beer', ebtEligible: false },
  { name: 'Fuel', ebtEligible: false },
  { name: 'Automotive', ebtEligible: false },
  { name: 'Health & Beauty', ebtEligible: true },
  { name: 'General Merchandise', ebtEligible: false },
];

const DEFAULT_TAX_OPTIONS: TaxOption[] = [
  { name: 'standard', rate: 0 },
  { name: 'non-taxable', rate: 0 },
  { name: 'fuel', rate: 0 },
  { name: 'tobacco', rate: 0 },
  { name: 'alcohol', rate: 0 },
];

const EMPTY_PRODUCT_FORM: ProductFormState = {
  upc: '',
  name: '',
  department: '',
  brand: '',
  costPrice: '',
  sellPrice: '',
  stock: '0',
  reorderLevel: '10',
  vendor: '',
  taxCategory: 'standard',
  taxRate: '0',
  taxable: true,
  ebtEligible: false,
  isActive: true,
  notes: '',
};

function productToForm(product: Product): ProductFormState {
  return {
    upc: product.upc,
    name: product.name,
    department: product.department || product.category || '',
    brand: product.brand || '',
    costPrice: product.costPrice.toFixed(2),
    sellPrice: product.sellPrice.toFixed(2),
    stock: String(product.stock),
    reorderLevel: String(product.reorderLevel),
    vendor: product.vendor || '',
    taxCategory: product.taxCategory || ((product.taxable ?? true) ? 'standard' : 'non-taxable'),
    taxRate: String(product.taxRate ?? 0),
    taxable: product.taxable ?? true,
    ebtEligible: product.ebtEligible ?? false,
    isActive: product.isActive ?? true,
    notes: product.notes || '',
  };
}

function formToProduct(form: ProductFormState): Product {
  const department = form.department.trim() || 'General Merchandise';

  return {
    upc: form.upc.trim(),
    name: form.name.trim(),
    category: department,
    department,
    brand: form.brand.trim() || 'Unknown',
    costPrice: Number(form.costPrice) || 0,
    sellPrice: Number(form.sellPrice) || 0,
    stock: Number(form.stock) || 0,
    reorderLevel: Number(form.reorderLevel) || 10,
    vendor: form.vendor.trim() || undefined,
    taxRate: form.taxable ? Number(form.taxRate) || 0 : 0,
    taxCategory: form.taxable ? form.taxCategory.trim() || 'standard' : 'non-taxable',
    taxable: form.taxable,
    ebtEligible: form.ebtEligible,
    isActive: form.isActive,
    notes: form.notes.trim() || undefined,
  };
}

function validateProductForm(form: ProductFormState): string | null {
  if (!form.upc.trim()) return 'UPC is required.';
  if (!form.name.trim()) return 'Product name is required.';
  if (!form.department.trim()) return 'Department is required.';

  const cost = Number(form.costPrice);
  const sell = Number(form.sellPrice);
  const stock = Number(form.stock);
  const reorder = Number(form.reorderLevel);

  if (!Number.isFinite(cost) || cost < 0) return 'Cost price must be a valid number.';
  if (!Number.isFinite(sell) || sell < 0) return 'Selling price must be a valid number.';
  if (!Number.isFinite(stock) || stock < 0) return 'Stock must be a valid number.';
  if (!Number.isFinite(reorder) || reorder < 0) return 'Reorder level must be a valid number.';

  return null;
}

function marginLabel(product: Product) {
  return computeMargin(product.sellPrice, product.costPrice);
}

function productStockStatus(product: Product) {
  if ((product.isActive ?? true) === false) return 'Inactive';
  if (product.stock <= product.reorderLevel) return 'Reorder';
  return 'In Stock';
}

function taxLabel(product: Product) {
  if ((product.taxable ?? true) === false) return 'No Tax';

  const rate = product.taxRate ?? 0;
  return `${rate.toFixed(rate % 1 === 0 ? 0 : 2)}%`;
}

function rateForTaxCategory(taxCategory: string, taxOptions: TaxOption[]) {
  return taxOptions.find((option) => option.name === taxCategory)?.rate ?? 0;
}

interface ProductFormModalProps {
  mode: 'add' | 'edit';
  open: boolean;
  form: ProductFormState;
  setForm: (form: ProductFormState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  departments: DepartmentOption[];
  taxOptions: TaxOption[];
  vendors: VendorOption[];
}

function ProductFormModal({
  mode,
  open,
  form,
  setForm,
  onClose,
  onSave,
  saving,
  error,
  departments,
  taxOptions,
  vendors,
}: ProductFormModalProps) {
  if (!open) return null;

  const title = mode === 'add' ? 'Add Product' : 'Edit Product';
  const description =
    mode === 'add'
      ? 'Create a product directly in StorePulse without uploading a CSV.'
      : 'Update product identity, department, pricing, inventory, tax category, and vendor details.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="max-h-[92vh] w-full max-w-4xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[calc(92vh-150px)] overflow-y-auto p-5">
          {error && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground">Product Identity</h3>

              <div className="mt-4 grid gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">UPC *</span>
                  <Input
                    value={form.upc}
                    onChange={(e) => setForm({ ...form, upc: e.target.value })}
                    placeholder="0120000010101"
                    disabled={mode === 'edit'}
                  />
                  {mode === 'edit' && (
                    <span className="text-[11px] text-muted-foreground">
                      UPC is locked because it is the product identifier.
                    </span>
                  )}
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Product Name *</span>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Coca-Cola 20oz"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Department *</span>
                  <select
                    value={form.department}
                    onChange={(e) => {
                      const selectedDepartment = departments.find(
                        (department) => department.name === e.target.value
                      );

                      setForm({
                        ...form,
                        department: e.target.value,
                        ebtEligible: selectedDepartment?.ebtEligible ?? form.ebtEligible,
                      });
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select department</option>
                    {departments.map((department) => (
                      <option key={department.name} value={department.name}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted-foreground">
                    Departments are managed from Store Settings.
                  </span>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Brand</span>
                  <Input
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    placeholder="Coca-Cola"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Vendor</span>
                  <select
                    value={form.vendor}
                    onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.name} value={vendor.name}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted-foreground">
                    Vendors are managed from Store Settings.
                  </span>
                </label>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground">Product Rules</h3>

              <div className="mt-4 space-y-4">
                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Active product</span>
                    <span className="text-xs text-muted-foreground">
                      Inactive products stay saved but can be filtered out later.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={form.taxable}
                    onChange={(e) => {
                      const taxable = e.target.checked;
                      const nextCategory = taxable ? 'standard' : 'non-taxable';

                      setForm({
                        ...form,
                        taxable,
                        taxCategory: nextCategory,
                        taxRate: String(rateForTaxCategory(nextCategory, taxOptions)),
                      });
                    }}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Taxable item</span>
                    <span className="text-xs text-muted-foreground">
                      Turn off for non-taxable products.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={form.ebtEligible}
                    onChange={(e) => setForm({ ...form, ebtEligible: e.target.checked })}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      EBT / Food Stamp eligible
                    </span>
                    <span className="text-xs text-muted-foreground">
                      This can automatically follow the selected department default.
                    </span>
                  </span>
                </label>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground">Pricing</h3>

              <div className="mt-4 grid gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Cost Price *</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                    placeholder="1.25"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Selling Price *</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.sellPrice}
                    onChange={(e) => setForm({ ...form, sellPrice: e.target.value })}
                    placeholder="2.49"
                  />
                </label>

                <div className="rounded-lg bg-secondary/50 p-3 text-sm">
                  <span className="text-muted-foreground">Calculated margin: </span>
                  <span className="font-semibold text-foreground">
                    {computeMargin(Number(form.sellPrice) || 0, Number(form.costPrice) || 0).toFixed(1)}%
                  </span>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground">Inventory</h3>

              <div className="mt-4 grid gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Current Stock</span>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    placeholder="142"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Reorder Level</span>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={form.reorderLevel}
                    onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                    placeholder="48"
                  />
                </label>
              </div>
            </Card>

            <Card className="p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Tax Category</h3>

              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Select Tax Category</span>
                  <select
                    value={form.taxCategory}
                    disabled={!form.taxable}
                    onChange={(e) => {
                      const taxCategory = e.target.value;

                      setForm({
                        ...form,
                        taxCategory,
                        taxRate: String(rateForTaxCategory(taxCategory, taxOptions)),
                      });
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {taxOptions.map((option) => (
                      <option key={option.name} value={option.name}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted-foreground">
                    Tax categories and percentages are managed from Store Settings.
                  </span>
                </label>

                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Selected Rate
                  </p>
                  <p className="mt-2 text-2xl font-bold text-foreground">
                    {form.taxable ? `${Number(form.taxRate || 0)}%` : '0%'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rate is controlled by the selected tax category.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Notes</h3>

              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional product notes, restrictions, vendor notes, or internal comments."
                className="mt-4 min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Card>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>

          <Button onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : mode === 'add' ? 'Add Product' : 'Save Changes'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function PricebookPage() {
  const {
    products: storeProducts,
    updateProduct,
    createProduct,
    isDemoProducts,
    productsMeta,
    cloudError,
    loaded,
  } = useStoreData();

  const { user, store: authStore, loading: authLoading } = useAuth();

  const [items, setItems] = useState<Product[]>(storeProducts);
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<string>('All');
  const [taxFilter, setTaxFilter] = useState<string>('All');
  const [marginFilter, setMarginFilter] = useState<string>('All');
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [settingsDepartments, setSettingsDepartments] = useState<DepartmentOption[]>([]);
  const [settingsTaxOptions, setSettingsTaxOptions] = useState<TaxOption[]>([]);
  const [settingsVendors, setSettingsVendors] = useState<VendorOption[]>([]);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    setItems(storeProducts);
  }, [storeProducts]);

  const loadProductSettings = useCallback(async () => {
    if (authLoading) return;

    if (!user || !authStore) {
      setSettingsDepartments([]);
      setSettingsTaxOptions([]);
      setSettingsVendors([]);
      return;
    }

    setSettingsError(null);

    const [departmentResult, taxResult, vendorResult] = await Promise.all([
      supabase
        .from('store_departments')
        .select('*')
        .eq('store_id', authStore.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('tax_categories')
        .select('*')
        .eq('store_id', authStore.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('store_vendors')
        .select('*')
        .eq('store_id', authStore.id)
        .eq('is_active', true)
        .order('vendor_name', { ascending: true }),
    ]);

    if (departmentResult.error) {
      setSettingsError(`Could not load departments: ${departmentResult.error.message}`);
      return;
    }

    if (taxResult.error) {
      setSettingsError(`Could not load tax categories: ${taxResult.error.message}`);
      return;
    }

    if (vendorResult.error) {
      setSettingsError(`Could not load vendors: ${vendorResult.error.message}`);
      return;
    }

    setSettingsDepartments(
      ((departmentResult.data || []) as StoreDepartmentRow[]).map((department) => ({
        name: department.name,
        ebtEligible: department.ebt_eligible ?? false,
      }))
    );

    setSettingsTaxOptions(
      ((taxResult.data || []) as TaxCategoryRow[]).map((tax) => ({
        name: tax.name,
        rate: tax.rate ?? 0,
      }))
    );

    setSettingsVendors(
      ((vendorResult.data || []) as StoreVendorRow[]).map((vendor) => ({
        name: vendor.vendor_name,
      }))
    );
  }, [authLoading, user, authStore]);

  useEffect(() => {
    void loadProductSettings();
  }, [loadProductSettings]);

  const departments = useMemo<DepartmentOption[]>(() => {
    if (settingsDepartments.length > 0) {
      return settingsDepartments;
    }

    const fallback = new Map<string, DepartmentOption>();

    DEFAULT_DEPARTMENTS.forEach((department) => {
      fallback.set(department.name, department);
    });

    storeProducts.forEach((product) => {
      const name = product.department || product.category;

      if (name && !fallback.has(name)) {
        fallback.set(name, {
          name,
          ebtEligible: product.ebtEligible ?? false,
        });
      }
    });

    return Array.from(fallback.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [settingsDepartments, storeProducts]);

  const taxOptions = useMemo<TaxOption[]>(() => {
    if (settingsTaxOptions.length > 0) {
      return settingsTaxOptions;
    }

    const map = new Map<string, number>();

    DEFAULT_TAX_OPTIONS.forEach((option) => {
      map.set(option.name, option.rate);
    });

    storeProducts.forEach((product) => {
      const name = product.taxCategory || ((product.taxable ?? true) ? 'standard' : 'non-taxable');
      const rate = product.taxRate ?? map.get(name) ?? 0;

      map.set(name, rate);
    });

    return Array.from(map.entries())
      .map(([name, rate]) => ({ name, rate }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [settingsTaxOptions, storeProducts]);

  const vendors = useMemo<VendorOption[]>(() => {
    const map = new Map<string, VendorOption>();

    settingsVendors.forEach((vendor) => {
      if (vendor.name) {
        map.set(vendor.name, vendor);
      }
    });

    storeProducts.forEach((product) => {
      if (product.vendor && !map.has(product.vendor)) {
        map.set(product.vendor, { name: product.vendor });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [settingsVendors, storeProducts]);

  const filtered = useMemo(() => {
    return items.filter((product) => {
      const productDepartment = product.department || product.category;
      const productMargin = marginLabel(product);
      const stockStatus = productStockStatus(product);

      if (departmentFilter !== 'All' && productDepartment !== departmentFilter) return false;
      if (stockFilter !== 'All' && stockStatus !== stockFilter) return false;

      if (taxFilter === 'Taxable' && (product.taxable ?? true) === false) return false;
      if (taxFilter === 'Non-taxable' && (product.taxable ?? true) !== false) return false;
      if (taxFilter === 'EBT eligible' && (product.ebtEligible ?? false) !== true) return false;

      if (marginFilter === 'Low margin' && productMargin >= 20) return false;
      if (marginFilter === 'Healthy margin' && productMargin < 20) return false;

      if (query.trim()) {
        const q = query.toLowerCase().trim();

        const haystack = [
          product.upc,
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

        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [items, query, departmentFilter, stockFilter, taxFilter, marginFilter]);

  const lowStockCount = items.filter((product) => product.stock <= product.reorderLevel).length;
  const inactiveCount = items.filter((product) => (product.isActive ?? true) === false).length;
  const taxableCount = items.filter((product) => (product.taxable ?? true) !== false).length;
  const ebtCount = items.filter((product) => product.ebtEligible ?? false).length;

  const openAddModal = () => {
    const defaultTax =
      taxOptions.find((option) => option.name === 'standard') ||
      taxOptions[0] ||
      { name: 'standard', rate: 0 };

    setModalMode('add');
    setForm({
      ...EMPTY_PRODUCT_FORM,
      department: '',
      ebtEligible: false,
      taxCategory: defaultTax.name,
      taxRate: String(defaultTax.rate),
      vendor: '',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setModalMode('edit');
    setForm(productToForm(product));
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setFormError(null);
  };

  const saveProduct = async () => {
    const validationError = validateProductForm(form);

    if (validationError) {
      setFormError(validationError);
      return;
    }

    const product = formToProduct(form);

    setSaving(true);
    setFormError(null);

    const result = modalMode === 'add' ? await createProduct(product) : await updateProduct(product);

    setSaving(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    setModalOpen(false);
  };

  const handleExport = () => {
    exportToCsv(
      'storepulse-pricebook.csv',
      filtered.map((product) => ({
        UPC: product.upc,
        Item: product.name,
        Department: product.department || product.category,
        Brand: product.brand || '',
        Vendor: product.vendor || '',
        CostPrice: product.costPrice.toFixed(2),
        SellPrice: product.sellPrice.toFixed(2),
        MarginPct: marginLabel(product).toFixed(1),
        Taxable: (product.taxable ?? true) ? 'Yes' : 'No',
        TaxCategory: product.taxCategory || '',
        TaxRate: product.taxRate ?? 0,
        EbtEligible: product.ebtEligible ? 'Yes' : 'No',
        Stock: product.stock,
        ReorderLevel: product.reorderLevel,
        Status: productStockStatus(product),
        Active: (product.isActive ?? true) ? 'Yes' : 'No',
        Notes: product.notes || '',
      }))
    );
  };

  const clearFilters = () => {
    setQuery('');
    setDepartmentFilter('All');
    setStockFilter('All');
    setTaxFilter('All');
    setMarginFilter('All');
  };

  return (
    <DashboardShell>
      {!loaded ? (
        <PageLoading />
      ) : (
        <>
          <PageHeader
            title="Pricebook"
            description={`${items.length} products · ${lowStockCount} below reorder level · ${taxableCount} taxable · ${ebtCount} EBT eligible · ${inactiveCount} inactive · ${
              isDemoProducts ? 'demo data' : productsMeta.fileName
            }`}
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>

              <Button size="sm" onClick={openAddModal}>
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Button>
            </div>
          </PageHeader>

          {settingsError && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{settingsError}</span>
            </div>
          )}

          {cloudError && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{cloudError}</span>
            </div>
          )}

          <div className="mb-5 grid gap-4 md:grid-cols-5">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Products</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{items.length.toLocaleString()}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Low Stock</p>
              <p className="mt-2 text-2xl font-bold text-destructive">{lowStockCount.toLocaleString()}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Taxable</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{taxableCount.toLocaleString()}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">EBT Eligible</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{ebtCount.toLocaleString()}</p>
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inactive</p>
              <p className="mt-2 text-2xl font-bold text-muted-foreground">{inactiveCount.toLocaleString()}</p>
            </Card>
          </div>

          <Card className="mb-5 p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by item, UPC, brand, vendor, or tax category..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Clear Filters
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All departments</option>
                  {departments.map((department) => (
                    <option key={department.name} value={department.name}>
                      {department.name}
                    </option>
                  ))}
                </select>

                <select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All stock statuses</option>
                  <option value="In Stock">In Stock</option>
                  <option value="Reorder">Reorder</option>
                  <option value="Inactive">Inactive</option>
                </select>

                <select
                  value={taxFilter}
                  onChange={(e) => setTaxFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All tax / EBT statuses</option>
                  <option value="Taxable">Taxable</option>
                  <option value="Non-taxable">Non-taxable</option>
                  <option value="EBT eligible">EBT eligible</option>
                </select>

                <select
                  value={marginFilter}
                  onChange={(e) => setMarginFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All margins</option>
                  <option value="Low margin">Low margin below 20%</option>
                  <option value="Healthy margin">Healthy margin 20%+</option>
                </select>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="grid grid-cols-[1.7fr_1fr_1fr_1fr_1fr_1fr_90px] border-b border-border bg-secondary/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <div>Product</div>
              <div>Department</div>
              <div>Pricing</div>
              <div>Tax / EBT</div>
              <div>Inventory</div>
              <div>Status</div>
              <div className="text-right">Action</div>
            </div>

            <div>
              {filtered.map((product) => {
                const margin = marginLabel(product);
                const isActive = product.isActive ?? true;
                const lowStock = product.stock <= product.reorderLevel;

                return (
                  <div
                    key={product.upc}
                    className={cn(
                      'grid grid-cols-[1.7fr_1fr_1fr_1fr_1fr_1fr_90px] items-center gap-4 border-b border-border/60 px-4 py-4 text-sm transition-colors hover:bg-secondary/30',
                      !isActive && 'bg-muted/30 opacity-75'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                          <Package className="h-4 w-4" />
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{product.name}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">UPC {product.upc}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {product.brand || 'Unknown brand'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {product.department || product.category}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {product.vendor || 'No vendor'}
                      </p>
                    </div>

                    <div>
                      <p className="font-semibold text-foreground">{formatCurrency(product.sellPrice)}</p>
                      <p className="text-xs text-muted-foreground">Cost {formatCurrency(product.costPrice)}</p>
                      <span
                        className={cn(
                          'mt-1 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                          margin >= 50
                            ? 'bg-success/10 text-success'
                            : margin >= 20
                              ? 'bg-chart-3/10 text-chart-3'
                              : 'bg-destructive/10 text-destructive'
                        )}
                      >
                        {margin.toFixed(1)}%
                      </span>
                    </div>

                    <div>
                      <span
                        className={cn(
                          'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                          (product.taxable ?? true)
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {taxLabel(product)}
                      </span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {product.taxCategory || ((product.taxable ?? true) ? 'standard' : 'non-taxable')}
                      </p>
                      {product.ebtEligible && (
                        <span className="mt-1 inline-flex rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                          EBT
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="font-medium text-foreground">Stock {product.stock}</p>
                      <p className="text-xs text-muted-foreground">Reorder {product.reorderLevel}</p>
                    </div>

                    <div>
                      {!isActive ? (
                        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Inactive
                        </span>
                      ) : lowStock ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          Reorder
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                          In Stock
                        </span>
                      )}
                    </div>

                    <div className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditModal(product)}
                        className="h-8 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                    <Search className="h-5 w-5" />
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-foreground">
                    No products match your filters
                  </h3>

                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    Clear filters, search by another UPC or item name, or add a product manually.
                  </p>

                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" onClick={clearFilters}>
                      Clear Filters
                    </Button>

                    <Button onClick={openAddModal}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Product
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card className="mt-5 border-dashed p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Settings className="h-5 w-5" />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Connected to Store Settings
                  </h3>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Department, tax category, and vendor dropdowns now come from Store Settings.
                  </p>
                </div>
              </div>

              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                store_settings
              </span>
            </div>
          </Card>

          <ProductFormModal
            mode={modalMode}
            open={modalOpen}
            form={form}
            setForm={setForm}
            onClose={closeModal}
            onSave={saveProduct}
            saving={saving}
            error={formError}
            departments={departments}
            taxOptions={taxOptions}
            vendors={vendors}
          />
        </>
      )}
    </DashboardShell>
  );
}