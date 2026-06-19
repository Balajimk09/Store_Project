'use client';

import { useMemo, useState } from 'react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { transactions as mockTransactions, type TransactionType, type PaymentType } from '@/lib/mock-data';
import { useStoreData } from '@/lib/store';
import { formatCurrency, formatDateTime, exportToCsv } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Download, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

const typeStyles: Record<TransactionType, string> = {
  Sale: 'bg-success/10 text-success',
  Refund: 'bg-chart-3/10 text-chart-3',
  Void: 'bg-chart-6/10 text-chart-6',
  'No-Sale': 'bg-destructive/10 text-destructive',
};

const paymentTypes: PaymentType[] = ['Credit', 'Debit', 'Cash', 'EBT', 'Mobile'];
const txTypes: TransactionType[] = ['Sale', 'Refund', 'Void', 'No-Sale'];
const PAGE_SIZE = 14;

export default function TransactionsPage() {
  const { transactions, meta, isDemo } = useStoreData();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionType | 'All'>('All');
  const [paymentFilter, setPaymentFilter] = useState<PaymentType | 'All'>('All');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (typeFilter !== 'All' && t.type !== typeFilter) return false;
      if (paymentFilter !== 'All' && t.paymentType !== paymentFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !t.item.toLowerCase().includes(q) &&
          !t.cashierName.toLowerCase().includes(q) &&
          !t.id.toLowerCase().includes(q) &&
          !t.category.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [query, typeFilter, paymentFilter]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleExport = () => {
    exportToCsv(
      'storepulse-transactions.csv',
      filtered.map((t) => ({
        TransactionID: t.id,
        DateTime: formatDateTime(t.timestamp),
        Item: t.item,
        Category: t.category,
        Cashier: t.cashierName,
        CashierID: t.cashierId,
        Register: t.register,
        PaymentType: t.paymentType,
        Amount: t.amount,
        Type: t.type,
      }))
    );
  };

  const resetPage = () => setPage(0);

  return (
    <DashboardShell>
      <PageHeader title="Live Transactions" description={`${transactions.length} transactions · ${isDemo ? 'demo data' : meta.fileName}`}>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search item, cashier, ID, category..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetPage();
              }}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <SelectChip
              label="All types"
              value={typeFilter}
              options={['All', ...txTypes] as (TransactionType | 'All')[]}
              onSelect={(v) => {
                setTypeFilter(v);
                resetPage();
              }}
            />
            <SelectChip
              label="All payments"
              value={paymentFilter}
              options={['All', ...paymentTypes] as (PaymentType | 'All')[]}
              onSelect={(v) => {
                setPaymentFilter(v);
                resetPage();
              }}
            />
            <span className="ml-2 text-sm text-muted-foreground">{filtered.length} results</span>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {['Time', 'Transaction ID', 'Item', 'Category', 'Cashier', 'Reg', 'Payment', 'Type', 'Amount'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((t) => (
                <tr key={t.id} className="border-b border-border/60 transition-colors hover:bg-secondary/30">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(t.timestamp)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.id}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{t.item}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.category}</td>
                  <td className="px-4 py-3 text-foreground">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {t.cashierName.split(' ').map((n) => n[0]).join('')}
                      </span>
                      {t.cashierName}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">#{t.register}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.paymentType}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', typeStyles[t.type])}>
                      {t.type}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 font-semibold tabular-nums',
                      t.amount < 0 ? 'text-destructive' : 'text-foreground'
                    )}
                  >
                    {formatCurrency(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {pageCount || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </DashboardShell>
  );
}

function SelectChip<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: T[];
  onSelect: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onSelect(e.target.value as T)}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o === 'All' ? label : o}
        </option>
      ))}
    </select>
  );
}
