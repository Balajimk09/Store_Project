'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { useStoreData } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type {
  PromotionProductRow,
  PromotionRow,
  StoreDepartmentRow,
  StoreVendorRow,
  TaxCategoryRow,
} from '@/lib/supabase';
import type { Product } from '@/lib/mock-data';
import {
  BadgePercent,
  Building2,
  CheckCircle2,
  CircleAlert,
  Mail,
  PackagePlus,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  Tag,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type TabKey = 'tax' | 'deals' | 'departments' | 'vendors' | 'age';
type ModalType = 'tax' | 'deal' | 'department' | 'vendor' | null;
type ModalMode = 'add' | 'edit';

type DealWithProducts = PromotionRow & {
  products: PromotionProductRow[];
};

type SelectedDealProduct = {
  upc: string;
  name: string;
  department?: string;
  sellPrice?: number;
};

type AgeRestrictionPresetRow = {
  id: string;
  store_id: string;
  name: string;
  minimum_age: number;
  restriction_type: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string | null;
};

const emptyTax = {
  name: '',
  rate: '0',
  description: '',
  isDefault: false,
  isActive: true,
};

const emptyDepartment = {
  name: '',
  ebtEligible: false,
  isActive: true,
};

const emptyVendor = {
  vendorName: '',
  salesRepName: '',
  phone: '',
  email: '',
  notes: '',
  isActive: true,
};

const emptyDeal = {
  name: '',
  quantityRequired: '2',
  dealPrice: '',
  startDate: '',
  endDate: '',
  isActive: true,
};

const emptyAgePreset = {
  name: '',
  minimumAge: '21',
  restrictionType: '',
};

const DEFAULT_AGE_PRESETS = [
  { name: 'Tobacco', minimum_age: 21, restriction_type: 'Tobacco' },
  { name: 'Alcohol', minimum_age: 21, restriction_type: 'Alcohol' },
  { name: 'Lottery', minimum_age: 18, restriction_type: 'Lottery' },
  { name: 'Vape / E-Cigarette', minimum_age: 21, restriction_type: 'Vape' },
  { name: 'Adult Content', minimum_age: 18, restriction_type: 'Adult' },
];

function percent(value: number) {
  return `${Number(value || 0).toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function dateLabel(value: string | null) {
  if (!value) return 'No date';
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function productSearchText(product: Product) {
  return [
    product.name,
    product.upc,
    product.department,
    product.category,
    product.brand,
    product.vendor,
    product.sellPrice,
    product.costPrice,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function productToSelected(product: Product): SelectedDealProduct {
  return {
    upc: product.upc,
    name: product.name,
    department: product.department || product.category,
    sellPrice: product.sellPrice,
  };
}

function SectionHeader({
  title,
  description,
  buttonLabel,
  onAdd,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <Button onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>
    </div>
  );
}

export default function StoreSettingsPage() {
  const { user, store, loading: authLoading } = useAuth();
  const { products } = useStoreData();

  const [activeTab, setActiveTab] = useState<TabKey>('tax');
  const [modalType, setModalType] = useState<ModalType>(null);
  const [modalMode, setModalMode] = useState<ModalMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [taxCategories, setTaxCategories] = useState<TaxCategoryRow[]>([]);
  const [departments, setDepartments] = useState<StoreDepartmentRow[]>([]);
  const [vendors, setVendors] = useState<StoreVendorRow[]>([]);
  const [deals, setDeals] = useState<DealWithProducts[]>([]);
  const [agePresets, setAgePresets] = useState<AgeRestrictionPresetRow[]>([]);

  const [taxForm, setTaxForm] = useState(emptyTax);
  const [departmentForm, setDepartmentForm] = useState(emptyDepartment);
  const [vendorForm, setVendorForm] = useState(emptyVendor);
  const [dealForm, setDealForm] = useState(emptyDeal);
  const [agePresetForm, setAgePresetForm] = useState(emptyAgePreset);
  const [editingAgePresetId, setEditingAgePresetId] = useState<string | null>(null);

  const [productSearch, setProductSearch] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<SelectedDealProduct[]>([]);

  const storeId = store?.id ?? null;

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 2500);
  };

  const loadSettings = useCallback(async () => {
    if (authLoading) return;

    if (!user || !storeId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError(null);

    const [taxResult, departmentResult, vendorResult, dealResult, dealProductResult, agePresetResult] =
      await Promise.all([
        supabase.from('tax_categories').select('*').eq('store_id', storeId).order('name'),
        supabase.from('store_departments').select('*').eq('store_id', storeId).order('name'),
        supabase.from('store_vendors').select('*').eq('store_id', storeId).order('vendor_name'),
        supabase.from('promotions').select('*').eq('store_id', storeId).order('created_at', { ascending: false }),
        supabase.from('promotion_products').select('*').eq('store_id', storeId),
        supabase.from('store_age_restriction_presets').select('*').eq('store_id', storeId).order('name'),
      ]);

    if (taxResult.error) {
      setPageError(`Could not load tax categories: ${taxResult.error.message}`);
      setLoading(false);
      return;
    }

    if (departmentResult.error) {
      setPageError(`Could not load departments: ${departmentResult.error.message}`);
      setLoading(false);
      return;
    }

    if (vendorResult.error) {
      setPageError(`Could not load vendors: ${vendorResult.error.message}`);
      setLoading(false);
      return;
    }

    if (dealResult.error) {
      setPageError(`Could not load deals: ${dealResult.error.message}`);
      setLoading(false);
      return;
    }

    if (dealProductResult.error) {
      setPageError(`Could not load deal products: ${dealProductResult.error.message}`);
      setLoading(false);
      return;
    }

    if (agePresetResult.error) {
      setPageError(`Could not load age restriction presets: ${agePresetResult.error.message}`);
      setLoading(false);
      return;
    }

    const loadedDeals = (dealResult.data || []) as PromotionRow[];
    const loadedProducts = (dealProductResult.data || []) as PromotionProductRow[];

    const productsByPromotion = loadedProducts.reduce<Record<string, PromotionProductRow[]>>(
      (acc, row) => {
        acc[row.promotion_id] = acc[row.promotion_id] || [];
        acc[row.promotion_id].push(row);
        return acc;
      },
      {}
    );

    setTaxCategories((taxResult.data || []) as TaxCategoryRow[]);
    setDepartments((departmentResult.data || []) as StoreDepartmentRow[]);
    setVendors((vendorResult.data || []) as StoreVendorRow[]);
    setAgePresets((agePresetResult.data || []) as AgeRestrictionPresetRow[]);
    setDeals(
      loadedDeals.map((deal) => ({
        ...deal,
        products: productsByPromotion[deal.id] || [],
      }))
    );

    setLoading(false);
  }, [authLoading, user, storeId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const activeTaxes = taxCategories.filter((tax) => tax.is_active);
  const activeDeals = deals.filter((deal) => deal.is_active);
  const activeDepartments = departments.filter((department) => department.is_active);
  const activeVendors = vendors.filter((vendor) => vendor.is_active);
  const activeAgePresets = agePresets.filter((preset) => preset.is_active);

  const searchedProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();

    const available = products.filter(
      (product) => !selectedProducts.some((selected) => selected.upc === product.upc)
    );

    if (!query) return available.slice(0, 8);

    return available.filter((product) => productSearchText(product).includes(query)).slice(0, 12);
  }, [products, productSearch, selectedProducts]);

  const openAddModal = (type: ModalType) => {
    setModalType(type);
    setModalMode('add');
    setEditingId(null);
    setPageError(null);

    if (type === 'tax') setTaxForm(emptyTax);
    if (type === 'department') setDepartmentForm(emptyDepartment);
    if (type === 'vendor') setVendorForm(emptyVendor);

    if (type === 'deal') {
      setDealForm(emptyDeal);
      setProductSearch('');
      setSelectedProducts([]);
    }
  };

  const openEditTax = (tax: TaxCategoryRow) => {
    setModalType('tax');
    setModalMode('edit');
    setEditingId(tax.id);
    setTaxForm({
      name: tax.name,
      rate: String(tax.rate),
      description: tax.description || '',
      isDefault: tax.is_default,
      isActive: tax.is_active,
    });
  };

  const openEditDepartment = (department: StoreDepartmentRow) => {
    setModalType('department');
    setModalMode('edit');
    setEditingId(department.id);
    setDepartmentForm({
      name: department.name,
      ebtEligible: department.ebt_eligible,
      isActive: department.is_active,
    });
  };

  const openEditVendor = (vendor: StoreVendorRow) => {
    setModalType('vendor');
    setModalMode('edit');
    setEditingId(vendor.id);
    setVendorForm({
      vendorName: vendor.vendor_name,
      salesRepName: vendor.sales_rep_name || '',
      phone: vendor.phone || '',
      email: vendor.email || '',
      notes: vendor.notes || '',
      isActive: vendor.is_active,
    });
  };

  const openEditDeal = (deal: DealWithProducts) => {
    setModalType('deal');
    setModalMode('edit');
    setEditingId(deal.id);
    setDealForm({
      name: deal.name,
      quantityRequired: String(deal.quantity_required),
      dealPrice: String(deal.deal_price),
      startDate: deal.start_date || '',
      endDate: deal.end_date || '',
      isActive: deal.is_active,
    });
    setProductSearch('');
    setSelectedProducts(
      deal.products.map((product) => ({
        upc: product.upc,
        name: product.item_name || product.upc,
      }))
    );
  };

  const closeModal = () => {
    if (saving) return;
    setModalType(null);
    setEditingId(null);
    setPageError(null);
  };

  const saveTax = async () => {
    if (!storeId) return;

    const name = taxForm.name.trim();
    const rate = Number(taxForm.rate);

    if (!name) {
      setPageError('Tax name is required.');
      return;
    }

    if (!Number.isFinite(rate) || rate < 0) {
      setPageError('Tax percentage must be valid.');
      return;
    }

    setSaving(true);

    if (taxForm.isDefault) {
      await supabase
        .from('tax_categories')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('store_id', storeId);
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

    const result =
      modalMode === 'edit' && editingId
        ? await supabase.from('tax_categories').update(payload).eq('id', editingId)
        : await supabase.from('tax_categories').upsert(payload, { onConflict: 'store_id,name' });

    if (!result.error && taxForm.isDefault) {
      await supabase.from('store_settings').upsert(
        {
          store_id: storeId,
          default_tax_category: name,
          default_tax_rate: rate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'store_id' }
      );
    }

    setSaving(false);

    if (result.error) {
      setPageError(`Could not save tax: ${result.error.message}`);
      return;
    }

    closeModal();
    showSuccess(modalMode === 'edit' ? 'Tax updated.' : 'Tax saved.');
    await loadSettings();
  };

  const deleteTax = async (tax: TaxCategoryRow) => {
    if (tax.is_default) {
      setPageError('Default tax cannot be deleted. Set another tax as default first.');
      return;
    }

    const ok = window.confirm(`Delete tax category "${tax.name}"?`);
    if (!ok) return;

    const { error } = await supabase.from('tax_categories').delete().eq('id', tax.id);

    if (error) {
      setPageError(`Could not delete tax: ${error.message}`);
      return;
    }

    showSuccess('Tax deleted.');
    await loadSettings();
  };

  const setDefaultTax = async (tax: TaxCategoryRow) => {
    if (!storeId) return;

    await supabase
      .from('tax_categories')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('store_id', storeId);

    const { error } = await supabase
      .from('tax_categories')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', tax.id);

    if (error) {
      setPageError(`Could not set default tax: ${error.message}`);
      return;
    }

    await supabase.from('store_settings').upsert(
      {
        store_id: storeId,
        default_tax_category: tax.name,
        default_tax_rate: tax.rate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' }
    );

    showSuccess('Default tax updated.');
    await loadSettings();
  };

  const toggleTax = async (tax: TaxCategoryRow) => {
    const { error } = await supabase
      .from('tax_categories')
      .update({ is_active: !tax.is_active, updated_at: new Date().toISOString() })
      .eq('id', tax.id);

    if (error) {
      setPageError(`Could not update tax: ${error.message}`);
      return;
    }

    showSuccess('Tax updated.');
    await loadSettings();
  };

  const saveDepartment = async () => {
    if (!storeId) return;

    const name = departmentForm.name.trim();

    if (!name) {
      setPageError('Department name is required.');
      return;
    }

    setSaving(true);

    const payload = {
      store_id: storeId,
      name,
      ebt_eligible: departmentForm.ebtEligible,
      is_active: departmentForm.isActive,
      updated_at: new Date().toISOString(),
    };

    const result =
      modalMode === 'edit' && editingId
        ? await supabase.from('store_departments').update(payload).eq('id', editingId)
        : await supabase.from('store_departments').upsert(payload, { onConflict: 'store_id,name' });

    setSaving(false);

    if (result.error) {
      setPageError(`Could not save department: ${result.error.message}`);
      return;
    }

    closeModal();
    showSuccess(modalMode === 'edit' ? 'Department updated.' : 'Department saved.');
    await loadSettings();
  };

  const deleteDepartment = async (department: StoreDepartmentRow) => {
    const ok = window.confirm(`Delete department "${department.name}"?`);
    if (!ok) return;

    const { error } = await supabase.from('store_departments').delete().eq('id', department.id);

    if (error) {
      setPageError(`Could not delete department: ${error.message}`);
      return;
    }

    showSuccess('Department deleted.');
    await loadSettings();
  };

  const toggleDepartment = async (department: StoreDepartmentRow) => {
    const { error } = await supabase
      .from('store_departments')
      .update({ is_active: !department.is_active, updated_at: new Date().toISOString() })
      .eq('id', department.id);

    if (error) {
      setPageError(`Could not update department: ${error.message}`);
      return;
    }

    showSuccess('Department updated.');
    await loadSettings();
  };

  const saveVendor = async () => {
    if (!storeId) return;

    const vendorName = vendorForm.vendorName.trim();

    if (!vendorName) {
      setPageError('Vendor name is required.');
      return;
    }

    setSaving(true);

    const payload = {
      store_id: storeId,
      vendor_name: vendorName,
      sales_rep_name: vendorForm.salesRepName.trim() || null,
      phone: vendorForm.phone.trim() || null,
      email: vendorForm.email.trim() || null,
      notes: vendorForm.notes.trim() || null,
      is_active: vendorForm.isActive,
      updated_at: new Date().toISOString(),
    };

    const result =
      modalMode === 'edit' && editingId
        ? await supabase.from('store_vendors').update(payload).eq('id', editingId)
        : await supabase.from('store_vendors').upsert(payload, { onConflict: 'store_id,vendor_name' });

    setSaving(false);

    if (result.error) {
      setPageError(`Could not save vendor: ${result.error.message}`);
      return;
    }

    closeModal();
    showSuccess(modalMode === 'edit' ? 'Vendor updated.' : 'Vendor saved.');
    await loadSettings();
  };

  const deleteVendor = async (vendor: StoreVendorRow) => {
    const ok = window.confirm(`Delete vendor "${vendor.vendor_name}"?`);
    if (!ok) return;

    const { error } = await supabase.from('store_vendors').delete().eq('id', vendor.id);

    if (error) {
      setPageError(`Could not delete vendor: ${error.message}`);
      return;
    }

    showSuccess('Vendor deleted.');
    await loadSettings();
  };

  const toggleVendor = async (vendor: StoreVendorRow) => {
    const { error } = await supabase
      .from('store_vendors')
      .update({ is_active: !vendor.is_active, updated_at: new Date().toISOString() })
      .eq('id', vendor.id);

    if (error) {
      setPageError(`Could not update vendor: ${error.message}`);
      return;
    }

    showSuccess('Vendor updated.');
    await loadSettings();
  };

  const resetAgePresetForm = () => {
    setAgePresetForm(emptyAgePreset);
    setEditingAgePresetId(null);
  };

  const editAgePreset = (preset: AgeRestrictionPresetRow) => {
    setEditingAgePresetId(preset.id);
    setAgePresetForm({
      name: preset.name,
      minimumAge: String(preset.minimum_age),
      restrictionType: preset.restriction_type,
    });
  };

  const saveAgePreset = async () => {
    if (!storeId) return;

    const name = agePresetForm.name.trim();
    const minimumAge = Number(agePresetForm.minimumAge);
    const restrictionType = agePresetForm.restrictionType.trim();

    if (!name || !restrictionType) {
      setPageError('Preset name and restriction type are required.');
      return;
    }

    if (!Number.isFinite(minimumAge) || minimumAge < 0) {
      setPageError('Minimum age must be valid.');
      return;
    }

    const payload = {
      store_id: storeId,
      name,
      minimum_age: minimumAge,
      restriction_type: restrictionType,
      updated_at: new Date().toISOString(),
    };

    const wasEditing = Boolean(editingAgePresetId);
    const result = editingAgePresetId
      ? await supabase.from('store_age_restriction_presets').update(payload).eq('id', editingAgePresetId)
      : await supabase.from('store_age_restriction_presets').insert({ ...payload, is_active: true });

    if (result.error) {
      setPageError(`Could not save age preset: ${result.error.message}`);
      return;
    }

    resetAgePresetForm();
    showSuccess(wasEditing ? 'Age restriction preset updated.' : 'Age restriction preset added.');
    await loadSettings();
  };

  const importDefaultAgePresets = async () => {
    if (!storeId) return;

    const rows = DEFAULT_AGE_PRESETS.map((preset) => ({
      store_id: storeId,
      ...preset,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from('store_age_restriction_presets').insert(rows);

    if (error) {
      setPageError(`Could not import defaults: ${error.message}`);
      return;
    }

    showSuccess('Default age restriction presets imported.');
    await loadSettings();
  };

  const deleteAgePreset = async (preset: AgeRestrictionPresetRow) => {
    const ok = window.confirm(`Delete age restriction preset "${preset.name}"?`);
    if (!ok) return;

    const { error } = await supabase.from('store_age_restriction_presets').delete().eq('id', preset.id);

    if (error) {
      setPageError(`Could not delete age preset: ${error.message}`);
      return;
    }

    showSuccess('Age restriction preset deleted.');
    await loadSettings();
  };

  const toggleAgePreset = async (preset: AgeRestrictionPresetRow) => {
    const { error } = await supabase
      .from('store_age_restriction_presets')
      .update({ is_active: !preset.is_active, updated_at: new Date().toISOString() })
      .eq('id', preset.id);

    if (error) {
      setPageError(`Could not update age preset: ${error.message}`);
      return;
    }

    showSuccess('Age restriction preset updated.');
    await loadSettings();
  };

  const saveDeal = async () => {
    if (!storeId) return;

    const name = dealForm.name.trim();
    const quantity = Number(dealForm.quantityRequired);
    const price = Number(dealForm.dealPrice);

    if (!name) {
      setPageError('Deal name is required.');
      return;
    }

    if (selectedProducts.length === 0) {
      setPageError('Add at least one product to the deal.');
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPageError('Quantity required must be valid.');
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      setPageError('Deal price must be valid.');
      return;
    }

    setSaving(true);

    let promotionId = editingId;

    if (modalMode === 'edit' && editingId) {
      const { error } = await supabase
        .from('promotions')
        .update({
          name,
          deal_type: 'quantity_price',
          quantity_required: quantity,
          deal_price: price,
          start_date: dealForm.startDate || null,
          end_date: dealForm.endDate || null,
          is_active: dealForm.isActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId);

      if (error) {
        setSaving(false);
        setPageError(`Could not update deal: ${error.message}`);
        return;
      }

      await supabase.from('promotion_products').delete().eq('promotion_id', editingId);
    } else {
      const { data, error } = await supabase
        .from('promotions')
        .insert({
          store_id: storeId,
          name,
          deal_type: 'quantity_price',
          quantity_required: quantity,
          deal_price: price,
          start_date: dealForm.startDate || null,
          end_date: dealForm.endDate || null,
          is_active: dealForm.isActive,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (error) {
        setSaving(false);
        setPageError(`Could not save deal: ${error.message}`);
        return;
      }

      promotionId = (data as PromotionRow).id;
    }

    const productRows = selectedProducts.map((product) => ({
      store_id: storeId,
      promotion_id: promotionId,
      upc: product.upc,
      item_name: product.name,
    }));

    const { error: productsError } = await supabase.from('promotion_products').insert(productRows);

    setSaving(false);

    if (productsError) {
      setPageError(`Deal saved, but products failed: ${productsError.message}`);
      return;
    }

    closeModal();
    showSuccess(modalMode === 'edit' ? 'Deal updated.' : 'Deal saved.');
    await loadSettings();
  };

  const deleteDeal = async (deal: DealWithProducts) => {
    const ok = window.confirm(`Delete deal "${deal.name}"?`);
    if (!ok) return;

    const { error } = await supabase.from('promotions').delete().eq('id', deal.id);

    if (error) {
      setPageError(`Could not delete deal: ${error.message}`);
      return;
    }

    showSuccess('Deal deleted.');
    await loadSettings();
  };

  const toggleDeal = async (deal: DealWithProducts) => {
    const { error } = await supabase
      .from('promotions')
      .update({ is_active: !deal.is_active, updated_at: new Date().toISOString() })
      .eq('id', deal.id);

    if (error) {
      setPageError(`Could not update deal: ${error.message}`);
      return;
    }

    showSuccess('Deal updated.');
    await loadSettings();
  };

  if (authLoading || loading) {
    return (
      <DashboardShell>
        <PageLoading />
      </DashboardShell>
    );
  }

  if (!user || !storeId) {
    return (
      <DashboardShell>
        <PageHeader
          title="Store Settings"
          description="Complete store setup before managing taxes, deals, departments, and vendors."
        />

        <Card className="p-6">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <h2 className="font-semibold text-foreground">Store setup required</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Please sign in and complete store setup first.
              </p>
            </div>
          </div>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Store Settings"
        description="Customize tax, deals and promo, departments, and vendors for your store."
      />

      {pageError && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pageError}</span>
        </div>
      )}

      {successMessage && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="mb-5 grid gap-4 md:grid-cols-5">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tax Categories</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{activeTaxes.length}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active Deals</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{activeDeals.length}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Departments</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{activeDepartments.length}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendors</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{activeVendors.length}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Age Presets</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{activeAgePresets.length}</p>
        </Card>
      </div>

      <Card className="mb-5 p-2">
        <div className="grid gap-2 md:grid-cols-5">
          {[
            { key: 'tax' as const, label: 'Tax', icon: BadgePercent },
            { key: 'deals' as const, label: 'Deals / Promo', icon: Tag },
            { key: 'departments' as const, label: 'Departments', icon: Building2 },
            { key: 'vendors' as const, label: 'Vendors', icon: Truck },
            { key: 'age' as const, label: 'Age Restrictions', icon: ShieldAlert },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </Card>

      {activeTab === 'tax' && (
        <Card className="p-5">
          <SectionHeader
            title="Tax"
            description="Create, edit, update, disable, or delete tax categories."
            buttonLabel="Add Tax"
            onAdd={() => openAddModal('tax')}
          />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {taxCategories.map((tax) => (
              <Card key={tax.id} className={cn('p-4', !tax.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{tax.name}</h3>
                    <p className="mt-1 text-2xl font-bold text-primary">{percent(tax.rate)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tax.description || 'No description'}
                    </p>
                  </div>

                  {tax.is_default && (
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      Default
                    </span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditTax(tax)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>

                  {!tax.is_default && (
                    <Button size="sm" variant="outline" onClick={() => void setDefaultTax(tax)}>
                      Set Default
                    </Button>
                  )}

                  <Button size="sm" variant="ghost" onClick={() => void toggleTax(tax)}>
                    {tax.is_active ? 'Disable' : 'Enable'}
                  </Button>

                  <Button size="sm" variant="ghost" onClick={() => void deleteTax(tax)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'departments' && (
        <Card className="p-5">
          <SectionHeader
            title="Departments"
            description="Create, edit, update, disable, or delete departments."
            buttonLabel="Add Department"
            onAdd={() => openAddModal('department')}
          />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {departments.map((department) => (
              <Card key={department.id} className={cn('p-4', !department.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{department.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      EBT Eligible:{' '}
                      <span className="font-semibold text-foreground">
                        {department.ebt_eligible ? 'Yes' : 'No'}
                      </span>
                    </p>
                  </div>

                  <span
                    className={cn(
                      'rounded-full px-2 py-1 text-xs font-semibold',
                      department.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {department.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditDepartment(department)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>

                  <Button size="sm" variant="outline" onClick={() => void toggleDepartment(department)}>
                    {department.is_active ? 'Disable' : 'Enable'}
                  </Button>

                  <Button size="sm" variant="ghost" onClick={() => void deleteDepartment(department)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'vendors' && (
        <Card className="p-5">
          <SectionHeader
            title="Vendors"
            description="Create, edit, update, disable, or delete vendor contacts."
            buttonLabel="Add Vendor"
            onAdd={() => openAddModal('vendor')}
          />

          {vendors.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Truck className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 font-semibold text-foreground">No vendors yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add vendor contacts for Coke, Pepsi, grocery distributors, and fuel suppliers.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {vendors.map((vendor) => (
                <Card key={vendor.id} className={cn('p-4', !vendor.is_active && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{vendor.vendor_name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Sales Rep: {vendor.sales_rep_name || 'Not added'}
                      </p>
                    </div>

                    <span
                      className={cn(
                        'rounded-full px-2 py-1 text-xs font-semibold',
                        vendor.is_active
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {vendor.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      {vendor.phone || 'No phone'}
                    </p>

                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      {vendor.email || 'No email'}
                    </p>

                    {vendor.notes && (
                      <p className="rounded-lg bg-secondary/40 p-2 text-xs text-muted-foreground">
                        {vendor.notes}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditVendor(vendor)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>

                    <Button size="sm" variant="outline" onClick={() => void toggleVendor(vendor)}>
                      {vendor.is_active ? 'Disable' : 'Enable'}
                    </Button>

                    <Button size="sm" variant="ghost" onClick={() => void deleteVendor(vendor)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'age' && (
        <Card className="p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Age Restriction Presets</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create presets for age-restricted products. These appear as one-click chips when adding products.
              </p>
            </div>

            {agePresets.length === 0 && (
              <Button onClick={() => void importDefaultAgePresets()}>
                <Plus className="mr-2 h-4 w-4" />
                Import Defaults
              </Button>
            )}
          </div>

          <div className="mb-5 grid gap-3 rounded-lg border border-border bg-secondary/20 p-3 md:grid-cols-[1fr_120px_1fr_auto]">
            <Input
              value={agePresetForm.name}
              onChange={(event) => setAgePresetForm({ ...agePresetForm, name: event.target.value })}
              placeholder="Name, e.g. Tobacco"
            />
            <Input
              type="number"
              min="0"
              value={agePresetForm.minimumAge}
              onChange={(event) => setAgePresetForm({ ...agePresetForm, minimumAge: event.target.value })}
              placeholder="21"
            />
            <Input
              value={agePresetForm.restrictionType}
              onChange={(event) => setAgePresetForm({ ...agePresetForm, restrictionType: event.target.value })}
              placeholder="Restriction Type"
            />
            <div className="flex gap-2">
              {editingAgePresetId && (
                <Button variant="outline" onClick={resetAgePresetForm}>
                  Cancel
                </Button>
              )}
              <Button onClick={() => void saveAgePreset()}>
                {editingAgePresetId ? 'Save' : 'Add'}
              </Button>
            </div>
          </div>

          {agePresets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 font-semibold text-foreground">No age presets yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Import defaults or add a custom preset above.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {agePresets.map((preset) => (
                <div key={preset.id} className={cn('flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between', !preset.is_active && 'opacity-60')}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-foreground">{preset.name}</p>
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                        {preset.minimum_age}+
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        {preset.restriction_type}
                      </span>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', preset.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                        {preset.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => editAgePreset(preset)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void toggleAgePreset(preset)}>
                      {preset.is_active ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void deleteAgePreset(preset)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'deals' && (
        <Card className="p-5">
          <SectionHeader
            title="Deals / Promo"
            description="Create, edit, update, disable, or delete quantity + total price deals."
            buttonLabel="Add Deal"
            onAdd={() => openAddModal('deal')}
          />

          {deals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Tag className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 font-semibold text-foreground">No deals yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your first deal, like 2 Red Bull for $6 or 2 candy bars for $3.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {deals.map((deal) => (
                <Card key={deal.id} className={cn('p-4', !deal.is_active && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{deal.name}</h3>
                      <p className="mt-1 text-xl font-bold text-primary">
                        Buy {deal.quantity_required} for ${Number(deal.deal_price).toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dateLabel(deal.start_date)} → {dateLabel(deal.end_date)}
                      </p>
                    </div>

                    <span
                      className={cn(
                        'rounded-full px-2 py-1 text-xs font-semibold',
                        deal.is_active
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {deal.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="mt-4 rounded-lg bg-secondary/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Products in deal
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {deal.products.map((product) => (
                        <span
                          key={product.id}
                          className="rounded-full bg-background px-2 py-1 text-xs text-foreground"
                        >
                          {product.item_name || product.upc}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditDeal(deal)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>

                    <Button size="sm" variant="outline" onClick={() => void toggleDeal(deal)}>
                      {deal.is_active ? 'Disable Deal' : 'Enable Deal'}
                    </Button>

                    <Button size="sm" variant="ghost" onClick={() => void deleteDeal(deal)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      )}

      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="max-h-[92vh] w-full max-w-3xl overflow-hidden">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {modalMode === 'add' ? 'Add' : 'Edit'}{' '}
                  {modalType === 'tax' && 'Tax'}
                  {modalType === 'department' && 'Department'}
                  {modalType === 'vendor' && 'Vendor'}
                  {modalType === 'deal' && 'Deal / Promo'}
                </h2>
              </div>

              <Button variant="ghost" size="icon" onClick={closeModal} disabled={saving}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[calc(92vh-150px)] overflow-y-auto p-5">
              {modalType === 'tax' && (
                <div className="grid gap-4">
                  <Input
                    value={taxForm.name}
                    onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })}
                    placeholder="Tax name, example: prepared-food"
                  />

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={taxForm.rate}
                    onChange={(e) => setTaxForm({ ...taxForm, rate: e.target.value })}
                    placeholder="Tax percentage, example: 8.5"
                  />

                  <Input
                    value={taxForm.description}
                    onChange={(e) => setTaxForm({ ...taxForm, description: e.target.value })}
                    placeholder="Description"
                  />

                  <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <input
                      type="checkbox"
                      checked={taxForm.isDefault}
                      onChange={(e) => setTaxForm({ ...taxForm, isDefault: e.target.checked })}
                    />
                    <span className="text-sm font-medium text-foreground">Set as default tax</span>
                  </label>

                  <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <input
                      type="checkbox"
                      checked={taxForm.isActive}
                      onChange={(e) => setTaxForm({ ...taxForm, isActive: e.target.checked })}
                    />
                    <span className="text-sm font-medium text-foreground">Active tax</span>
                  </label>
                </div>
              )}

              {modalType === 'department' && (
                <div className="grid gap-4">
                  <Input
                    value={departmentForm.name}
                    onChange={(e) => setDepartmentForm({ ...departmentForm, name: e.target.value })}
                    placeholder="Department name, example: Grocery"
                  />

                  <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <input
                      type="checkbox"
                      checked={departmentForm.ebtEligible}
                      onChange={(e) =>
                        setDepartmentForm({ ...departmentForm, ebtEligible: e.target.checked })
                      }
                    />
                    <span className="text-sm font-medium text-foreground">
                      EBT / Food Stamp eligible
                    </span>
                  </label>

                  <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <input
                      type="checkbox"
                      checked={departmentForm.isActive}
                      onChange={(e) =>
                        setDepartmentForm({ ...departmentForm, isActive: e.target.checked })
                      }
                    />
                    <span className="text-sm font-medium text-foreground">Active department</span>
                  </label>
                </div>
              )}

              {modalType === 'vendor' && (
                <div className="grid gap-4">
                  <Input
                    value={vendorForm.vendorName}
                    onChange={(e) => setVendorForm({ ...vendorForm, vendorName: e.target.value })}
                    placeholder="Vendor name"
                  />

                  <Input
                    value={vendorForm.salesRepName}
                    onChange={(e) =>
                      setVendorForm({ ...vendorForm, salesRepName: e.target.value })
                    }
                    placeholder="Sales rep name"
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <Input
                      value={vendorForm.phone}
                      onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                      placeholder="Phone"
                    />

                    <Input
                      value={vendorForm.email}
                      onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                      placeholder="Email"
                    />
                  </div>

                  <textarea
                    value={vendorForm.notes}
                    onChange={(e) => setVendorForm({ ...vendorForm, notes: e.target.value })}
                    placeholder="Notes"
                    className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />

                  <label className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <input
                      type="checkbox"
                      checked={vendorForm.isActive}
                      onChange={(e) => setVendorForm({ ...vendorForm, isActive: e.target.checked })}
                    />
                    <span className="text-sm font-medium text-foreground">Active vendor</span>
                  </label>
                </div>
              )}

              {modalType === 'deal' && (
                <div className="grid gap-5">
                  <Card className="p-4">
                    <h3 className="font-semibold text-foreground">1. Deal Info</h3>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Input
                        value={dealForm.name}
                        onChange={(e) => setDealForm({ ...dealForm, name: e.target.value })}
                        placeholder="Deal name, example: 2 Red Bull for $6"
                        className="md:col-span-2"
                      />

                      <Input
                        type="date"
                        value={dealForm.startDate}
                        onChange={(e) => setDealForm({ ...dealForm, startDate: e.target.value })}
                      />

                      <Input
                        type="date"
                        value={dealForm.endDate}
                        onChange={(e) => setDealForm({ ...dealForm, endDate: e.target.value })}
                      />
                    </div>
                  </Card>

                  <Card className="p-4">
                    <h3 className="font-semibold text-foreground">2. Add Products</h3>

                    <div className="relative mt-4">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search products by name, UPC, price, department, brand, or vendor..."
                        className="pl-9"
                      />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Pricebook Products
                        </p>

                        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                          {searchedProducts.map((product) => (
                            <button
                              key={product.upc}
                              onClick={() =>
                                setSelectedProducts((prev) => [...prev, productToSelected(product)])
                              }
                              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-3 text-left hover:bg-secondary/50"
                            >
                              <span>
                                <span className="block text-sm font-medium text-foreground">
                                  {product.name}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {product.upc} · {product.department || product.category} · ${product.sellPrice}
                                </span>
                              </span>

                              <PackagePlus className="h-4 w-4 text-primary" />
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-border p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Selected Products
                        </p>

                        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                          {selectedProducts.length === 0 ? (
                            <p className="rounded-lg bg-secondary/40 p-3 text-sm text-muted-foreground">
                              No products selected yet.
                            </p>
                          ) : (
                            selectedProducts.map((product) => (
                              <div
                                key={product.upc}
                                className="flex items-center justify-between gap-3 rounded-lg bg-secondary/40 p-3"
                              >
                                <span>
                                  <span className="block text-sm font-medium text-foreground">
                                    {product.name}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {product.upc}
                                  </span>
                                </span>

                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setSelectedProducts((prev) =>
                                      prev.filter((selected) => selected.upc !== product.upc)
                                    )
                                  }
                                >
                                  Remove
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-4">
                    <h3 className="font-semibold text-foreground">3. Deal Rule</h3>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={dealForm.quantityRequired}
                        onChange={(e) =>
                          setDealForm({ ...dealForm, quantityRequired: e.target.value })
                        }
                        placeholder="Quantity required"
                      />

                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={dealForm.dealPrice}
                        onChange={(e) => setDealForm({ ...dealForm, dealPrice: e.target.value })}
                        placeholder="Total deal price"
                      />
                    </div>

                    <label className="mt-4 flex items-center gap-3 rounded-lg border border-border p-3">
                      <input
                        type="checkbox"
                        checked={dealForm.isActive}
                        onChange={(e) => setDealForm({ ...dealForm, isActive: e.target.checked })}
                      />
                      <span className="text-sm font-medium text-foreground">Active deal</span>
                    </label>
                  </Card>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={closeModal} disabled={saving}>
                Cancel
              </Button>

              <Button
                disabled={saving}
                onClick={() => {
                  if (modalType === 'tax') void saveTax();
                  if (modalType === 'department') void saveDepartment();
                  if (modalType === 'vendor') void saveVendor();
                  if (modalType === 'deal') void saveDeal();
                }}
              >
                {saving ? 'Saving...' : modalMode === 'edit' ? 'Update' : 'Save'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </DashboardShell>
  );
}
