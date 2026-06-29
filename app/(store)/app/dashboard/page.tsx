'use client';

import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, DollarSign, Receipt, RotateCcw, Ban, CircleSlash, Sigma, TriangleAlert as AlertTriangle, Boxes, ArrowRight, Sparkles, Lightbulb } from 'lucide-react';
import { CHART_COLORS } from '@/lib/mock-data';
import { useAuth } from '@/lib/auth';
import { useStoreData } from '@/lib/store';
import { generateInsights, type Severity } from '@/lib/insights';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

type Stats = ReturnType<typeof useStoreData>['stats'];

function buildCards(stats: Stats) {
  const hasTransactions = stats.totalTransactions > 0;
  const neutralDelta = hasTransactions ? null : '0%';
  return [
    {
      label: 'Total Sales',
      value: formatCurrency(stats.totalSales, { compact: true }),
      sub: formatCurrency(stats.totalSales),
      icon: DollarSign,
      tint: 'bg-chart-4/10 text-chart-4',
      delta: neutralDelta || '+12.4%',
      up: hasTransactions,
    },
    {
      label: 'Total Transactions',
      value: formatNumber(stats.totalTransactions),
      sub: 'across all registers',
      icon: Receipt,
      tint: 'bg-chart-2/10 text-chart-2',
      delta: neutralDelta || '+8.1%',
      up: hasTransactions,
    },
    {
      label: 'Refund Count',
      value: formatNumber(stats.refundCount),
      sub: formatCurrency(-Math.abs(stats.totalSales * 0.018)),
      icon: RotateCcw,
      tint: 'bg-chart-3/10 text-chart-3',
      delta: neutralDelta || '+2.3%',
      up: false,
    },
    {
      label: 'Void Count',
      value: formatNumber(stats.voidCount),
      sub: 'requires review',
      icon: Ban,
      tint: 'bg-chart-6/10 text-chart-6',
      delta: neutralDelta || '+0.8%',
      up: false,
    },
    {
      label: 'No-Sale Count',
      value: formatNumber(stats.noSaleCount),
      sub: 'drawer opens',
      icon: CircleSlash,
      tint: 'bg-destructive/10 text-destructive',
      delta: neutralDelta || '+5.6%',
      up: false,
    },
    {
      label: 'Avg. Transaction Value',
      value: formatCurrency(stats.averageTransactionValue),
      sub: 'per sale',
      icon: Sigma,
      tint: 'bg-primary/10 text-primary',
      delta: neutralDelta || '+3.2%',
      up: hasTransactions,
    },
  ];
}

export default function DashboardPage() {
  const { stats, categoryData, hourData, productData, paymentData, dailyData, meta, isDemo, lowStockProducts, isDemoProducts, productsMeta, loaded } = useStoreData();
  const { user, activeStoreId, storeScope } = useAuth();
  const showAllStoresDashboardMessage = Boolean(user && (storeScope === 'all' || !activeStoreId));
  const cards = buildCards(stats);

  return (
    <DashboardShell>
      {!loaded ? <PageLoading /> : (<>
      <PageHeader title="Dashboard" description={`· ${isDemo ? 'Demo data' : meta.fileName} Â· ${meta.rowCount.toLocaleString()} transactions`}>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <span className="text-muted-foreground">{isDemo ? 'Demo mode' : 'Live upload'} Â· {meta.rowCount.toLocaleString()} txns</span>
        </div>
      </PageHeader>

      {showAllStoresDashboardMessage && (
        <Card className="mb-6 border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold">All Stores dashboard view</h2>
              <p className="mt-1 text-sm text-amber-900">
                All Stores dashboard aggregation is not available yet. Select a specific store to view detailed dashboard metrics.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label} className="p-5 transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.tint}`}>
                <c.icon className="h-5 w-5" />
              </div>
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${
                  c.up ? 'text-success' : 'text-destructive'
                }`}
              >
                {c.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {c.delta}
              </span>
            </div>
            <p className="mt-4 text-2xl font-bold tracking-tight text-foreground">{c.value}</p>
            <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">{c.sub}</p>
          </Card>
        ))}
      </div>

      {/* Low-stock insight */}
      {lowStockProducts.length > 0 && (
        <Card className={cn('mt-6 border-l-4 p-5', lowStockProducts.length > 5 ? 'border-l-chart-3 bg-chart-3/5' : 'border-l-chart-3 bg-chart-3/5')}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-chart-3/15 text-chart-3">
                {lowStockProducts.length > 5 ? <AlertTriangle className="h-5 w-5" /> : <Boxes className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{lowStockProducts.length} products need reordering</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Most urgent: <span className="font-medium text-foreground">{lowStockProducts[0].name}</span> with only {lowStockProducts[0].stock} units left (reorder at {lowStockProducts[0].reorderLevel}).
                  {!isDemoProducts ? ` From uploaded pricebook â€œ${productsMeta.fileName}â€.` : ''}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/pricebook">Manage pricebook <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </Card>
      )}

      {/* Daily sales trend */}
      <Card className="mt-6 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Daily Sales Trend</h3>
            <p className="text-sm text-muted-foreground">Net sales over the last 7 days</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--popover))',
                fontSize: 13,
              }}
              formatter={(value: number) => [formatCurrency(value), 'Sales']}
            />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              fill="url(#salesGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Sales by category + payment split */}
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <h3 className="text-base font-semibold text-foreground">Sales by Category</h3>
          <p className="text-sm text-muted-foreground">Revenue distribution across product categories</p>
          <ResponsiveContainer width="100%" height={280} className="mt-4">
            <BarChart data={categoryData} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
              />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                width={110}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--popover))',
                  fontSize: 13,
                }}
                formatter={(value: number) => [formatCurrency(value), 'Sales']}
              />
              <Bar dataKey="sales" radius={[0, 4, 4, 0]} fill="hsl(var(--primary))" barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h3 className="text-base font-semibold text-foreground">Payment Type Split</h3>
          <p className="text-sm text-muted-foreground">Share of revenue by payment method</p>
          <ResponsiveContainer width="100%" height={280} className="mt-4">
            <PieChart>
              <Pie
                data={paymentData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
              >
                {paymentData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--popover))',
                  fontSize: 13,
                }}
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Sales by hour + top products */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-base font-semibold text-foreground">Sales by Hour</h3>
          <p className="text-sm text-muted-foreground">Revenue across the 24-hour day</p>
          <ResponsiveContainer width="100%" height={280} className="mt-4">
            <BarChart data={hourData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--popover))',
                  fontSize: 13,
                }}
                formatter={(value: number) => [formatCurrency(value), 'Sales']}
              />
              <Bar dataKey="sales" radius={[4, 4, 0, 0]} fill="hsl(var(--chart-2))" barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="text-base font-semibold text-foreground">Top Products</h3>
          <p className="text-sm text-muted-foreground">Best sellers by revenue (7 days)</p>
          <div className="mt-4 space-y-3">
            {productData.map((p, i) => {
              const max = productData[0].sales;
              return (
                <div key={p.name}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
                        style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                      >
                        {i + 1}
                      </span>
                      <span className="font-medium text-foreground">{p.name}</span>
                    </div>
                    <span className="font-semibold text-foreground">{formatCurrency(p.sales)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(p.sales / max) * 100}%`,
                        background: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* AI Insights */}
      <AIInsightsCard />
      </>)}
    </DashboardShell>
  );
}

const severityStyles: Record<Severity, { badge: string; dot: string }> = {
  high: { badge: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  medium: { badge: 'bg-chart-3/10 text-chart-3', dot: 'bg-chart-3' },
  low: { badge: 'bg-success/10 text-success', dot: 'bg-success' },
};

const severityLabel: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function AIInsightsCard() {
  const store = useStoreData();
  const insights = generateInsights(store);
  const top = insights.slice(0, 3);

  return (
    <Card className="mt-6 p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">AI Insights</h3>
          <p className="text-sm text-muted-foreground">Top {top.length} priorities surfaced from your active data</p>
        </div>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-muted-foreground">No insights available yet â€” upload POS data to unlock analysis.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {top.map((insight) => {
            const s = severityStyles[insight.severity];
            return (
              <div key={insight.id} className="flex flex-col rounded-xl border border-border bg-secondary/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', s.badge)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                    {severityLabel[insight.severity]}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{insight.type.replace('-', ' ')}</span>
                </div>
                <h4 className="text-sm font-semibold text-foreground">{insight.title}</h4>
                <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">{insight.description}</p>
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-background p-2.5">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="text-xs leading-relaxed text-foreground">{insight.recommendation}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
