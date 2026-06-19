'use client';

import { useEffect, useMemo, useState } from 'react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStoreData } from '@/lib/store';
import type { Product } from '@/lib/mock-data';
import { computeMargin } from '@/lib/csv';
import { formatCurrency, exportToCsv } from '@/lib/format';
import { Search, Download, Pencil, Check, X, Package, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PricebookPage() {
  const { products: storeProducts, updateProductPrice, isDemoProducts, productsMeta } = useStoreData();
  const [items, setItems] = useState<Product[]>(storeProducts);

  // Sync local items when the store (localStorage) changes: imports, resets, edits from other tabs
  useEffect(() => {
    setItems(storeProducts);
  }, [storeProducts]);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [editingUpc, setEditingUpc] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ sellPrice: string; costPrice: string }>({ sellPrice: '', costPrice: '' });

  const categoryList = useMemo(
    () => Array.from(new Set(storeProducts.map((p) => p.category))).sort(),
    [storeProducts]
  );

  const filtered = useMemo(() => {
    return items.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.upc.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, category]);

  const startEdit = (p: Product) => {
    setEditingUpc(p.upc);
    setDraft({ sellPrice: p.sellPrice.toFixed(2), costPrice: p.costPrice.toFixed(2) });
  };

  const cancelEdit = () => {
    setEditingUpc(null);
    setDraft({ sellPrice: '', costPrice: '' });
  };

  const saveEdit = (upc: string) => {
    const newSell = parseFloat(draft.sellPrice);
    const newCost = parseFloat(draft.costPrice);
    if (!Number.isNaN(newSell) && !Number.isNaN(newCost)) {
      setItems((prev) =>
        prev.map((p) => (p.upc === upc ? { ...p, sellPrice: newSell, costPrice: newCost } : p))
      );
      updateProductPrice(upc, newCost, newSell);
    }
    cancelEdit();
  };

  const margin = (sell: number, cost: number) => computeMargin(sell, cost);
  const lowStockCount = items.filter((p) => p.stock <= p.reorderLevel).length;
  const status = (p: Product) => (p.stock <= p.reorderLevel ? 'Reorder' : 'In Stock');

  // Reorder priority: ratio of stock to reorder level
  const reorderPriority = (p: Product): 'Critical' | 'Low' | null => {
    if (p.stock > p.reorderLevel) return null;
    const ratio = p.stock / Math.max(p.reorderLevel, 1);
    return ratio <= 0.25 ? 'Critical' : 'Low';
  };

  const handleExport = () => {
    exportToCsv(
      'storepulse-pricebook.csv',
      filtered.map((p) => ({
        UPC: p.upc,
        Item: p.name,
        Category: p.category,
        CostPrice: p.costPrice.toFixed(2),
        SellPrice: p.sellPrice.toFixed(2),
        MarginPct: margin(p.sellPrice, p.costPrice).toFixed(1),
        Stock: p.stock,
        Status: p.stock <= p.reorderLevel ? 'Reorder' : 'In Stock',
      }))
    );
  };

  return (
    <DashboardShell>
      <PageHeader title="Pricebook" description={`${items.length} products · ${lowStockCount} below reorder level · ${isDemoProducts ? 'demo data' : productsMeta.fileName}`}>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by item name or UPC..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="All">All categories</option>
            {categoryList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {['UPC', 'Item', 'Category', 'Cost', 'Sell Price', 'Margin', 'Stock', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isEditing = editingUpc === p.upc;
                const m = margin(p.sellPrice, p.costPrice);
                const lowStock = p.stock <= p.reorderLevel;
                return (
                  <tr key={p.upc} className="border-b border-border/60 transition-colors hover:bg-secondary/30">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.upc}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                          <Package className="h-4 w-4" />
                        </div>
                        <span className="font-medium text-foreground">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={draft.costPrice}
                          onChange={(e) => setDraft({ ...draft, costPrice: e.target.value })}
                          className="h-8 w-20 text-xs"
                        />
                      ) : (
                        formatCurrency(p.costPrice)
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {isEditing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={draft.sellPrice}
                          onChange={(e) => setDraft({ ...draft, sellPrice: e.target.value })}
                          className="h-8 w-20 text-xs"
                        />
                      ) : (
                        formatCurrency(p.sellPrice)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={cn(
                            'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                            m >= 50 ? 'bg-success/10 text-success' : m >= 20 ? 'bg-chart-3/10 text-chart-3' : 'bg-destructive/10 text-destructive'
                          )}
                        >
                          {m.toFixed(1)}%
                        </span>
                        {m < 20 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                            <AlertTriangle className="h-2.5 w-2.5" /> Low margin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{p.stock}</td>
                    <td className="px-4 py-3">
                      {lowStock ? (
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            <AlertTriangle className="h-3 w-3" /> Reorder
                          </span>
                          {(() => {
                            const pr = reorderPriority(p);
                            if (!pr) return null;
                            return (
                              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', pr === 'Critical' ? 'bg-destructive/15 text-destructive' : 'bg-chart-3/10 text-chart-3')}>
                                {pr === 'Critical' ? 'Priority: Critical' : 'Priority: Low'}
                              </span>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="inline-flex rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">In Stock</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-success" onClick={() => saveEdit(p.upc)}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={cancelEdit}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-8 text-muted-foreground hover:text-foreground">
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </DashboardShell>
  );
}
