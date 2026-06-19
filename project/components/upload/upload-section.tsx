'use client';

import { useCallback, useRef, useState } from 'react';
import { useStoreData } from '@/lib/store';
import {
  parseTransactionsCsv,
  downloadSampleCsv,
  REQUIRED_COLUMNS,
  type ParseResult,
} from '@/lib/csv';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  RefreshCw,
  ArrowRight,
  FileUp,
  Database,
  Receipt,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  description: string;
  icon: React.ElementType;
  accept: string;
  isDemo: boolean;
  meta: { fileName: string; importedAt: string; rowCount: number };
  onDrop: (file: File) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  fileName: string | null;
  error: string | null;
  parseOk: boolean | null;
  missingColumns: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  previewRows: { id: string; cells: { label: string; value: string }[] }[];
  previewColumns: string[];
  onImport: () => void;
  onReset: () => void;
  imported: boolean;
  importedCount: number;
  formatHelper: { columns: readonly string[]; rules: { label: string; value: string }[]; sampleFn: () => void; sampleLabel: string };
  importLabel: string;
  successRedirect: string;
  redirectLabel: string;
}

export function UploadSection({
  title,
  description,
  icon: Icon,
  accept,
  isDemo,
  meta,
  onDrop: onFile,
  inputRef,
  dragging,
  setDragging,
  fileName,
  error,
  parseOk,
  missingColumns,
  totalRows,
  validRows,
  invalidRows,
  previewRows,
  previewColumns,
  onImport,
  onReset,
  imported,
  importedCount,
  formatHelper,
  importLabel,
  successRedirect,
  redirectLabel,
}: Props) {
  const router = useRouter();
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile, setDragging]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        {/* Current source banner */}
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg',
                  isDemo ? 'bg-secondary text-muted-foreground' : 'bg-success/10 text-success'
                )}
              >
                {isDemo ? <Database className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {isDemo ? 'Using built-in demo data' : 'Using uploaded data'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {meta.rowCount.toLocaleString()} records {isDemo ? 'from realistic demo patterns.' : `from ${meta.fileName}${meta.importedAt ? ` · ${formatDateTime(meta.importedAt)}` : ''}`}
                </p>
              </div>
            </div>
            {!isDemo && (
              <Button variant="outline" size="sm" onClick={onReset}>
                <RefreshCw className="mr-2 h-4 w-4" /> Reset to Demo Data
              </Button>
            )}
          </div>
        </Card>

        <Card
          className={cn(
            'relative flex flex-col items-center justify-center border-2 border-dashed p-10 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border'
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">{fileName ? fileName : `Drop your ${title} here`}</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
          <Button variant="outline" className="mt-5" onClick={() => inputRef.current?.click()}>
            <FileUp className="mr-2 h-4 w-4" /> Select CSV file
          </Button>
        </Card>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" />
              <span className="font-medium">{error}</span>
            </div>
          </Card>
        )}

        {missingColumns.length > 0 && parseOk === false && (
          <Card className="border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Required columns are missing</p>
                <p className="mt-1 text-muted-foreground">
                  Your CSV is missing: <span className="font-mono text-foreground">{missingColumns.join(', ')}</span>
                </p>
                <p className="mt-2 text-muted-foreground">
                  Download the sample file below to see the correct format, add the missing columns, then re-upload.
                </p>
              </div>
            </div>
          </Card>
        )}

        {parseOk && (
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{totalRows}</p>
              <p className="text-xs text-muted-foreground">Rows parsed</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-success">{validRows}</p>
              <p className="text-xs text-muted-foreground">Valid rows</p>
            </Card>
            <Card className="p-4 text-center">
              <p className={cn('text-2xl font-bold', invalidRows > 0 ? 'text-chart-3' : 'text-foreground')}>{invalidRows}</p>
              <p className="text-xs text-muted-foreground">Invalid rows</p>
            </Card>
          </div>
        )}

        {previewRows.length > 0 && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Preview · first {previewRows.length} valid rows</h3>
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    {previewColumns.map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 hover:bg-secondary/30">
                      {r.cells.map((c, i) => (
                        <td key={i} className={cn('px-4 py-2.5', i === 0 ? 'font-mono text-xs text-muted-foreground' : i === r.cells.length - 1 ? 'font-semibold tabular-nums text-foreground' : 'text-muted-foreground')}>
                          {c.value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {parseOk && validRows > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Ready to import <strong className="text-foreground">{validRows.toLocaleString()}</strong> records. This will replace the currently active data.
            </p>
            <Button onClick={onImport} disabled={imported}>
              {imported ? (
                <><CheckCircle2 className="mr-2 h-4 w-4" /> Imported</>
              ) : (
                <><FileUp className="mr-2 h-4 w-4" /> {importLabel}</>
              )}
            </Button>
          </div>
        )}

        {imported && (
          <Card className="border-success/30 bg-success/5 p-4">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">Import successful</p>
                <p className="mt-1 text-muted-foreground">
                  {importedCount.toLocaleString()} records were saved and are now live across your store.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => router.push(successRedirect)}>
                    {redirectLabel} <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => router.push('/pricebook')}>View Pricebook</Button>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Format helper */}
      <div className="lg:col-span-1">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground">Expected CSV format</h3>
          <p className="mt-1 text-xs text-muted-foreground">Header row (case-insensitive):</p>
          <div className="mt-3 space-y-1.5">
            {formatHelper.columns.map((c) => (
              <div key={c} className="flex items-center gap-2 rounded-md bg-secondary/50 px-2.5 py-1.5">
                <span className="font-mono text-xs text-foreground">{c}</span>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="mt-4 w-full" onClick={formatHelper.sampleFn}>
            <Download className="mr-2 h-4 w-4" /> {formatHelper.sampleLabel}
          </Button>
        </Card>
        <Card className="mt-4 p-5">
          <h3 className="text-sm font-semibold text-foreground">Field rules</h3>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            {formatHelper.rules.map((r) => (
              <li key={r.label}>
                <span className="font-medium text-foreground">{r.label}:</span> {r.value}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
