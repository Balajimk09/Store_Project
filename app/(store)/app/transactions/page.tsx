'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { exportToCsv, formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import type { PaymentType, Transaction, TransactionType } from '@/lib/mock-data';
import {
  buildPaymentSummary,
  CANONICAL_TRANSACTION_PAGE_SIZE,
  getCanonicalCashEventSummary,
  getCanonicalCashier,
  getCanonicalRegister,
  getCanonicalTicketId,
  getPaymentDirectionLabel,
  getTransactionTypeDisplay,
  humanizeIdentifier,
  isChangePayment,
  normalizePaymentLabel,
  resolveSafeTimeZone,
  type CanonicalPosTransactionHeader,
  type CanonicalPosTransactionLine,
  type CanonicalPosTransactionPayment,
  type CanonicalTransactionFilters,
  type CanonicalTransactionTicket,
} from '@/lib/pos/canonical-transactions';
import { useCanonicalTransactions } from '@/lib/pos/use-canonical-transactions';
import { useStoreData } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Filter,
  RefreshCw,
  Search,
} from 'lucide-react';

const legacyTypeStyles: Record<TransactionType, string> = {
  Sale: 'bg-success/10 text-success',
  Refund: 'bg-chart-3/10 text-chart-3',
  Void: 'bg-chart-6/10 text-chart-6',
  'No-Sale': 'bg-destructive/10 text-destructive',
};

const paymentTypes: PaymentType[] = ['Credit', 'Debit', 'Cash', 'EBT', 'Mobile'];
const txTypes: TransactionType[] = ['Sale', 'Refund', 'Void', 'No-Sale'];
const canonicalTypeOptions = [
  'completed_sale',
  'completed_sale_with_item_void',
  'completed_recalled_sale',
  'fuel_pay_at_pump',
  'fuel_prepay_completed',
  'refund',
  'void',
  'paid_out',
  'safe_drop',
  'no_sale',
  'zero_value_event',
];
const PAGE_SIZE = 14;

const defaultCanonicalFilters: CanonicalTransactionFilters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  transactionType: 'all',
  register: '',
  cashier: '',
  paymentMethod: 'all',
  fuelOnly: false,
  hasItemVoids: false,
  recalledOnly: false,
};

function cleanCanonicalFilters(filters: CanonicalTransactionFilters): CanonicalTransactionFilters {
  return {
    ...filters,
    search: filters.search.trim(),
    register: filters.register.trim(),
    cashier: filters.cashier.trim(),
    paymentMethod: filters.paymentMethod === 'all' ? 'all' : filters.paymentMethod.trim() || 'all',
  };
}

function canonicalFiltersEqual(left: CanonicalTransactionFilters, right: CanonicalTransactionFilters) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasActiveCanonicalFilters(filters: CanonicalTransactionFilters) {
  return !canonicalFiltersEqual(cleanCanonicalFilters(filters), defaultCanonicalFilters);
}

export default function TransactionsPage() {
  const { activeStore, activeStoreId, storeScope, storeLoading } = useAuth();
  const legacyStore = useStoreData();
  const [legacyQuery, setLegacyQuery] = useState('');
  const [legacyTypeFilter, setLegacyTypeFilter] = useState<TransactionType | 'All'>('All');
  const [legacyPaymentFilter, setLegacyPaymentFilter] = useState<PaymentType | 'All'>('All');
  const [legacyPage, setLegacyPage] = useState(0);
  const [canonicalPage, setCanonicalPage] = useState(0);
  const [draftFilters, setDraftFilters] = useState<CanonicalTransactionFilters>(defaultCanonicalFilters);
  const [appliedFilters, setAppliedFilters] = useState<CanonicalTransactionFilters>(defaultCanonicalFilters);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const timeZone = resolveSafeTimeZone(activeStore?.timezone);
  const canonicalEnabled = Boolean(activeStoreId && storeScope === 'single');
  const canonical = useCanonicalTransactions({
    storeId: activeStoreId,
    enabled: canonicalEnabled,
    page: canonicalPage,
    filters: appliedFilters,
    timeZone,
  });

  const canonicalAvailable = canonical.canonicalAvailable === true;
  const canonicalFailedWithLegacy = Boolean(canonical.error && legacyStore.transactions.length > 0);
  const showCanonical = canonicalEnabled && canonicalAvailable && !canonical.error;
  const showLegacy =
    !showCanonical &&
    legacyStore.loaded &&
    (canonical.canonicalAvailable === false || (Boolean(canonical.error) && legacyStore.transactions.length > 0));
  const sourceLabel = showCanonical ? 'Live POS' : canonicalFailedWithLegacy ? 'Legacy Fallback' : 'Legacy Upload';

  const legacyFiltered = useMemo(() => {
    return legacyStore.transactions.filter((transaction) => {
      if (legacyTypeFilter !== 'All' && transaction.type !== legacyTypeFilter) return false;
      if (legacyPaymentFilter !== 'All' && transaction.paymentType !== legacyPaymentFilter) return false;
      if (legacyQuery) {
        const q = legacyQuery.toLowerCase();
        if (
          !transaction.item.toLowerCase().includes(q) &&
          !transaction.cashierName.toLowerCase().includes(q) &&
          !transaction.id.toLowerCase().includes(q) &&
          !transaction.category.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [legacyPaymentFilter, legacyQuery, legacyStore.transactions, legacyTypeFilter]);

  const legacyPageCount = Math.ceil(legacyFiltered.length / PAGE_SIZE);
  const legacyPageData = legacyFiltered.slice(legacyPage * PAGE_SIZE, (legacyPage + 1) * PAGE_SIZE);
  const canonicalPageCount = Math.ceil((canonical.data?.totalHeaders ?? 0) / CANONICAL_TRANSACTION_PAGE_SIZE);

  useEffect(() => {
    setCanonicalPage(0);
    setDraftFilters(defaultCanonicalFilters);
    setAppliedFilters(defaultCanonicalFilters);
    setExpandedRows(new Set());
  }, [activeStoreId]);

  useEffect(() => {
    if (!canonical.data) return;
    const maxPage = Math.max(0, Math.ceil(canonical.data.totalHeaders / CANONICAL_TRANSACTION_PAGE_SIZE) - 1);
    if (canonicalPage > maxPage) {
      setCanonicalPage(maxPage);
    }
  }, [canonical.data, canonicalPage]);

  const updateDraftFilter = <K extends keyof CanonicalTransactionFilters>(key: K, value: CanonicalTransactionFilters[K]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    const nextFilters = cleanCanonicalFilters(draftFilters);
    const filtersUnchanged = canonicalFiltersEqual(nextFilters, appliedFilters);
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setExpandedRows(new Set());
    if (filtersUnchanged && canonicalPage === 0) {
      void canonical.refresh();
      return;
    }
    setCanonicalPage(0);
  };

  const clearFilters = () => {
    const filtersUnchanged = canonicalFiltersEqual(defaultCanonicalFilters, appliedFilters);
    setDraftFilters(defaultCanonicalFilters);
    setAppliedFilters(defaultCanonicalFilters);
    setExpandedRows(new Set());
    if (filtersUnchanged && canonicalPage === 0) {
      void canonical.refresh();
      return;
    }
    setCanonicalPage(0);
  };

  const toggleExpanded = (id: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExport = () => {
    if (showCanonical) {
      const rows = (canonical.data?.tickets ?? []).map((ticket) => {
        const header = ticket.header;
        return {
          transaction_time: header.transaction_time,
          business_date: header.business_date || '',
          ticket: getCanonicalTicketId(header),
          register: getCanonicalRegister(header),
          cashier: getCanonicalCashier(header),
          transaction_type: header.transaction_type,
          subtotal: header.subtotal,
          tax_total: header.tax_total,
          total: header.total,
          item_count: header.item_count,
          payment_count: header.payment_count,
          payment_summary: buildPaymentSummary(ticket),
          is_fuel_transaction: String(header.is_fuel_transaction),
          has_item_voids: String(header.has_item_voids),
          item_void_count: header.item_void_count,
          was_recalled: String(header.was_recalled),
          source_unique_id: header.source_unique_id,
        };
      });
      exportToCsv('storepulse-live-pos-transactions.csv', rows);
      return;
    }

    exportToCsv(
      'storepulse-transactions.csv',
      legacyFiltered.map((transaction) => ({
        TransactionID: transaction.id,
        DateTime: formatDateTime(transaction.timestamp),
        Item: transaction.item,
        Category: transaction.category,
        Cashier: transaction.cashierName,
        CashierID: transaction.cashierId,
        Register: transaction.register,
        PaymentType: transaction.paymentType,
        Amount: transaction.amount,
        Type: transaction.type,
      }))
    );
  };

  if (storeScope === 'all' || !activeStoreId) {
    return (
      <DashboardShell>
        <PageHeader title="Live Transactions" description="Canonical POS ticket verification" />
        <Card className="p-6">
          <p className="font-medium text-foreground">Select a specific store to view live POS transactions.</p>
          <p className="mt-2 text-sm text-muted-foreground">All Stores mode is disabled for canonical transaction review in this phase.</p>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      {storeLoading ||
      (canonicalEnabled && canonical.canonicalAvailable === null && !canonical.error) ||
      (canonicalEnabled && canonical.canonicalAvailable === true && !canonical.data && !canonical.error) ||
      (canonical.loading && !legacyStore.loaded) ? (
        <PageLoading />
      ) : (
        <>
          <PageHeader
            title="Live Transactions"
            description={`${showCanonical ? formatNumber(canonical.data?.totalHeaders ?? 0) : formatNumber(legacyFiltered.length)} transactions · ${activeStore?.store_name || 'Selected store'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={sourceLabel} />
              {showCanonical ? (
                <Button variant="outline" size="sm" onClick={() => void canonical.refresh()} disabled={canonical.refreshing}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', canonical.refreshing && 'animate-spin')} />
                  Refresh
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={handleExport} disabled={showCanonical ? !canonical.data?.tickets.length : !legacyFiltered.length}>
                <Download className="mr-2 h-4 w-4" /> {showCanonical ? 'Export Current Page CSV' : 'Export CSV'}
              </Button>
            </div>
          </PageHeader>

          {canonical.error && showLegacy ? (
            <Card className="mb-4 border-chart-6/30 bg-chart-6/5 p-4">
              <p className="text-sm font-medium text-foreground">Live POS data could not be loaded. Showing legacy transaction data.</p>
              <p className="mt-1 text-sm text-muted-foreground">Legacy transaction rows are shown until live POS data is available again.</p>
            </Card>
          ) : null}

          {showCanonical ? (
            <CanonicalTransactionsView
              draftFilters={draftFilters}
              appliedFilters={appliedFilters}
              updateDraftFilter={updateDraftFilter}
              applyFilters={applyFilters}
              clearFilters={clearFilters}
              timeZone={timeZone}
              lastRefreshedAt={canonical.lastRefreshedAt}
              refreshing={canonical.refreshing}
              result={canonical.data!}
              page={canonicalPage}
              pageCount={canonicalPageCount}
              setPage={setCanonicalPage}
              expandedRows={expandedRows}
              toggleExpanded={toggleExpanded}
            />
          ) : showLegacy ? (
            <LegacyTransactionsView
              isDemo={legacyStore.isDemo}
              metaFileName={legacyStore.meta.fileName}
              filtered={legacyFiltered}
              pageData={legacyPageData}
              page={legacyPage}
              pageCount={legacyPageCount}
              query={legacyQuery}
              typeFilter={legacyTypeFilter}
              paymentFilter={legacyPaymentFilter}
              setQuery={(value) => {
                setLegacyQuery(value);
                setLegacyPage(0);
              }}
              setTypeFilter={(value) => {
                setLegacyTypeFilter(value);
                setLegacyPage(0);
              }}
              setPaymentFilter={(value) => {
                setLegacyPaymentFilter(value);
                setLegacyPage(0);
              }}
              setPage={setLegacyPage}
            />
          ) : (
            <Card className="p-6">
              <p className="font-medium text-foreground">
                {canonical.error ? 'Live POS transactions could not be loaded.' : 'No transaction data is available for this store yet.'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {canonical.error
                  ? 'No legacy transaction rows are available for fallback.'
                  : 'Live POS data and legacy uploaded transactions are both empty for the selected store.'}
              </p>
            </Card>
          )}
        </>
      )}
    </DashboardShell>
  );
}

function CanonicalTransactionsView({
  draftFilters,
  appliedFilters,
  updateDraftFilter,
  applyFilters,
  clearFilters,
  timeZone,
  lastRefreshedAt,
  refreshing,
  result,
  page,
  pageCount,
  setPage,
  expandedRows,
  toggleExpanded,
}: {
  draftFilters: CanonicalTransactionFilters;
  appliedFilters: CanonicalTransactionFilters;
  updateDraftFilter: <K extends keyof CanonicalTransactionFilters>(key: K, value: CanonicalTransactionFilters[K]) => void;
  applyFilters: () => void;
  clearFilters: () => void;
  timeZone: string;
  lastRefreshedAt: string | null;
  refreshing: boolean;
  result: NonNullable<ReturnType<typeof useCanonicalTransactions>['data']>;
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  expandedRows: Set<string>;
  toggleExpanded: (id: string) => void;
}) {
  const hasFilters = hasActiveCanonicalFilters(draftFilters) || hasActiveCanonicalFilters(appliedFilters);
  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyFilters();
  };

  return (
    <>
      <Card className="mb-5 p-4">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Canonical POS source</p>
            <p className="text-xs text-muted-foreground">
              Last refreshed {lastRefreshedAt ? formatDateTime(lastRefreshedAt) : 'not yet'} · Timezone: {timeZone}
              {refreshing ? ' · Refreshing...' : ''}
            </p>
          </div>
          {result.paymentFilterAppliedToVisiblePage ? (
            <Badge variant="outline" className="w-fit text-muted-foreground">
              Payment filter applies to the current loaded page only
            </Badge>
          ) : null}
        </div>
        <form onSubmit={handleFilterSubmit}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="md:col-span-2 xl:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={draftFilters.search}
                  placeholder="Ticket, cashier, register..."
                  onChange={(event) => updateDraftFilter('search', event.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <FilterInput label="Date from" type="date" value={draftFilters.dateFrom} onChange={(value) => updateDraftFilter('dateFrom', value)} />
            <FilterInput label="Date to" type="date" value={draftFilters.dateTo} onChange={(value) => updateDraftFilter('dateTo', value)} />
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Transaction type</label>
              <select
                value={draftFilters.transactionType}
                onChange={(event) => updateDraftFilter('transactionType', event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All types</option>
                {canonicalTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {getTransactionTypeDisplay(type).label}
                  </option>
                ))}
              </select>
            </div>
            <FilterInput label="Register" value={draftFilters.register} onChange={(value) => updateDraftFilter('register', value)} />
            <FilterInput label="Cashier" value={draftFilters.cashier} onChange={(value) => updateDraftFilter('cashier', value)} />
            <FilterInput label="Payment method - current page" value={draftFilters.paymentMethod === 'all' ? '' : draftFilters.paymentMethod} placeholder="Cash, Credit, Debit..." onChange={(value) => updateDraftFilter('paymentMethod', value || 'all')} />
            <div className="flex flex-wrap items-end gap-4">
              <BooleanFilter label="Fuel only" checked={draftFilters.fuelOnly} onChange={(checked) => updateDraftFilter('fuelOnly', checked)} />
              <BooleanFilter label="Has item voids" checked={draftFilters.hasItemVoids} onChange={(checked) => updateDraftFilter('hasItemVoids', checked)} />
              <BooleanFilter label="Recalled only" checked={draftFilters.recalledOnly} onChange={(checked) => updateDraftFilter('recalledOnly', checked)} />
            </div>
            <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-4">
              <Button type="submit" variant="outline" size="sm" className="h-9">
                Apply Filters
              </Button>
              {hasFilters ? (
                <Button type="button" variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
                  Clear Filters
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {['Time', 'Business Date', 'Ticket', 'Register', 'Cashier', 'Type', 'Items', 'Payment / Cash Event', 'Subtotal', 'Tax', 'Total', 'Flags', ''].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.tickets.length ? (
                result.tickets.map((ticket) => (
                  <CanonicalTicketRow
                    key={ticket.header.id}
                    ticket={ticket}
                    expanded={expandedRows.has(ticket.header.id)}
                    onToggle={() => toggleExpanded(ticket.header.id)}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No live POS transactions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationFooter
          page={page}
          pageCount={pageCount}
          total={result.totalHeaders}
          pageSize={CANONICAL_TRANSACTION_PAGE_SIZE}
          visibleCount={result.tickets.length}
          onPrev={() => setPage(Math.max(0, page - 1))}
          onNext={() => setPage(Math.min(Math.max(0, pageCount - 1), page + 1))}
        />
      </Card>
    </>
  );
}

function CanonicalTicketRow({ ticket, expanded, onToggle }: { ticket: CanonicalTransactionTicket; expanded: boolean; onToggle: () => void }) {
  const header = ticket.header;
  const typeDisplay = getTransactionTypeDisplay(header.transaction_type);
  const cashEvent = getCanonicalCashEventSummary(ticket);
  const flagLabels = [
    header.is_fuel_transaction ? 'Fuel' : null,
    header.has_item_voids ? `${header.item_void_count || 1} item void${header.item_void_count === 1 ? '' : 's'}` : null,
    header.was_recalled ? 'Recalled' : null,
    header.has_cash_back ? 'Cash back' : null,
    header.has_rounding_adjustment ? 'Rounding' : null,
    cashEvent?.eventType === 'paid_out' || cashEvent?.eventType === 'safe_drop' ? 'Cash Management' : null,
    header.transaction_type === 'no_sale' ? 'Cashier Exception' : null,
    header.transaction_type === 'zero_value_event' ? 'Review Required' : null,
    typeDisplay.indicator,
  ].filter((label): label is string => Boolean(label));

  return (
    <>
      <tr className="border-b border-border/60 transition-colors hover:bg-secondary/30">
        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(header.transaction_time)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{header.business_date || '—'}</td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{getCanonicalTicketId(header)}</td>
        <td className="px-4 py-3 text-muted-foreground">{getCanonicalRegister(header)}</td>
        <td className="px-4 py-3 font-medium text-foreground">{getCanonicalCashier(header)}</td>
        <td className="px-4 py-3">
          <TransactionTypeBadge label={typeDisplay.label} tone={typeDisplay.tone} />
        </td>
        <td className="px-4 py-3 text-muted-foreground">{formatNumber(header.item_count)}</td>
        <td className="px-4 py-3 text-muted-foreground">{buildPaymentSummary(ticket, true)}</td>
        <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatCurrency(header.subtotal)}</td>
        <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatCurrency(header.tax_total)}</td>
        <td className={cn('px-4 py-3 font-semibold tabular-nums', header.total < 0 ? 'text-destructive' : 'text-foreground')}>
          {formatCurrency(header.total)}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {flagLabels.length ? flagLabels.map((label) => <Badge key={label} variant="outline" className="text-[10px] text-muted-foreground">{label}</Badge>) : <span className="text-muted-foreground">—</span>}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <Button variant="ghost" size="sm" onClick={onToggle} aria-label={expanded ? 'Collapse ticket details' : 'Expand ticket details'}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border/60 bg-secondary/15">
          <td colSpan={13} className="px-4 py-4">
            <ExpandedTicketDetails ticket={ticket} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExpandedTicketDetails({ ticket }: { ticket: CanonicalTransactionTicket }) {
  const header = ticket.header;
  const cashEvent = getCanonicalCashEventSummary(ticket);
  return (
    <div className="space-y-4">
      <DetailSection title="Ticket Summary">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="Source ID" value={header.source_unique_id} />
          <DetailItem label="Sequence" value={header.transaction_sequence || '—'} />
          <DetailItem label="Serial" value={header.transaction_serial || '—'} />
          <DetailItem label="Transaction time" value={formatDateTime(header.transaction_time)} />
          <DetailItem label="Business date" value={header.business_date || '—'} />
          <DetailItem label="Register" value={getCanonicalRegister(header)} />
          <DetailItem label="Cashier" value={getCanonicalCashier(header)} />
          <DetailItem label="Till" value={header.till || '—'} />
          <DetailItem label="Subtotal" value={formatCurrency(header.subtotal)} />
          <DetailItem label="Tax" value={formatCurrency(header.tax_total)} />
          <DetailItem label="Total" value={formatCurrency(header.total)} />
          <DetailItem label="Current total" value={formatCurrency(header.current_total)} />
          <DetailItem label="Duration" value={`${header.duration_seconds.toFixed(1)}s`} />
          <DetailItem label="Items" value={formatNumber(header.item_count)} />
          <DetailItem label="Payments" value={formatNumber(header.payment_count)} />
        </div>
      </DetailSection>

      {cashEvent ? (
        <DetailSection title="Cash Event Summary">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem label="Event type" value={cashEvent.label} />
            <DetailItem label="Cash amount" value={formatCurrency(cashEvent.amount)} />
            <DetailItem label="Cashier" value={getCanonicalCashier(header)} />
            <DetailItem label="Register" value={getCanonicalRegister(header)} />
            <DetailItem label="Transaction time" value={formatDateTime(header.transaction_time)} />
            <DetailItem label="Source ticket" value={getCanonicalTicketId(header)} />
          </div>
        </DetailSection>
      ) : null}

      <DetailSection title="Item Lines">
        <CompactTable
          headers={['Line', 'Type', 'UPC', 'Description', 'Department', 'Qty', 'Unit price', 'Line total', 'Tax rate', 'Flags']}
          rows={ticket.lines.map((line) => lineToCells(line))}
          empty="No item lines found for this ticket."
        />
      </DetailSection>

      <DetailSection title="Payments">
        <CompactTable
          headers={['#', 'Method', 'Card/network', 'Last four', 'Entry', 'Direction', 'Amount', 'Flags']}
          rows={ticket.payments.map((payment) => paymentToCells(payment, ticket.payments.length > 1))}
          empty="No payment rows found for this ticket."
        />
      </DetailSection>

      {ticket.relationships.length ? (
        <DetailSection title="Relationships">
          <CompactTable
            headers={['Type', 'Related ticket', 'Related source ID', 'Linked transaction ID', 'Metadata']}
            rows={ticket.relationships.map((relationship) => [
              humanizeIdentifier(relationship.relationship_type),
              relationship.related_ticket || '—',
              relationship.related_source_unique_id || '—',
              relationship.related_transaction_id || '—',
              relationship.metadata ? `${Object.keys(relationship.metadata).length} metadata fields` : '—',
            ])}
          />
        </DetailSection>
      ) : null}

      <DetailSection title="Advanced Details">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="Source system" value={header.source_system} />
          <DetailItem label="Store number" value={header.store_number || '—'} />
          <DetailItem label="Original ticket" value={header.original_ticket || '—'} />
          <DetailItem label="Original source ID" value={header.original_source_unique_id || '—'} />
          <DetailItem label="Shadow source IDs" value={header.shadow_source_unique_ids.length ? header.shadow_source_unique_ids.join(', ') : '—'} />
          <DetailItem label="First seen" value={formatDateTime(header.first_seen_at)} />
          <DetailItem label="Last seen" value={formatDateTime(header.last_seen_at)} />
          <DetailItem label="Created" value={formatDateTime(header.created_at)} />
          <DetailItem label="Updated" value={formatDateTime(header.updated_at)} />
          <DetailItem label="Cash back" value={header.has_cash_back ? `${formatCurrency(header.cash_back_amount)} fee ${formatCurrency(header.cash_back_fee)}` : '—'} />
          <DetailItem label="Rounding adjustments" value={header.has_rounding_adjustment ? formatNumber(header.rounding_adjustment_count) : '—'} />
        </div>
      </DetailSection>
    </div>
  );
}

function lineToCells(line: CanonicalPosTransactionLine): string[] {
  const flags = [
    line.is_fuel ? 'Fuel' : null,
    line.is_voided ? 'Voided' : null,
    line.is_refund ? 'Refund' : null,
    line.modifier ? 'Modifier' : null,
  ].filter(Boolean).join(', ');
  return [
    String(line.line_number),
    humanizeIdentifier(line.line_type),
    line.upc || '—',
    line.description || '—',
    line.department || '—',
    line.signed_quantity !== null ? formatNumber(line.signed_quantity) : line.quantity !== null ? formatNumber(line.quantity) : '—',
    line.unit_price !== null ? formatCurrency(line.unit_price) : '—',
    line.line_total !== null ? formatCurrency(line.line_total) : '—',
    line.tax_rate !== null ? `${line.tax_rate}%` : '—',
    flags || '—',
  ];
}

function paymentToCells(payment: CanonicalPosTransactionPayment, splitTender: boolean): string[] {
  const flags = [
    isChangePayment(payment) ? 'Change' : null,
    payment.is_refund ? 'Refund' : null,
    splitTender ? 'Split Tender' : null,
  ].filter(Boolean).join(', ');
  return [
    String(payment.payment_number),
    normalizePaymentLabel(payment),
    payment.card_type || payment.host || '—',
    payment.card_last_four || '—',
    payment.entry_method || '—',
    getPaymentDirectionLabel(payment.direction),
    formatCurrency(payment.amount),
    flags || '—',
  ];
}

function LegacyTransactionsView({
  isDemo,
  metaFileName,
  filtered,
  pageData,
  page,
  pageCount,
  query,
  typeFilter,
  paymentFilter,
  setQuery,
  setTypeFilter,
  setPaymentFilter,
  setPage,
}: {
  isDemo: boolean;
  metaFileName: string;
  filtered: Transaction[];
  pageData: Transaction[];
  page: number;
  pageCount: number;
  query: string;
  typeFilter: TransactionType | 'All';
  paymentFilter: PaymentType | 'All';
  setQuery: (value: string) => void;
  setTypeFilter: (value: TransactionType | 'All') => void;
  setPaymentFilter: (value: PaymentType | 'All') => void;
  setPage: (page: number) => void;
}) {
  return (
    <>
      <Card className="mb-5 p-4">
        <div className="mb-3 text-sm text-muted-foreground">
          Legacy source: {isDemo ? 'demo data' : metaFileName}. Stores without canonical POS records continue to use this upload view.
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search item, cashier, ID, category..." value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <SelectChip label="All types" value={typeFilter} options={['All', ...txTypes] as (TransactionType | 'All')[]} onSelect={setTypeFilter} />
            <SelectChip label="All payments" value={paymentFilter} options={['All', ...paymentTypes] as (PaymentType | 'All')[]} onSelect={setPaymentFilter} />
            <span className="ml-2 text-sm text-muted-foreground">{filtered.length} results</span>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {['Time', 'Transaction ID', 'Item', 'Category', 'Cashier', 'Reg', 'Payment', 'Type', 'Amount'].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((transaction) => (
                <tr key={transaction.id} className="border-b border-border/60 transition-colors hover:bg-secondary/30">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(transaction.timestamp)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{transaction.id}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{transaction.item}</td>
                  <td className="px-4 py-3 text-muted-foreground">{transaction.category}</td>
                  <td className="px-4 py-3 text-foreground">{transaction.cashierName}</td>
                  <td className="px-4 py-3 text-muted-foreground">#{transaction.register}</td>
                  <td className="px-4 py-3 text-muted-foreground">{transaction.paymentType}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', legacyTypeStyles[transaction.type])}>
                      {transaction.type}
                    </span>
                  </td>
                  <td className={cn('px-4 py-3 font-semibold tabular-nums', transaction.amount < 0 ? 'text-destructive' : 'text-foreground')}>
                    {formatCurrency(transaction.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationFooter
          page={page}
          pageCount={pageCount}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          visibleCount={pageData.length}
          onPrev={() => setPage(Math.max(0, page - 1))}
          onNext={() => setPage(Math.min(Math.max(0, pageCount - 1), page + 1))}
        />
      </Card>
    </>
  );
}

function SourceBadge({ source }: { source: 'Live POS' | 'Legacy Upload' | 'Legacy Fallback' }) {
  return (
    <Badge
      variant={source === 'Live POS' ? 'default' : 'outline'}
      className={cn(source === 'Legacy Fallback' && 'border-chart-6/40 bg-chart-6/10 text-chart-6')}
    >
      {source}
    </Badge>
  );
}

function TransactionTypeBadge({ label, tone }: { label: string; tone: ReturnType<typeof getTransactionTypeDisplay>['tone'] }) {
  const className = {
    sale: 'bg-success/10 text-success',
    refund: 'bg-destructive/10 text-destructive',
    void: 'bg-destructive/10 text-destructive',
    fuel: 'bg-chart-2/10 text-chart-2',
    review: 'bg-secondary text-muted-foreground',
    neutral: 'bg-secondary text-muted-foreground',
    'cash-warning': 'bg-chart-6/10 text-chart-6',
    'cash-neutral': 'bg-primary/10 text-primary',
  }[tone];
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', className)}>{label}</span>;
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  icon = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  icon?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        {icon ? <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /> : null}
        <Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={cn(icon && 'pl-9')} />
      </div>
    </div>
  );
}

function BooleanFilter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-9 items-center gap-2 text-sm text-foreground">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function CompactTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty?: string }) {
  if (!rows.length) return <p className="rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">{empty || 'No rows found.'}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-background">
      <table className="w-full min-w-[760px] text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row.join('|')}-${rowIndex}`} className="border-b border-border/50 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className="px-3 py-2 text-muted-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaginationFooter({
  page,
  pageCount,
  total,
  pageSize,
  visibleCount,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  visibleCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = total === 0 ? 0 : Math.min(page * pageSize + visibleCount, total);
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <p className="text-sm text-muted-foreground">
        Showing {start}-{end} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={onPrev}>
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page + 1} of {pageCount || 1}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={onNext}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
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
  onSelect: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onSelect(event.target.value as T)}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option === 'All' ? label : option}
        </option>
      ))}
    </select>
  );
}
