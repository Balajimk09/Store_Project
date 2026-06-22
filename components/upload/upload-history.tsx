'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import { supabase, type UploadBatchRow } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';
import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  FileText,
  History,
  Loader2,
  Receipt,
  RefreshCw,
} from 'lucide-react';

function uploadTypeLabel(type: UploadBatchRow['upload_type']) {
  if (type === 'transactions') {
    return {
      label: 'Transactions',
      description: 'Sales file',
      icon: Receipt,
    };
  }

  return {
    label: 'Pricebook',
    description: 'Product file',
    icon: BookOpen,
  };
}

function statusLabel(batch: UploadBatchRow) {
  if (batch.invalid_rows > 0) {
    return {
      label: 'Needs Review',
      variant: 'destructive' as const,
    };
  }

  return {
    label: 'Imported',
    variant: 'secondary' as const,
  };
}

export function UploadHistory() {
  const { user, store, loading: authLoading } = useAuth();

  const [batches, setBatches] = useState<UploadBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (authLoading) return;

    if (!user || !store) {
      setBatches([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: historyError } = await supabase
      .from('upload_batches')
      .select('*')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
      .limit(25);

    if (historyError) {
      setError(historyError.message);
      setLoading(false);
      return;
    }

    setBatches((data || []) as UploadBatchRow[]);
    setLoading(false);
  }, [authLoading, user, store]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const handler = () => {
      void loadHistory();
    };

    window.addEventListener('storepulse:data-updated', handler);

    return () => {
      window.removeEventListener('storepulse:data-updated', handler);
    };
  }, [loadHistory]);

  const stats = useMemo(() => {
    return batches.reduce(
      (acc, batch) => {
        acc.uploads += 1;
        acc.totalRows += batch.total_rows || 0;
        acc.validRows += batch.valid_rows || 0;
        acc.invalidRows += batch.invalid_rows || 0;
        return acc;
      },
      {
        uploads: 0,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
      }
    );
  }, [batches]);

  if (authLoading || loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Loading upload history</h3>
            <p className="text-sm text-muted-foreground">Checking recent imports.</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!user || !store) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 text-destructive" />
          <div>
            <h3 className="font-semibold text-foreground">Store setup required</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete store setup to view upload history.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <h3 className="font-semibold text-foreground">Could not load upload history</h3>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (batches.length === 0) {
    return (
      <Card className="border-dashed p-6">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <History className="h-5 w-5" />
          </div>

          <h3 className="mt-4 text-base font-semibold text-foreground">No upload history yet</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Uploaded files will appear here after import.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <History className="h-5 w-5" />
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground">Upload History</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Recent imported files.
              </p>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Uploads</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{stats.uploads}</p>
          </div>

          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rows</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{stats.totalRows.toLocaleString()}</p>
          </div>

          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Imported</p>
            <p className="mt-2 text-2xl font-bold text-success">{stats.validRows.toLocaleString()}</p>
          </div>

          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Skipped</p>
            <p className="mt-2 text-2xl font-bold text-destructive">{stats.invalidRows.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        {batches.map((batch) => {
          const type = uploadTypeLabel(batch.upload_type);
          const Icon = type.icon;
          const status = statusLabel(batch);

          return (
            <div
              key={batch.id}
              className="grid gap-4 p-5 lg:grid-cols-[1.1fr_1.5fr_0.8fr_0.8fr_0.8fr] lg:items-center"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </div>

                <div>
                  <p className="font-semibold text-foreground">{type.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{type.description}</p>
                </div>
              </div>

              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{batch.file_name}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  {formatDateTime(batch.created_at)}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rows</p>
                <p className="mt-1 font-semibold text-foreground">{batch.total_rows.toLocaleString()}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Imported</p>
                <p className="mt-1 font-semibold text-success">{batch.valid_rows.toLocaleString()}</p>
              </div>

              <div className="flex items-center justify-start gap-2 lg:justify-end">
                <Badge variant={status.variant}>{status.label}</Badge>
                {batch.invalid_rows === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <CircleAlert className="h-4 w-4 text-destructive" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}