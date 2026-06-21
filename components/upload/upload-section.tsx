'use client';

import { useCallback, type DragEvent, type ElementType, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  description: string;
  icon: ElementType;
  accept: string;
  onDrop: (file: File) => void;
  inputRef: RefObject<HTMLInputElement>;
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
  imported: boolean;
  importedCount: number;
  formatHelper: {
    requiredColumns: readonly string[];
    optionalColumns?: readonly string[];
    rules: { label: string; value: string }[];
    sampleFn: () => void;
    sampleLabel: string;
  };
  importLabel: string;
  successRedirect: string;
  redirectLabel: string;
  emptyStateTitle: string;
  emptyStateDescription: string;
}

export function UploadSection({
  title,
  description,
  icon: Icon,
  accept,
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
  imported,
  importedCount,
  formatHelper,
  importLabel,
  successRedirect,
  redirectLabel,
  emptyStateTitle,
  emptyStateDescription,
}: Props) {
  const router = useRouter();

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);

      const file = e.dataTransfer.files?.[0];

      if (file) {
        onFile(file);
      }
    },
    [onFile, setDragging]
  );

  const hasReviewedFile = parseOk !== null;
  const showEmptyState = parseOk === false && missingColumns.length === 0 && totalRows > 0;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-muted/30 p-5 lg:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>

                {parseOk === true && (
                  <Badge variant="secondary">
                    {validRows.toLocaleString()} valid rows
                  </Badge>
                )}

                {parseOk === false && (
                  <Badge variant="destructive">
                    Needs fixes
                  </Badge>
                )}
              </div>

              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            </div>
          </div>

          <Button variant="outline" onClick={formatHelper.sampleFn}>
            <Download className="mr-2 h-4 w-4" />
            {formatHelper.sampleLabel}
          </Button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5 p-5 lg:p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['1', 'Download sample'],
              ['2', 'Upload CSV'],
              ['3', 'Review and import'],
            ].map(([step, label]) => (
              <div
                key={step}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {step}
                </span>
                <span className="text-sm font-medium text-foreground">{label}</span>
              </div>
            ))}
          </div>

          <div
            className={cn(
              'relative flex min-h-[230px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors',
              dragging
                ? 'border-primary bg-primary/5'
                : 'border-border bg-background hover:bg-muted/30'
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];

                if (file) {
                  onFile(file);
                }
              }}
            />

            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {fileName ? (
                <FileSpreadsheet className="h-8 w-8" />
              ) : (
                <UploadCloud className="h-8 w-8" />
              )}
            </div>

            <h3 className="mt-4 text-base font-semibold text-foreground">
              {fileName ? fileName : `Drop your ${title.toLowerCase()} CSV here`}
            </h3>

            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Select the correct CSV type for this section. The file is parsed in your browser
              first, then only valid rows are saved when you click import.
            </p>

            <Button
              variant="outline"
              className="mt-5"
              onClick={() => inputRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              Select CSV file
            </Button>
          </div>

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
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />

                <div className="text-sm">
                  <p className="font-semibold text-destructive">
                    This looks like the wrong CSV format
                  </p>

                  <p className="mt-1 text-muted-foreground">
                    Missing required columns:{' '}
                    <span className="font-mono text-foreground">
                      {missingColumns.join(', ')}
                    </span>
                  </p>

                  <p className="mt-2 text-muted-foreground">
                    Download the sample file for this section, compare the header row, then
                    upload again.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {showEmptyState && (
            <Card className="border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />

                <div className="text-sm">
                  <p className="font-semibold text-foreground">{emptyStateTitle}</p>
                  <p className="mt-1 text-muted-foreground">{emptyStateDescription}</p>
                </div>
              </div>
            </Card>
          )}

          {hasReviewedFile && (
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">
                  {totalRows.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Rows parsed</p>
              </Card>

              <Card className="p-4 text-center">
                <p className="text-2xl font-bold text-success">
                  {validRows.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Valid rows</p>
              </Card>

              <Card className="p-4 text-center">
                <p
                  className={cn(
                    'text-2xl font-bold',
                    invalidRows > 0 ? 'text-amber-600' : 'text-foreground'
                  )}
                >
                  {invalidRows.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Invalid rows</p>
              </Card>
            </div>
          )}

          {previewRows.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Preview first {previewRows.length} valid rows
                  </h3>
                </div>

                <Badge variant="outline">Review before import</Badge>
              </div>

              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      {previewColumns.map((header) => (
                        <th
                          key={header}
                          className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr
                        key={`${row.id}-${rowIndex}`}
                        className="border-b border-border/60 hover:bg-secondary/30"
                      >
                        {row.cells.map((cell, cellIndex) => (
                          <td
                            key={`${cell.label}-${cellIndex}`}
                            className={cn(
                              'px-4 py-2.5',
                              cellIndex === 0
                                ? 'font-mono text-xs text-muted-foreground'
                                : cellIndex === row.cells.length - 1
                                  ? 'font-semibold tabular-nums text-foreground'
                                  : 'text-muted-foreground'
                            )}
                          >
                            {cell.value}
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
            <Card className="border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Ready to save to cloud
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {validRows.toLocaleString()} clean rows will be saved for this store.
                    Invalid rows are ignored.
                  </p>
                </div>

                <Button onClick={onImport} disabled={imported}>
                  {imported ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Imported
                    </>
                  ) : (
                    <>
                      <FileUp className="mr-2 h-4 w-4" />
                      {importLabel}
                    </>
                  )}
                </Button>
              </div>
            </Card>
          )}

          {imported && (
            <Card className="border-success/30 bg-success/5 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />

                <div className="text-sm">
                  <p className="font-semibold text-foreground">Import successful</p>

                  <p className="mt-1 text-muted-foreground">
                    {importedCount.toLocaleString()} records were saved and are now live
                    across your store.
                  </p>

                  <div className="mt-3">
                    <Button size="sm" onClick={() => router.push(successRedirect)}>
                      {redirectLabel}
                      <ArrowRight className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>

        <aside className="border-t border-border bg-muted/20 p-5 lg:border-l lg:border-t-0 lg:p-6">
          <div className="sticky top-6 space-y-5">
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-foreground">
                Required CSV columns
              </h3>

              <p className="mt-1 text-xs text-muted-foreground">
                The header row is case-insensitive.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {formatHelper.requiredColumns.map((column) => (
                  <span
                    key={column}
                    className="rounded-md bg-secondary px-2.5 py-1.5 font-mono text-xs text-foreground"
                  >
                    {column}
                  </span>
                ))}
              </div>
            </Card>

            {formatHelper.optionalColumns && formatHelper.optionalColumns.length > 0 && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-foreground">
                  Optional columns
                </h3>

                <div className="mt-3 flex flex-wrap gap-2">
                  {formatHelper.optionalColumns.map((column) => (
                    <span
                      key={column}
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-muted-foreground"
                    >
                      {column}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            <Card className="p-5">
              <h3 className="text-sm font-semibold text-foreground">
                Validation rules
              </h3>

              <ul className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
                {formatHelper.rules.map((rule) => (
                  <li key={rule.label}>
                    <span className="font-medium text-foreground">{rule.label}:</span>{' '}
                    {rule.value}
                  </li>
                ))}
              </ul>

              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full"
                onClick={formatHelper.sampleFn}
              >
                <Download className="mr-2 h-4 w-4" />
                {formatHelper.sampleLabel}
              </Button>
            </Card>
          </div>
        </aside>
      </div>
    </Card>
  );
}