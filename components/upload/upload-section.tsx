'use client';

import Link from 'next/link';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type PreviewCell = {
  label: string;
  value: string;
};

type PreviewRow = {
  id: string;
  cells: PreviewCell[];
};

type FormatRule = {
  label: string;
  value: string;
};

interface FormatHelper {
  requiredColumns: readonly string[];
  optionalColumns?: readonly string[];
  sampleFn: () => void;
  sampleLabel: string;
  rules?: FormatRule[];
}

interface UploadSectionProps {
  title: string;
  description: string;
  icon: React.ElementType;
  accept: string;
  onDrop: (file: File) => void;
  inputRef: RefObject<HTMLInputElement>;
  dragging: boolean;
  setDragging: (value: boolean) => void;
  fileName: string | null;
  error: string | null;
  parseOk: boolean | null;
  missingColumns: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  previewRows: PreviewRow[];
  previewColumns: string[];
  onImport: () => void;
  imported: boolean;
  importedCount: number;
  importLabel: string;
  successRedirect: string;
  redirectLabel: string;
  emptyStateTitle: string;
  emptyStateDescription: string;
  formatHelper: FormatHelper;
}

export function UploadSection({
  title,
  description,
  icon: Icon,
  accept,
  onDrop,
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
  imported,
  importedCount,
  importLabel,
  successRedirect,
  redirectLabel,
  emptyStateTitle,
  emptyStateDescription,
  formatHelper,
}: UploadSectionProps) {
  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      onDrop(file);
    }

    event.target.value = '';
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (file) {
      onDrop(file);
    }
  };

  const hasPreview = previewRows.length > 0;
  const hasParsedFile = parseOk !== null;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>

              <div>
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={formatHelper.sampleFn}>
              Download Sample
            </Button>
          </div>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_320px]">
          <div>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors',
                dragging
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-secondary/20 hover:border-primary/60 hover:bg-primary/5'
              )}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={handleFileSelect}
              />

              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-background text-primary shadow-sm">
                <UploadCloud className="h-6 w-6" />
              </div>

              <h3 className="mt-4 text-base font-semibold text-foreground">
                Drop your CSV file here
              </h3>

              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Or click to select a file. You can preview the data before importing.
              </p>

              <Button type="button" variant="outline" size="sm" className="mt-4">
                Select CSV File
              </Button>

              {fileName && (
                <p className="mt-4 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  Selected: {fileName}
                </p>
              )}
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {missingColumns.length > 0 && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Missing columns: {missingColumns.join(', ')}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Import Summary
              </p>

              {!hasParsedFile ? (
                <div className="mt-4 text-sm text-muted-foreground">
                  Select a CSV file to see the import summary.
                </div>
              ) : (
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total rows</span>
                    <span className="font-semibold text-foreground">{totalRows.toLocaleString()}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Ready to import</span>
                    <span className="font-semibold text-success">{validRows.toLocaleString()}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Skipped rows</span>
                    <span className="font-semibold text-destructive">{invalidRows.toLocaleString()}</span>
                  </div>

                  {parseOk ? (
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success">
                      <CheckCircle2 className="h-4 w-4" />
                      File looks good
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      File needs review
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Button
              className="w-full"
              disabled={!parseOk || validRows === 0 || imported}
              onClick={onImport}
            >
              {imported ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Imported {importedCount.toLocaleString()} rows
                </>
              ) : (
                importLabel
              )}
            </Button>

            {imported && (
              <Button asChild variant="outline" className="w-full">
                <Link href={successRedirect}>{redirectLabel}</Link>
              </Button>
            )}
          </div>
        </div>
      </Card>

      {hasPreview ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <h3 className="font-semibold text-foreground">Preview</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Showing the first {previewRows.length} clean rows before import.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {previewColumns.map((column) => (
                    <th key={column} className="px-4 py-3 font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {previewRows.map((row) => (
                  <tr key={row.id} className="hover:bg-secondary/30">
                    {row.cells.map((cell) => (
                      <td key={`${row.id}-${cell.label}`} className="px-4 py-3 text-foreground">
                        {cell.value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : hasParsedFile ? (
        <Card className="border-dashed p-8 text-center">
          <FileSpreadsheet className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 font-semibold text-foreground">{emptyStateTitle}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{emptyStateDescription}</p>
        </Card>
      ) : null}

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold text-foreground">
          CSV format help
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-border p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Required columns</h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {formatHelper.requiredColumns.map((column) => (
                  <span
                    key={column}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {column}
                  </span>
                ))}
              </div>
            </div>

            {formatHelper.optionalColumns && formatHelper.optionalColumns.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground">Optional columns</h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {formatHelper.optionalColumns.map((column) => (
                    <span
                      key={column}
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {column}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {formatHelper.rules && formatHelper.rules.length > 0 && (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {formatHelper.rules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {rule.label}
                  </p>
                  <p className="mt-1 text-sm text-foreground">{rule.value}</p>
                </div>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" className="mt-5" onClick={formatHelper.sampleFn}>
            {formatHelper.sampleLabel}
          </Button>
        </div>
      </details>
    </div>
  );
}