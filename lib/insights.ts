import type { Transaction, Cashier, Product } from '@/lib/mock-data';
import { computeMargin } from '@/lib/csv';

export type InsightType =
  | 'sales'
  | 'cashier-risk'
  | 'inventory'
  | 'margin'
  | 'suspicious';

export type Severity = 'low' | 'medium' | 'high';

export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  severity: Severity;
  recommendation: string;
  createdAt: string;
}

export interface InsightsInput {
  transactions: Transaction[];
  cashiers: Cashier[];
  products: Product[];
  stats: {
    totalSales: number;
    totalTransactions: number;
    refundCount: number;
    voidCount: number;
    noSaleCount: number;
    averageTransactionValue: number;
  };
  dailyData: { date: string; label: string; sales: number; transactions: number }[];
  hourData: { hour: string; sales: number; transactions: number }[];
  categoryData: { category: string; sales: number; pct: number }[];
  productData: { name: string; sales: number; units: number; category: string }[];
  lowStockProducts: Product[];
}

const REFUND_THRESHOLD = 5;
const VOID_THRESHOLD = 4;
const NO_SALE_THRESHOLD = 15;
const LOW_MARGIN_THRESHOLD = 20;
const STRONG_MARGIN_THRESHOLD = 50;

function severityRank(s: Severity): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

function riskLevel(cashier: Cashier): 'Low' | 'Medium' | 'High' {
  if (cashier.riskScore >= 70) return 'High';
  if (cashier.riskScore >= 40) return 'Medium';
  return 'Low';
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function explainCashierFlag(cashier: Cashier, allCashiers: Cashier[]): string {
  const reasons: string[] = [];
  const avgRefunds = allCashiers.reduce((s, c) => s + c.refundCount, 0) / (allCashiers.length || 1);
  const avgVoids = allCashiers.reduce((s, c) => s + c.voidCount, 0) / (allCashiers.length || 1);
  const avgNoSales = allCashiers.reduce((s, c) => s + c.noSaleCount, 0) / (allCashiers.length || 1);

  if (cashier.refundCount > avgRefunds * 1.5 && cashier.refundCount > 0) {
    reasons.push(`${cashier.refundCount} refunds (${(cashier.refundCount / Math.max(avgRefunds, 0.1)).toFixed(1)}× the store average)`);
  }
  if (cashier.voidCount > avgVoids * 1.5 && cashier.voidCount > 0) {
    reasons.push(`${cashier.voidCount} voids (${(cashier.voidCount / Math.max(avgVoids, 0.1)).toFixed(1)}× the store average)`);
  }
  if (cashier.noSaleCount > avgNoSales * 1.5 && cashier.noSaleCount > 0) {
    reasons.push(`${cashier.noSaleCount} no-sale drawer opens (${(cashier.noSaleCount / Math.max(avgNoSales, 0.1)).toFixed(1)}× the store average)`);
  }
  const refundRate = cashier.transactionCount ? (cashier.refundCount / cashier.transactionCount) * 100 : 0;
  if (refundRate > 5) {
    reasons.push(`refund rate of ${refundRate.toFixed(1)}% of sales`);
  }

  if (reasons.length === 0) {
    return `${cashier.name} shows normal activity with a risk score of ${cashier.riskScore}/100 — no anomalies detected.`;
  }
  return `${cashier.name} is flagged (${riskLevel(cashier)} risk, score ${cashier.riskScore}/100) due to ${reasons.join(', ')}. Recommend reviewing transaction-level detail and reconciling drawer counts during their ${cashier.shift.toLowerCase()} shift.`;
}

export function generateInsights(input: InsightsInput): Insight[] {
  const insights: Insight[] = [];
  const now = new Date().toISOString();
  const { transactions, cashiers, products, stats, dailyData, hourData, categoryData, productData, lowStockProducts } = input;

  // ---------- 1. Sales Performance ----------
  // Total sales trend
  if (dailyData.length >= 2) {
    const sorted = [...dailyData].sort((a, b) => a.date.localeCompare(b.date));
    const recent = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const change = prev.sales > 0 ? ((recent.sales - prev.sales) / prev.sales) * 100 : 0;
    const up = change >= 0;
    insights.push({
      id: 'sales-trend',
      type: 'sales',
      title: up ? 'Sales trending up' : 'Sales trending down',
      description: `Net sales ${up ? 'increased' : 'decreased'} ${Math.abs(change).toFixed(1)}% compared to the previous day (${recent.label}: ${fmtCurrency(recent.sales)} vs ${prev.label}: ${fmtCurrency(prev.sales)}).`,
      severity: up ? 'low' : change < -15 ? 'high' : 'medium',
      recommendation: up
        ? 'Momentum is positive — consider reinforcing top-performing categories with cross-promotions.'
        : 'Review the weakest-performing day and consider a targeted promotion on high-margin categories to recover the dip.',
      createdAt: now,
    });
  }

  // Best sales hour
  if (hourData.length) {
    const best = [...hourData].sort((a, b) => b.sales - a.sales)[0];
    insights.push({
      id: 'sales-best-hour',
      type: 'sales',
      title: 'Peak sales hour identified',
      description: `${best.hour} is your highest-grossing hour at ${fmtCurrency(best.sales)} (${best.transactions} transactions).`,
      severity: 'low',
      recommendation: 'Ensure peak hours are fully staffed and high-impulse items are restocked before this window.',
      createdAt: now,
    });
  }

  // Best category
  if (categoryData.length) {
    const best = categoryData[0];
    insights.push({
      id: 'sales-best-category',
      type: 'sales',
      title: 'Top revenue category',
      description: `${best.category} leads revenue at ${fmtCurrency(best.sales)} (${best.pct}% of total sales).`,
      severity: 'low',
      recommendation: `Protect ${best.category} availability and negotiate vendor pricing to protect margin on your biggest category.`,
      createdAt: now,
    });
  }

  // Average transaction value
  if (stats.averageTransactionValue > 0) {
    insights.push({
      id: 'sales-atv',
      type: 'sales',
      title: 'Average transaction value',
      description: `Average ticket is ${fmtCurrency(stats.averageTransactionValue)} across ${stats.totalTransactions.toLocaleString()} transactions.`,
      severity: 'low',
      recommendation: 'If below target, train cashiers on suggestive selling for high-margin add-ons at the register.',
      createdAt: now,
    });
  }

  // Top-selling products
  if (productData.length) {
    const top3 = productData.slice(0, 3);
    insights.push({
      id: 'sales-top-products',
      type: 'sales',
      title: 'Top-selling products',
      description: `Your best sellers are ${top3.map((p) => `${p.name} (${fmtCurrency(p.sales)}, ${p.units} units)`).join('; ')}.`,
      severity: 'low',
      recommendation: 'Never stock out of these — set higher reorder levels and prioritize restocking them.',
      createdAt: now,
    });
  }

  // ---------- 2. Cashier Risk ----------
  const flaggedCashiers = cashiers
    .filter((c) => c.riskScore >= 40)
    .sort((a, b) => b.riskScore - a.riskScore);

  for (const c of flaggedCashiers) {
    const level = riskLevel(c);
    insights.push({
      id: `cashier-risk-${c.id}`,
      type: 'cashier-risk',
      title: `${c.name} flagged as ${level} risk`,
      description: explainCashierFlag(c, cashiers),
      severity: level === 'High' ? 'high' : level === 'Medium' ? 'medium' : 'low',
      recommendation: `Spot-check drawer counts for ${c.name}, review void/refund reasoning, and consider a coaching conversation during their ${c.shift.toLowerCase()} shift.`,
      createdAt: now,
    });
  }

  // ---------- 3. Inventory / Reorder ----------
  if (lowStockProducts.length > 0) {
    const priority = lowStockProducts[0];
    const ratio = priority.stock / Math.max(priority.reorderLevel, 1);
    insights.push({
      id: 'inventory-reorder',
      type: 'inventory',
      title: `${lowStockProducts.length} products need reordering`,
      description: `${lowStockProducts.length} products are at or below their reorder level. Highest priority: ${priority.name} with only ${priority.stock} units left (reorder at ${priority.reorderLevel}, ${ratio <= 0.25 ? 'critical' : 'low'}).`,
      severity: lowStockProducts.length > 5 ? 'high' : lowStockProducts.length > 2 ? 'medium' : 'low',
      recommendation: `Place a reorder for ${priority.name} today and review the full low-stock list. Consider raising reorder levels for fast-movers.`,
      createdAt: now,
    });
  } else {
    insights.push({
      id: 'inventory-healthy',
      type: 'inventory',
      title: 'Inventory levels healthy',
      description: 'No products are currently at or below their reorder level.',
      severity: 'low',
      recommendation: 'Continue routine stock checks; no immediate action needed.',
      createdAt: now,
    });
  }

  // ---------- 4. Product Margin ----------
  const lowMargin = products.filter((p) => computeMargin(p.sellPrice, p.costPrice) < LOW_MARGIN_THRESHOLD);
  const strongMargin = products.filter((p) => computeMargin(p.sellPrice, p.costPrice) >= STRONG_MARGIN_THRESHOLD);

  if (lowMargin.length > 0) {
    const worst = [...lowMargin].sort((a, b) => computeMargin(a.sellPrice, a.costPrice) - computeMargin(b.sellPrice, b.costPrice))[0];
    const worstMargin = computeMargin(worst.sellPrice, worst.costPrice);
    insights.push({
      id: 'margin-low',
      type: 'margin',
      title: `${lowMargin.length} products have thin margins (<${LOW_MARGIN_THRESHOLD}%)`,
      description: `${lowMargin.length} product${lowMargin.length === 1 ? '' : 's'} have a margin below ${LOW_MARGIN_THRESHOLD}%. Lowest is ${worst.name} at ${worstMargin}% (cost ${fmtCurrency(worst.costPrice)}, sell ${fmtCurrency(worst.sellPrice)}).`,
      severity: worstMargin < 10 ? 'high' : 'medium',
      recommendation: `Review pricing for ${worst.name} and other low-margin items — renegotiate cost, raise price, or discontinue if unprofitable.`,
      createdAt: now,
    });
  }

  if (strongMargin.length > 0) {
    insights.push({
      id: 'margin-strong',
      type: 'margin',
      title: `${strongMargin.length} products have strong margins (≥${STRONG_MARGIN_THRESHOLD}%)`,
      description: `${strongMargin.length} products carry margins of ${STRONG_MARGIN_THRESHOLD}% or higher — these are your most profitable SKUs.`,
      severity: 'low',
      recommendation: 'Protect availability of high-margin items and feature them in cross-sell promotions.',
      createdAt: now,
    });
  }

  // ---------- 5. Suspicious Activity ----------
  const totalRefunds = stats.refundCount;
  const refundRate = stats.totalTransactions ? (totalRefunds / stats.totalTransactions) * 100 : 0;
  if (refundRate > 7 || totalRefunds > REFUND_THRESHOLD * 3) {
    insights.push({
      id: 'suspicious-refunds',
      type: 'suspicious',
      title: 'Refund volume elevated',
      description: `${totalRefunds} refunds processed (${refundRate.toFixed(1)}% of all transactions) — above the 7% healthy threshold.`,
      severity: refundRate > 12 ? 'high' : 'medium',
      recommendation: 'Audit refund receipts, especially in categories prone to abuse, and require manager approval above a set amount.',
      createdAt: now,
    });
  }

  if (stats.voidCount > VOID_THRESHOLD * 3) {
    insights.push({
      id: 'suspicious-voids',
      type: 'suspicious',
      title: 'Void count above threshold',
      description: `${stats.voidCount} voids recorded across all registers — above the normal range.`,
      severity: stats.voidCount > VOID_THRESHOLD * 6 ? 'high' : 'medium',
      recommendation: 'Investigate the most frequent void reasons and which cashier/register the voids cluster on.',
      createdAt: now,
    });
  }

  if (stats.noSaleCount > NO_SALE_THRESHOLD * 2) {
    insights.push({
      id: 'suspicious-no-sales',
      type: 'suspicious',
      title: 'No-sale drawer opens elevated',
      description: `${stats.noSaleCount} no-sale events recorded — drawer opens without a sale are a common shrink indicator.`,
      severity: stats.noSaleCount > NO_SALE_THRESHOLD * 4 ? 'high' : 'medium',
      recommendation: 'Require a reason code for every no-sale and review the register with the highest no-sale count.',
      createdAt: now,
    });
  }

  // Concentration: refunds/voids under one cashier
  if (cashiers.length > 0) {
    const totalRefVoids = cashiers.reduce((s, c) => s + c.refundCount + c.voidCount, 0);
    const top = [...cashiers].sort((a, b) => b.refundCount + b.voidCount - (a.refundCount + a.voidCount))[0];
    const topShare = totalRefVoids > 0 ? ((top.refundCount + top.voidCount) / totalRefVoids) * 100 : 0;
    if (topShare >= 40 && (top.refundCount + top.voidCount) >= 5) {
      insights.push({
        id: 'suspicious-concentration',
        type: 'suspicious',
        title: `Refunds/voids concentrated under ${top.name}`,
        description: `${top.name} accounts for ${topShare.toFixed(0)}% of all refunds and voids (${top.refundCount} refunds, ${top.voidCount} voids) — concentration above the 40% threshold.`,
        severity: topShare >= 60 ? 'high' : 'medium',
        recommendation: `Review ${top.name}'s transaction-level history and require secondary approval for their refunds/voids.`,
        createdAt: now,
      });
    }
  }

  // Large discounts (refunds with large negative amounts)
  const largeRefunds = transactions
    .filter((t) => t.type === 'Refund' && Math.abs(t.amount) >= 50)
    .sort((a, b) => a.amount - b.amount);
  if (largeRefunds.length > 0) {
    const biggest = largeRefunds[0];
    insights.push({
      id: 'suspicious-large-discount',
      type: 'suspicious',
      title: 'Large refund detected',
      description: `${largeRefunds.length} large refund${largeRefunds.length === 1 ? '' : 's'} (≥$50) processed. Largest was ${fmtCurrency(biggest.amount)} on ${biggest.item}, cashier ${biggest.cashierName}.`,
      severity: 'high',
      recommendation: 'Verify the original sale receipt and require manager sign-off for refunds above $50.',
      createdAt: now,
    });
  }

  // Sort by severity (high first), then keep stable order
  return insights.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

export function topInsights(insights: Insight[], n: number): Insight[] {
  return insights.slice(0, n);
}

export function topRecommendations(insights: Insight[], n: number): Insight[] {
  return insights
    .filter((i) => i.severity !== 'low')
    .slice(0, n);
}
