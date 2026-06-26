'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FileClock,
  Fuel,
  Loader2,
  Package,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  Receipt,
  Save,
  ShieldAlert,
  Store,
  Upload,
  X,
} from 'lucide-react';
import { adminFetch } from '@/lib/admin-client';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Store360Mode = 'admin' | 'superadmin';
type Store360Tab =
  | 'overview'
  | 'profile'
  | 'uploads'
  | 'products'
  | 'transactions'
  | 'reports'
  | 'fuel'
  | 'settings'
  | 'support'
  | 'audit';

type JsonRecord = Record<string, unknown>;

type StoreRow = JsonRecord & {
  id: string;
  store_name?: string | null;
  owner_id?: string | null;
  primary_owner_email?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  store_type?: string | null;
  pos_type?: string | null;
  plan?: string | null;
  phone_number?: string | null;
  manager_name?: string | null;
  manager_email?: string | null;
  manager_phone?: string | null;
  has_fuel?: boolean | null;
  fuel_brand?: string | null;
  is_active?: boolean | null;
  status?: string | null;
  notes?: string | null;
};

type Store360Metrics = {
  total_sales: number;
  transaction_count: number;
  product_count: number;
  low_stock_count: number;
  last_upload: JsonRecord | null;
};

type Store360Permissions = {
  canView: boolean;
  canEditProfile: boolean;
  canDeactivate: boolean;
  canViewAudit: boolean;
  canEditProducts: boolean;
  canViewProducts: boolean;
  canUpload: boolean;
  canViewTransactions: boolean;
  isSuperadmin: boolean;
};

type Store360Response = {
  store: StoreRow;
  owner: { email: string | null };
  metrics: Store360Metrics;
  recent_uploads: JsonRecord[];
  recent_tickets: JsonRecord[];
  recent_audit_logs: JsonRecord[];
  permissions: Store360Permissions;
  permissionKeys: string[];
};

type ProductRow = {
  id: string;
  upc: string | null;
  item_name: string | null;
  category: string | null;
  department: string | null;
  brand: string | null;
  vendor: string | null;
  cost_price: number | null;
  selling_price: number | null;
  stock: number | null;
  reorder_level: number | null;
  is_active: boolean | null;
  notes: string | null;
};

type TransactionRow = {
  id: string;
  transaction_id: string | null;
  transaction_time: string | null;
  item_name: string | null;
  category: string | null;
  cashier_id: string | null;
  quantity: number | null;
  total_amount: number | null;
  payment_type: string | null;
  transaction_type: string | null;
};

type UploadRow = JsonRecord & {
  id?: string;
  upload_type?: string | null;
  file_name?: string | null;
  total_rows?: number | null;
  valid_rows?: number | null;
  invalid_rows?: number | null;
  created_at?: string | null;
};

type AuditRow = JsonRecord & {
  id?: string;
  action?: string | null;
  description?: string | null;
  actor_email?: string | null;
  created_at?: string | null;
};

type ProfileFormState = {
  store_name: string;
  store_type: string;
  pos_type: string;
  phone_number: string;
  manager_name: string;
  manager_email: string;
  manager_phone: string;
  address_line1: string;
  city: string;
  state: string;
  zip_code: string;
  plan: string;
  notes: string;
  has_fuel: boolean;
  fuel_brand: string;
};

type ProductFormState = {
  upc: string;
  item_name: string;
  category: string;
  brand: string;
  department: string;
  vendor: string;
  cost_price: string;
  selling_price: string;
  stock: string;
  reorder_level: string;
  is_active: boolean;
  notes: string;
};

type ImportType = 'products' | 'transactions';
type ProductDrawerMode = 'add' | 'edit';

const DEFAULT_PRODUCT_FORM: ProductFormState = {
  upc: '',
  item_name: '',
  category: '',
  brand: '',
  department: '',
  vendor: '',
  cost_price: '',
  selling_price: '',
  stock: '0',
  reorder_level: '10',
  is_active: true,
  notes: '',
};

const TABS: Array<{ key: Store360Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'profile', label: 'Profile' },
  { key: 'uploads', label: 'Uploads' },
  { key: 'products', label: 'Products' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'reports', label: 'Reports' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'settings', label: 'Settings' },
  { key: 'support', label: 'Support' },
  { key: 'audit', label: 'Audit' },
];

function asText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getStatus(store: StoreRow) {
  if (typeof store.status === 'string' && store.status.trim()) return store.status;
  return store.is_active === false ? 'inactive' : 'active';
}

function toProfileForm(store: StoreRow): ProfileFormState {
  return {
    store_name: asText(store.store_name),
    store_type: asText(store.store_type),
    pos_type: asText(store.pos_type),
    phone_number: asText(store.phone_number),
    manager_name: asText(store.manager_name),
    manager_email: asText(store.manager_email),
    manager_phone: asText(store.manager_phone),
    address_line1: asText(store.address_line1),
    city: asText(store.city),
    state: asText(store.state),
    zip_code: asText(store.zip_code),
    plan: asText(store.plan),
    notes: asText(store.notes),
    has_fuel: store.has_fuel === true,
    fuel_brand: asText(store.fuel_brand),
  };
}

function toProductForm(product?: ProductRow | null): ProductFormState {
  if (!product) return DEFAULT_PRODUCT_FORM;
  return {
    upc: product.upc || '',
    item_name: product.item_name || '',
    category: product.category || '',
    brand: product.brand || '',
    department: product.department || '',
    vendor: product.vendor || '',
    cost_price: product.cost_price === null || product.cost_price === undefined ? '' : String(product.cost_price),
    selling_price: product.selling_price === null || product.selling_price === undefined ? '' : String(product.selling_price),
    stock: product.stock === null || product.stock === undefined ? '0' : String(product.stock),
    reorder_level: product.reorder_level === null || product.reorder_level === undefined ? '10' : String(product.reorder_level),
    is_active: product.is_active !== false,
    notes: product.notes || '',
  };
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) || [];

  return rows.map((values) => {
    const parsed: Record<string, string> = {};
    headers.forEach((header, index) => {
      parsed[header] = values[index] || '';
    });
    return parsed;
  });
}

function EmptyState({ icon: Icon, text }: { icon: typeof Store; text: string }) {
  return (
    <div className="py-10 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">{text}</p>
    </div>
  );
}

function exportCSV(rows: JsonRecord[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) =>
    headers
      .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  const blob = new Blob([`${headers.join(',')}\n${csvRows.join('\n')}`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function Store360View({ storeId, mode }: { storeId: string; mode: Store360Mode }) {
  const [activeTab, setActiveTab] = useState<Store360Tab>('overview');
  const [data, setData] = useState<Store360Response | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [profileForm, setProfileForm] = useState<ProfileFormState | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionFromDate, setTransactionFromDate] = useState('');
  const [transactionToDate, setTransactionToDate] = useState('');
  const [importType, setImportType] = useState<ImportType>('products');
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [productDrawerOpen, setProductDrawerOpen] = useState(false);
  const [productDrawerMode, setProductDrawerMode] = useState<ProductDrawerMode>('add');
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [productForm, setProductForm] = useState<ProductFormState>(DEFAULT_PRODUCT_FORM);
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminFetch<Store360Response>(`/api/admin/stores/${storeId}`);
      setData(response);
      setUploads(response.recent_uploads as UploadRow[]);
      setAuditLogs(response.recent_audit_logs as AuditRow[]);
      setProfileForm(toProfileForm(response.store));
      setProfileEditing(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Store 360.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  const loadProducts = useCallback(async () => {
    setSectionLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (productSearch.trim()) params.set('search', productSearch.trim());
      const response = await adminFetch<{ products: ProductRow[] }>(`/api/admin/stores/${storeId}/products?${params}`);
      setProducts(response.products || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load products.');
    } finally {
      setSectionLoading(false);
    }
  }, [productSearch, storeId]);

  const loadTransactions = useCallback(async () => {
    setSectionLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (transactionSearch.trim()) params.set('search', transactionSearch.trim());
      const response = await adminFetch<{ transactions: TransactionRow[] }>(`/api/admin/stores/${storeId}/transactions?${params}`);
      setTransactions(response.transactions || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load transactions.');
    } finally {
      setSectionLoading(false);
    }
  }, [storeId, transactionSearch]);

  const loadUploads = useCallback(async () => {
    setSectionLoading(true);
    try {
      const response = await adminFetch<{ uploads: UploadRow[] }>(`/api/admin/stores/${storeId}/uploads?limit=50`);
      setUploads(response.uploads || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load uploads.');
    } finally {
      setSectionLoading(false);
    }
  }, [storeId]);

  const loadAudit = useCallback(async () => {
    setSectionLoading(true);
    try {
      const response = await adminFetch<{ audit_logs: AuditRow[] }>(`/api/admin/stores/${storeId}/audit?limit=50`);
      setAuditLogs(response.audit_logs || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load audit logs.');
    } finally {
      setSectionLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((item) => item.key === tab)) setActiveTab(tab as Store360Tab);
  }, []);

  useEffect(() => {
    if (activeTab === 'products') void loadProducts();
    if (activeTab === 'transactions') void loadTransactions();
    if (activeTab === 'reports' && transactions.length === 0) void loadTransactions();
    if (activeTab === 'uploads') void loadUploads();
    if (activeTab === 'audit' && data?.permissions.canViewAudit) void loadAudit();
  }, [activeTab, data?.permissions.canViewAudit, loadAudit, loadProducts, loadTransactions, loadUploads, transactions.length]);

  const headerDescription = data
    ? `${data.store.store_name || 'Selected store'} · ${getStatus(data.store)} · ${data.owner.email || data.store.primary_owner_email || 'No owner email'}`
    : 'Loading selected store...';

  const backHref = mode === 'superadmin' ? '/superadmin/stores' : '/admin/stores';
  const Shell = mode === 'superadmin' ? SuperadminShell : AdminShell;
  const PageHeader = mode === 'superadmin' ? SuperadminPageHeader : AdminPageHeader;

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const showProfileSuccess = (message: string) => {
    setProfileSuccess(message);
    window.setTimeout(() => setProfileSuccess(null), 3000);
  };

  const showProfileError = (message: string) => {
    setProfileError(message);
    window.setTimeout(() => setProfileError(null), 3000);
  };

  const saveProfile = async () => {
    if (!profileForm || !data) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const original = toProfileForm(data.store);
      const changedFields = Object.entries(profileForm).reduce<Record<string, string | boolean>>((payload, [key, value]) => {
        const formKey = key as keyof ProfileFormState;
        if (original[formKey] !== value) payload[key] = value;
        return payload;
      }, {});

      if (Object.keys(changedFields).length === 0) {
        setProfileEditing(false);
        return;
      }

      await adminFetch(`/api/admin/stores/${storeId}`, {
        method: 'PATCH',
        body: JSON.stringify(changedFields),
      });
      showProfileSuccess('Store updated.');
      await loadOverview();
      setProfileEditing(false);
    } catch (saveError) {
      showProfileError(saveError instanceof Error ? saveError.message : 'Failed to save profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const cancelProfileEdit = () => {
    if (data) setProfileForm(toProfileForm(data.store));
    setProfileEditing(false);
    setProfileError(null);
  };

  const toggleActive = async () => {
    if (!data) return;
    const nextActive = data.store.is_active === false;
    const storeName = data.store.store_name || 'this store';
    const confirmed = window.confirm(
      nextActive
        ? `Reactivate ${storeName}? Store owner will regain access.`
        : `Deactivate ${storeName}? Store owner will lose access. Store data will be kept.`
    );
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/stores/${storeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: nextActive, status: nextActive ? 'active' : 'inactive' }),
      });
      showSuccess(nextActive ? 'Store reactivated.' : 'Store deactivated.');
      await loadOverview();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update store status.');
    } finally {
      setSaving(false);
    }
  };

  const openAddProduct = () => {
    setProductDrawerMode('add');
    setEditingProduct(null);
    setProductForm(DEFAULT_PRODUCT_FORM);
    setProductError(null);
    setProductDrawerOpen(true);
  };

  const openEditProduct = (product: ProductRow) => {
    setProductDrawerMode('edit');
    setEditingProduct(product);
    setProductForm(toProductForm(product));
    setProductError(null);
    setProductDrawerOpen(true);
  };

  const closeProductDrawer = () => {
    setProductDrawerOpen(false);
    setEditingProduct(null);
    setProductError(null);
  };

  const submitProduct = async () => {
    setProductSaving(true);
    setProductError(null);
    try {
      const payload = {
        ...productForm,
        cost_price: toNumber(productForm.cost_price),
        selling_price: toNumber(productForm.selling_price),
        stock: toNumber(productForm.stock),
        reorder_level: toNumber(productForm.reorder_level),
      };
      if (productDrawerMode === 'add') {
        await adminFetch(`/api/admin/stores/${storeId}/products`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showSuccess('Product added.');
      } else if (editingProduct) {
        await adminFetch(`/api/admin/stores/${storeId}/products`, {
          method: 'PATCH',
          body: JSON.stringify({ id: editingProduct.id, ...payload }),
        });
        showSuccess('Product updated.');
      }
      closeProductDrawer();
      await Promise.all([loadProducts(), loadOverview()]);
    } catch (submitError) {
      setProductError(submitError instanceof Error ? submitError.message : 'Failed to save product.');
    } finally {
      setProductSaving(false);
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>, selectedType = importType) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSectionLoading(true);
    setError(null);
    setImportSummary(null);
    try {
      const rows = parseCsv(await file.text());
      const response = await adminFetch<{ summary: { inserted: number; skipped: number; failed: number }; message: string }>(
        `/api/admin/stores/${storeId}/uploads`,
        {
          method: 'POST',
          body: JSON.stringify({ type: selectedType, fileName: file.name, rows }),
        }
      );
      setImportSummary(`${response.summary.inserted} inserted, ${response.summary.skipped} skipped, ${response.summary.failed} failed.`);
      showSuccess(response.message);
      await Promise.all([loadOverview(), loadUploads()]);
      if (selectedType === 'products') await loadProducts();
      if (selectedType === 'transactions') await loadTransactions();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setSectionLoading(false);
    }
  };

  const overviewCards = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Total Sales', value: formatCurrency(data.metrics.total_sales) },
      { label: 'Transactions', value: String(data.metrics.transaction_count) },
      { label: 'Products', value: String(data.metrics.product_count) },
      { label: 'Low Stock', value: String(data.metrics.low_stock_count) },
      { label: 'Last Upload', value: data.metrics.last_upload ? formatDate(data.metrics.last_upload.created_at) : 'No uploads' },
    ];
  }, [data]);

  const canEditProfile = mode === 'superadmin' || data?.permissions.canEditProfile === true;
  const canEditProducts = mode === 'superadmin' || data?.permissions.canEditProducts === true;
  const canUpload = mode === 'superadmin' || data?.permissions.canUpload === true;
  const canViewTransactions = mode === 'superadmin' || data?.permissions.canViewTransactions === true;
  const canDeactivate = mode === 'superadmin' || data?.permissions.canDeactivate === true;
  const canViewProducts = mode === 'superadmin' || data?.permissions.canViewProducts === true;

  const filteredProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    if (!search) return products;
    return products.filter((product) =>
      [product.item_name, product.upc, product.category, product.brand, product.department, product.vendor]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }, [productSearch, products]);

  const filteredTransactions = useMemo(() => {
    const search = transactionSearch.trim().toLowerCase();
    const fromTime = transactionFromDate ? new Date(`${transactionFromDate}T00:00:00`).getTime() : null;
    const toTime = transactionToDate ? new Date(`${transactionToDate}T23:59:59`).getTime() : null;

    return transactions.filter((transaction) => {
      const textMatch =
        !search ||
        [transaction.item_name, transaction.cashier_id, transaction.category, transaction.payment_type, transaction.transaction_id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search);
      const transactionTime = transaction.transaction_time ? new Date(transaction.transaction_time).getTime() : null;
      const dateMatch =
        transactionTime === null ||
        ((!fromTime || transactionTime >= fromTime) && (!toTime || transactionTime <= toTime));
      return textMatch && dateMatch;
    });
  }, [transactionFromDate, transactionSearch, transactionToDate, transactions]);

  const salesByCategory = useMemo(() => {
    const groups = new Map<string, { category: string; total_sales: number; transactions: number }>();
    for (const transaction of filteredTransactions) {
      const category = transaction.category || 'Uncategorized';
      const current = groups.get(category) || { category, total_sales: 0, transactions: 0 };
      current.total_sales += Number(transaction.total_amount || 0);
      current.transactions += 1;
      groups.set(category, current);
    }
    return Array.from(groups.values()).sort((a, b) => b.total_sales - a.total_sales).slice(0, 20);
  }, [filteredTransactions]);

  const topProducts = useMemo(() => {
    const groups = new Map<string, { product: string; units_sold: number; revenue: number }>();
    for (const transaction of filteredTransactions) {
      const product = transaction.item_name || 'Unknown Product';
      const current = groups.get(product) || { product, units_sold: 0, revenue: 0 };
      current.units_sold += Number(transaction.quantity || 0);
      current.revenue += Number(transaction.total_amount || 0);
      groups.set(product, current);
    }
    return Array.from(groups.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  }, [filteredTransactions]);

  const cashierSummary = useMemo(() => {
    const groups = new Map<string, { cashier: string; transactions: number; total_sales: number }>();
    for (const transaction of filteredTransactions) {
      const cashier = transaction.cashier_id || 'Unassigned';
      const current = groups.get(cashier) || { cashier, transactions: 0, total_sales: 0 };
      current.transactions += 1;
      current.total_sales += Number(transaction.total_amount || 0);
      groups.set(cashier, current);
    }
    return Array.from(groups.values()).sort((a, b) => b.total_sales - a.total_sales).slice(0, 20);
  }, [filteredTransactions]);

  const content = (
    <div className="space-y-5">
      {error ? (
        <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </Card>
      ) : null}

      {success ? (
        <Card className="flex items-start gap-3 border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{success}</p>
        </Card>
      ) : null}

      {data ? (
        <Card className="p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-foreground">{data.store.store_name || 'Store'}</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium capitalize text-emerald-700">
                  {getStatus(data.store)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[data.store.address_line1, data.store.city, data.store.state, data.store.zip_code].filter(Boolean).join(', ') || 'No address on file'}
                {' · '}
                {data.owner.email || data.store.primary_owner_email || 'No owner email'}
                {data.store.pos_type ? ` · ${data.store.pos_type}` : ''}
                {data.store.plan ? ` · ${data.store.plan}` : ''}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">Store ID: {storeId}</p>
          </div>
        </Card>
      ) : null}

      <Card className="border-amber-200 bg-amber-50 p-4 text-amber-900">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Assisted management mode</p>
            <p className="text-sm">You are managing this customer store as StorePulse staff. All actions are logged.</p>
          </div>
        </div>
      </Card>

      <div className="flex gap-2 overflow-x-auto border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-5">
            {overviewCards.map((card) => (
              <Card key={card.label} className="p-4">
                <p className="text-xs uppercase text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{card.value}</p>
              </Card>
            ))}
          </div>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {canEditProfile ? (
                <QuickAction icon={Pencil} label="Edit Profile" onClick={() => setActiveTab('profile')} />
              ) : null}
              {canEditProducts ? (
                <QuickAction icon={Plus} label="Add Product" onClick={() => { setActiveTab('products'); openAddProduct(); }} />
              ) : null}
              {canUpload ? (
                <QuickAction icon={Upload} label="Upload Data" onClick={() => setActiveTab('uploads')} />
              ) : null}
              <QuickAction icon={BarChart3} label="View Reports" onClick={() => setActiveTab('reports')} />
              {canViewTransactions ? (
                <QuickAction icon={Receipt} label="View Transactions" onClick={() => setActiveTab('transactions')} />
              ) : null}
              {canDeactivate && data ? (
                <QuickAction
                  icon={Power}
                  label={data.store.is_active === false ? 'Reactivate Store' : 'Deactivate Store'}
                  tone={data.store.is_active === false ? 'green' : 'amber'}
                  onClick={() => void toggleActive()}
                />
              ) : null}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'profile' && data && profileForm && (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Store Profile</h2>
              <p className="text-sm text-muted-foreground">Edits apply only to {data.store.store_name || 'this selected store'}.</p>
            </div>
            {canDeactivate ? (
              <Button variant="outline" onClick={() => void toggleActive()} disabled={saving}>
                {data.store.is_active === false ? 'Reactivate' : 'Deactivate'}
              </Button>
            ) : null}
          </div>

          {profileSuccess ? <p className="mb-3 text-sm text-emerald-700">{profileSuccess}</p> : null}
          {profileError ? <p className="mb-3 text-sm text-destructive">{profileError}</p> : null}
          {!canEditProfile ? <p className="mb-4 text-sm text-muted-foreground">You don&apos;t have permission to edit this store.</p> : null}

          <div className="mb-4 flex justify-end gap-2">
            {canEditProfile && !profileEditing ? (
              <Button variant="outline" onClick={() => setProfileEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            ) : null}
            {canEditProfile && profileEditing ? (
              <>
                <Button variant="outline" onClick={cancelProfileEdit} disabled={profileSaving}>Cancel</Button>
                <Button onClick={() => void saveProfile()} disabled={profileSaving}>
                  {profileSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Changes
                </Button>
              </>
            ) : null}
          </div>

          {
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Basic Information</h3>
              </div>
              {([
                ['store_name', 'Store Name'],
                ['store_type', 'Store Type'],
                ['pos_type', 'POS Type'],
              ] as Array<[keyof ProfileFormState, string]>).map(([key, label]) => (
                <label key={key} className="space-y-1 text-sm">
                  <span className="font-medium text-foreground">{label}</span>
                  {key === 'store_type' ? (
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={String(profileForm[key] ?? '')}
                      disabled={!profileEditing || !canEditProfile}
                      onChange={(event) => setProfileForm((current) => (current ? { ...current, [key]: event.target.value } : current))}
                    >
                      <option value="">Select store type</option>
                      <option value="convenience_store">Convenience Store</option>
                      <option value="gas_station">Gas Station</option>
                      <option value="liquor_store">Liquor Store</option>
                      <option value="grocery">Grocery</option>
                      <option value="other">Other</option>
                    </select>
                  ) : key === 'pos_type' ? (
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={String(profileForm[key] ?? '')}
                      disabled={!profileEditing || !canEditProfile}
                      onChange={(event) => setProfileForm((current) => (current ? { ...current, [key]: event.target.value } : current))}
                    >
                      <option value="">Select POS</option>
                      <option value="Verifone">Verifone</option>
                      <option value="Gilbarco">Gilbarco</option>
                      <option value="Clover">Clover</option>
                      <option value="Square">Square</option>
                      <option value="NCR">NCR</option>
                      <option value="Other">Other</option>
                    </select>
                  ) : (
                    <Input
                      required={key === 'store_name'}
                      value={String(profileForm[key] ?? '')}
                      disabled={!profileEditing || !canEditProfile}
                      onChange={(event) => setProfileForm((current) => (current ? { ...current, [key]: event.target.value } : current))}
                    />
                  )}
                </label>
              ))}
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">Register Count</span>
                <Input type="number" disabled placeholder="Managed from full store profile" />
              </label>
              <div className="md:col-span-2">
                <h3 className="mb-2 mt-2 text-sm font-semibold text-muted-foreground">Location</h3>
              </div>
              {([
                ['phone_number', 'Phone'],
                ['address_line1', 'Address'],
                ['city', 'City'],
                ['state', 'State'],
                ['zip_code', 'Zip'],
              ] as Array<[keyof ProfileFormState, string]>).map(([key, label]) => (
                <label key={key} className="space-y-1 text-sm">
                  <span className="font-medium text-foreground">{label}</span>
                  <Input
                    value={String(profileForm[key] ?? '')}
                    disabled={!profileEditing || !canEditProfile}
                    onChange={(event) => setProfileForm((current) => (current ? { ...current, [key]: event.target.value } : current))}
                  />
                </label>
              ))}
              <div className="md:col-span-2">
                <h3 className="mb-2 mt-2 text-sm font-semibold text-muted-foreground">Fuel</h3>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={profileForm.has_fuel}
                  disabled={!profileEditing || !canEditProfile}
                  onChange={(event) => setProfileForm((current) => (current ? { ...current, has_fuel: event.target.checked } : current))}
                />
                This store sells fuel
              </label>
              {profileForm.has_fuel ? (
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-foreground">Fuel Brand</span>
                  <Input
                    value={profileForm.fuel_brand}
                    disabled={!profileEditing || !canEditProfile}
                    onChange={(event) => setProfileForm((current) => (current ? { ...current, fuel_brand: event.target.value } : current))}
                  />
                </label>
              ) : null}
              <div className="md:col-span-2">
                <h3 className="mb-2 mt-2 text-sm font-semibold text-muted-foreground">Manager / Contact</h3>
              </div>
              {([
                ['manager_name', 'Manager Name'],
                ['manager_email', 'Manager Email'],
                ['manager_phone', 'Manager Phone'],
              ] as Array<[keyof ProfileFormState, string]>).map(([key, label]) => (
                <label key={key} className="space-y-1 text-sm">
                  <span className="font-medium text-foreground">{label}</span>
                  <Input
                    value={String(profileForm[key] ?? '')}
                    disabled={!profileEditing || !canEditProfile}
                    onChange={(event) => setProfileForm((current) => (current ? { ...current, [key]: event.target.value } : current))}
                  />
                </label>
              ))}
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium text-foreground">Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={profileForm.notes}
                  disabled={!profileEditing || !canEditProfile}
                  onChange={(event) => setProfileForm((current) => (current ? { ...current, notes: event.target.value } : current))}
                />
              </label>
            </div>
          }
        </Card>
      )}

      {activeTab === 'uploads' && (
        <div className="space-y-4">
          {canUpload ? (
            <div className="grid gap-4 md:grid-cols-2">
              <UploadCard
                icon={Receipt}
                title="Upload Transaction CSV"
                text="Import sales/transaction data into this store."
                uploading={sectionLoading && importType === 'transactions'}
                onPick={(event) => { setImportType('transactions'); void handleFileUpload(event, 'transactions'); }}
              />
              <UploadCard
                icon={Package}
                title="Upload Product CSV"
                text="Import or update product/pricebook data for this store."
                uploading={sectionLoading && importType === 'products'}
                onPick={(event) => { setImportType('products'); void handleFileUpload(event, 'products'); }}
              />
            </div>
          ) : (
            <Card className="p-5"><EmptyState icon={ShieldAlert} text="Access Limited. You do not have permission to upload data for this store." /></Card>
          )}
          {importSummary ? (
            <Card className="border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700">
              <p className="font-semibold">Upload Complete</p>
              <p>{importSummary}</p>
            </Card>
          ) : null}
          <TableCard title="Upload History" rows={uploads} emptyText="No upload history for this store." loading={sectionLoading} />
        </div>
      )}

      {activeTab === 'products' && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Products</h2>
              <p className="text-sm text-muted-foreground">Showing up to 100 products for this store.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input className="w-72" placeholder="Search by name, UPC, category, brand, vendor..." value={productSearch} onChange={(event) => setProductSearch(event.target.value)} />
              {canViewProducts ? (
                <Button variant="outline" onClick={() => exportCSV(filteredProducts as unknown as JsonRecord[], 'store-products.csv')} disabled={filteredProducts.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
              ) : null}
              {canEditProducts ? (
                <Button onClick={openAddProduct}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Product
                </Button>
              ) : null}
            </div>
          </div>
          {sectionLoading ? <LoadingRows /> : filteredProducts.length === 0 ? <EmptyState icon={Package} text="No products for this store." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Product</th><th className="px-3 py-2">UPC</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Brand</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Stock</th>{canEditProducts ? <th className="px-3 py-2 text-right">Actions</th> : null}</tr></thead>
                <tbody>{filteredProducts.map((product) => <tr key={product.id} className="border-b last:border-0"><td className="px-3 py-3 font-medium">{product.item_name || '-'}</td><td className="px-3 py-3 text-muted-foreground">{product.upc || '-'}</td><td className="px-3 py-3">{product.category || '-'}</td><td className="px-3 py-3">{product.brand || '-'}</td><td className="px-3 py-3">{product.vendor || '-'}</td><td className="px-3 py-3">{formatCurrency(product.selling_price)}</td><td className="px-3 py-3">{product.stock ?? 0} / {product.reorder_level ?? 0}</td>{canEditProducts ? <td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => openEditProduct(product)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button></td> : null}</tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'transactions' && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Transactions</h2>
              <p className="text-sm text-muted-foreground">Showing up to 100 transactions for this store.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input className="w-72" placeholder="Search by item, cashier, category, payment type..." value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} />
              <Input type="date" value={transactionFromDate} onChange={(event) => setTransactionFromDate(event.target.value)} />
              <Input type="date" value={transactionToDate} onChange={(event) => setTransactionToDate(event.target.value)} />
              {canViewTransactions ? (
                <Button variant="outline" onClick={() => exportCSV(filteredTransactions as unknown as JsonRecord[], 'store-transactions.csv')} disabled={filteredTransactions.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
              ) : null}
            </div>
          </div>
          {sectionLoading ? <LoadingRows /> : filteredTransactions.length === 0 ? <EmptyState icon={Database} text="No transactions uploaded for this store." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Time</th><th className="px-3 py-2">Transaction</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Payment</th><th className="px-3 py-2">Total</th></tr></thead>
                <tbody>{filteredTransactions.map((transaction) => <tr key={transaction.id} className="border-b last:border-0"><td className="px-3 py-3">{formatDate(transaction.transaction_time)}</td><td className="px-3 py-3 text-muted-foreground">{transaction.transaction_id || '-'}</td><td className="px-3 py-3">{transaction.item_name || '-'}</td><td className="px-3 py-3">{transaction.category || '-'}</td><td className="px-3 py-3">{transaction.payment_type || '-'}</td><td className="px-3 py-3 font-medium">{formatCurrency(transaction.total_amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'reports' && data && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <ReportCard label="Sales" value={formatCurrency(data.metrics.total_sales)} icon={BarChart3} />
            <ReportCard label="Transactions" value={String(data.metrics.transaction_count)} icon={Database} />
            <ReportCard label="Products" value={String(data.metrics.product_count)} icon={Package} />
            <ReportCard label="Low Stock" value={String(data.metrics.low_stock_count)} icon={AlertCircle} />
          </div>
          {filteredTransactions.length === 0 ? (
            <Card className="p-5"><EmptyState icon={BarChart3} text="No report data available." /></Card>
          ) : (
            <div className="grid gap-5 xl:grid-cols-3">
              <ReportTable
                title="Sales by Category"
                headers={['Category', 'Total Sales', 'Transactions']}
                rows={salesByCategory.map((row) => [row.category, formatCurrency(row.total_sales), String(row.transactions)])}
              />
              <ReportTable
                title="Top Products"
                headers={['Product', 'Units Sold', 'Revenue']}
                rows={topProducts.map((row) => [row.product, String(row.units_sold), formatCurrency(row.revenue)])}
              />
              <ReportTable
                title="Cashier Summary"
                headers={['Cashier', 'Transactions', 'Total Sales']}
                rows={cashierSummary.map((row) => [row.cashier, String(row.transactions), formatCurrency(row.total_sales)])}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'fuel' && data && (
        <Card className="p-5">
          {data.store.has_fuel ? (
            <div>
              <h2 className="font-semibold text-foreground">Fuel</h2>
              <p className="mt-2 text-sm text-muted-foreground">Fuel brand: {data.store.fuel_brand || 'Not specified'}</p>
              <p className="mt-3 text-sm text-muted-foreground">Fuel editing requires fuel inventory schema. Current view is read-only.</p>
            </div>
          ) : (
            <EmptyState icon={Fuel} text="This store is not configured for fuel." />
          )}
        </Card>
      )}

      {activeTab === 'settings' && (
        <Card className="p-5">
          <h2 className="font-semibold text-foreground">Store Settings</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Settings management from Store 360 is coming soon.
          </p>
        </Card>
      )}

      {activeTab === 'support' && data && (
        <Card className="p-5">
          <h2 className="font-semibold text-foreground">Support</h2>
          {data.recent_tickets.length === 0 ? <EmptyState icon={AlertCircle} text="No support tickets for this store." /> : <TableCard title="Recent Tickets" rows={data.recent_tickets} emptyText="No support tickets for this store." />}
        </Card>
      )}

      {activeTab === 'audit' && (
        <Card className="p-5">
          {data?.permissions.canViewAudit ? <TableCard title="Audit Logs" rows={auditLogs} emptyText="No audit logs for this store." loading={sectionLoading} /> : <EmptyState icon={ShieldAlert} text="Access Limited. You do not have permission to view audit logs." />}
        </Card>
      )}
    </div>
  );

  return (
    <Shell>
      <PageHeader title="Store 360" description={headerDescription}>
        <Button variant="outline" asChild>
          <Link href={backHref}>Back to Stores</Link>
        </Button>
        <Button variant="outline" onClick={() => void loadOverview()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
        {data && canDeactivate ? (
          <Button
            variant="outline"
            className={data.store.is_active === false ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}
            onClick={() => void toggleActive()}
            disabled={saving}
          >
            <Power className="mr-2 h-4 w-4" />
            {data.store.is_active === false ? 'Reactivate Store' : 'Deactivate Store'}
          </Button>
        ) : null}
      </PageHeader>
      {loading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Store 360...
        </Card>
      ) : data ? content : (
        <Card className="p-6">
          <EmptyState icon={Store} text="Store 360 could not load for this store." />
        </Card>
      )}
      {productDrawerOpen ? (
        <ProductDrawer
          mode={productDrawerMode}
          form={productForm}
          saving={productSaving}
          error={productError}
          onChange={setProductForm}
          onClose={closeProductDrawer}
          onSubmit={() => void submitProduct()}
        />
      ) : null}
    </Shell>
  );
}

function LoadingRows() {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading...
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: typeof Store;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'amber' | 'green';
}) {
  const iconClass =
    tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : 'text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl border bg-white p-4 text-left text-sm font-medium transition hover:bg-gray-50"
    >
      <Icon className={`h-4 w-4 ${iconClass}`} />
      {label}
    </button>
  );
}

function UploadCard({
  icon: Icon,
  title,
  text,
  uploading,
  onPick,
}: {
  icon: typeof Store;
  title: string;
  text: string;
  uploading: boolean;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          <label className="mt-4 inline-flex h-10 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {uploading ? 'Uploading...' : 'Upload'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onPick} />
          </label>
        </div>
      </div>
    </Card>
  );
}

function TableCard({ title, rows, emptyText, loading }: { title: string; rows: JsonRecord[]; emptyText: string; loading?: boolean }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-foreground">{title}</h2>
      {loading ? <LoadingRows /> : rows.length === 0 ? <EmptyState icon={FileClock} text={emptyText} /> : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Type / Action</th>
                <th className="px-3 py-2">Details</th>
                <th className="px-3 py-2">Rows / Actor</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id || index)} className="border-b last:border-0">
                  <td className="px-3 py-3 font-medium">{String(row.upload_type || row.action || 'Activity')}</td>
                  <td className="px-3 py-3 text-muted-foreground">{String(row.file_name || row.description || row.related_type || '-')}</td>
                  <td className="px-3 py-3">{String(row.total_rows ?? row.actor_email ?? '-')}</td>
                  <td className="px-3 py-3">{formatDate(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ReportCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Store }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-foreground">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs uppercase text-muted-foreground">
              {headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}-${index}`} className="border-b last:border-0">
                {row.map((cell, cellIndex) => <td key={`${title}-${index}-${cellIndex}`} className="px-3 py-3">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ProductDrawer({
  mode,
  form,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: ProductDrawerMode;
  form: ProductFormState;
  saving: boolean;
  error: string | null;
  onChange: (form: ProductFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const update = (key: keyof ProductFormState, value: string | boolean) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close product drawer" className="flex-1 bg-black/50" onClick={onClose} />
      <aside className="flex h-full w-full max-w-lg flex-col bg-background shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{mode === 'add' ? 'Add Product' : 'Edit Product'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Changes are scoped to this selected store.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
          {([
            ['upc', 'UPC'],
            ['item_name', 'Item Name'],
            ['category', 'Category'],
            ['brand', 'Brand'],
            ['department', 'Department'],
            ['vendor', 'Vendor'],
            ['cost_price', 'Cost Price'],
            ['selling_price', 'Selling Price'],
            ['stock', 'Stock'],
            ['reorder_level', 'Reorder Level'],
          ] as Array<[keyof ProductFormState, string]>).map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{label}</span>
              <Input
                type={['cost_price', 'selling_price', 'stock', 'reorder_level'].includes(key) ? 'number' : 'text'}
                required={key === 'upc' || key === 'item_name'}
                value={String(form[key])}
                onChange={(event) => update(key, event.target.value)}
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(event) => update('is_active', event.target.checked)} />
            Active
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-foreground">Notes</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t p-5">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === 'add' ? 'Add Product' : 'Save Changes'}
          </Button>
        </div>
      </aside>
    </div>
  );
}
