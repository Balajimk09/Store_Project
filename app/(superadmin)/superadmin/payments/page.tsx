'use client';

import { CreditCard } from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Card } from '@/components/ui/card';

export default function SuperadminPaymentsPage() {
  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Payments & Revenue"
        description="Platform billing and revenue controls."
      />
      <Card className="p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-indigo-100 p-3 text-indigo-700">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Payments & Revenue - Coming Soon</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Platform billing, subscriptions, and revenue reporting will live here.
            </p>
          </div>
        </div>
      </Card>
    </SuperadminShell>
  );
}
