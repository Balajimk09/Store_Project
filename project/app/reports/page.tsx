'use client';

import { useState } from 'react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStoreData } from '@/lib/store';
import { generateInsights, topRecommendations, type Severity } from '@/lib/insights';
import { formatCurrency, formatNumber, exportToCsv, formatDate } from '@/lib/format';
import { Download, Sparkles, FileText, Calendar, TrendingUp, Loader2, AlertTriangle, CheckCircle2, Lightbulb, ArrowRight } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';

type ReportView = 'daily' | 'weekly';

export default function ReportsPage() {
  const { transactions, dailyData: daily, productData: topProductsAll, cashiers: cashierData, stats: dashboardStats, lowStockProducts, isDemo, meta } = useStoreData();
  const [view, setView] = useState<ReportView>('daily');
  const [summary, setSummary] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const weeklyTotal = daily.reduce((s, d) => s + d.sales, 0);
  const weeklyTxns = daily.reduce((s, d) => s + d.transactions, 0);
  const top = topProductsAll.slice(0, 5);
  const topCashiers = [...cashierData].sort((a, b) => b.totalSales - a.totalSales);

  const today = daily[daily.length - 1];
  const todaySales = today?.sales || 0;
  const todayTxns = today?.transactions || 0;

  const handleExport = () => {
    if (view === 'daily') {
      exportToCsv(
        'storepulse-daily-report.csv',
        daily.map((d) => ({
          Date: d.date,
          Day: d.label,
          Sales: d.sales.toFixed(2),
          Transactions: d.transactions,
          AvgValue: (d.sales / (d.transactions || 1)).toFixed(2),
        }))
      );
    } else {
      exportToCsv(
        'storepulse-weekly-summary.csv',
        top.map((p, i) => ({ Rank: i + 1, Product: p.name, Category: p.category, Units: p.units, Revenue: p.sales.toFixed(2) }))
      );
    }
  };

  const generateSummary = () => {
    setGenerating(true);
    setSummary(null);
    setTimeout(() => {
      const peakDay = [...daily].sort((a, b) => b.sales - a.sales)[0];
      const bestProduct = top[0];
      const bestCashier = topCashiers[0];
      const flagged = cashierData.filter((c) => c.riskScore >= 40).length;
      const avgDaily = weeklyTotal / (daily.length || 1);
      const lowStock = lowStockProducts;
      const lowStockLine =
        lowStock.length > 0
          ? ` Inventory alert: ${lowStock.length} product${lowStock.length === 1 ? ' is' : 's are'} at or below reorder level — most urgent is ${lowStock[0].name} (${lowStock[0].stock} units left, reorder at ${lowStock[0].reorderLevel}).`
          : ' Inventory is healthy — no products currently below reorder levels.';

      setSummary(
        `Over the last 7 days, QuickStop #4127 generated ${formatCurrency(
          weeklyTotal
        )} in net sales across ${formatNumber(weeklyTxns)} transactions, averaging ${formatCurrency(
          avgDaily
        )} per day. Your strongest day was ${peakDay?.label ?? '—'} at ${formatCurrency(peakDay?.sales ?? 0)}. The top-performing product was ${
          bestProduct?.name ?? '—'
        }, contributing ${formatCurrency(bestProduct?.sales ?? 0)} in revenue. ${
          bestCashier?.name ?? '—'
        } led cashier sales at ${formatCurrency(bestCashier?.totalSales ?? 0)}. Refunds (${dashboardStats.refundCount}) and voids (${dashboardStats.voidCount
        }) are within acceptable range, but ${flagged} cashier${
          flagged === 1 ? ' was' : 's were'
        } flagged for elevated risk scores — recommend a drawer audit.${lowStockLine}`
      );
      setGenerating(false);
    }, 1200);
  };

  return (
    <DashboardShell>
      <PageHeader title="Reports" description="Daily and weekly performance with AI-generated insights">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </PageHeader>

      {/* Tab switcher */}
      <div className="mb-5 inline-flex rounded-lg border border-border bg-card p-1">
        <button
          onClick={() => setView('daily')}
          className={cn(
            'flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            view === 'daily' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Calendar className="h-4 w-4" /> Daily Sales Report
        </button>
        <button
          onClick={() => setView('weekly')}
          className={cn(
            'flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            view === 'weekly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <FileText className="h-4 w-4" /> Weekly Summary
        </button>
      </div>

      {view === 'daily' ? (
        <>
          {/* Daily summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-bold">{formatCurrency(todaySales, { compact: true })}</p>
              <p className="text-xs text-muted-foreground">Today's sales</p>
            </Card>
            <Card className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-2/10 text-chart-2">
                <Calendar className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-bold">{formatCurrency(weeklyTotal, { compact: true })}</p>
              <p className="text-xs text-muted-foreground">7-day total</p>
            </Card>
            <Card className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-4/10 text-chart-4">
                <FileText className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-bold">{formatNumber(weeklyTxns)}</p>
              <p className="text-xs text-muted-foreground">Transactions (7 days)</p>
            </Card>
            <Card className="p-5">
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', lowStockProducts.length > 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}>
                {lowStockProducts.length > 0 ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <p className="mt-3 text-2xl font-bold">{formatNumber(lowStockProducts.length)}</p>
              <p className="text-xs text-muted-foreground">Low-stock products</p>
            </Card>
          </div>

          {/* Daily chart */}
          <Card className="mt-6 p-6">
            <h3 className="text-base font-semibold text-foreground">Daily Sales Breakdown</h3>
            <ResponsiveContainer width="100%" height={300} className="mt-4">
              <AreaChart data={daily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="reportGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', fontSize: 13 }} formatter={(v: number) => [formatCurrency(v), 'Sales']} />
                <Area type="monotone" dataKey="sales" stroke="hsl(var(--chart-2))" strokeWidth={2.5} fill="url(#reportGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* Daily table */}
          <Card className="mt-6 overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    {['Date', 'Day', 'Net Sales', 'Transactions', 'Avg Value'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d) => (
                    <tr key={d.date} className="border-b border-border/60 hover:bg-secondary/30">
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(d.date)}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{d.label}</td>
                      <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(d.sales)}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{d.transactions}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatCurrency(d.sales / (d.transactions || 1))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-secondary/40 font-semibold">
                    <td className="px-4 py-3 text-foreground" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(weeklyTotal)}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">{formatNumber(weeklyTxns)}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">{formatCurrency(weeklyTotal / weeklyTxns)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <>
          {/* Weekly summary */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground">Top Products (Week)</h3>
              <p className="text-sm text-muted-foreground">Highest revenue contributors</p>
              <div className="mt-4 space-y-3">
                {top.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between border-b border-border/60 pb-3 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.category} · {p.units} units</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold">{formatCurrency(p.sales)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground">Cashier Performance (Week)</h3>
              <p className="text-sm text-muted-foreground">Ranked by total sales</p>
              <div className="mt-4 space-y-3">
                {topCashiers.map((c, i) => (
                  <div key={c.id} className="flex items-center justify-between border-b border-border/60 pb-3 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-chart-2/10 text-xs font-bold text-chart-2">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.shift} shift · {c.transactionCount} txns</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(c.totalSales)}</p>
                      <p className="text-xs text-muted-foreground">Risk {c.riskScore}/100</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {/* AI summary */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-primary/5 to-chart-2/5 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">AI-Generated Summary</h3>
              <p className="text-xs text-muted-foreground">Natural-language analysis of this week's performance</p>
            </div>
          </div>
          <Button size="sm" onClick={generateSummary} disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {summary ? 'Regenerate' : 'Generate AI Summary'}
          </Button>
        </div>
        <div className="p-6">
          {generating ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing sales, cashiers, and inventory data...
            </div>
          ) : summary ? (
            <p className="text-sm leading-relaxed text-foreground">{summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click <strong className="text-foreground">Generate AI Summary</strong> to produce a plain-English analysis of your
              store's weekly performance, including top sellers, cashier highlights, and reorder alerts.
            </p>
          )}
        </div>
      </Card>

      {/* AI Business Summary */}
      <AIBusinessSummaryCard />
    </DashboardShell>
  );
}

const reportSeverityStyles: Record<Severity, { badge: string; dot: string }> = {
  high: { badge: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  medium: { badge: 'bg-chart-3/10 text-chart-3', dot: 'bg-chart-3' },
  low: { badge: 'bg-success/10 text-success', dot: 'bg-success' },
};

function AIBusinessSummaryCard() {
  const store = useStoreData();
  const all = generateInsights(store);
  const recs = topRecommendations(all, 5);
  const display = recs.length > 0 ? recs : all.slice(0, 5);
  const highCount = all.filter((i) => i.severity === 'high').length;
  const mediumCount = all.filter((i) => i.severity === 'medium').length;

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="border-b border-border bg-gradient-to-r from-primary/5 to-chart-2/5 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Lightbulb className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">AI Business Summary</h3>
            <p className="text-xs text-muted-foreground">{all.length} insights generated · {highCount} high · {mediumCount} medium</p>
          </div>
        </div>
      </div>
      <div className="p-6">
        {display.length === 0 ? (
          <p className="text-sm text-muted-foreground">No insights available.</p>
        ) : (
          <ol className="space-y-3">
            {display.map((insight, i) => {
              const s = reportSeverityStyles[insight.severity];
              return (
                <li key={insight.id} className="flex gap-3 rounded-xl border border-border bg-secondary/20 p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', s.badge)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                        {insight.severity}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">{insight.type.replace('-', ' ')}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground">{insight.title}</h4>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{insight.description}</p>
                    <div className="mt-2 flex items-start gap-1.5">
                      <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                      <p className="text-xs leading-relaxed text-foreground">{insight.recommendation}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
