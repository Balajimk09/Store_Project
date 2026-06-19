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
import { Receipt, BookOpen } from 'lucide-react';

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

export default function UploadPage() {
  const store = useStoreData();

  // Transactions section state
  const txInputRef = useRef<HTMLInputElement>(null);
  const [tx, setTx] = useState<SectionState<ParseResult>>(initialState());

  // Products section state
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

  const resetTx = () => {
    store.resetToDemo();
    setTx(initialState());
  };

  const resetProducts = () => {
    store.resetProductsToDemo();
    setP(initialState());
  };

  // Transaction preview rows
  const txPreviewRows =
    tx.result?.rows.filter((r) => r.valid && r.transaction).slice(0, 20).map((r) => ({
      id: r.transaction!.id,
      cells: [
        { label: 'ID', value: r.transaction!.id },
        { label: 'Time', value: formatDateTime(r.transaction!.timestamp) },
        { label: 'Item', value: r.transaction!.item },
        { label: 'Category', value: r.transaction!.category },
        { label: 'Cashier', value: r.transaction!.cashierName },
        { label: 'Payment', value: r.transaction!.paymentType },
        { label: 'Type', value: r.transaction!.type },
        { label: 'Amount', value: formatCurrency(r.transaction!.amount) },
      ],
    })) || [];

  // Product preview rows
  const pPreviewRows =
    p.result?.rows.filter((r) => r.valid && r.product).slice(0, 20).map((r) => ({
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
      <PageHeader title="Upload POS Data" description="Import transactions and pricebook CSVs to replace demo data" />

      <div className="space-y-10">
        {/* Transactions */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Transactions CSV</h2>
          </div>
          <UploadSection
            title="transactions.csv"
            description="Drag and drop your POS transaction export. Parsed entirely in your browser — nothing is uploaded to a server."
            icon={Receipt}
            accept=".csv,text/csv"
            isDemo={store.isDemo}
            meta={store.meta}
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
            previewColumns={['Transaction ID', 'Time', 'Item', 'Category', 'Cashier', 'Payment', 'Type', 'Amount']}
            onImport={importTx}
            onReset={resetTx}
            imported={tx.imported}
            importedCount={tx.importedCount}
            importLabel="Import Data"
            successRedirect="/dashboard"
            redirectLabel="Go to Dashboard"
            formatHelper={{
              columns: REQUIRED_COLUMNS,
              sampleFn: downloadSampleCsv,
              sampleLabel: 'Download sample CSV',
              rules: [
                { label: 'Numbers', value: 'quantity, unit_price, discount_amount, total_amount parsed as numbers' },
                { label: 'Dates', value: 'transaction_time must be a valid ISO date' },
                { label: 'transaction_type', value: 'SALE, REFUND, VOID, or NO_SALE' },
                { label: 'payment_type', value: 'CASH, CARD, CREDIT, DEBIT, EBT, MOBILE, NONE, or OTHER' },
                { label: 'Missing optional', value: 'falls back to Unknown or 0' },
              ],
            }}
          />
        </div>

        {/* Pricebook */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Pricebook CSV</h2>
          </div>
          <UploadSection
            title="products.csv"
            description="Upload your product catalog with costs and selling prices. Margins are calculated automatically."
            icon={BookOpen}
            accept=".csv,text/csv"
            isDemo={store.isDemoProducts}
            meta={store.productsMeta}
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
            onReset={resetProducts}
            imported={p.imported}
            importedCount={p.importedCount}
            importLabel="Import Pricebook"
            successRedirect="/pricebook"
            redirectLabel="View Pricebook"
            formatHelper={{
              columns: [...PRODUCT_REQUIRED_COLUMNS, ...PRODUCT_OPTIONAL_COLUMNS],
              sampleFn: downloadSampleProductsCsv,
              sampleLabel: 'Download sample pricebook CSV',
              rules: [
                { label: 'Required', value: 'upc, item_name, category, brand, cost_price, selling_price' },
                { label: 'Optional', value: 'stock (default 0), reorder_level (default 10), vendor' },
                { label: 'Numbers', value: 'cost_price, selling_price, stock, reorder_level parsed as numbers' },
                { label: 'Defaults', value: 'brand → Unknown, category → Uncategorized' },
                { label: 'Margin', value: '((selling - cost) / selling) × 100' },
              ],
            }}
          />
        </div>
      </div>
    </DashboardShell>
  );
}
