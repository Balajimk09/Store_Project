'use client';

import { useCallback, useRef, useState } from 'react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { useStoreData, saveUploadedTransactions, saveUploadedProducts } from '@/lib/store';
import { useAuth } from '@/lib/auth';
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
import { UploadHistory } from '@/components/upload/upload-history';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, Receipt, UploadCloud } from 'lucide-react';

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

const SELECT_STORE_UPLOAD_MESSAGE = 'Select a specific store to upload CSV data.';

export default function UploadPage() {
  const store = useStoreData();
  const { activeStore, activeStoreId, storeScope } = useAuth();
  const uploadDisabled = storeScope === 'all' || !activeStoreId;
  const selectedStoreName = uploadDisabled ? 'All Stores' : activeStore?.store_name ?? 'Selected store';

  const txInputRef = useRef<HTMLInputElement>(null);
  const [tx, setTx] = useState<SectionState<ParseResult>>(initialState());

  const pInputRef = useRef<HTMLInputElement>(null);
  const [p, setP] = useState<SectionState<ProductParseResult>>(initialState());

  const handleTxFile = useCallback((file: File) => {
    if (uploadDisabled) {
      setTx((s) => ({
        ...s,
        error: SELECT_STORE_UPLOAD_MESSAGE,
        imported: false,
        result: null,
        fileName: null,
      }));
      return;
    }

    setTx((s) => ({
      ...s,
      error: null,
      imported: false,
      result: null,
      fileName: file.name,
    }));

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setTx((s) => ({ ...s, error: 'Please upload a .csv file.' }));
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const text = String(event.target?.result || '');
      setTx((s) => ({ ...s, result: parseTransactionsCsv(text) }));
    };

    reader.onerror = () => {
      setTx((s) => ({ ...s, error: 'Could not read the file. Please try again.' }));
    };

    reader.readAsText(file);
  }, [uploadDisabled]);

  const handleProductFile = useCallback((file: File) => {
    if (uploadDisabled) {
      setP((s) => ({
        ...s,
        error: SELECT_STORE_UPLOAD_MESSAGE,
        imported: false,
        result: null,
        fileName: null,
      }));
      return;
    }

    setP((s) => ({
      ...s,
      error: null,
      imported: false,
      result: null,
      fileName: file.name,
    }));

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setP((s) => ({ ...s, error: 'Please upload a .csv file.' }));
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const text = String(event.target?.result || '');
      setP((s) => ({ ...s, result: parseProductsCsv(text) }));
    };

    reader.onerror = () => {
      setP((s) => ({ ...s, error: 'Could not read the file. Please try again.' }));
    };

    reader.readAsText(file);
  }, [uploadDisabled]);

  const importTx = async () => {
    if (uploadDisabled || !activeStoreId) {
      setTx((s) => ({ ...s, error: SELECT_STORE_UPLOAD_MESSAGE }));
      return;
    }

    if (!tx.result || tx.result.transactions.length === 0) return;

    setTx((s) => ({ ...s, error: null }));

    const result = await saveUploadedTransactions(
      tx.result.transactions,
      tx.fileName || 'transactions.csv',
      activeStoreId
    );

    if (result.error) {
      setTx((s) => ({ ...s, error: `Upload failed: ${result.error}` }));
      return;
    }

    setTx((s) => ({
      ...s,
      imported: true,
      importedCount: s.result?.transactions.length || 0,
    }));

    store.refresh();
    window.dispatchEvent(new Event('storepulse:data-updated'));
  };

  const importProducts = async () => {
    if (uploadDisabled || !activeStoreId) {
      setP((s) => ({ ...s, error: SELECT_STORE_UPLOAD_MESSAGE }));
      return;
    }

    if (!p.result || p.result.products.length === 0) return;

    setP((s) => ({ ...s, error: null }));

    const result = await saveUploadedProducts(
      p.result.products,
      p.fileName || 'pricebook.csv',
      activeStoreId
    );

    if (result.error) {
      setP((s) => ({ ...s, error: `Upload failed: ${result.error}` }));
      return;
    }

    setP((s) => ({
      ...s,
      imported: true,
      importedCount: s.result?.products.length || 0,
    }));

    store.refresh();
    window.dispatchEvent(new Event('storepulse:data-updated'));
  };

  const txPreviewRows =
    tx.result?.rows
      .filter((row) => row.valid && row.transaction)
      .slice(0, 10)
      .map((row) => ({
        id: row.transaction!.id,
        cells: [
          { label: 'ID', value: row.transaction!.id },
          { label: 'Time', value: formatDateTime(row.transaction!.timestamp) },
          { label: 'Item', value: row.transaction!.item },
          { label: 'Qty', value: row.raw.quantity || '1' },
          { label: 'Total', value: formatCurrency(row.transaction!.amount) },
        ],
      })) || [];

  const pPreviewRows =
    p.result?.rows
      .filter((row) => row.valid && row.product)
      .slice(0, 10)
      .map((row) => ({
        id: row.product!.upc,
        cells: [
          { label: 'UPC', value: row.product!.upc },
          { label: 'Item', value: row.product!.name },
          { label: 'Department', value: row.product!.department || row.product!.category },
          { label: 'Sell', value: formatCurrency(row.product!.sellPrice) },
          { label: 'Stock', value: String(row.product!.stock) },
        ],
      })) || [];

  const txParseOk = tx.result ? tx.result.ok && tx.result.transactions.length > 0 : null;
  const pParseOk = p.result ? p.result.ok && p.result.products.length > 0 : null;

  return (
    <DashboardShell>
      <PageHeader
        title="Upload POS Data"
        description="Upload transaction or pricebook CSV files."
      />

      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-background p-4 text-sm">
          <p className="font-medium text-foreground">Selected store: {selectedStoreName}</p>
          {uploadDisabled ? (
            <p className="mt-1 text-amber-700">{SELECT_STORE_UPLOAD_MESSAGE}</p>
          ) : null}
        </div>

        <Tabs defaultValue="transactions" className="space-y-5">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-muted/60 p-1.5 sm:grid-cols-2">
            <TabsTrigger value="transactions" className="h-auto justify-start gap-3 px-4 py-3 text-left">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-background text-primary shadow-sm">
                <Receipt className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-semibold">Transactions</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Sales history
                </span>
              </span>
            </TabsTrigger>

            <TabsTrigger value="pricebook" className="h-auto justify-start gap-3 px-4 py-3 text-left">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-background text-primary shadow-sm">
                <BookOpen className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-semibold">Pricebook</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Product catalog
                </span>
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="mt-0">
            <UploadSection
              title="Upload Transactions"
              description="Upload a transaction CSV file and review the rows before importing."
              icon={UploadCloud}
              accept=".csv,text/csv"
              onDrop={handleTxFile}
              inputRef={txInputRef}
              dragging={tx.dragging}
              setDragging={(value) => setTx((s) => ({ ...s, dragging: value }))}
              fileName={tx.fileName}
              error={tx.error}
              parseOk={txParseOk}
              missingColumns={tx.result?.missingColumns || []}
              totalRows={tx.result?.totalRows || 0}
              validRows={tx.result?.validRows || 0}
              invalidRows={tx.result?.invalidRows || 0}
              previewRows={txPreviewRows}
              previewColumns={['Transaction ID', 'Time', 'Item', 'Qty', 'Total']}
              onImport={importTx}
              imported={tx.imported}
              importedCount={tx.importedCount}
              importLabel="Import Transactions"
              successRedirect="/app/dashboard"
              redirectLabel="Go to Dashboard"
              emptyStateTitle="No valid transactions found"
              emptyStateDescription="The file was read, but no valid transaction rows were found."
              formatHelper={{
                requiredColumns: REQUIRED_COLUMNS,
                sampleFn: downloadSampleCsv,
                sampleLabel: 'Download transaction sample',
                rules: [
                  { label: 'Tip', value: 'Use the sample file if you are unsure about the format.' },
                ],
              }}
            />
          </TabsContent>

          <TabsContent value="pricebook" className="mt-0">
            <UploadSection
              title="Upload Pricebook"
              description="Upload a product catalog CSV file and review the rows before importing."
              icon={UploadCloud}
              accept=".csv,text/csv"
              onDrop={handleProductFile}
              inputRef={pInputRef}
              dragging={p.dragging}
              setDragging={(value) => setP((s) => ({ ...s, dragging: value }))}
              fileName={p.fileName}
              error={p.error}
              parseOk={pParseOk}
              missingColumns={p.result?.missingColumns || []}
              totalRows={p.result?.totalRows || 0}
              validRows={p.result?.validRows || 0}
              invalidRows={p.result?.invalidRows || 0}
              previewRows={pPreviewRows}
              previewColumns={['UPC', 'Item', 'Department', 'Sell', 'Stock']}
              onImport={importProducts}
              imported={p.imported}
              importedCount={p.importedCount}
              importLabel="Import Pricebook"
              successRedirect="/pricebook"
              redirectLabel="View Pricebook"
              emptyStateTitle="No valid products found"
              emptyStateDescription="The file was read, but no valid product rows were found."
              formatHelper={{
                requiredColumns: PRODUCT_REQUIRED_COLUMNS,
                optionalColumns: PRODUCT_OPTIONAL_COLUMNS,
                sampleFn: downloadSampleProductsCsv,
                sampleLabel: 'Download pricebook sample',
                rules: [
                  { label: 'Tip', value: 'Products can also be added one by one from Pricebook.' },
                ],
              }}
            />
          </TabsContent>
        </Tabs>

        <UploadHistory />
      </div>
    </DashboardShell>
  );
}
