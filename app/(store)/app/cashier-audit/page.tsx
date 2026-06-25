'use client';

import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { useStoreData } from '@/lib/store';
import { explainCashierFlag } from '@/lib/insights';
import { formatCurrency, formatNumber, exportToCsv } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Download, ShieldAlert, ShieldCheck, Shield, TrendingUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';

function riskTier(score: number) {
  if (score >= 70) return { label: 'High Risk', color: 'text-destructive', bg: 'bg-destructive/10', icon: ShieldAlert };
  if (score >= 40) return { label: 'Medium Risk', color: 'text-chart-3', bg: 'bg-chart-3/10', icon: Shield };
  return { label: 'Low Risk', color: 'text-success', bg: 'bg-success/10', icon: ShieldCheck };
}

export default function CashierAuditPage() {
  const { cashiers: cashierData } = useStoreData();
  const sorted = [...cashierData].sort((a, b) => b.riskScore - a.riskScore);
  const flaggedForExplanation = sorted.filter((c) => c.riskScore >= 40).sort((a, b) => b.riskScore - a.riskScore);
  const flagged = sorted.filter((c) => c.riskScore >= 40).length;

  const radarData = sorted.slice(0, 6).map((c) => ({
    cashier: c.name.split(' ')[0],
    refunds: c.refundCount,
    voids: c.voidCount,
    noSales: c.noSaleCount,
  }));

  const handleExport = () => {
    exportToCsv(
      'storepulse-cashier-audit.csv',
      sorted.map((c) => ({
        CashierID: c.id,
        Name: c.name,
        Shift: c.shift,
        TotalSales: c.totalSales.toFixed(2),
        Transactions: c.transactionCount,
        Refunds: c.refundCount,
        Voids: c.voidCount,
        NoSales: c.noSaleCount,
        RiskScore: c.riskScore,
        Tier: riskTier(c.riskScore).label,
      }))
    );
  };

  return (
    <DashboardShell>
      <PageHeader title="Cashier Audit" description={`${cashierData.length} cashiers · ${flagged} flagged for review`}>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export
        </Button>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <TrendingUp className="h-5 w-5" />
          </div>
          <p className="mt-3 text-2xl font-bold">{formatCurrency(sorted.reduce((s, c) => s + c.totalSales, 0), { compact: true })}</p>
          <p className="text-xs text-muted-foreground">Total sales across all cashiers</p>
        </Card>
        <Card className="p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-3/10 text-chart-3">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <p className="mt-3 text-2xl font-bold">{formatNumber(sorted.reduce((s, c) => s + c.refundCount, 0))}</p>
          <p className="text-xs text-muted-foreground">Total refunds processed</p>
        </Card>
        <Card className="p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-6/10 text-chart-6">
            <Shield className="h-5 w-5" />
          </div>
          <p className="mt-3 text-2xl font-bold">{formatNumber(sorted.reduce((s, c) => s + c.voidCount, 0))}</p>
          <p className="text-xs text-muted-foreground">Total voids</p>
        </Card>
        <Card className="p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <p className="mt-3 text-2xl font-bold">{flagged}</p>
          <p className="text-xs text-muted-foreground">Cashiers flagged for review</p>
        </Card>
      </div>

      {/* Radar chart + bar chart */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-base font-semibold text-foreground">Anomaly Comparison</h3>
          <p className="text-sm text-muted-foreground">Refunds, voids, and no-sales per cashier</p>
          <ResponsiveContainer width="100%" height={300} className="mt-2">
            <RadarChart data={radarData} outerRadius={100}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="cashier" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
              <Radar name="Refunds" dataKey="refunds" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.4} />
              <Radar name="Voids" dataKey="voids" stroke="hsl(var(--chart-6))" fill="hsl(var(--chart-6))" fillOpacity={0.3} />
              <Radar name="No-Sales" dataKey="noSales" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.2} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', fontSize: 13 }} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="text-base font-semibold text-foreground">Risk Score by Cashier</h3>
          <p className="text-sm text-muted-foreground">Higher score = greater anomaly exposure</p>
          <ResponsiveContainer width="100%" height={300} className="mt-2">
            <BarChart data={sorted} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={100} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', fontSize: 13 }} formatter={(v: number) => [`${v}/100`, 'Risk Score']} />
              <Bar dataKey="riskScore" radius={[0, 4, 4, 0]} barSize={20}>
                {sorted.map((c) => {
                  const tier = riskTier(c.riskScore);
                  const fill = tier.label === 'High Risk' ? 'hsl(var(--destructive))' : tier.label === 'Medium Risk' ? 'hsl(var(--chart-3))' : 'hsl(var(--success))';
                  return <Cell key={c.id} fill={fill} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Cashier table */}
      <Card className="mt-6 overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {['Cashier', 'ID', 'Shift', 'Total Sales', 'Txns', 'Refunds', 'Voids', 'No-Sales', 'Risk Score', 'Tier'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const tier = riskTier(c.riskScore);
                return (
                  <tr key={c.id} className="border-b border-border/60 transition-colors hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold', tier.bg, tier.color)}>
                          {c.name.split(' ').map((n) => n[0]).join('')}
                        </div>
                        <span className="font-medium text-foreground">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.shift}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-foreground">{formatCurrency(c.totalSales)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{c.transactionCount}</td>
                    <td className="px-4 py-3 tabular-nums text-chart-3">{c.refundCount}</td>
                    <td className="px-4 py-3 tabular-nums text-chart-6">{c.voidCount}</td>
                    <td className="px-4 py-3 tabular-nums text-destructive">{c.noSaleCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full', tier.label === 'High Risk' ? 'bg-destructive' : tier.label === 'Medium Risk' ? 'bg-chart-3' : 'bg-success')}
                            style={{ width: `${c.riskScore}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-foreground">{c.riskScore}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tier.bg, tier.color)}>
                        <tier.icon className="h-3 w-3" />
                        {tier.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* AI explanations */}
      {flaggedForExplanation.length > 0 && (
        <Card className="mt-6 p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Why this cashier is flagged</h3>
              <p className="text-sm text-muted-foreground">AI-generated explanations based on refund, void, and no-sale activity</p>
            </div>
          </div>
          <div className="space-y-3">
            {flaggedForExplanation.map((c) => {
              const tier = riskTier(c.riskScore);
              return (
                <div key={c.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold', tier.bg, tier.color)}>
                        {c.name.split(' ').map((n) => n[0]).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.id} · {c.shift} shift · Risk score {c.riskScore}/100</p>
                      </div>
                    </div>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tier.bg, tier.color)}>
                      <tier.icon className="h-3 w-3" />
                      {tier.label}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-foreground">{explainCashierFlag(c, cashierData)}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </DashboardShell>
  );
}

