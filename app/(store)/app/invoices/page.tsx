'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  History,
  PackageCheck,
  Plus,
  Receipt,
  Truck,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ProductForm, type ProductFormState } from '@/components/products/ProductForm';
import { useAuth } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';
import {
  findProductMatch,
  parseReceivingCsv,
  type InvoiceSourceKind,
  type ReceivingLine,
  type ReceivingLineStatus,
} from '@/lib/invoices';
import type { Product } from '@/lib/mock-data';
import { useStoreData } from '@/lib/store';
import { cn } from '@/lib/utils';

type InvoiceTab = 'overview' | 'upload' | 'receiving' | 'history' | 'vendors';

type ExtractedInvoiceLine = {
  upc?: string;
  name?: string;
  department?: string;
  vendor?: string;
  quantity?: number;
  unitCost?: number;
  totalCost?: number;
};

type ExtractInvoiceResponse = {
  error?: string;
  message?: string;
  lines?: ExtractedInvoiceLine[];
};

type InvoicePreviewLine = ReceivingLine & {
  receivedCases: number;
  looseUnits: number;
  unitsPerCase: number;
  caseCost: number;
  totalUnits: number;
  matchedProductId?: string;
};

const SELECT_STORE_MESSAGE = 'Select a specific store to upload and review invoices.';
const SELECT_VENDOR_STORE_MESSAGE = 'Select a specific store to build vendor orders.';

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
  costPrice: '0.00',
  sellPrice: '0.00',
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

const invoiceTabs: Array<{
  id: InvoiceTab;
  title: string;
  description: string;
  icon: typeof Receipt;
}> = [
  {
    id: 'overview',
    title: 'Overview',
    description: 'A future snapshot for invoice totals, recent receiving, open vendor orders, and items needing review.',
    icon: Receipt,
  },
  {
    id: 'upload',
    title: 'Upload Invoice',
    description: 'Upload an invoice source file and preview extracted receiving lines.',
    icon: UploadCloud,
  },
  {
    id: 'receiving',
    title: 'Receiving',
    description: 'Current save tools remain in Products until migration is complete.',
    icon: PackageCheck,
  },
  {
    id: 'history',
    title: 'History',
    description: 'Saved invoice history will move here in a later migration phase.',
    icon: History,
  },
  {
    id: 'vendors',
    title: 'Vendor Orders',
    description: 'Vendor order windows and purchase order exports will move here later.',
    icon: Truck,
  },
];

function safeNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function getProductIdentity(product: Product) {
  return product.id || product.upc || product.productCode || product.plu || product.sku || product.name;
}

function getInvoiceSourceKind(file: File): InvoiceSourceKind {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (lowerName.endsWith('.csv') || file.type.includes('csv')) return 'csv';
  if (file.type.startsWith('image/')) return 'image';
  return 'unknown';
}

function getStatus(upc: string, name: string, products: ReturnType<typeof useStoreData>['products']): ReceivingLineStatus {
  const matched = findProductMatch(products, upc, name);
  return matched ? 'Matched' : upc || name ? 'New Product' : 'Needs Review';
}

function getUnitsPerCase(product: Product | undefined) {
  return Math.max(1, safeNumber(product?.unitsPerCase, 1));
}

function calculateLineTotals(line: Pick<InvoicePreviewLine, 'receivedCases' | 'looseUnits' | 'unitsPerCase' | 'unitCost'>) {
  const receivedCases = Math.max(0, safeNumber(line.receivedCases));
  const looseUnits = Math.max(0, safeNumber(line.looseUnits));
  const unitsPerCase = Math.max(1, safeNumber(line.unitsPerCase, 1));
  const unitCost = Math.max(0, safeNumber(line.unitCost));
  const totalUnits = receivedCases * unitsPerCase + looseUnits;

  return {
    receivedCases,
    looseUnits,
    unitsPerCase,
    unitCost,
    caseCost: unitCost * unitsPerCase,
    totalUnits,
    totalCost: totalUnits * unitCost,
  };
}

function productToForm(product: Product): ProductFormState {
  const unitsPerCase = getUnitsPerCase(product);
  const casesOnHand =
    product.casesOnHand !== undefined
      ? safeNumber(product.casesOnHand)
      : Math.floor(safeNumber(product.stock) / unitsPerCase);
  const looseUnits =
    product.looseUnits !== undefined
      ? safeNumber(product.looseUnits)
      : safeNumber(product.stock) % unitsPerCase;

  return {
    ...EMPTY_PRODUCT_FORM,
    upc: product.upc || '',
    plu: product.plu || '',
    productCode: product.productCode || '',
    sku: product.sku || '',
    name: product.name || '',
    department: product.department || product.category || '',
    category: product.category || product.department || '',
    brand: product.brand || '',
    vendor: product.vendor || '',
    costPrice: safeNumber(product.costPrice).toFixed(2),
    sellPrice: safeNumber(product.sellPrice).toFixed(2),
    stock: String(safeNumber(product.stock)),
    reorderLevel: String(safeNumber(product.reorderLevel, 10)),
    unitsPerCase: String(unitsPerCase),
    casesOnHand: String(casesOnHand),
    looseUnits: String(looseUnits),
    taxCategory: product.taxCategory || ((product.taxable ?? true) ? 'standard' : 'non-taxable'),
    taxRate: String(product.taxRate ?? 0),
    taxable: product.taxable ?? true,
    ebtEligible: product.ebtEligible ?? false,
    ageVerification: product.ageVerification ?? false,
    minimumAge: product.minimumAge ? String(product.minimumAge) : '',
    ageRestrictionType: product.ageRestrictionType || '',
    isActive: product.isActive ?? true,
    notes: product.notes || '',
  };
}

function formToProduct(form: ProductFormState, original: Product): Product {
  const department =
    form.department === '__other__'
      ? form.customDepartment.trim() || 'General Merchandise'
      : form.department.trim() || 'General Merchandise';
  const category = form.category.trim() || department;
  const unitsPerCase = Math.max(1, safeNumber(form.unitsPerCase, 1));
  const casesOnHand = Math.max(0, safeNumber(form.casesOnHand));
  const looseUnits = Math.max(0, safeNumber(form.looseUnits));

  return {
    ...original,
    upc: form.upc.trim(),
    plu: form.plu.trim() || undefined,
    productCode: form.productCode.trim() || undefined,
    sku: form.sku.trim() || undefined,
    name: form.name.trim(),
    department,
    category,
    brand: form.brand.trim() || 'Unknown',
    vendor:
      form.vendor === '__other__'
        ? form.customVendor.trim() || undefined
        : form.vendor.trim() || undefined,
    costPrice: safeNumber(form.costPrice),
    sellPrice: safeNumber(form.sellPrice),
    stock: casesOnHand * unitsPerCase + looseUnits,
    reorderLevel: safeNumber(form.reorderLevel, 10),
    unitsPerCase,
    casesOnHand,
    looseUnits,
    taxCategory: form.taxable ? form.taxCategory.trim() || 'standard' : 'non-taxable',
    taxRate: form.taxable ? safeNumber(form.taxRate) : 0,
    taxable: form.taxable,
    ebtEligible: form.ebtEligible,
    ageVerification: form.ageVerification,
    minimumAge: form.ageVerification ? safeNumber(form.minimumAge) || 21 : undefined,
    ageRestrictionType: form.ageVerification ? form.ageRestrictionType || undefined : undefined,
    isActive: form.isActive,
    notes: form.notes.trim() || undefined,
  };
}

export default function InvoicesPage() {
  const { activeStore, activeStoreId, storeScope, user } = useAuth();
  const { products, loaded, updateProduct, refresh } = useStoreData();
  const [activeTab, setActiveTab] = useState<InvoiceTab>('upload');
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceFileName, setInvoiceFileName] = useState('');
  const [invoiceSourceKind, setInvoiceSourceKind] = useState<InvoiceSourceKind>('unknown');
  const [receivingLines, setReceivingLines] = useState<InvoicePreviewLine[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extractingInvoice, setExtractingInvoice] = useState(false);
  const [editingProductDefaults, setEditingProductDefaults] = useState<Product | null>(null);
  const [productDefaultsForm, setProductDefaultsForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [savingProductDefaults, setSavingProductDefaults] = useState(false);
  const [productDefaultsError, setProductDefaultsError] = useState<string | null>(null);
  const [vendorFilter, setVendorFilter] = useState('all');
  const [vendorOrderDrafts, setVendorOrderDrafts] = useState<
    Record<string, { orderedCases?: string; looseUnits?: string; expectedUnitCost?: string }>
  >({});

  const uploadBlocked = Boolean(user && (storeScope === 'all' || !activeStoreId));
  const storeBlockedMessage = activeTab === 'vendors' ? SELECT_VENDOR_STORE_MESSAGE : SELECT_STORE_MESSAGE;
  const selectedStoreName = activeStore?.store_name || 'Selected store';

  const invoiceTotal = useMemo(
    () => receivingLines.reduce((sum, line) => sum + safeNumber(line.totalCost), 0),
    [receivingLines]
  );

  const lineCounts = useMemo(
    () => ({
      matched: receivingLines.filter((line) => line.status === 'Matched').length,
      new: receivingLines.filter((line) => line.status === 'New Product').length,
      review: receivingLines.filter((line) => line.status === 'Needs Review').length,
    }),
    [receivingLines]
  );

  const vendorOrderSuggestions = useMemo(() => {
    return products
      .filter((product) => {
        const active = product.isActive ?? true;
        const stock = safeNumber(product.stock);
        const reorderLevel = safeNumber(product.reorderLevel, 10);
        return active && stock <= reorderLevel;
      })
      .map((product) => {
        const productKey = getProductIdentity(product);
        const stock = Math.max(0, safeNumber(product.stock));
        const reorderLevel = Math.max(0, safeNumber(product.reorderLevel, 10));
        const unitsPerCase = Math.max(1, safeNumber(product.unitsPerCase, 1));
        const costPrice = Math.max(0, safeNumber(product.costPrice));
        const suggestedUnits = Math.max(reorderLevel * 2 - stock, reorderLevel);
        const suggestedCases = Math.floor(suggestedUnits / unitsPerCase);
        const suggestedLooseUnits = suggestedUnits % unitsPerCase;
        const draft = vendorOrderDrafts[productKey] || {};
        const orderedCases = Math.max(0, safeNumber(draft.orderedCases, suggestedCases));
        const looseUnits = Math.max(0, safeNumber(draft.looseUnits, suggestedLooseUnits));
        const expectedUnitCost = Math.max(0, safeNumber(draft.expectedUnitCost, costPrice));
        const totalOrderedUnits = orderedCases * unitsPerCase + looseUnits;
        const expectedCaseCost = expectedUnitCost * unitsPerCase;
        const estimatedTotal = totalOrderedUnits * expectedUnitCost;

        return {
          product,
          productKey,
          vendor: product.vendor || 'No vendor',
          stock,
          reorderLevel,
          unitsPerCase,
          suggestedUnits,
          suggestedCases,
          suggestedLooseUnits,
          orderedCases,
          looseUnits,
          expectedUnitCost,
          totalOrderedUnits,
          expectedCaseCost,
          estimatedTotal,
        };
      })
      .sort((a, b) => {
        const vendorSort = a.vendor.localeCompare(b.vendor);
        if (vendorSort !== 0) return vendorSort;
        return a.product.name.localeCompare(b.product.name);
      });
  }, [products, vendorOrderDrafts]);

  const vendorOrderVendorOptions = useMemo(() => {
    return Array.from(new Set(vendorOrderSuggestions.map((suggestion) => suggestion.vendor))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [vendorOrderSuggestions]);

  const filteredVendorOrderSuggestions = useMemo(() => {
    if (vendorFilter === 'all') return vendorOrderSuggestions;
    return vendorOrderSuggestions.filter((suggestion) => suggestion.vendor === vendorFilter);
  }, [vendorFilter, vendorOrderSuggestions]);

  const vendorOrderGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        vendor: string;
        products: typeof vendorOrderSuggestions;
        productCount: number;
        totalSuggestedUnits: number;
        totalOrderedUnits: number;
        estimatedTotal: number;
      }
    >();

    filteredVendorOrderSuggestions.forEach((suggestion) => {
      const current = map.get(suggestion.vendor) || {
        vendor: suggestion.vendor,
        products: [],
        productCount: 0,
        totalSuggestedUnits: 0,
        totalOrderedUnits: 0,
        estimatedTotal: 0,
      };

      current.products.push(suggestion);
      current.productCount += 1;
      current.totalSuggestedUnits += suggestion.suggestedUnits;
      current.totalOrderedUnits += suggestion.totalOrderedUnits;
      current.estimatedTotal += suggestion.estimatedTotal;

      map.set(suggestion.vendor, current);
    });

    return Array.from(map.values()).sort((a, b) => b.estimatedTotal - a.estimatedTotal);
  }, [filteredVendorOrderSuggestions, vendorOrderSuggestions]);

  const vendorOrderSummary = useMemo(
    () => ({
      vendors: vendorOrderGroups.length,
      products: filteredVendorOrderSuggestions.length,
      suggestedUnits: filteredVendorOrderSuggestions.reduce((sum, suggestion) => sum + suggestion.suggestedUnits, 0),
      orderedUnits: filteredVendorOrderSuggestions.reduce((sum, suggestion) => sum + suggestion.totalOrderedUnits, 0),
      estimatedTotal: filteredVendorOrderSuggestions.reduce((sum, suggestion) => sum + suggestion.estimatedTotal, 0),
    }),
    [filteredVendorOrderSuggestions, vendorOrderGroups.length]
  );

  const departmentOptions = useMemo(() => {
    const values = new Set<string>(['General Merchandise']);

    products.forEach((product) => {
      if (product.department) values.add(product.department);
      if (product.category) values.add(product.category);
    });

    receivingLines.forEach((line) => {
      if (line.department) values.add(line.department);
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [products, receivingLines]);

  const vendorOptions = useMemo(() => {
    const values = new Set<string>();

    products.forEach((product) => {
      if (product.vendor) values.add(product.vendor);
    });

    receivingLines.forEach((line) => {
      if (line.vendor) values.add(line.vendor);
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [products, receivingLines]);

  const buildPreviewLine = (line: ReceivingLine, index: number): InvoicePreviewLine => {
    const matched = findProductMatch(products, line.upc, line.name);
    const unitsPerCase = getUnitsPerCase(matched);
    const importedUnits = Math.max(0, safeNumber(line.quantity));
    const importedUnitCost =
      safeNumber(line.unitCost) ||
      (importedUnits > 0 ? safeNumber(line.totalCost) / importedUnits : 0) ||
      safeNumber(matched?.costPrice);
    const totals = calculateLineTotals({
      receivedCases: 0,
      looseUnits: importedUnits,
      unitsPerCase,
      unitCost: importedUnitCost,
    });

    return {
      ...line,
      id: line.id || `INVOICE-${Date.now()}-${index}`,
      name: line.name || matched?.name || '',
      department: line.department || matched?.department || matched?.category || 'General Merchandise',
      vendor: line.vendor || matched?.vendor || '',
      ...totals,
      quantity: totals.totalUnits,
      status: matched ? 'Matched' : line.name || line.upc ? 'New Product' : 'Needs Review',
      matchedProductId: matched?.id,
    };
  };

  const findMatchedProductForLine = (line: InvoicePreviewLine) => {
    if (line.matchedProductId) {
      const byId = products.find((product) => product.id === line.matchedProductId);
      if (byId) return byId;
    }

    return findProductMatch(products, line.upc, line.name);
  };

  useEffect(() => {
    setInvoiceFile(null);
    setInvoiceFileName('');
    setInvoiceSourceKind('unknown');
    setReceivingLines([]);
    setVendorFilter('all');
    setVendorOrderDrafts({});
    setMessage(null);
    setError(null);
    setExtractingInvoice(false);
  }, [activeStoreId]);

  const updateVendorOrderDraft = (
    productKey: string,
    field: 'orderedCases' | 'looseUnits' | 'expectedUnitCost',
    value: string
  ) => {
    setVendorOrderDrafts((previous) => ({
      ...previous,
      [productKey]: {
        ...previous[productKey],
        [field]: value,
      },
    }));
  };

  const handleInvoiceFile = (file: File | null) => {
    if (!file) return;

    if (uploadBlocked) {
      setError(SELECT_STORE_MESSAGE);
      return;
    }

    setInvoiceFile(file);
    setInvoiceFileName(file.name);
    setInvoiceSourceKind(getInvoiceSourceKind(file));
    setReceivingLines([]);
    setError(null);
    setMessage('File selected. Click Upload & Extract to read the invoice.');
  };

  const extractSelectedInvoice = async () => {
    if (uploadBlocked) {
      setError(SELECT_STORE_MESSAGE);
      return;
    }

    if (!invoiceFile) {
      setError('Choose an invoice file before extracting.');
      return;
    }

    setExtractingInvoice(true);
    setError(null);
    setMessage(null);
    setReceivingLines([]);

    try {
      if (invoiceSourceKind === 'csv') {
        const text = await invoiceFile.text();
        const rows = parseReceivingCsv(text, products).map(buildPreviewLine);

        setReceivingLines(rows);
        setMessage(rows.length ? `${rows.length} invoice lines extracted for review.` : 'No invoice lines found in this CSV.');
        return;
      }

      const formData = new FormData();
      formData.append('file', invoiceFile);

      const response = await fetch('/api/extract-invoice', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as ExtractInvoiceResponse | null;

      if (!response.ok) {
        throw new Error(payload?.error || 'Invoice extraction failed.');
      }

      const rows: InvoicePreviewLine[] = (payload?.lines || []).map((line, index) => {
        const upc = line.upc || '';
        const name = line.name || '';
        const quantity = safeNumber(line.quantity);
        const unitCost = safeNumber(line.unitCost);
        const totalCost = safeNumber(line.totalCost, quantity * unitCost);
        const matched = findProductMatch(products, upc, name);
        const status: ReceivingLineStatus = matched ? 'Matched' : name || upc ? 'New Product' : 'Needs Review';

        return buildPreviewLine({
          id: `INVOICE-${Date.now()}-${index}`,
          upc,
          name: name || matched?.name || '',
          department: line.department || matched?.department || matched?.category || 'General Merchandise',
          vendor: line.vendor || matched?.vendor || '',
          quantity,
          unitCost: unitCost || matched?.costPrice || 0,
          totalCost,
          status,
        }, index);
      });

      setReceivingLines(rows);
      setMessage(
        rows.length
          ? `${rows.length} invoice lines extracted for review.`
          : payload?.message || 'No product lines were found in this invoice.'
      );
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : 'Could not extract invoice.');
    } finally {
      setExtractingInvoice(false);
    }
  };

  const updateReceivingLine = (id: string, changes: Partial<InvoicePreviewLine>) => {
    setReceivingLines((previous) =>
      previous.map((line) => {
        if (line.id !== id) return line;

        const next = { ...line, ...changes };
        const matched = findProductMatch(products, next.upc, next.name);
        const unitsPerCase = Math.max(1, safeNumber(next.unitsPerCase, getUnitsPerCase(matched)));
        const receivedCases = Math.max(0, safeNumber(next.receivedCases));
        const looseUnits = Math.max(0, safeNumber(next.looseUnits));
        let unitCost = Math.max(0, safeNumber(next.unitCost));

        if ('caseCost' in changes) {
          unitCost = unitsPerCase > 0 ? Math.max(0, safeNumber(next.caseCost)) / unitsPerCase : 0;
        }

        const totals = calculateLineTotals({
          receivedCases,
          looseUnits,
          unitsPerCase,
          unitCost,
        });

        return {
          ...next,
          ...totals,
          quantity: totals.totalUnits,
          totalCost: totals.totalCost,
          matchedProductId: matched?.id,
          status: getStatus(next.upc, next.name, products),
        };
      })
    );
  };

  const addManualReceivingLine = () => {
    if (uploadBlocked) {
      setError(SELECT_STORE_MESSAGE);
      return;
    }

    setReceivingLines((previous) => [
      ...previous,
      {
        id: `MANUAL-${Date.now()}`,
        upc: '',
        name: '',
        department: 'General Merchandise',
        vendor: '',
        receivedCases: 0,
        looseUnits: 1,
        unitsPerCase: 1,
        quantity: 1,
        caseCost: 0,
        unitCost: 0,
        totalUnits: 1,
        totalCost: 0,
        status: 'Needs Review',
      },
    ]);
    setMessage('Manual preview row added.');
    setError(null);
  };

  const removeReceivingLine = (id: string) => {
    setReceivingLines((previous) => previous.filter((line) => line.id !== id));
  };

  const openProductDefaults = (product: Product) => {
    setEditingProductDefaults(product);
    setProductDefaultsForm(productToForm(product));
    setProductDefaultsError(null);
  };

  const closeProductDefaults = () => {
    if (savingProductDefaults) return;
    setEditingProductDefaults(null);
    setProductDefaultsForm(EMPTY_PRODUCT_FORM);
    setProductDefaultsError(null);
  };

  const saveProductDefaults = async () => {
    if (!editingProductDefaults) return;

    if (!productDefaultsForm.name.trim()) {
      setProductDefaultsError('Product name is required.');
      return;
    }

    if (safeNumber(productDefaultsForm.unitsPerCase, 1) <= 0) {
      setProductDefaultsError('Units per case must be at least 1.');
      return;
    }

    setSavingProductDefaults(true);
    setProductDefaultsError(null);

    const nextProduct = formToProduct(productDefaultsForm, editingProductDefaults);
    const result = await updateProduct(nextProduct);

    setSavingProductDefaults(false);

    if (result.error) {
      setProductDefaultsError(result.error);
      return;
    }

    const unitsPerCase = getUnitsPerCase(nextProduct);

    setReceivingLines((previous) =>
      previous.map((line) => {
        const sameProduct =
          (nextProduct.id && line.matchedProductId === nextProduct.id) ||
          (nextProduct.upc && line.upc === nextProduct.upc) ||
          (nextProduct.name && line.name.toLowerCase() === nextProduct.name.toLowerCase());

        if (!sameProduct) return line;

        const unitCost = line.caseCost > 0 ? line.caseCost / unitsPerCase : line.unitCost;
        const totals = calculateLineTotals({
          receivedCases: line.receivedCases,
          looseUnits: line.looseUnits,
          unitsPerCase,
          unitCost,
        });

        return {
          ...line,
          name: line.name || nextProduct.name,
          department: line.department || nextProduct.department || nextProduct.category || 'General Merchandise',
          vendor: line.vendor || nextProduct.vendor || '',
          matchedProductId: nextProduct.id,
          ...totals,
          quantity: totals.totalUnits,
          totalCost: totals.totalCost,
          status: 'Matched',
        };
      })
    );

    refresh();
    setMessage('Product defaults updated. Invoice preview math now uses the latest units per case.');
    closeProductDefaults();
  };

  if (!loaded && !uploadBlocked) {
    return (
      <DashboardShell>
        <PageLoading />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Invoices"
        description="Upload invoice sources, preview extracted receiving lines, and prepare for the full receiving migration."
      >
        <Button asChild>
          <Link href="/app/products?tab=receiving">
            <PackageCheck className="mr-2 h-4 w-4" />
            Open current Receiving tools
          </Link>
        </Button>
      </PageHeader>

      {uploadBlocked && (
        <Card className="mb-5 border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold">Select a store</h2>
              <p className="mt-1 text-sm text-amber-900">{storeBlockedMessage}</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-5 border-amber-200 bg-amber-50 p-5 text-amber-950">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h2 className="font-semibold">Preview only</h2>
            <p className="mt-1 text-sm text-amber-900">
              Save Receiving will be enabled after invoice migration is complete. Current save tools are still available
              in Products.
            </p>
          </div>
        </div>
      </Card>

      <div className="mb-5 flex flex-wrap gap-2">
        {invoiceTabs.map((tab) => {
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                activeTab === tab.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.title}
            </button>
          );
        })}
      </div>

      {activeTab !== 'upload' && activeTab !== 'vendors' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {invoiceTabs
            .filter((section) => section.id !== 'upload' && section.id !== 'vendors')
            .map((section) => {
              const Icon = section.icon;

              return (
                <Card key={section.id} className="p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 font-semibold text-foreground">{section.title}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>
                  <div className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                    Current save workflow remains in Products for now.
                  </div>
                </Card>
              );
            })}
        </div>
      )}

      {activeTab === 'vendors' && (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{selectedStoreName}</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Vendor Order Suggestions</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Build vendor orders from low-stock products before matching invoices. This is a preview only and does
                  not save purchase orders yet.
                </p>
              </div>

              {!uploadBlocked && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={vendorFilter}
                    onChange={(event) => setVendorFilter(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    disabled={vendorOrderVendorOptions.length === 0}
                  >
                    <option value="all">All vendors</option>
                    {vendorOrderVendorOptions.map((vendor) => (
                      <option key={vendor} value={vendor}>
                        {vendor}
                      </option>
                    ))}
                  </select>

                  <Button disabled>
                    <Truck className="mr-2 h-4 w-4" />
                    Create Draft Order coming next
                  </Button>
                </div>
              )}
            </div>

            {!uploadBlocked && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">Vendors</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{formatNumber(vendorOrderSummary.vendors)}</p>
                </div>

                <div className="rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">Products</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{formatNumber(vendorOrderSummary.products)}</p>
                </div>

                <div className="rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">Suggested Units</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {formatNumber(vendorOrderSummary.suggestedUnits)}
                  </p>
                </div>

                <div className="rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">Draft Units</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{formatNumber(vendorOrderSummary.orderedUnits)}</p>
                </div>

                <div className="rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">Estimated Total</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {formatCurrency(vendorOrderSummary.estimatedTotal)}
                  </p>
                </div>
              </div>
            )}

            {!uploadBlocked && (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
                Draft saving will be enabled after this preview is verified.
              </div>
            )}
          </Card>

          {uploadBlocked ? (
            <Card className="p-6">
              <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="mt-3 font-semibold text-foreground">Select a specific store</h3>
                <p className="mt-1 text-sm text-muted-foreground">{SELECT_VENDOR_STORE_MESSAGE}</p>
              </div>
            </Card>
          ) : vendorOrderGroups.length === 0 ? (
            <Card className="p-6">
              <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                <PackageCheck className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="mt-3 font-semibold text-foreground">No low-stock products need ordering right now.</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Low-stock active products will appear here grouped by vendor when stock reaches reorder level.
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {vendorOrderGroups.map((group) => (
                <Card key={group.vendor} className="overflow-hidden">
                  <div className="border-b border-border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">{group.vendor}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatNumber(group.productCount)} product(s) · {formatNumber(group.totalSuggestedUnits)} suggested units ·{' '}
                          {formatCurrency(group.estimatedTotal)} estimated total
                        </p>
                      </div>

                      <Button disabled variant="outline" size="sm">
                        Create Draft Order coming next
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 p-4">
                    {group.products.map((suggestion) => {
                      const product = suggestion.product;
                      const identifier = product.upc || product.plu || product.productCode || product.sku || 'No identifier';

                      return (
                        <Card key={suggestion.productKey} className="p-4">
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0">
                              <h4 className="font-semibold text-foreground">{product.name}</h4>
                              <p className="mt-1 font-mono text-xs text-muted-foreground">{identifier}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {product.department || product.category || 'No department'} · Stock{' '}
                                {formatNumber(suggestion.stock)} / Reorder {formatNumber(suggestion.reorderLevel)}
                              </p>
                            </div>

                            <div className="grid gap-2 text-sm sm:grid-cols-3 xl:min-w-[420px]">
                              <div className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs text-muted-foreground">Units per case</p>
                                <p className="font-semibold text-foreground">{formatNumber(suggestion.unitsPerCase)}</p>
                              </div>

                              <div className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs text-muted-foreground">Suggested</p>
                                <p className="font-semibold text-foreground">
                                  {formatNumber(suggestion.suggestedCases)} cases +{' '}
                                  {formatNumber(suggestion.suggestedLooseUnits)} loose
                                </p>
                              </div>

                              <div className="rounded-lg bg-secondary/40 p-3">
                                <p className="text-xs text-muted-foreground">Estimated total</p>
                                <p className="font-semibold text-foreground">{formatCurrency(suggestion.estimatedTotal)}</p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                            <label className="space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">Ordered Cases</span>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={
                                  vendorOrderDrafts[suggestion.productKey]?.orderedCases ?? String(suggestion.orderedCases)
                                }
                                onChange={(event) =>
                                  updateVendorOrderDraft(suggestion.productKey, 'orderedCases', event.target.value)
                                }
                              />
                            </label>

                            <label className="space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">Loose Units</span>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={vendorOrderDrafts[suggestion.productKey]?.looseUnits ?? String(suggestion.looseUnits)}
                                onChange={(event) =>
                                  updateVendorOrderDraft(suggestion.productKey, 'looseUnits', event.target.value)
                                }
                              />
                            </label>

                            <label className="space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">Expected Unit Cost</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={
                                  vendorOrderDrafts[suggestion.productKey]?.expectedUnitCost ??
                                  String(suggestion.expectedUnitCost)
                                }
                                onChange={(event) =>
                                  updateVendorOrderDraft(suggestion.productKey, 'expectedUnitCost', event.target.value)
                                }
                              />
                            </label>

                            <div className="rounded-lg bg-secondary/40 p-3">
                              <p className="text-xs text-muted-foreground">Ordered Units</p>
                              <p className="mt-1 font-semibold text-foreground">
                                {formatNumber(suggestion.totalOrderedUnits)}
                              </p>
                            </div>

                            <div className="rounded-lg bg-secondary/40 p-3">
                              <p className="text-xs text-muted-foreground">Expected Case Cost</p>
                              <p className="mt-1 font-semibold text-foreground">
                                {formatCurrency(suggestion.expectedCaseCost)}
                              </p>
                            </div>

                            <div className="rounded-lg bg-secondary/40 p-3">
                              <p className="text-xs text-muted-foreground">Estimated Total</p>
                              <p className="mt-1 font-semibold text-foreground">
                                {formatCurrency(suggestion.estimatedTotal)}
                              </p>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'upload' && (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{selectedStoreName}</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Upload Invoice</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a delivery CSV, text-based PDF, or invoice image. This page extracts preview lines only and does
                  not save receiving.
                </p>

                <div className="mt-5 grid gap-3">
                  <label
                    className={cn(
                      'flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center transition hover:bg-secondary/50',
                      uploadBlocked && 'cursor-not-allowed opacity-60 hover:bg-secondary/30'
                    )}
                  >
                    <Upload className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium text-foreground">Choose CSV, PDF, or image invoice</span>
                    <input
                      type="file"
                      accept=".csv,text/csv,application/pdf,image/*"
                      className="hidden"
                      onChange={(event) => handleInvoiceFile(event.target.files?.[0] || null)}
                      disabled={uploadBlocked}
                    />
                  </label>

                  <label
                    className={cn(
                      'flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-border p-4 text-center transition hover:bg-secondary/40',
                      uploadBlocked && 'cursor-not-allowed opacity-60 hover:bg-background'
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
                      disabled={uploadBlocked}
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-lg bg-secondary/40 p-3 text-sm">
                  <span className="font-medium text-foreground">Selected file: </span>
                  <span className="text-muted-foreground">{invoiceFileName || 'No file selected.'}</span>
                </div>

                <Button
                  className="mt-4 w-full"
                  onClick={() => void extractSelectedInvoice()}
                  disabled={!invoiceFile || extractingInvoice || uploadBlocked}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {extractingInvoice ? 'Extracting...' : 'Upload & Extract'}
                </Button>
              </div>

              <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Invoice Total</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{formatCurrency(invoiceTotal)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{receivingLines.length} extracted lines</p>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Matched</p>
                    <p className="text-xl font-bold text-foreground">{lineCounts.matched}</p>
                  </div>

                  <div className="rounded-lg bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">New</p>
                    <p className="text-xl font-bold text-foreground">{lineCounts.new}</p>
                  </div>

                  <div className="rounded-lg bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">Review</p>
                    <p className="text-xl font-bold text-foreground">{lineCounts.review}</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {message && (
            <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{message}</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Review Extracted Items</h2>
                <p className="text-sm text-muted-foreground">
                  Edit this preview before using the current Products receiving workflow to save inventory updates.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={addManualReceivingLine} disabled={uploadBlocked}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Row
                </Button>

                <Button disabled>
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Save Receiving coming later
                </Button>
              </div>
            </div>

            {receivingLines.length === 0 ? (
              <div className="p-6">
                <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center">
                  <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
                  <h3 className="mt-3 font-semibold text-foreground">No invoice lines extracted yet.</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose an invoice file and run extraction, or add a manual preview row.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 p-4">
                {receivingLines.map((line, index) => (
                  <Card key={line.id} className="p-4">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Item {index + 1}</p>
                        <p className="text-xs text-muted-foreground">Preview row only. No stock changes are saved here.</p>
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

                        {findMatchedProductForLine(line) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const product = findMatchedProductForLine(line);
                              if (product) openProductDefaults(product);
                            }}
                            disabled={uploadBlocked}
                          >
                            Edit Product Defaults
                          </Button>
                        )}

                        <Button variant="outline" size="sm" onClick={() => removeReceivingLine(line.id)} disabled={uploadBlocked}>
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
                          onChange={(event) => updateReceivingLine(line.id, { name: event.target.value })}
                          placeholder="Product name"
                          disabled={uploadBlocked}
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">UPC / Item Code</span>
                        <Input
                          value={line.upc}
                          onChange={(event) => updateReceivingLine(line.id, { upc: event.target.value })}
                          placeholder="UPC or item code"
                          className="font-mono"
                          disabled={uploadBlocked}
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Department</span>
                        <select
                          value={line.department}
                          onChange={(event) => updateReceivingLine(line.id, { department: event.target.value })}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={uploadBlocked}
                        >
                          {departmentOptions.map((department) => (
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
                          onChange={(event) => updateReceivingLine(line.id, { vendor: event.target.value })}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={uploadBlocked}
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
                        <span className="text-xs font-medium text-muted-foreground">Received Cases</span>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={line.receivedCases}
                          onChange={(event) => updateReceivingLine(line.id, { receivedCases: safeNumber(event.target.value) })}
                          disabled={uploadBlocked}
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Loose Units</span>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={line.looseUnits}
                          onChange={(event) => updateReceivingLine(line.id, { looseUnits: safeNumber(event.target.value) })}
                          disabled={uploadBlocked}
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Units Per Case</span>
                        <Input
                          type="number"
                          min="1"
                          value={line.unitsPerCase}
                          readOnly
                          disabled={uploadBlocked}
                        />
                        <span className="text-xs text-muted-foreground">
                          Units Per Case comes from the product master. Edit the product once and future invoices will use the updated case pack.
                        </span>
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Case Cost</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.caseCost}
                          onChange={(event) => updateReceivingLine(line.id, { caseCost: safeNumber(event.target.value) })}
                          disabled={uploadBlocked}
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Unit Cost</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(event) => updateReceivingLine(line.id, { unitCost: safeNumber(event.target.value) })}
                          disabled={uploadBlocked}
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Total Units</span>
                        <Input
                          type="number"
                          min="0"
                          value={line.totalUnits}
                          readOnly
                          disabled={uploadBlocked}
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Total Cost</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.totalCost}
                          readOnly
                          className="font-semibold"
                          disabled={uploadBlocked}
                        />
                      </label>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">Current receiving save tools</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Save Receiving will be enabled after invoice migration is complete. Current save tools are still
                    available in Products.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline">
                <Link href="/app/products?tab=receiving">Open current Receiving tools</Link>
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editingProductDefaults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-start justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Edit Product Defaults</h2>
                <p className="text-xs text-muted-foreground">
                  Update the product master record. Invoice receiving remains preview-only.
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeProductDefaults} disabled={savingProductDefaults}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ProductForm
              mode="edit"
              form={productDefaultsForm}
              setForm={setProductDefaultsForm}
              onSubmit={() => void saveProductDefaults()}
              onCancel={closeProductDefaults}
              saving={savingProductDefaults}
              error={productDefaultsError}
              departmentOptions={departmentOptions}
              vendorOptions={vendorOptions}
              taxCategoryOptions={[]}
              ageRestrictionOptions={[]}
              upcDuplicate={null}
              pluDuplicate={null}
              productCodeDuplicate={null}
              onUpcChange={() => undefined}
              onNameChange={() => setProductDefaultsError(null)}
              onUpcBlur={() => undefined}
              onPluBlur={() => undefined}
              onProductCodeBlur={() => undefined}
              submitLabel={savingProductDefaults ? 'Saving...' : 'Save Product Defaults'}
              writeBlocked={uploadBlocked}
            />
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
