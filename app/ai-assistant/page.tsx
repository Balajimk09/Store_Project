'use client';

import { useState, useRef, useEffect } from 'react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, Send, Bot, User, TrendingUp, ShieldAlert, AlertTriangle, RefreshCw, Percent, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStoreData } from '@/lib/store';
import { generateInsights, explainCashierFlag, type Insight } from '@/lib/insights';
import { salesByCategory } from '@/lib/mock-data';
import { formatCurrency, formatNumber } from '@/lib/format';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  data?: { label: string; value: string }[];
}

type Store = ReturnType<typeof useStoreData>;

const suggestedPrompts = [
  { icon: AlertTriangle, text: "Show today's biggest issue" },
  { icon: RefreshCw, text: 'What should I reorder?' },
  { icon: ShieldAlert, text: 'Which cashier needs review?' },
  { icon: Percent, text: 'Which products have low margin?' },
  { icon: Activity, text: 'Summarize store performance' },
];

function generateAnswer(question: string, store: Store): Message {
  const { transactions, cashiers: cashierData, lowStockProducts } = store;
  const q = question.toLowerCase();
  const today = transactions[0]?.date;
  const allSales = transactions.filter((t) => t.type === 'Sale');

  if (q.includes('top') && q.includes('product')) {
    const top = store.productData.slice(0, 5);
    if (top.length === 0) {
      return { role: 'assistant', content: 'No sales data available to rank products yet. Upload POS data or reset to demo data.' };
    }
    return {
      role: 'assistant',
      content: `Here are your top 5 best-selling products by revenue. Your strongest performer is **${top[0].name}** at ${formatCurrency(
        top[0].sales
      )} across ${top[0].units} units sold. Beverages and snacks continue to drive most of your volume.`,
      data: top.map((p, i) => ({ label: `${i + 1}. ${p.name}`, value: `${formatCurrency(p.sales)} · ${p.units} units` })),
    };
  }

  if (q.includes('refund') && q.includes('cashier')) {
    const sorted = [...cashierData].sort((a, b) => b.refundCount - a.refundCount);
    const top = sorted[0];
    return {
      role: 'assistant',
      content: `**${top.name}** (${top.id}) processed the most refunds with ${top.refundCount} refund transactions — about ${(
        (top.refundCount / top.transactionCount) *
        100
      ).toFixed(1)}% of their sales. Their overall risk score is ${top.riskScore}/100. I recommend a review of their refund patterns, especially during evening shifts.`,
      data: sorted.slice(0, 3).map((c) => ({ label: c.name, value: `${c.refundCount} refunds · Risk ${c.riskScore}` })),
    };
  }

  if (q.includes('reorder') || q.includes('restock') || q.includes('low stock')) {
    const low = lowStockProducts;
    if (low.length === 0) {
      return { role: 'assistant', content: 'Good news — no products are currently at or below their reorder level. All SKUs are comfortably stocked.' };
    }
    return {
      role: 'assistant',
      content: `I found **${low.length} products** at or below their reorder level. Priority items are running critically low and should be reordered today to avoid stockouts. The most urgent is ${low[0].name} with only ${low[0].stock} units left (reorder at ${low[0].reorderLevel}).`,
      data: low.slice(0, 6).map((p) => ({ label: p.name, value: `${p.stock} left · reorder at ${p.reorderLevel}` })),
    };
  }

  if (q.includes('sales drop') || q.includes('why') || q.includes('drop')) {
    const cat = salesByCategory(transactions);
    const beer = cat.find((c) => c.category === 'Beer');
    const fuel = cat.find((c) => c.category === 'Fuel');
    return {
      role: 'assistant',
      content: `Sales dipped on the most recent weekday compared to the weekend peak — this is consistent with your normal traffic pattern. Two factors stand out: (1) Fuel volume dropped slightly due to higher pump prices, and (2) Beer sales were softer midweek. Consider a midweek promotion on high-margin beverages and snacks to lift average ticket size during the dip.`,
      data: [
        { label: 'Fuel revenue', value: fuel ? formatCurrency(fuel.sales) : '—' },
        { label: 'Beer revenue', value: beer ? formatCurrency(beer.sales) : '—' },
        { label: 'Avg. ticket', value: formatCurrency(allSales.reduce((s, t) => s + t.amount, 0) / allSales.length) },
      ],
    };
  }

  if (q.includes('suspicious') || q.includes('fraud') || q.includes('risk')) {
    const flagged = cashierData
      .filter((c) => c.riskScore >= 40)
      .sort((a, b) => b.riskScore - a.riskScore);
    if (flagged.length === 0) {
      return { role: 'assistant', content: 'No cashiers currently flagged for elevated risk. All cashier risk scores are below the 40-point threshold.' };
    }
    return {
      role: 'assistant',
      content: `I flagged **${flagged.length} cashiers** with elevated risk scores. **${flagged[0].name}** has the highest anomaly exposure at ${flagged[0].riskScore}/100, driven by ${flagged[0].voidCount} voids and ${flagged[0].noSaleCount} no-sale events — well above the store average. Their no-sale-to-sale ratio is unusually high for a night shift. I recommend spot-checking drawer counts and reviewing transaction-level void reasoning for this cashier.`,
      data: flagged.map((c) => ({ label: `${c.name} (${c.shift})`, value: `Risk ${c.riskScore} · ${c.noSaleCount} no-sales` })),
    };
  }

  if (q.includes('sale') && (q.includes('today') || q.includes('total'))) {
    const todayTxns = transactions.filter((t) => t.date === today);
    const todaySales = todayTxns.filter((t) => t.type === 'Sale').reduce((s, t) => s + t.amount, 0);
    return {
      role: 'assistant',
      content: `As of the most recent sync, today's net sales total **${formatCurrency(todaySales)}** across ${todayTxns.length} transactions. The average transaction value is ${formatCurrency(
        todaySales / (todayTxns.filter((t) => t.type === 'Sale').length || 1)
      )}. Sales are tracking in line with your weekly average.`,
      data: [
        { label: 'Net sales', value: formatCurrency(todaySales) },
        { label: 'Transactions', value: formatNumber(todayTxns.length) },
      ],
    };
  }

  if (q.includes('biggest issue') || (q.includes('today') && q.includes('issue'))) {
    const insights = generateInsights(store);
    const top: Insight | undefined = insights[0];
    if (!top) {
      return { role: 'assistant', content: 'No major issues detected right now — your store metrics are within healthy ranges.' };
    }
    return {
      role: 'assistant',
      content: `**${top.title}** is your biggest issue right now (severity: ${top.severity}). ${top.description} **Recommendation:** ${top.recommendation}`,
      data: insights.slice(1, 4).map((i) => ({ label: i.title, value: i.severity })),
    };
  }

  if (q.includes('low margin') || q.includes('thin margin')) {
    const low = store.products.filter((p) => {
      const m = ((p.sellPrice - p.costPrice) / Math.max(p.sellPrice, 0.01)) * 100;
      return m < 20;
    });
    if (low.length === 0) {
      return { role: 'assistant', content: 'No products have a margin below 20% — your pricing is healthy across the board.' };
    }
    const worst = [...low].sort((a, b) => ((a.sellPrice - a.costPrice) / a.sellPrice) - ((b.sellPrice - b.costPrice) / b.sellPrice))[0];
    const worstMargin = ((worst.sellPrice - worst.costPrice) / Math.max(worst.sellPrice, 0.01)) * 100;
    return {
      role: 'assistant',
      content: `**${low.length} products** have a margin below 20%. The lowest is **${worst.name}** at ${worstMargin.toFixed(1)}% (cost ${formatCurrency(worst.costPrice)}, sell ${formatCurrency(worst.sellPrice)}). Consider renegotiating cost or raising the price — or discontinuing if it stays unprofitable.`,
      data: low.slice(0, 6).map((p) => ({ label: p.name, value: `${(((p.sellPrice - p.costPrice) / Math.max(p.sellPrice, 0.01)) * 100).toFixed(1)}% margin` })),
    };
  }

  if (q.includes('summarize') && (q.includes('store') || q.includes('performance'))) {
    const insights = generateInsights(store);
    const high = insights.filter((i) => i.severity === 'high');
    const medium = insights.filter((i) => i.severity === 'medium');
    const { stats } = store;
    return {
      role: 'assistant',
      content: `Here's your store performance summary. Net sales: **${formatCurrency(stats.totalSales)}** across **${formatNumber(stats.totalTransactions)}** transactions (avg ticket ${formatCurrency(stats.averageTransactionValue)}). I surfaced **${insights.length} insights** — ${high.length} high severity and ${medium.length} medium severity. The biggest priority is: ${insights[0]?.title || 'no critical issues'} — ${insights[0]?.recommendation || 'continue monitoring.'}`,
      data: insights.slice(0, 5).map((i) => ({ label: i.title, value: i.severity })),
    };
  }

  if ((q.includes('cashier') && q.includes('review')) || (q.includes('cashier') && q.includes('need'))) {
    const flagged = cashierData.filter((c) => c.riskScore >= 40).sort((a, b) => b.riskScore - a.riskScore);
    if (flagged.length === 0) {
      return { role: 'assistant', content: 'No cashiers currently need review — all risk scores are below the 40-point threshold.' };
    }
    const top = flagged[0];
    return {
      role: 'assistant',
      content: explainCashierFlag(top, cashierData),
      data: flagged.map((c) => ({ label: `${c.name} (${c.shift})`, value: `Risk ${c.riskScore}/100` })),
    };
  }

  return {
    role: 'assistant',
    content: `I can answer questions about your store's sales, transactions, cashiers, refunds, voids, and inventory. Try asking about top products, cashier refunds, reorder alerts, sales trends, or suspicious activity. For example: "Which products should I reorder?"`,
  };
}

export default function AIAssistantPage() {
  const store = useStoreData();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'm your StorePulse AI assistant. I can analyze your POS data in real time. Ask me about sales, top products, cashier activity, reorder needs, or anything else about your store.",
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const send = (text: string) => {
    if (!text.trim() || thinking) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setThinking(true);
    // Simulated AI thinking delay
    setTimeout(() => {
      const answer = generateAnswer(text, store);
      setMessages((prev) => [...prev, answer]);
      setThinking(false);
    }, 700 + Math.random() * 600);
  };

  return (
    <DashboardShell>
      <PageHeader title="AI Assistant" description="Ask questions about your store in plain English" />

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Chat */}
        <Card className="flex h-[70vh] flex-col lg:col-span-3">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">StorePulse AI</p>
              <p className="text-xs text-success">● Online · trained on your POS data</p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto scrollbar-thin p-5">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    m.role === 'assistant' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {m.role === 'assistant' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>
                <div className={cn('max-w-[80%]', m.role === 'user' && 'text-right')}>
                  <div
                    className={cn(
                      'inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                      m.role === 'assistant'
                        ? 'rounded-tl-sm bg-secondary text-foreground'
                        : 'rounded-tr-sm bg-primary text-primary-foreground'
                    )}
                  >
                    {m.content.split('**').map((part, j) =>
                      j % 2 === 1 ? <strong key={j} className="font-semibold">{part}</strong> : <span key={j}>{part}</span>
                    )}
                  </div>
                  {m.data && (
                    <div className="mt-2 space-y-1.5 rounded-xl border border-border bg-card p-3 text-left">
                      {m.data.map((d, j) => (
                        <div key={j} className="flex items-center justify-between gap-4 text-xs">
                          <span className="text-muted-foreground">{d.label}</span>
                          <span className="font-semibold text-foreground">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                </div>
                <div className="inline-block rounded-2xl rounded-tl-sm bg-secondary px-4 py-3 text-sm">
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about sales, cashiers, restocking..."
              className="h-11"
            />
            <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={thinking || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </Card>

        {/* Suggested prompts */}
        <div className="lg:col-span-1">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Try asking</h3>
            <p className="mt-1 text-xs text-muted-foreground">Click a prompt to get an instant analysis.</p>
            <div className="mt-4 space-y-2">
              {suggestedPrompts.map((p) => (
                <button
                  key={p.text}
                  onClick={() => send(p.text)}
                  disabled={thinking}
                  className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left text-sm transition-all hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                >
                  <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="text-foreground">{p.text}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="mt-4 p-5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Auto-detected insight</h3>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Register #3 had <strong className="text-foreground">14 no-sale events</strong> during last night's shift — 3× the
              store average. Review drawer reconciliation for cashier <strong className="text-foreground">C006</strong>.
            </p>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
