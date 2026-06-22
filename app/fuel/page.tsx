'use client';

import { useMemo, useState } from 'react';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStoreData } from '@/lib/store';
import type { Product } from '@/lib/mock-data';
import { formatCurrency, formatNumber } from '@/lib/format';
import {
  CheckCircle2,
  CircleAlert,
  Fuel,
  Loader2,
  Save,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';

function isFuelProduct(product: Product) {
  const text = `${product.department || ''} ${product.category || ''} ${product.name || ''}`.toLowerCase();

  return (
    text.includes('fuel') ||
    text.includes('gas') ||
    text.includes('regular') ||
    text.includes('unleaded') ||
    text.includes('diesel') ||
    text.includes('dsl') ||
    text.includes('e10') ||
    text.includes('plus') ||
    text.includes('premium') ||
    text.includes('prem')
  );
}

function fuelGradeName(product: Product) {
  const text = `${product.name} ${product.category} ${product.department}`.toLowerCase();

  if (text.includes('diesel') || text.includes('dsl')) return 'Diesel';
  if (text.includes('e10')) return 'E10';
  if (text.includes('premium') || text.includes('prem')) return 'Premium';
  if (text.includes('plus')) return 'Plus';
  if (text.includes('regular') || text.includes('unleaded')) return 'Regular';

  return product.name;
}

type FuelEdit = {
  costPrice: string;
  sellPrice: string;
  stock: string;
  reorderLevel: string;
};

export default function FuelPage() {
  const { products, loaded, updateProduct, cloudError } = useStoreData();

  const fuelProducts = useMemo(() => {
    return products
      .filter(isFuelProduct)
      .sort((a, b) => fuelGradeName(a).localeCompare(fuelGradeName(b)));
  }, [products]);

  const [editing, setEditing] = useState<Record<string, FuelEdit>>({});
  const [savingUpc, setSavingUpc] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const getEdit = (product: Product): FuelEdit => {
    return (
      editing[product.upc] || {
        costPrice: String(product.costPrice || 0),
        sellPrice: String(product.sellPrice || 0),
        stock: String(product.stock || 0),
        reorderLevel: String(product.reorderLevel || 0),
      }
    );
  };

  const setEdit = (upc: string, patch: Partial<FuelEdit>) => {
    setEditing((current) => ({
      ...current,
      [upc]: {
        ...(current[upc] || {
          costPrice: '',
          sellPrice: '',
          stock: '',
          reorderLevel: '',
        }),
        ...patch,
      },
    }));
  };

  const saveFuelProduct = async (product: Product) => {
    const edit = getEdit(product);

    const costPrice = Number(edit.costPrice);
    const sellPrice = Number(edit.sellPrice);
    const stock = Number(edit.stock);
    const reorderLevel = Number(edit.reorderLevel);

    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setPageError('Cost price must be valid.');
      return;
    }

    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      setPageError('Selling price must be valid.');
      return;
    }

    setSavingUpc(product.upc);
    setPageError(null);
    setMessage(null);

    const result = await updateProduct({
      ...product,
      costPrice,
      sellPrice,
      stock: Number.isFinite(stock) ? stock : product.stock,
      reorderLevel: Number.isFinite(reorderLevel) ? reorderLevel : product.reorderLevel,
      category: product.category || 'Fuel',
      department: product.department || 'Fuel',
      taxCategory: product.taxCategory || 'fuel',
      taxable: false,
      ebtEligible: false,
    });

    setSavingUpc(null);

    if (result.error) {
      setPageError(result.error);
      return;
    }

    setMessage(`${fuelGradeName(product)} updated.`);
  };

  if (!loaded) {
    return (
      <DashboardShell>
        <PageLoading />
      </DashboardShell>
    );
  }

  const totalFuelValue = fuelProducts.reduce(
    (sum, product) => sum + product.stock * product.costPrice,
    0
  );

  const lowFuelProducts = fuelProducts.filter((product) => product.stock <= product.reorderLevel);

  return (
    <DashboardShell>
      <PageHeader
        title="Fuel"
        description="Update fuel buying cost, selling price, inventory level, and reorder settings."
      />

      {(cloudError || pageError) && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pageError || cloudError}</span>
        </div>
      )}

      {message && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Fuel className="h-5 w-5" />
          </div>
          <p className="mt-3 text-2xl font-bold text-foreground">{fuelProducts.length}</p>
          <p className="text-xs text-muted-foreground">Fuel grades</p>
        </Card>

        <Card className="p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-2/10 text-chart-2">
            <TrendingUp className="h-5 w-5" />
          </div>
          <p className="mt-3 text-2xl font-bold text-foreground">
            {formatCurrency(totalFuelValue, { compact: true })}
          </p>
          <p className="text-xs text-muted-foreground">Estimated fuel inventory cost</p>
        </Card>

        <Card className="p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-3/10 text-chart-3">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <p className="mt-3 text-2xl font-bold text-foreground">
            {formatNumber(lowFuelProducts.length)}
          </p>
          <p className="text-xs text-muted-foreground">Grades near reorder level</p>
        </Card>
      </div>

      {fuelProducts.length === 0 ? (
        <Card className="border-dashed p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <Fuel className="h-5 w-5" />
          </div>
          <h3 className="mt-4 font-semibold text-foreground">No fuel products found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add Regular, Plus, Premium, Diesel, or E10 products in Pricebook first.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <h2 className="font-semibold text-foreground">Fuel Pricing and Reorder Setup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Reports use these cost prices to calculate fuel gross profit.
            </p>
          </div>

          <div className="divide-y divide-border">
            {fuelProducts.map((product) => {
              const edit = getEdit(product);
              const margin = Number(edit.sellPrice) - Number(edit.costPrice);
              const saving = savingUpc === product.upc;

              return (
                <div
                  key={product.upc}
                  className="grid gap-4 p-5 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.8fr_auto] xl:items-end"
                >
                  <div>
                    <p className="font-semibold text-foreground">{fuelGradeName(product)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {product.name} · UPC {product.upc}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Current margin per gallon:{' '}
                      <span className="font-semibold text-foreground">
                        {Number.isFinite(margin) ? formatCurrency(margin) : '$0.00'}
                      </span>
                    </p>
                  </div>

                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Buy Cost</span>
                    <Input
                      type="number"
                      step="0.001"
                      value={edit.costPrice}
                      onChange={(event) => setEdit(product.upc, { costPrice: event.target.value })}
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Sell Price</span>
                    <Input
                      type="number"
                      step="0.001"
                      value={edit.sellPrice}
                      onChange={(event) => setEdit(product.upc, { sellPrice: event.target.value })}
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Gallons On Hand</span>
                    <Input
                      type="number"
                      step="0.001"
                      value={edit.stock}
                      onChange={(event) => setEdit(product.upc, { stock: event.target.value })}
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Reorder Level</span>
                    <Input
                      type="number"
                      step="0.001"
                      value={edit.reorderLevel}
                      onChange={(event) => setEdit(product.upc, { reorderLevel: event.target.value })}
                    />
                  </label>

                  <div className="flex gap-2">
                    <Button onClick={() => saveFuelProduct(product)} disabled={saving}>
                      {saving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save
                    </Button>

                    <Button variant="outline" type="button">
                      Order
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </DashboardShell>
  );
}