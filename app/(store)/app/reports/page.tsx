'use client';

import { useMemo, useState, type ElementType, type ReactNode } from 'react';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStoreData } from '@/lib/store';
import type { Product, Transaction } from '@/lib/mock-data';
import { exportToCsv, formatCurrency, formatNumber } from '@/lib/format';
import {
  AlertTriangle,
  CalendarDays,
  CircleAlert,
  CreditCard,
  Download,
  Fuel,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBasket,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

type ReportTab = 'dayClose' | 'merchandise' | 'fuel' | 'payments' | 'cashiers';

type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'tillDate'
  | 'custom';

type CashierDetailFilter =
  | 'all'
  | 'sales'
  | 'refunds'
  | 'voidTickets'
  | 'voidLines'
  | 'errorCorrect'
  | 'noSales';

type SalesRow = {
  date: string;
  label: string;
  sales: number;
  transactions: number;
  avgTicket: number;
};

type SummaryRow = {
  name: string;
  sales: number;
  transactions: number;
  units: number;
};

type FuelRow = {
  grade: string;
  dollars: number;
  volume: number;
  transactions: number;
  cost: number;
  profit: number;
  knownCostVolume: number;
};

type PaymentNetworkRow = {
  name: string;
  paymentType: string;
  salesCount: number;
  salesAmount: number;
  refundCount: number;
  refundAmount: number;
  netAmount: number;
};

type CashierRow = {
  id: string;
  name: string;
  sales: number;
  transactions: number;
  refunds: number;
  voidTickets: number;
  voidLines: number;
  errorCorrects: number;
  noSales: number;
  avgTicket: number;
  riskScore: number;
};

type ProductRow = {
  name: string;
  category: string;
  upc: string;
  units: number;
  sales: number;
  transactions: number;
};

type ExceptionRow = {
  id: string;
  timestamp: string;
  date: string;
  time: string;
  cashier: string;
  cashierId: string;
  register: number;
  type: string;
  reason: string;
  item: string;
  amount: number;
  paymentType: string;
  cardNetwork: string;
};

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--destructive))',
  'hsl(var(--muted-foreground))',
];

function normalized(value: string | undefined | null) {
  return String(value || '').toLowerCase();
}

function normalizedReason(value: string | undefined | null) {
  return String(value || '')
    .toUpperCase()
    .replaceAll(' ', '_')
    .replaceAll('-', '_')
    .trim();
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getPresetRange(preset: DatePreset, minDate: string, maxDate: string) {
  const realToday = toDateInputValue(new Date());
  const anchorDate = maxDate && maxDate < realToday ? maxDate : realToday;
  const anchor = parseLocalDate(anchorDate);

  if (preset === 'today') {
    return { start: anchorDate, end: anchorDate };
  }

  if (preset === 'yesterday') {
    const yesterday = new Date(anchor);
    yesterday.setDate(yesterday.getDate() - 1);
    const value = toDateInputValue(yesterday);

    return { start: value, end: value };
  }

  if (preset === 'thisMonth') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);

    return {
      start: toDateInputValue(start),
      end: anchorDate,
    };
  }

  if (preset === 'thisQuarter') {
    const currentQuarter = Math.floor(anchor.getMonth() / 3);
    const start = new Date(anchor.getFullYear(), currentQuarter * 3, 1);

    return {
      start: toDateInputValue(start),
      end: anchorDate,
    };
  }

  if (preset === 'thisYear') {
    const start = new Date(anchor.getFullYear(), 0, 1);

    return {
      start: toDateInputValue(start),
      end: anchorDate,
    };
  }

  return {
    start: minDate,
    end: anchorDate,
  };
}

function getPaymentReportName(transaction: Transaction) {
  const text = `${transaction.paymentType || ''} ${transaction.cardNetwork || ''}`.toLowerCase();

  if (text.includes('coupon')) return 'Coupons';
  if (transaction.paymentType === 'Credit') return 'Credit';
  if (transaction.paymentType === 'Debit') return 'Debit';
  if (transaction.paymentType === 'Cash') return 'Cash';
  if (transaction.paymentType === 'Mobile') return 'Mobile';
  if (transaction.paymentType === 'EBT') return 'EBT';

  return transaction.paymentType || 'Other';
}

function parseLocalDate(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);

  if (!year || !month || !day) {
    return new Date(dateString);
  }

  return new Date(year, month - 1, day);
}

function formatReportDate(dateString: string) {
  return parseLocalDate(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatReportDateShort(dateString: string) {
  return parseLocalDate(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function isFuelText(text: string) {
  return (
    text.includes('fuel') ||
    text.includes('gas') ||
    text.includes('regular') ||
    text.includes('unleaded') ||
    text.includes('100ul') ||
    text.includes('100 ul') ||
    text.includes('dsl') ||
    text.includes('diesel') ||
    text.includes('e10') ||
    text.includes('plus') ||
    text.includes('premium') ||
    text.includes('prem')
  );
}

function isFuelTransaction(transaction: Transaction) {
  if (transaction.fuelGrade) return true;

  const text = `${normalized(transaction.category)} ${normalized(transaction.item)}`;

  return isFuelText(text);
}

function detectFuelGradeFromText(textValue: string) {
  const text = normalized(textValue);

  if (text.includes('diesel') || text.includes('dsl')) return 'Diesel';
  if (text.includes('e10')) return 'E10';
  if (text.includes('100ul') || text.includes('100 ul')) return '100UL';
  if (text.includes('premium') || text.includes('prem')) return 'Premium';
  if (text.includes('plus')) return 'Plus';
  if (text.includes('regular') || text.includes('reg') || text.includes('unleaded')) return 'Regular';

  return 'Other Fuel';
}

function detectFuelGrade(transaction: Transaction) {
  if (transaction.fuelGrade) return transaction.fuelGrade;

  return detectFuelGradeFromText(`${transaction.category} ${transaction.item}`);
}

function detectProductFuelGrade(product: Product) {
  return detectFuelGradeFromText(`${product.department || ''} ${product.category || ''} ${product.name || ''}`);
}

function getTxnSalesValue(transaction: Transaction) {
  if (transaction.type === 'Refund') return -Math.abs(transaction.amount || 0);
  if (transaction.type === 'Void' || transaction.type === 'No-Sale') return 0;

  return transaction.amount || 0;
}

function getTxnUnitCount(transaction: Transaction) {
  if (transaction.type !== 'Sale') return 0;

  return Number(transaction.quantity || 1);
}

function getFuelVolume(transaction: Transaction) {
  if (transaction.type !== 'Sale') return 0;

  const quantity = Number(transaction.quantity || 0);
  if (quantity > 0) return quantity;

  const unitPrice = Number(transaction.unitPrice || 0);
  const amount = Number(transaction.amount || 0);

  if (unitPrice > 0 && amount > 0) return amount / unitPrice;

  return 0;
}

function isInRange(transaction: Transaction, startDate: string, endDate: string) {
  if (startDate && transaction.date < startDate) return false;
  if (endDate && transaction.date > endDate) return false;

  return true;
}

function percentOf(value: number, total: number) {
  if (!total) return '0%';

  return `${((value / total) * 100).toFixed(1)}%`;
}

function safeAvg(total: number, count: number) {
  return count > 0 ? total / count : 0;
}

function sortByDateAsc(a: SalesRow, b: SalesRow) {
  return a.date.localeCompare(b.date);
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getCardNetwork(transaction: Transaction) {
  if (transaction.cardNetwork) return transaction.cardNetwork;

  if (transaction.paymentType === 'Credit') return 'Credit';
  if (transaction.paymentType === 'Debit') return 'Debit';
  if (transaction.paymentType === 'Cash') return 'Cash';
  if (transaction.paymentType === 'EBT') return 'EBT';
  if (transaction.paymentType === 'Mobile') return 'Mobile';

  return 'Other';
}

function getExceptionCode(transaction: Transaction) {
  if (transaction.exceptionReason) return normalizedReason(transaction.exceptionReason);

  if (transaction.type === 'Refund') return 'REFUND';
  if (transaction.type === 'No-Sale') return 'NO_SALE';
  if (transaction.type === 'Void') return 'VOID_TICKET';

  return 'SALE';
}

function getExceptionLabel(transaction: Transaction) {
  const code = getExceptionCode(transaction);

  if (code === 'VOID_LINE') return 'VOID LINE';
  if (code === 'VOID_TICKET') return 'VOID TICKET';
  if (code === 'ERROR_CORRECT') return 'ERROR CORRECT';
  if (code === 'NO_SALE') return 'NO SALE';
  if (code === 'REFUND') return 'REFUND';
  if (code === 'SAFE_DROP') return 'SAFE DROP';
  if (transaction.type === 'Sale') return 'SALE';

  return 'OTHER';
}

function getRiskLabel(score: number) {
  if (score >= 70) return 'High';
  if (score >= 35) return 'Medium';

  return 'Low';
}

function getRiskClass(score: number) {
  if (score >= 70) return 'bg-destructive/10 text-destructive';
  if (score >= 35) return 'bg-chart-3/10 text-chart-3';

  return 'bg-success/10 text-success';
}

function matchesCashierFilter(transaction: Transaction, filter: CashierDetailFilter) {
  const code = getExceptionCode(transaction);

  if (filter === 'all') return true;
  if (filter === 'sales') return transaction.type === 'Sale';
  if (filter === 'refunds') return transaction.type === 'Refund';
  if (filter === 'voidTickets') return code === 'VOID_TICKET';
  if (filter === 'voidLines') return code === 'VOID_LINE';
  if (filter === 'errorCorrect') return code === 'ERROR_CORRECT';
  if (filter === 'noSales') return transaction.type === 'No-Sale';

  return true;
}

function ReportTableHeader({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
      {children}
    </thead>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <Receipt className="h-5 w-5" />
      </div>

      <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </Card>
  );
}

function PieLegend({
  data,
  formatter,
}: {
  data: { name: string; value: number }[];
  formatter: (value: number) => string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="mt-4 grid gap-2">
      {data.map((item, index) => (
        <div key={item.name} className="flex items-center justify-between gap-3 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="truncate text-muted-foreground">{item.name}</span>
          </div>

          <div className="shrink-0 text-right">
            <span className="font-semibold text-foreground">{formatter(item.value)}</span>
            <span className="ml-2 text-xs text-muted-foreground">{percentOf(item.value, total)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const {
    transactions,
    products,
    lowStockProducts,
    cloudError,
    loaded,
    dataMode,
    isDemo,
  } = useStoreData();

  const [activeTab, setActiveTab] = useState<ReportTab>('dayClose');
  const [selectedCashierId, setSelectedCashierId] = useState<string | null>(null);
  const [cashierFilter, setCashierFilter] = useState<CashierDetailFilter>('all');
  const [cashierSearch, setCashierSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const allDates = useMemo(() => {
    const dates = transactions.map((transaction) => transaction.date).filter(Boolean).sort();

    return {
      min: dates[0] || '',
      max: dates[dates.length - 1] || '',
    };
  }, [transactions]);

  const presetRange = useMemo(
    () => getPresetRange(datePreset, allDates.min, allDates.max),
    [datePreset, allDates.min, allDates.max]
  );

  const effectiveStart = datePreset === 'custom' ? customStartDate : presetRange.start;
  const effectiveEnd = datePreset === 'custom' ? customEndDate : presetRange.end;

  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) =>
      isInRange(transaction, effectiveStart, effectiveEnd)
    );
  }, [transactions, effectiveStart, effectiveEnd]);

  const fuelCostLookup = useMemo(() => {
    const byUpc = new Map<string, number>();
    const byGrade = new Map<string, number>();

    products.forEach((product) => {
      const text = `${product.department || ''} ${product.category || ''} ${product.name || ''}`;

      if (!isFuelText(normalized(text))) return;

      const cost = Number(product.costPrice || 0);

      if (cost <= 0) return;

      if (product.upc) {
        byUpc.set(product.upc, cost);
      }

      const grade = detectProductFuelGrade(product);
      byGrade.set(grade, cost);
    });

    return { byUpc, byGrade };
  }, [products]);

  const report = useMemo(() => {
    const salesRowsMap = new Map<string, SalesRow>();
    const merchandiseMap = new Map<string, SummaryRow>();
    const fuelMap = new Map<string, FuelRow>();
    const paymentMap = new Map<string, PaymentNetworkRow>();
    const cashierMap = new Map<string, CashierRow>();
    const productMap = new Map<string, ProductRow>();
    const exceptions: ExceptionRow[] = [];

    let netSales = 0;
    let merchandiseSales = 0;
    let fuelSales = 0;
    let fuelVolume = 0;
    let saleCount = 0;
    let refundCount = 0;
    let voidCount = 0;
    let noSaleCount = 0;
    let merchandiseUnits = 0;

    filteredTransactions.forEach((transaction) => {
      const salesValue = getTxnSalesValue(transaction);
      const units = getTxnUnitCount(transaction);
      const isSale = transaction.type === 'Sale';
      const fuelTxn = isFuelTransaction(transaction);
      const exceptionCode = getExceptionCode(transaction);

      netSales += salesValue;

      if (transaction.type === 'Sale') saleCount += 1;
      if (transaction.type === 'Refund') refundCount += 1;
      if (transaction.type === 'Void') voidCount += 1;
      if (transaction.type === 'No-Sale') noSaleCount += 1;

      if (transaction.type !== 'Sale') {
        exceptions.push({
          id: transaction.id,
          timestamp: transaction.timestamp,
          date: transaction.date,
          time: formatTime(transaction.timestamp),
          cashier: transaction.cashierName || transaction.cashierId || 'Unknown',
          cashierId: transaction.cashierId || 'Unknown',
          register: transaction.register || 1,
          type: transaction.type,
          reason: getExceptionLabel(transaction),
          item: transaction.item || 'Unknown item',
          amount: transaction.amount || 0,
          paymentType: transaction.paymentType || 'Unknown',
          cardNetwork: getCardNetwork(transaction),
        });
      }

      const dayRow = salesRowsMap.get(transaction.date) || {
        date: transaction.date,
        label: formatReportDateShort(transaction.date),
        sales: 0,
        transactions: 0,
        avgTicket: 0,
      };

      dayRow.sales += salesValue;
      if (isSale) dayRow.transactions += 1;
      salesRowsMap.set(transaction.date, dayRow);

      const paymentName = getPaymentReportName(transaction);
      const paymentRow = paymentMap.get(paymentName) || {
        name: paymentName,
        paymentType: paymentName,
        salesCount: 0,
        salesAmount: 0,
        refundCount: 0,
        refundAmount: 0,
        netAmount: 0,
      };

      if (transaction.type === 'Sale') {
        paymentRow.salesCount += 1;
        paymentRow.salesAmount += Math.abs(transaction.amount || 0);
      }

      if (transaction.type === 'Refund') {
        paymentRow.refundCount += 1;
        paymentRow.refundAmount += Math.abs(transaction.amount || 0);
      }

      paymentRow.netAmount += salesValue;
      paymentMap.set(paymentName, paymentRow);

      const cashierKey = transaction.cashierId || transaction.cashierName || 'Unknown';
      const cashierRow = cashierMap.get(cashierKey) || {
        id: transaction.cashierId || 'Unknown',
        name: transaction.cashierName || transaction.cashierId || 'Unknown',
        sales: 0,
        transactions: 0,
        refunds: 0,
        voidTickets: 0,
        voidLines: 0,
        errorCorrects: 0,
        noSales: 0,
        avgTicket: 0,
        riskScore: 0,
      };

      cashierRow.sales += salesValue;
      if (isSale) cashierRow.transactions += 1;
      if (transaction.type === 'Refund') cashierRow.refunds += 1;
      if (exceptionCode === 'VOID_TICKET') cashierRow.voidTickets += 1;
      if (exceptionCode === 'VOID_LINE') cashierRow.voidLines += 1;
      if (exceptionCode === 'ERROR_CORRECT') cashierRow.errorCorrects += 1;
      if (transaction.type === 'No-Sale') cashierRow.noSales += 1;
      cashierMap.set(cashierKey, cashierRow);

      if (fuelTxn) {
        const grade = detectFuelGrade(transaction);
        const volume = getFuelVolume(transaction);
        const costPerGallon =
          (transaction.upc ? fuelCostLookup.byUpc.get(transaction.upc) : undefined) ??
          fuelCostLookup.byGrade.get(grade) ??
          0;

        const fuelCost = costPerGallon > 0 ? costPerGallon * volume : 0;
        const fuelProfit = costPerGallon > 0 ? salesValue - fuelCost : 0;

        fuelSales += salesValue;
        fuelVolume += volume;

        const fuelRow = fuelMap.get(grade) || {
          grade,
          dollars: 0,
          volume: 0,
          transactions: 0,
          cost: 0,
          profit: 0,
          knownCostVolume: 0,
        };

        fuelRow.dollars += salesValue;
        fuelRow.volume += volume;
        fuelRow.cost += fuelCost;
        fuelRow.profit += fuelProfit;
        if (costPerGallon > 0) fuelRow.knownCostVolume += volume;
        if (isSale) fuelRow.transactions += 1;
        fuelMap.set(grade, fuelRow);

        return;
      }

      merchandiseSales += salesValue;
      merchandiseUnits += units;

      const categoryName = transaction.category || 'Uncategorized';
      const categoryRow = merchandiseMap.get(categoryName) || {
        name: categoryName,
        sales: 0,
        transactions: 0,
        units: 0,
      };

      categoryRow.sales += salesValue;
      if (isSale) categoryRow.transactions += 1;
      categoryRow.units += units;
      merchandiseMap.set(categoryName, categoryRow);

      if (isSale) {
        const productKey = transaction.upc || transaction.item;
        const productRow = productMap.get(productKey) || {
          name: transaction.item || 'Unknown Item',
          category: transaction.category || 'Uncategorized',
          upc: transaction.upc || '—',
          units: 0,
          sales: 0,
          transactions: 0,
        };

        productRow.units += units;
        productRow.sales += salesValue;
        productRow.transactions += 1;
        productMap.set(productKey, productRow);
      }
    });

    const salesRows = Array.from(salesRowsMap.values())
      .map((row) => ({
        ...row,
        avgTicket: safeAvg(row.sales, row.transactions),
      }))
      .sort(sortByDateAsc);

    const merchandiseRows = Array.from(merchandiseMap.values()).sort((a, b) => b.sales - a.sales);
    const fuelRows = Array.from(fuelMap.values()).sort((a, b) => b.dollars - a.dollars);
    const paymentRows = Array.from(paymentMap.values()).sort((a, b) => b.netAmount - a.netAmount);

    const cashierRows = Array.from(cashierMap.values())
      .map((row) => {
        const riskScore = Math.min(
          100,
          Math.round(
            row.refunds * 8 +
              row.voidTickets * 12 +
              row.voidLines * 7 +
              row.errorCorrects * 6 +
              row.noSales * 4
          )
        );

        return {
          ...row,
          avgTicket: safeAvg(row.sales, row.transactions),
          riskScore,
        };
      })
      .sort((a, b) => b.sales - a.sales);

    const productRows = Array.from(productMap.values()).sort((a, b) => b.sales - a.sales);
    const exceptionRows = exceptions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const avgTicket = safeAvg(netSales, saleCount);
    const bestDay = salesRows.length > 0 ? [...salesRows].sort((a, b) => b.sales - a.sales)[0] : null;
    const bestMerchCategory = merchandiseRows[0] || null;
    const bestFuelGrade = fuelRows[0] || null;
    const bestCashier = cashierRows[0] || null;

    return {
      netSales,
      merchandiseSales,
      fuelSales,
      fuelVolume,
      saleCount,
      refundCount,
      voidCount,
      noSaleCount,
      merchandiseUnits,
      avgTicket,
      salesRows,
      merchandiseRows,
      fuelRows,
      paymentRows,
      cashierRows,
      productRows,
      exceptionRows,
      bestDay,
      bestMerchCategory,
      bestFuelGrade,
      bestCashier,
    };
  }, [filteredTransactions, fuelCostLookup]);

  const selectedCashier = report.cashierRows.find((cashier) => cashier.id === selectedCashierId) || null;

  const selectedCashierTransactions = useMemo(() => {
    if (!selectedCashier) return [];

    return filteredTransactions
      .filter((transaction) => {
        const sameId = transaction.cashierId === selectedCashier.id;
        const sameName = transaction.cashierName === selectedCashier.name;

        return sameId || sameName;
      })
      .filter((transaction) => matchesCashierFilter(transaction, cashierFilter))
      .filter((transaction) => {
        if (!cashierSearch.trim()) return true;

        const query = cashierSearch.toLowerCase();

        return [
          transaction.id,
          transaction.item,
          transaction.category,
          transaction.paymentType,
          getCardNetwork(transaction),
          getExceptionLabel(transaction),
          String(transaction.register),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [filteredTransactions, selectedCashier, cashierFilter, cashierSearch]);

  const departmentPieData = report.merchandiseRows
    .filter((row) => row.sales > 0)
    .slice(0, 6)
    .map((row) => ({
      name: row.name,
      value: Number(row.sales.toFixed(2)),
    }));

  const fuelDollarPieData = report.fuelRows
    .filter((row) => row.dollars > 0)
    .map((row) => ({
      name: row.grade,
      value: Number(row.dollars.toFixed(2)),
    }));

  const totalFuelCost = report.fuelRows.reduce((sum, row) => sum + row.cost, 0);
  const totalFuelProfit = report.fuelRows.reduce((sum, row) => sum + row.profit, 0);

  const handleExport = () => {
    if (activeTab === 'fuel') {
      exportToCsv(
        'storepulse-fuel-profit-report.csv',
        report.fuelRows.map((row) => ({
          Grade: row.grade,
          Dollars: row.dollars.toFixed(2),
          Gallons: row.volume.toFixed(3),
          Cost: row.cost.toFixed(2),
          Profit: row.profit.toFixed(2),
          AvgSell: row.volume > 0 ? (row.dollars / row.volume).toFixed(3) : '0',
          AvgCost: row.knownCostVolume > 0 ? (row.cost / row.knownCostVolume).toFixed(3) : '',
          Transactions: row.transactions,
        }))
      );
      return;
    }

    if (activeTab === 'payments') {
      exportToCsv(
        'storepulse-payment-report.csv',
        report.paymentRows.map((row) => ({
          Name: row.name,
          Count: row.salesCount,
          Sales: row.salesAmount.toFixed(2),
          CountRefunds: row.refundCount,
          Refunds: row.refundAmount.toFixed(2),
          Net: row.netAmount.toFixed(2),
        }))
      );
      return;
    }

    if (activeTab === 'cashiers' && selectedCashier) {
      exportToCsv(
        `storepulse-${selectedCashier.name}-cashier-detail.csv`,
        selectedCashierTransactions.map((transaction) => ({
          Date: transaction.date,
          Time: formatTime(transaction.timestamp),
          Cashier: transaction.cashierName || transaction.cashierId,
          Register: transaction.register,
          Type: transaction.type,
          Reason: getExceptionLabel(transaction),
          Item: transaction.item,
          Amount: transaction.amount.toFixed(2),
          PaymentType: transaction.paymentType,
          CardNetwork: getCardNetwork(transaction),
        }))
      );
      return;
    }

    exportToCsv(
      'storepulse-report-export.csv',
      report.salesRows.map((row) => ({
        Date: row.date,
        Sales: row.sales.toFixed(2),
        Transactions: row.transactions,
        AvgTicket: row.avgTicket.toFixed(2),
      }))
    );
  };

  const resetDates = () => {
    setDatePreset('today');
    setCustomStartDate('');
    setCustomEndDate('');
  };

  if (!loaded) {
    return (
      <DashboardShell>
        <PageLoading />
      </DashboardShell>
    );
  }

  const tabs: { key: ReportTab; label: string; icon: ElementType }[] = [
    { key: 'dayClose', label: 'Day Close', icon: Receipt },
    { key: 'merchandise', label: 'Merchandise', icon: ShoppingBasket },
    { key: 'fuel', label: 'Fuel', icon: Fuel },
    { key: 'payments', label: 'Payments', icon: CreditCard },
    { key: 'cashiers', label: 'Cashiers', icon: UserRound },
  ];

  return (
    <DashboardShell>
      <PageHeader
        title="Reports"
        description="Review day close, merchandise, fuel, payments, cashier activity, and exceptions."
      >
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </PageHeader>

      {cloudError && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{cloudError}</span>
        </div>
      )}

      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Report Range</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {effectiveStart && effectiveEnd
                ? `${formatReportDate(effectiveStart)} to ${formatReportDate(effectiveEnd)}`
                : 'All available transactions'}
              {isDemo ? ' · Demo data' : dataMode === 'cloud' ? ' · Store data' : ''}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[220px_1fr_1fr_auto]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Range</span>
              <select
                value={datePreset}
                onChange={(event) => setDatePreset(event.target.value as DatePreset)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="thisMonth">This Month</option>
                <option value="thisQuarter">This Quarter</option>
                <option value="thisYear">This Year</option>
                <option value="tillDate">Till Date Sales</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Start Date</span>
              <Input
                type="date"
                value={datePreset === 'custom' ? customStartDate : effectiveStart}
                min={allDates.min}
                max={allDates.max || undefined}
                disabled={datePreset !== 'custom'}
                onChange={(event) => setCustomStartDate(event.target.value)}
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">End Date</span>
              <Input
                type="date"
                value={datePreset === 'custom' ? customEndDate : effectiveEnd}
                min={allDates.min}
                max={allDates.max || undefined}
                disabled={datePreset !== 'custom'}
                onChange={(event) => setCustomEndDate(event.target.value)}
              />
            </label>

            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={resetDates}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {filteredTransactions.length === 0 ? (
        <EmptyState
          title="No transactions found"
          description="Try changing the date range or upload transaction data first."
        />
      ) : (
        <>
          <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <TrendingUp className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-foreground">
                {formatCurrency(report.netSales, { compact: true })}
              </p>
              <p className="text-xs text-muted-foreground">Net sales</p>
            </Card>

            <Card className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-2/10 text-chart-2">
                <ShoppingBasket className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-foreground">
                {formatCurrency(report.merchandiseSales, { compact: true })}
              </p>
              <p className="text-xs text-muted-foreground">Merchandise sales</p>
            </Card>

            <Card className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-3/10 text-chart-3">
                <Fuel className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-foreground">
                {formatCurrency(report.fuelSales, { compact: true })}
              </p>
              <p className="text-xs text-muted-foreground">
                Fuel sales · {report.fuelVolume.toFixed(2)} gal
              </p>
            </Card>

            <Card className="p-5">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl',
                  lowStockProducts.length > 0
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-success/10 text-success'
                )}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-foreground">
                {formatNumber(lowStockProducts.length)}
              </p>
              <p className="text-xs text-muted-foreground">Low-stock products</p>
            </Card>
          </div>

          <Card className="mb-5 p-2">
            <div className="grid gap-2 md:grid-cols-5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;

                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </Card>

          {activeTab === 'dayClose' && (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                <Card className="p-5">
                  <h2 className="font-semibold text-foreground">Merchandise Sales Mix</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Department share of merchandise sales.</p>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr] lg:items-center">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={departmentPieData} dataKey="value" nameKey="name" outerRadius={90}>
                          {departmentPieData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>

                    <PieLegend data={departmentPieData} formatter={(value) => formatCurrency(value)} />
                  </div>
                </Card>

                <Card className="p-5">
                  <h2 className="font-semibold text-foreground">Fuel Sales Mix</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Fuel dollars by grade.</p>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr] lg:items-center">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={fuelDollarPieData} dataKey="value" nameKey="name" outerRadius={90}>
                          {fuelDollarPieData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>

                    <PieLegend data={fuelDollarPieData} formatter={(value) => formatCurrency(value)} />
                  </div>
                </Card>
              </div>

              <Card className="p-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-foreground">Sales Trend</h2>
                    <p className="text-sm text-muted-foreground">Net sales by day for the selected range.</p>
                  </div>

                  {report.bestDay && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      Best day: {report.bestDay.label}
                    </span>
                  )}
                </div>

                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={report.salesRows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="salesReportGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />

                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />

                    <YAxis
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) =>
                        `$${Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(0)}k` : value}`
                      }
                    />

                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--popover))',
                        fontSize: 13,
                      }}
                      formatter={(value: number) => [formatCurrency(value), 'Net Sales']}
                    />

                    <Area
                      type="monotone"
                      dataKey="sales"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      fill="url(#salesReportGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          {activeTab === 'merchandise' && (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                <Card className="p-5">
                  <h2 className="font-semibold text-foreground">Department Sales</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Merchandise sales by department.</p>

                  <div className="mt-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={departmentPieData} dataKey="value" nameKey="name" outerRadius={82}>
                          {departmentPieData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>

                    <PieLegend data={departmentPieData} formatter={(value) => formatCurrency(value)} />
                  </div>
                </Card>

                <Card className="overflow-hidden">
                  <div className="border-b border-border p-5">
                    <h2 className="font-semibold text-foreground">Top Products</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Best-selling merchandise products.</p>
                  </div>

                  <div className="divide-y divide-border">
                    {report.productRows.slice(0, 6).map((row, index) => (
                      <div
                        key={`${row.upc}-${row.name}`}
                        className="grid gap-3 p-4 md:grid-cols-[44px_1.4fr_0.8fr_0.7fr] md:items-center"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                          {index + 1}
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{row.name}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{row.category}</p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sales</p>
                          <p className="mt-1 font-semibold text-foreground">{formatCurrency(row.sales)}</p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Units</p>
                          <p className="mt-1 font-semibold text-foreground">{formatNumber(row.units)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="border-b border-border p-5">
                  <h2 className="font-semibold text-foreground">Merchandise Department Report</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Non-fuel sales grouped by department or category.</p>
                </div>

                <div className="divide-y divide-border">
                  {report.merchandiseRows.map((row) => (
                    <div key={row.name} className="grid gap-4 p-5 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:items-center">
                      <div>
                        <p className="font-semibold text-foreground">{row.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{percentOf(row.sales, report.merchandiseSales)} of merchandise sales</p>
                      </div>

                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sales</p>
                        <p className="mt-1 font-semibold text-foreground">{formatCurrency(row.sales)}</p>
                      </div>

                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Units</p>
                        <p className="mt-1 font-semibold text-foreground">{formatNumber(row.units)}</p>
                      </div>

                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transactions</p>
                        <p className="mt-1 font-semibold text-foreground">{formatNumber(row.transactions)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'fuel' && (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                <Card className="p-5">
                  <h2 className="font-semibold text-foreground">Fuel Sales Mix</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Fuel dollars by grade.</p>

                  <div className="mt-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={fuelDollarPieData} dataKey="value" nameKey="name" outerRadius={82}>
                          {fuelDollarPieData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>

                    <PieLegend data={fuelDollarPieData} formatter={(value) => formatCurrency(value)} />
                  </div>
                </Card>

                <Card className="p-5">
                  <h2 className="font-semibold text-foreground">Fuel Profit Summary</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Profit uses fuel cost prices saved in Pricebook.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-xl border border-border bg-secondary/30 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fuel Sales</p>
                      <p className="mt-2 text-xl font-bold text-foreground">{formatCurrency(report.fuelSales)}</p>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/30 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fuel Cost</p>
                      <p className="mt-2 text-xl font-bold text-foreground">{formatCurrency(totalFuelCost)}</p>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/30 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gross Profit</p>
                      <p className="mt-2 text-xl font-bold text-success">{formatCurrency(totalFuelProfit)}</p>
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-muted-foreground">
                    If profit shows low or zero, update fuel cost prices in Pricebook for Regular, Plus, Premium, Diesel, and E10.
                  </p>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="border-b border-border p-5">
                  <h2 className="font-semibold text-foreground">Fuel Report</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Dollars, gallons, cost, and profit grouped by grade.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <ReportTableHeader>
                      <tr>
                        <th className="px-4 py-3">Grade</th>
                        <th className="px-4 py-3">Sales</th>
                        <th className="px-4 py-3">Gallons</th>
                        <th className="px-4 py-3">Avg Sell</th>
                        <th className="px-4 py-3">Avg Cost</th>
                        <th className="px-4 py-3">Cost</th>
                        <th className="px-4 py-3">Profit</th>
                        <th className="px-4 py-3">Transactions</th>
                      </tr>
                    </ReportTableHeader>

                    <tbody className="divide-y divide-border">
                      {report.fuelRows.map((row) => {
                        const avgSell = row.volume > 0 ? row.dollars / row.volume : 0;
                        const avgCost = row.knownCostVolume > 0 ? row.cost / row.knownCostVolume : 0;

                        return (
                          <tr key={row.grade} className="hover:bg-secondary/30">
                            <td className="px-4 py-3 font-semibold text-foreground">{row.grade}</td>
                            <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(row.dollars)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{row.volume.toFixed(3)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{formatCurrency(avgSell)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{avgCost > 0 ? formatCurrency(avgCost) : 'Add cost'}</td>
                            <td className="px-4 py-3 text-muted-foreground">{row.cost > 0 ? formatCurrency(row.cost) : '—'}</td>
                            <td className="px-4 py-3 font-semibold text-success">{row.profit ? formatCurrency(row.profit) : '—'}</td>
                            <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.transactions)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'payments' && (
            <Card className="overflow-hidden">
              <div className="border-b border-border p-5">
                <h2 className="font-semibold text-foreground">Payment Report</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Payment totals grouped by tender type.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <ReportTableHeader>
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Cnt</th>
                      <th className="px-4 py-3">Sales</th>
                      <th className="px-4 py-3">Cnt Refunds</th>
                      <th className="px-4 py-3">Refunds</th>
                      <th className="px-4 py-3">Net</th>
                    </tr>
                  </ReportTableHeader>

                  <tbody className="divide-y divide-border">
                    {report.paymentRows.map((row) => (
                      <tr key={row.name} className="hover:bg-secondary/30">
                        <td className="px-4 py-3 font-semibold text-foreground">{row.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.salesCount)}</td>
                        <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(row.salesAmount)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.refundCount)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatCurrency(row.refundAmount)}</td>
                        <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(row.netAmount)}</td>
                      </tr>
                    ))}

                    <tr className="bg-secondary/30">
                      <td className="px-4 py-3 font-bold text-foreground">TOTAL</td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {formatNumber(report.paymentRows.reduce((sum, row) => sum + row.salesCount, 0))}
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {formatCurrency(report.paymentRows.reduce((sum, row) => sum + row.salesAmount, 0))}
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {formatNumber(report.paymentRows.reduce((sum, row) => sum + row.refundCount, 0))}
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {formatCurrency(report.paymentRows.reduce((sum, row) => sum + row.refundAmount, 0))}
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {formatCurrency(report.paymentRows.reduce((sum, row) => sum + row.netAmount, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeTab === 'cashiers' && (
            <div className="space-y-5">
              <Card className="overflow-hidden">
                <div className="border-b border-border p-5">
                  <h2 className="font-semibold text-foreground">Cashier Report</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Click a cashier to view sales, voids, refunds, no-sales, and risk details.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-left text-sm">
                    <ReportTableHeader>
                      <tr>
                        <th className="px-4 py-3">Cashier</th>
                        <th className="px-4 py-3">Sales</th>
                        <th className="px-4 py-3">Transactions</th>
                        <th className="px-4 py-3">Avg Ticket</th>
                        <th className="px-4 py-3">Refunds</th>
                        <th className="px-4 py-3">Void Tickets</th>
                        <th className="px-4 py-3">Void Lines</th>
                        <th className="px-4 py-3">No Sales</th>
                        <th className="px-4 py-3">Risk</th>
                        <th className="px-4 py-3 text-right">Details</th>
                      </tr>
                    </ReportTableHeader>

                    <tbody className="divide-y divide-border">
                      {report.cashierRows.map((row) => (
                        <tr key={row.id} className="hover:bg-secondary/30">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-foreground">{row.name}</p>
                            <p className="text-xs text-muted-foreground">{row.id}</p>
                          </td>
                          <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(row.sales)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.transactions)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatCurrency(row.avgTicket)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.refunds)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.voidTickets)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.voidLines)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatNumber(row.noSales)}</td>
                          <td className="px-4 py-3">
                            <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', getRiskClass(row.riskScore))}>
                              {getRiskLabel(row.riskScore)} · {row.riskScore}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedCashierId(row.id);
                                setCashierFilter('all');
                                setCashierSearch('');
                              }}
                            >
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          <Card className="mt-5 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <CalendarDays className="h-5 w-5" />
                </div>

                <div>
                  <h2 className="font-semibold text-foreground">Quick Summary</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {report.bestDay
                      ? `${report.bestDay.label} was the strongest day at ${formatCurrency(report.bestDay.sales)}.`
                      : 'No daily sales summary available.'}{' '}
                    {report.bestMerchCategory
                      ? `${report.bestMerchCategory.name} is the top merchandise department.`
                      : ''}{' '}
                    {report.bestFuelGrade
                      ? `${report.bestFuelGrade.grade} is the top fuel grade.`
                      : ''}{' '}
                    {report.bestCashier
                      ? `${report.bestCashier.name} leads cashier sales.`
                      : ''}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm">
                <p className="font-semibold text-foreground">
                  {formatNumber(report.refundCount)} refunds · {formatNumber(report.voidCount)} voids ·{' '}
                  {formatNumber(report.noSaleCount)} no-sales
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Exception activity in selected range</p>
              </div>
            </div>
          </Card>
        </>
      )}

      {selectedCashier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="max-h-[92vh] w-full max-w-6xl overflow-hidden">
            <div className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">{selectedCashier.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cashier detail report · {selectedCashier.id}
                </p>
              </div>

              <Button variant="ghost" size="icon" onClick={() => setSelectedCashierId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[calc(92vh-88px)] overflow-y-auto p-5">
              <div className="mb-5 grid gap-4 md:grid-cols-4">
                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Sales</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(selectedCashier.sales)}</p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transactions</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(selectedCashier.transactions)}</p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exceptions</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">
                    {formatNumber(
                      selectedCashier.refunds +
                        selectedCashier.voidTickets +
                        selectedCashier.voidLines +
                        selectedCashier.errorCorrects +
                        selectedCashier.noSales
                    )}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk Factor</p>
                  <p className="mt-2">
                    <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', getRiskClass(selectedCashier.riskScore))}>
                      {getRiskLabel(selectedCashier.riskScore)} · {selectedCashier.riskScore}
                    </span>
                  </p>
                </Card>
              </div>

              <div className="mb-5 grid gap-4 md:grid-cols-5">
                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Refunds</p>
                  <p className="mt-2 text-xl font-bold text-foreground">{selectedCashier.refunds}</p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Void Tickets</p>
                  <p className="mt-2 text-xl font-bold text-foreground">{selectedCashier.voidTickets}</p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Void Lines</p>
                  <p className="mt-2 text-xl font-bold text-foreground">{selectedCashier.voidLines}</p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Error Correct</p>
                  <p className="mt-2 text-xl font-bold text-foreground">{selectedCashier.errorCorrects}</p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">No Sales</p>
                  <p className="mt-2 text-xl font-bold text-foreground">{selectedCashier.noSales}</p>
                </Card>
              </div>

              <Card className="mb-5 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative w-full lg:max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={cashierSearch}
                      onChange={(event) => setCashierSearch(event.target.value)}
                      placeholder="Search item, register, payment, reason..."
                      className="pl-9"
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
                    {[
                      ['all', 'All'],
                      ['sales', 'Sales'],
                      ['refunds', 'Refunds'],
                      ['voidTickets', 'Void Tickets'],
                      ['voidLines', 'Void Lines'],
                      ['errorCorrect', 'Error Correct'],
                      ['noSales', 'No Sales'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setCashierFilter(value as CashierDetailFilter)}
                        className={cn(
                          'rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                          cashierFilter === value
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="border-b border-border p-5">
                  <h3 className="font-semibold text-foreground">Cashier Activity</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Showing {selectedCashierTransactions.length} matching rows.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1050px] text-left text-sm">
                    <ReportTableHeader>
                      <tr>
                        <th className="px-4 py-3">Date / Time</th>
                        <th className="px-4 py-3">Register</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Reason</th>
                        <th className="px-4 py-3">Item</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Payment</th>
                        <th className="px-4 py-3">Network</th>
                      </tr>
                    </ReportTableHeader>

                    <tbody className="divide-y divide-border">
                      {selectedCashierTransactions.map((transaction) => (
                        <tr key={transaction.id} className="hover:bg-secondary/30">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{formatReportDate(transaction.date)}</p>
                            <p className="text-xs text-muted-foreground">{formatTime(transaction.timestamp)}</p>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{transaction.register}</td>
                          <td className="px-4 py-3 font-semibold text-foreground">{transaction.type}</td>
                          <td className="px-4 py-3 text-muted-foreground">{getExceptionLabel(transaction)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{transaction.item}</td>
                          <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(transaction.amount)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{transaction.paymentType}</td>
                          <td className="px-4 py-3 text-muted-foreground">{getCardNetwork(transaction)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </Card>
        </div>
      )}
    </DashboardShell>
  );
}