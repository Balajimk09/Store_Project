'use client';

import { BarChart3 } from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Card } from '@/components/ui/card';

export default function SuperadminMarketingInsightsPage() {
  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Marketing Insights"
        description="Platform marketing and performance insights."
      />
      <Card className="p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-indigo-100 p-3 text-indigo-700">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Marketing Insights - Coming Soon</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Marketing attribution, adoption, and performance insights will live here.
            </p>
          </div>
        </div>
      </Card>
    </SuperadminShell>
  );
}
