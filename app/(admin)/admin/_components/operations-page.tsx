'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, RefreshCcw } from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { adminFetch, type AdminMeResponse } from '@/lib/admin-client';

export type Column = {
  key: string;
  label: string;
};

type OperationsPageProps = {
  title: string;
  description: string;
  endpoint: string;
  rowsKey: string;
  columns: Column[];
  emptyText: string;
  createLabel?: string;
  createEndpoint?: string;
  createFields?: Array<{ key: string; label: string; required?: boolean }>;
  requiredPermissions: string[];
};

function displayValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value);
}

export function OperationsPage(props: OperationsPageProps) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [allowed, setAllowed] = useState(false);

  const hasAccess = (me: AdminMeResponse) => {
    if (me.isSuperadmin) return true;
    return props.requiredPermissions.some((permission) => me.permissionKeys.includes(permission));
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await adminFetch<AdminMeResponse>('/api/admin/me');
      if (!hasAccess(me)) {
        setAllowed(false);
        setRows([]);
        return;
      }
      setAllowed(true);
      const response = await adminFetch<Record<string, unknown>>(props.endpoint);
      const data = response[props.rowsKey];
      setRows(Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async () => {
    if (!props.createEndpoint || !props.createFields) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminFetch<Record<string, unknown>>(props.createEndpoint, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSuccess('Saved.');
      setDrawerOpen(false);
      setForm({});
      await load();
      window.setTimeout(() => setSuccess(null), 3000);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader title={props.title} description={props.description}>
        {props.createLabel && props.createFields && (
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {props.createLabel}
          </Button>
        )}
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </AdminPageHeader>

      {success && <Card className="mb-4 border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</Card>}

      {loading ? (
        <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </Card>
      ) : error ? (
        <Card className="flex items-start gap-3 border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <div>
            <p className="font-medium">Could not load this section.</p>
            <p>{error}</p>
          </div>
        </Card>
      ) : !allowed ? (
        <Card className="p-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">Access Limited</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You don&apos;t have permission to view this section. Contact your superadmin to request access.
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{props.emptyText}</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  {props.columns.map((column) => (
                    <th key={column.key} className="px-4 py-3 font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, index) => (
                  <tr key={String(row.id || index)} className="align-top">
                    {props.columns.map((column) => (
                      <td key={column.key} className="max-w-xs truncate px-4 py-3">
                        {displayValue(row, column.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {drawerOpen && props.createFields && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-md overflow-y-auto bg-background p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{props.createLabel}</h2>
              <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
                Close
              </Button>
            </div>
            <div className="mt-6 space-y-4">
              {props.createFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={field.key}>{field.required ? `${field.label} *` : field.label}</Label>
                  <Input
                    id={field.key}
                    value={form[field.key] || ''}
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDrawerOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
