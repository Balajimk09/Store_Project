'use client';

import { Package } from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Card } from '@/components/ui/card';

export default function SuperadminProductsPage() {
  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Products"
        description="Platform-wide product oversight for Superadmin."
      />
      <Card className="p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-indigo-100 p-3 text-indigo-700">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Products Oversight</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The dedicated Superadmin product control page will live here. Store-owner product
              management remains in the store app at /app/products.
            </p>
          </div>
        </div>
      </Card>
    </SuperadminShell>
  );
}
