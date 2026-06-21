'use client';

import { useCallback, useRef, useState } from 'react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { useStoreData, saveUploadedTransactions, saveUploadedProducts } from '@/lib/store';
import {
  parseTransactionsCsv,
  downloadSampleCsv,
  REQUIRED_COLUMNS,
  type ParseResult,
  parseProductsCsv,
  downloadSampleProductsCsv,
  PRODUCT_REQUIRED_COLUMNS,
  PRODUCT_OPTIONAL_COLUMNS,
  type ProductParseResult,
} from '@/lib/csv';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { UploadSection } from '@/components/upload/upload-section';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, FileSpreadsheet, Receipt, ShieldCheck } from 'lucide-react';

interface SectionState<R> {
  fileName: string | null;
  dragging: boolean;
  error: string | null;
  result: R | null;
  imported: boolean;
  importedCount: number;
}

const initialState = <R,>(): SectionState<R> => ({
  fileName: null,
  dragging: false,
  error: null,
  result: null,
  imported: false,
  importedCount: 0,
});

function safeCurrency(value: string | undefined, fallback = '$0.00') {
  if (!value) return fallback;
  const parsed = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? formatCurrency(parsed) : fallback;
}

export default function UploadPage() {
  const store = useStoreData();

  const txInputRef = useRef<HTMLInputElement>(null);
  const [tx, setTx] = useState<SectionState<ParseResult>>(initialState());

  const pInputRef = useRef<HTMLInputElement>(null);
  const [p, setP] = useState<SectionState<ProductParseResult>>(initialState());

  const handleTxFile = useCallback((file: File) => {
    setTx((s) => ({ ...s, error: null, imported: false, result: null, fileName: file.name }));
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setTx((s) => ({ ...s, error: 'Please upload a .csv file.' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      setTx((s) => ({ ...s, result: parseTransactionsCsv(text) }));
    };
    reader.onerror = () => setTx((s) => ({ ...s, error: 'Could not read the file. Please try again.' }));
    reader.readAsText(file);
  }, []);

  const handleProductFile = useCallback((file: File) => {
    setP((s) => ({ ...s, error: null, imported: false, result: null, fileName: file.name }));
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setP((s) => ({ ...s, error: 'Please upload a .csv file.' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      setP((s) => ({ ...s, result: parseProductsCsv(text) }));
    };
    reader.onerror = () => setP((s) => ({ ...s, error: 'Could not read the file. Please try again.' }));
    reader.readAsText(file);
  }, []);

  const importTx = async () => {
    if (!tx.result || tx.result.transactions.length === 0) return;
    setTx((s) => ({ ...s, error: null }));
    const result = await saveUploadedTransactions(tx.result.transactions, tx.fileName || 'transactions.csv');
    if (result.error) {
      setTx((s) => ({ ...s, error: `Cloud save failed: ${result.error}` }));
      return;
    }
    setTx((s) => ({ ...s, imported: true, importedCount: s.result!.transactions.length }));
    store.refresh();
  };

  const importProducts = async () => {
    if (!p.result || p.result.products.length === 0) return;
    setP((s) => ({ ...s, error: null }));
    const result = await saveUploadedProducts(p.result.products, p.fileName || 'pricebook.csv');
    if (result.error) {
      setP((s) => ({ ...s, error: `Cloud save failed: ${result.error}` }));
      return;
    }
    setP((s) => ({ ...s, imported: true, importedCount: s.result!.products.length }));
    store.refresh();
  };

  const txPreviewRows =
    tx.result?.rows
      .filter((r) => r.valid && r.transaction)
      .slice(0, 20)
      .map((r) => ({
        id: r.transaction!.id,
        cells: [
          { label: 'ID', value: r.transaction!.id },
          { label: 'Time', value: formatDateTime(r.transaction!.timestamp) },
          { label: 'UPC', value: r.raw.upc || 'Missing' },
          { label: 'Item', value: r.transaction!.item },
          { label: 'Qty', value: r.raw.quantity || '1' },
          { label: 'Unit', value: safeCurrency(r.raw.unit_price, '—') },
          { label: 'Discount', value: safeCurrency(r.raw.discount_amount) },
          { label: 'Total', value: formatCurrency(r.transaction!.amount) },
        ],
      })) || [];

  const pPreviewRows =
    p.result?.rows
      .filter((r) => r.valid && r.product)
      .slice(0, 20)
      .map((r) => ({
        id: r.product!.upc,
        cells: [
          { label: 'UPC', value: r.product!.upc },
          { label: 'Item', value: r.product!.name },
          { label: 'Category', value: r.product!.category },
          { label: 'Brand', value: r.product!.brand || 'Unknown' },
          { label: 'Cost', value: formatCurrency(r.product!.costPrice) },
          { label: 'Sell', value: formatCurrency(r.product!.sellPrice) },
          { label: 'Margin', value: `${r.margin ?? 0}%` },
          { label: 'Stock', value: String(r.product!.stock) },
        ],
      })) || [];

  const txParseOk = tx.result ? tx.result.ok && tx.result.transactions.length > 0 : null;
  const pParseOk = p.result ? p.result.ok && p.result.products.length > 0 : null;

  return (
    <DashboardShell>
      <PageHeader
        title="Upload POS Data"
        description="Import transaction and pricebook CSV files for your store. Review the file first, then save clean rows to Supabase."
      />

      <div className="space-y-6">
        <Card className="overflow-hidden border-primary/20 bg-primary/5">
          <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr] lg:p-6">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">Choose the correct CSV type before uploading</h2>
                  <Badge variant="secondary">Cloud upload</Badge>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Transactions power sales analytics, cashier audit, dashboard metrics, and reports. Pricebook files power product catalog,
                  margins, stock levels, and reorder insights. Keeping them separate prevents wrong-file imports.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-xl border border-border bg-background/80 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Receipt className="h-4 w-4 text-primary" /> Transaction CSV
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Sales rows, register IDs, cashiers, payment type, quantity, UPC, and totals.</p>
              </div>
              <div className="rounded-xl border border-border bg-background/80 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BookOpen className="h-4 w-4 text-primary" /> Pricebook CSV
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Product UPCs, item names, brands, cost, selling price, stock, and vendor details.</p>
              </div>
            </div>
          </div>
        </Card>

        <Tabs defaultValue="transactions" className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-muted/60 p-1.5 sm:grid-cols-2">
            <TabsTrigger value="transactions" className="h-auto justify-start gap-3 px-4 py-3 text-left">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-background text-primary shadow-sm">
                <Receipt className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-semibold">Transactions CSV</span>
                <span className="block text-xs font-normal text-muted-foreground">Sales, cashiers, dashboard, reports</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="pricebook" className="h-auto justify-start gap-3 px-4 py-3 text-left">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-background text-primary shadow-sm">
                <BookOpen className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-semibold">Pricebook CSV</span>
                <span className="block text-xs font-normal text-muted-foreground">Products, margins, stock, vendors</span>
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="mt-0">
            <UploadSection
              title="Transaction Sales Data"
              description="Upload only POS sales exports here. This file feeds the dashboard, live transactions, cashier audit, and reports."
              icon={Receipt}
              accept=".csv,text/csv"
              onDrop={handleTxFile}
              inputRef={txInputRef}
              dragging={tx.dragging}
              setDragging={(v) => setTx((s) => ({ ...s, dragging: v }))}
              fileName={tx.fileName}
              error={tx.error}
              parseOk={txParseOk}
              missingColumns={tx.result?.missingColumns || []}
              totalRows={tx.result?.totalRows || 0}
              validRows={tx.result?.validRows || 0}
              invalidRows={tx.result?.invalidRows || 0}
              previewRows={txPreviewRows}
              previewColumns={['Transaction ID', 'Time', 'UPC', 'Item', 'Qty', 'Unit Price', 'Discount', 'Total']}
              onImport={importTx}
              imported={tx.imported}
              importedCount={tx.importedCount}
              importLabel="Import Transactions"
              successRedirect="/dashboard"
              redirectLabel="Go to Dashboard"
              emptyStateTitle="No valid transactions found"
              emptyStateDescription="Make sure you uploaded a transaction CSV, not a pricebook CSV. The transaction file must include sales, register, cashier, payment, quantity, UPC, and amount columns."
              formatHelper={{
                requiredColumns: REQUIRED_COLUMNS,
                sampleFn: downloadSampleCsv,
                sampleLabel: 'Download transaction sample',
                rules: [
                  { label: 'Used for', value: 'Dashboard, Live Transactions, Cashier Audit, and Reports' },
                  { label: 'Numbers', value: 'quantity, unit_price, discount_amount, and total_amount must be numeric' },
                  { label: 'Dates', value: 'transaction_time should be a valid ISO date or timestamp' },
                  { label: 'transaction_type', value: 'SALE, REFUND, VOID, or NO_SALE' },
                  { label: 'payment_type', value: 'CASH, CARD, CREDIT, DEBIT, EBT, MOBILE, NONE, or OTHER' },
                ],
              }}
            />
          </TabsContent>

          <TabsContent value="pricebook" className="mt-0">
            <UploadSection
              title="Product Pricebook"
              description="Upload only product catalog or pricebook exports here. This file feeds item lookup, margins, inventory, and low-stock views."
              icon={BookOpen}
              accept=".csv,text/csv"
              onDrop={handleProductFile}
              inputRef={pInputRef}
              dragging={p.dragging}
              setDragging={(v) => setP((s) => ({ ...s, dragging: v }))}
              fileName={p.fileName}
              error={p.error}
              parseOk={pParseOk}
              missingColumns={p.result?.missingColumns || []}
              totalRows={p.result?.totalRows || 0}
              validRows={p.result?.validRows || 0}
              invalidRows={p.result?.invalidRows || 0}
              previewRows={pPreviewRows}
              previewColumns={['UPC', 'Item', 'Category', 'Brand', 'Cost', 'Sell', 'Margin', 'Stock']}
              onImport={importProducts}
              imported={p.imported}
              importedCount={p.importedCount}
              importLabel="Import Pricebook"
              successRedirect="/pricebook"
              redirectLabel="View Pricebook"
              emptyStateTitle="No valid products found"
              emptyStateDescription="Make sure you uploaded a pricebook CSV, not a transaction CSV. The pricebook file must include UPC, item, category, brand, cost, and selling price columns."
              formatHelper={{
                requiredColumns: PRODUCT_REQUIRED_COLUMNS,
                optionalColumns: PRODUCT_OPTIONAL_COLUMNS,
                sampleFn: downloadSampleProductsCsv,
                sampleLabel: 'Download pricebook sample',
                rules: [
                  { label: 'Used for', value: 'Pricebook, margins, stock, low inventory, and future barcode lookup' },
                  { label: 'Required', value: 'upc, item_name, category, brand, cost_price, and selling_price' },
                  { label: 'Optional', value: 'stock defaults to 0, reorder_level defaults to 10, vendor can be blank' },
                  { label: 'Numbers', value: 'cost_price, selling_price, stock, and reorder_level must be numeric' },
                  { label: 'Duplicate UPCs', value: 'Existing products with the same UPC are updated for this store' },
                ],
              }}
            />
          </TabsContent>
        </Tabs>

        <Card className="border-dashed p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Coming next: upload history</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  The database already tracks upload batches. A history table can show file name, upload type, valid rows, invalid rows, and upload time.
                </p>
              </div>
            </div>
            <Badge variant="outline">upload_batches</Badge>
          </div>
        </Card>
      </div>
    </DashboardShell>
  );
}
