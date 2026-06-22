'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  FileText,
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useStoreData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/lib/mock-data';
import { CHART_COLORS } from '@/lib/mock-data';
import { computeMargin } from '@/lib/csv';
import { exportToCsv, formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'products' | 'receiving' | 'reorder' | 'history';

type ProductFormState = {
  upc: string;
  name: string;
  department: string;
  brand: string;
  vendor: string;
  costPrice: string;
  sellPrice: string;
  stock: string;
  reorderLevel: string;
  taxCategory: string;
  taxRate: string;
  taxable: boolean;
  ebtEligible: boolean;
  isActive: boolean;
  notes: string;
};

type ReceivingLineStatus = 'Matched' | 'New Product' | 'Needs Review';
type InvoiceSourceKind = 'pdf' | 'image' | 'csv' | 'unknown';

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

const RECEIVING_HISTORY_KEY = 'storepulse_receiving_history_v1';
const INVOICE_BUCKET = 'inventory-invoices';

const EMPTY_PRODUCT_FORM: ProductFormState = {
  upc: '',
  name: '',
  department: '',
  brand: '',
  vendor: '',
  costPrice: '',
  sellPrice: '',
  stock: '0',
  reorderLevel: '10',
  taxCategory: 'standard',
  taxRate: '0',
  taxable: true,
  ebtEligible: false,
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
  { key: 'receiving', label: 'Receiving' },
  { key: 'reorder', label: 'Reorder' },
  { key: 'history', label: 'History' },
];

function safeNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function productToForm(product: Product): ProductFormState {
  return {
    upc: product.upc,
    name: product.name,
    department: product.department || product.category || '',
    brand: product.brand || '',
    vendor: product.vendor || '',
    costPrice: product.costPrice.toFixed(2),
    sellPrice: product.sellPrice.toFixed(2),
    stock: String(product.stock),
    reorderLevel: String(product.reorderLevel),
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
    vendor: form.vendor.trim() || undefined,
    costPrice: safeNumber(form.costPrice),
    sellPrice: safeNumber(form.sellPrice),
    stock: safeNumber(form.stock),
    reorderLevel: safeNumber(form.reorderLevel, 10),
    taxCategory: form.taxable ? form.taxCategory.trim() || 'standard' : 'non-taxable',
    taxRate: form.taxable ? safeNumber(form.taxRate) : 0,
    taxable: form.taxable,
    ebtEligible: form.ebtEligible,
    isActive: form.isActive,
    notes: form.notes.trim() || undefined,
  };
}

function validateProductForm(form: ProductFormState) {
  if (!form.upc.trim()) return 'UPC is required.';
  if (!form.name.trim()) return 'Product name is required.';
  if (!form.department.trim()) return 'Department is required.';
  if (safeNumber(form.costPrice) < 0) return 'Cost price must be zero or more.';
  if (safeNumber(form.sellPrice) < 0) return 'Selling price must be zero or more.';
  if (safeNumber(form.stock) < 0) return 'Stock must be zero or more.';
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
}: {
  open: boolean;
  mode: 'add' | 'edit';
  form: ProductFormState;
  setForm: (form: ProductFormState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  departments: string[];
  vendors: string[];
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="max-h-[92vh] w-full max-w-4xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {mode === 'add' ? 'Add Product' : 'Edit Product'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage product details, pricing, stock, tax, and vendor information.
            </p>
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
              <h3 className="text-sm font-semibold text-foreground">Product Details</h3>

              <div className="mt-4 grid gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">UPC *</span>
                  <Input
                    value={form.upc}
                    onChange={(event) => setForm({ ...form, upc: event.target.value })}
                    disabled={mode === 'edit'}
                    placeholder="0120000010101"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Product Name *</span>
                  <Input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="Coca-Cola 20oz"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Department *</span>
                  <select
                    value={form.department}
                    onChange={(event) => setForm({ ...form, department: event.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select department</option>
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Brand</span>
                  <Input
                    value={form.brand}
                    onChange={(event) => setForm({ ...form, brand: event.target.value })}
                    placeholder="Coca-Cola"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Vendor</span>
                  <select
                    value={form.vendor}
                    onChange={(event) => setForm({ ...form, vendor: event.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">No vendor selected</option>
                    {vendors.map((vendor) => (
                      <option key={vendor} value={vendor}>
                        {vendor}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground">Pricing & Stock</h3>

              <div className="mt-4 grid gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Cost Price *</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.costPrice}
                    onChange={(event) => setForm({ ...form, costPrice: event.target.value })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Selling Price *</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.sellPrice}
                    onChange={(event) => setForm({ ...form, sellPrice: event.target.value })}
                  />
                </label>

                <div className="rounded-lg bg-secondary/50 p-3 text-sm">
                  <span className="text-muted-foreground">Margin: </span>
                  <span className="font-semibold text-foreground">
                    {computeMargin(safeNumber(form.sellPrice), safeNumber(form.costPrice)).toFixed(1)}%
                  </span>
                </div>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Current Stock</span>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={form.stock}
                    onChange={(event) => setForm({ ...form, stock: event.target.value })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Reorder Level</span>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={form.reorderLevel}
                    onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })}
                  />
                </label>
              </div>
            </Card>

            <Card className="p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Product Rules</h3>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Active</span>
                    <span className="text-xs text-muted-foreground">Show this product in active inventory.</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={form.taxable}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        taxable: event.target.checked,
                        taxCategory: event.target.checked ? 'standard' : 'non-taxable',
                        taxRate: event.target.checked ? form.taxRate : '0',
                      })
                    }
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Taxable</span>
                    <span className="text-xs text-muted-foreground">Used for product tax reporting.</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <input
                    type="checkbox"
                    checked={form.ebtEligible}
                    onChange={(event) => setForm({ ...form, ebtEligible: event.target.checked })}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">EBT Eligible</span>
                    <span className="text-xs text-muted-foreground">Mark food stamp eligible products.</span>
                  </span>
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_160px]">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Tax Category</span>
                  <Input
                    value={form.taxCategory}
                    disabled={!form.taxable}
                    onChange={(event) => setForm({ ...form, taxCategory: event.target.value })}
                    placeholder="standard"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Tax Rate %</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.taxRate}
                    disabled={!form.taxable}
                    onChange={(event) => setForm({ ...form, taxRate: event.target.value })}
                  />
                </label>
              </div>

              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Optional product notes."
                className="mt-4 min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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

export default function ProductsPage() {
  const { store } = useAuth();

  const {
    products: storeProducts,
    updateProduct,
    createProduct,
    isDemoProducts,
    productsMeta,
    cloudError,
    loaded,
  } = useStoreData();

  const [items, setItems] = useState<Product[]>(storeProducts);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState('All');
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  const [storeVendorOptions, setStoreVendorOptions] = useState<string[]>([]);

  useEffect(() => {
    setItems(storeProducts);
  }, [storeProducts]);

  const loadCloudReceivingHistory = async () => {
    if (!store?.id) {
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

    const history: ReceivingHistoryItem[] = (data || []).map((receipt: any) => {
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
        lines: receiptItems.map((item: any) => ({
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
        setStoreVendorOptions([]);
        return;
      }

      const { data, error } = await supabase
        .from('store_vendors')
        .select('vendor_name')
        .eq('store_id', store.id)
        .eq('is_active', true)
        .order('vendor_name', { ascending: true });

      if (error) {
        setStoreVendorOptions([]);
        return;
      }

      setStoreVendorOptions(
        (data || [])
          .map((vendor: any) => String(vendor.vendor_name || '').trim())
          .filter(Boolean)
      );
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

  const vendorOptions = useMemo(() => {
    const set = new Set<string>();

    storeVendorOptions.forEach((vendor) => {
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
  }, [storeVendorOptions, vendors, receivingLines, receiptVendor]);

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

  const filteredProducts = useMemo(() => {
    return items.filter((product) => {
      const stockStatus = product.stock <= product.reorderLevel ? 'Reorder' : 'In Stock';
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

      if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
      if (departmentFilter !== 'All' && (product.department || product.category) !== departmentFilter) return false;
      if (stockFilter !== 'All' && stockStatus !== stockFilter) return false;

      return true;
    });
  }, [items, query, departmentFilter, stockFilter]);

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
    setReceivingLines((previous) => previous.filter((line) => line.id !== id));
  };

  const addManualReceivingLine = () => {
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
    setModalMode('add');
    setForm(EMPTY_PRODUCT_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setModalMode('edit');
    setForm(productToForm(product));
    setFormError(null);
    setModalOpen(true);
  };

  const saveProduct = async () => {
    const validationError = validateProductForm(form);

    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);

    const product = formToProduct(form);
    const result = modalMode === 'add' ? await createProduct(product) : await updateProduct(product);

    setSaving(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    setModalOpen(false);
  };

  const exportProducts = () => {
    exportToCsv(
      'storepulse-products-inventory.csv',
      filteredProducts.map((product) => ({
        UPC: product.upc,
        Product: product.name,
        Department: product.department || product.category,
        Brand: product.brand || '',
        Vendor: product.vendor || '',
        CostPrice: product.costPrice.toFixed(2),
        SellPrice: product.sellPrice.toFixed(2),
        Margin: computeMargin(product.sellPrice, product.costPrice).toFixed(1),
        Stock: product.stock,
        ReorderLevel: product.reorderLevel,
        Taxable: (product.taxable ?? true) ? 'Yes' : 'No',
        EBT: product.ebtEligible ? 'Yes' : 'No',
        Active: (product.isActive ?? true) ? 'Yes' : 'No',
      }))
    );
  };

  const uploadInvoiceSource = async (existingPath?: string) => {
    if (!store?.id) return existingPath || '';
    if (!invoiceFile) return existingPath || '';

    const path = `${store.id}/${Date.now()}-${safeFileName(invoiceFile.name)}`;

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

        const updatedProduct: Product = {
          ...matched,
          stock: nextStock,
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
    if (!store?.id) return entry;

    const receiptPayload = {
      store_id: store.id,
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
        .eq('id', editingHistoryId);

      if (error) throw new Error(error.message);

      const { error: deleteItemsError } = await supabase
        .from('inventory_receipt_items')
        .delete()
        .eq('receipt_id', editingHistoryId);

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
      store_id: store.id,
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

      if (!store?.id) {
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
    setReceivingMessage(null);

    try {
      if (entry.lines?.length) {
        const reversed = await applyReceivingLinesToProducts(items, entry.lines, 'subtract');
        setItems(reversed.nextProducts);
      }

      if (store?.id) {
        const { error } = await supabase.from('inventory_receipts').delete().eq('id', entry.id);
        if (error) throw new Error(error.message);

        if (entry.sourcePath) {
          await supabase.storage.from(INVOICE_BUCKET).remove([entry.sourcePath]);
        }
      }

      const nextHistory = receivingHistory.filter((item) => item.id !== entry.id);
      setReceivingHistory(nextHistory);

      if (!store?.id) {
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

          <Button size="sm" onClick={openAddModal}>
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>
      </PageHeader>

      {(cloudError || receivingMessage) && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{cloudError || receivingMessage}</span>
        </div>
      )}

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <button onClick={openAddModal} className="rounded-lg border bg-card p-4 text-left shadow-sm transition hover:bg-secondary/40">
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
                  <div key={product.upc} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.stock} left · reorder at {product.reorderLevel}
                      </p>
                    </div>

                    <Button size="sm" variant="outline" onClick={() => openEditModal(product)}>
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
            <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by product, UPC, brand, vendor, or department..."
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
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="All">All stock</option>
                <option value="In Stock">In Stock</option>
                <option value="Reorder">Reorder</option>
              </select>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
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

                    return (
                      <tr key={product.upc} className="border-t border-border/70 hover:bg-secondary/30">
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                              <Package className="h-4 w-4" />
                            </div>

                            <div>
                              <p className="font-semibold text-foreground">{product.name}</p>
                              <p className="font-mono text-xs text-muted-foreground">UPC {product.upc}</p>
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
                        </td>

                        <td className="px-4 py-4 text-right">
                          <Button variant="outline" size="sm" onClick={() => openEditModal(product)}>
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
                  <label className="flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center transition hover:bg-secondary/50">
                    <Upload className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium text-foreground">Choose CSV, PDF, or image invoice</span>
                    <input
                      type="file"
                      accept=".csv,text/csv,application/pdf,image/*"
                      className="hidden"
                      onChange={(event) => handleInvoiceFile(event.target.files?.[0] || null)}
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-border p-4 text-center transition hover:bg-secondary/40">
                    <Camera className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium text-foreground">Take invoice photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(event) => handleInvoiceFile(event.target.files?.[0] || null)}
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
                  disabled={!invoiceFile || extractingInvoice}
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
                  <Button variant="outline" onClick={addManualReceivingLine}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Row
                  </Button>

                  <Button onClick={() => void saveReceiving()} disabled={savingReceiving}>
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

                        <Button variant="outline" size="sm" onClick={() => removeReceivingLine(line.id)}>
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
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold text-foreground">Reorder List</h2>
            <p className="text-sm text-muted-foreground">Products at or below reorder level.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Reorder Level</th>
                  <th className="px-4 py-3 text-right">Suggested Qty</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                {lowStockProducts.map((product) => {
                  const suggestedQty = Math.max(product.reorderLevel * 2 - product.stock, product.reorderLevel);

                  return (
                    <tr key={product.upc} className="border-t border-border/70">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-foreground">{product.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">UPC {product.upc}</p>
                      </td>

                      <td className="px-4 py-4 text-muted-foreground">{product.vendor || 'No vendor'}</td>
                      <td className="px-4 py-4 text-right font-semibold text-destructive">{formatNumber(product.stock)}</td>
                      <td className="px-4 py-4 text-right text-muted-foreground">{formatNumber(product.reorderLevel)}</td>
                      <td className="px-4 py-4 text-right font-semibold text-foreground">{formatNumber(suggestedQty)}</td>

                      <td className="px-4 py-4 text-right">
                        <Button size="sm" variant="outline" onClick={() => openEditModal(product)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!lowStockProducts.length && (
            <div className="p-8 text-center text-sm text-muted-foreground">No reorder items right now.</div>
          )}
        </Card>
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

      <ProductModal
        open={modalOpen}
        mode={modalMode}
        form={form}
        setForm={setForm}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        onSave={saveProduct}
        saving={saving}
        error={formError}
        departments={departments}
        vendors={vendors}
      />
    </DashboardShell>
  );
}