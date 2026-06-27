'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileArchive, FileText, Loader2, RefreshCcw, UploadCloud } from 'lucide-react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

type ImportSummary = {
  totalFiles: number;
  parsedFiles: number;
  skippedDuplicates: number;
  skippedFiles?: number;
  failedFiles: number;
  ignoredUnsupportedFiles?: number;
  rowsInsertedByReportType: Record<string, number>;
  skipped?: Array<{ fileName: string; message: string }>;
  errors: Array<{ fileName: string; message: string }>;
};

type RecentBatch = {
  id: string;
  file_name: string | null;
  total_rows: number | null;
  valid_rows: number | null;
  invalid_rows: number | null;
  created_at: string | null;
};

type RecentReportFile = {
  id: string;
  file_name: string | null;
  report_title: string | null;
  report_type: string | null;
  parsed_status: string | null;
  error_message: string | null;
  created_at: string | null;
};

type RecentResponse = {
  batches: RecentBatch[];
  files: RecentReportFile[];
};

type PosImportApiResponse = {
  ok?: boolean;
  success?: boolean;
  summary?: ImportSummary;
  error?: string;
  details?: string;
  step?: string;
};

const TEMPLATE_LINKS = [
  { href: '/templates/pos-import/plu-sales-sample.csv', label: 'Download PLU Sales CSV' },
  { href: '/templates/pos-import/department-sales-sample.csv', label: 'Download Department Sales CSV' },
  { href: '/templates/pos-import/category-sales-sample.csv', label: 'Download Category Sales CSV' },
  { href: '/templates/pos-import/tax-summary-sample.csv', label: 'Download Tax Summary CSV' },
  { href: '/templates/pos-import/deal-sales-sample.csv', label: 'Download Deal Sales CSV' },
  { href: '/templates/pos-import/payment-summary-sample.csv', label: 'Download Payment Summary CSV' },
  { href: '/templates/pos-import/fuel-dcr-summary-sample.csv', label: 'Download Fuel DCR CSV' },
  { href: '/templates/pos-import/cashier-summary-sample.csv', label: 'Download Cashier Summary CSV' },
];

const DISCOVERED_SETUP_ITEMS = [
  { title: 'Products', text: 'No discovered products yet. Import a PLU report to find new products.' },
  { title: 'Departments', text: 'No discovered departments yet. Import a Department report to find new departments.' },
  { title: 'Categories', text: 'No discovered categories yet. Import a Category report to find new categories.' },
  { title: 'Tax Categories', text: 'No discovered tax categories yet. Import a Tax report to find new tax categories.' },
  { title: 'Deals / Promotions', text: 'No discovered deals yet. Import a Deal report to find new promotions.' },
  { title: 'Payment Methods', text: 'No discovered payment methods yet. Import a Payment report to find new payment methods.' },
  { title: 'Age Restriction Suggestions', text: 'No age restriction suggestions yet. Import product sales to generate suggestions.' },
];

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as { error?: unknown; details?: unknown; step?: unknown; message?: unknown };
    const formatted = [
      record.error || record.message,
      record.details ? `Details: ${record.details}` : null,
      record.step ? `Step: ${record.step}` : null,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ');

    if (formatted) return formatted;
  }
  return String(error || 'Something went wrong.');
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString();
}

function fileIcon(fileName: string) {
  return fileName.toLowerCase().endsWith('.zip') ? FileArchive : FileText;
}

export default function PosImportPage() {
  const { user, loading, activeStore, activeStoreId, storeScope } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [recent, setRecent] = useState<RecentResponse>({ batches: [], files: [] });

  const blocked = storeScope === 'all' || !activeStoreId;
  const selectedStoreName = storeScope === 'all' ? 'All Stores' : activeStore?.store_name || 'Selected Store';

  const selectedFileNames = useMemo(() => files.map((file) => file.name).join(', '), [files]);

  const loadRecent = useCallback(async () => {
    if (!activeStoreId) {
      setRecent({ batches: [], files: [] });
      return;
    }

    setLoadingRecent(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos-import?storeId=${encodeURIComponent(activeStoreId)}`);
      const json = (await response.json().catch(() => ({}))) as Partial<RecentResponse> & { error?: string };
      if (!response.ok) throw new Error(json.error || 'Could not load recent POS imports.');
      setRecent({
        batches: Array.isArray(json.batches) ? json.batches : [],
        files: Array.isArray(json.files) ? json.files : [],
      });
    } catch (loadError) {
      console.error('[POS Import Recent Load Error]', loadError);
      setError(formatError(loadError));
    } finally {
      setLoadingRecent(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const handleFiles = (fileList: FileList | null) => {
    setError(null);
    setSummary(null);
    const selected = Array.from(fileList || []).filter((file) => /\.(html?|xml|csv|xlsx?|zip)$/i.test(file.name));
    setFiles(selected);
    if (fileList && selected.length !== fileList.length) {
      setError('Only .html, .htm, .xml, .csv, .xlsx, .xls, and .zip files are supported.');
    }
  };

  const importFiles = async () => {
    if (blocked || !activeStoreId) {
      setError('Select a specific store to import POS reports.');
      return;
    }
    if (files.length === 0) {
      setError('Select at least one POS report file.');
      return;
    }

    setImporting(true);
    setError(null);
    setSummary(null);

    try {
      const formData = new FormData();
      formData.append('storeId', activeStoreId);
      files.forEach((file) => formData.append('files', file));

      const response = await fetch('/api/pos-import', {
        method: 'POST',
        body: formData,
      });
      const json = (await response.json().catch(() => ({}))) as PosImportApiResponse;
      if (!response.ok || json.success === false || !json.summary) throw json;
      setSummary(json.summary);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      await loadRecent();
      window.dispatchEvent(new Event('storepulse:data-updated'));
    } catch (importError) {
      console.error('[POS Import Error]', importError);
      setError(formatError(importError));
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <DashboardShell>
        <div className="flex min-h-[320px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="POS Import Center"
        description="Upload POS report files, review parsed data, and prepare discovered setup items."
      >
        <Button variant="outline" onClick={() => void loadRecent()} disabled={loadingRecent || !activeStoreId}>
          {loadingRecent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </PageHeader>

      <div className="space-y-6">
        <Card className="p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Selected Store</p>
              <h2 className="text-xl font-semibold text-foreground">{selectedStoreName}</h2>
            </div>
            {blocked ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
                Select one store
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
                Ready
              </span>
            )}
          </div>
          {blocked ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Select a specific store to import POS reports.
            </div>
          ) : null}
        </Card>

        <Card className="p-6">
          <div className="grid gap-5 lg:grid-cols-[1fr_280px] lg:items-start">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Upload POS Reports</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Supported formats: HTML, XML, CSV, XLSX, XLS, ZIP.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Verifone HTML reports can be uploaded directly. Use templates only when preparing CSV/XLSX files manually.
              </p>
              <div className="mt-5 rounded-2xl border border-dashed border-border p-6">
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".html,.htm,.xml,.csv,.xlsx,.xls,.zip"
                  className="hidden"
                  onChange={(event) => handleFiles(event.target.files)}
                  disabled={blocked || importing || !user}
                />
                <button
                  type="button"
                  disabled={blocked || importing || !user}
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center rounded-xl bg-secondary/50 px-4 py-8 text-center transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UploadCloud className="h-10 w-10 text-primary" />
                  <span className="mt-3 text-sm font-semibold text-foreground">Choose POS report files</span>
                  <span className="mt-1 text-xs text-muted-foreground">Raw report content is stored once per report file for audit and reprocessing.</span>
                </button>
              </div>
              {files.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">Selected files</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {files.map((file) => {
                      const Icon = fileIcon(file.name);
                      return (
                        <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate">{file.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <Card className="bg-secondary/40 p-4">
              <h3 className="font-semibold text-foreground">Phase 1 supports</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>Verifone HTML reports and manual CSV/XLSX templates</li>
                <li>ZIP files containing supported POS report files</li>
                <li>Duplicate file detection by SHA-256 hash</li>
                <li>XML files accepted and stored, then skipped until a parser is configured</li>
              </ul>
              <Button className="mt-5 w-full" onClick={() => void importFiles()} disabled={blocked || importing || files.length === 0}>
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                Import Reports
              </Button>
            </Card>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Get Sample Import Templates</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use these templates only when preparing CSV/XLSX files manually. Verifone HTML reports can be uploaded directly without using a template.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {TEMPLATE_LINKS.map((template) => (
              <Button key={template.href} asChild variant="outline" className="justify-start">
                <a href={template.href} download>
                  <Download className="mr-2 h-4 w-4" />
                  {template.label}
                </a>
              </Button>
            ))}
          </div>
        </Card>

        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {summary ? (
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1 h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-lg font-semibold text-foreground">Import Summary</h2>
                <p className="mt-1 text-sm text-muted-foreground">Source files: {selectedFileNames || 'Imported selection'}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Metric label="Total files" value={summary.totalFiles} />
              <Metric label="Parsed" value={summary.parsedFiles} />
              <Metric label="Duplicates" value={summary.skippedDuplicates || 0} />
              <Metric label="Skipped" value={summary.skippedFiles || 0} />
              <Metric label="Failed" value={summary.failedFiles} />
              <Metric label="Ignored" value={summary.ignoredUnsupportedFiles || 0} />
            </div>
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-foreground">Rows inserted by report type</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(summary.rowsInsertedByReportType).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No parsed rows were inserted.</p>
                ) : Object.entries(summary.rowsInsertedByReportType).map(([type, count]) => (
                  <div key={type} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="font-medium">{type}</span>: {count}
                  </div>
                ))}
              </div>
            </div>
            {summary.skipped && summary.skipped.length > 0 ? (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">Accepted but skipped</h3>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {summary.skipped.map((item) => (
                    <li key={`${item.fileName}-${item.message}`}>{item.fileName}: {item.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.errors.length > 0 ? (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">File errors</h3>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {summary.errors.map((item) => (
                    <li key={`${item.fileName}-${item.message}`}>{item.fileName}: {item.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card className="p-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Discovered Setup Items</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              After imports, StorePulse will identify new products, departments, categories, tax categories, deals, payment methods, and age restriction suggestions that can be approved into the main app.
            </p>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {DISCOVERED_SETUP_ITEMS.map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-secondary/30 p-4">
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Recent POS Imports</h2>
              <p className="text-sm text-muted-foreground">Recent upload batches and report files for this store.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="font-semibold text-foreground">Upload Batches</h3>
            <div className="mt-4 space-y-3">
              {recent.batches.length === 0 ? <p className="text-sm text-muted-foreground">No POS import batches yet.</p> : recent.batches.map((batch) => (
                <div key={batch.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium text-foreground">{batch.file_name || 'POS reports'}</p>
                  <p className="text-muted-foreground">{formatDate(batch.created_at)}</p>
                  <p className="text-muted-foreground">Files: {batch.total_rows || 0} | Parsed: {batch.valid_rows || 0} | Skipped/failed: {batch.invalid_rows || 0}</p>
                </div>
              ))}
            </div>
            </div>

            <div>
            <h3 className="font-semibold text-foreground">Report Files</h3>
            <div className="mt-4 space-y-3">
              {recent.files.length === 0 ? <p className="text-sm text-muted-foreground">No POS report files yet.</p> : recent.files.map((file) => (
                <div key={file.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{file.file_name || file.report_title || 'Report file'}</p>
                      <p className="text-muted-foreground">{file.report_type || 'unknown'} | {formatDate(file.created_at)}</p>
                      {file.error_message ? <p className="mt-1 text-xs text-destructive">{file.error_message}</p> : null}
                    </div>
                    <span className="rounded-full bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground">{file.parsed_status || 'unknown'}</span>
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>
        </Card>
      </div>
    </DashboardShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
