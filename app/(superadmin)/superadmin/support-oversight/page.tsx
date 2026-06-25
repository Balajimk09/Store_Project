'use client';

import Link from 'next/link';
import { BarChart3, ExternalLink } from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function SuperadminSupportOversightPage() {
  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Support Oversight"
        description="Superadmin visibility into support operations, separate from the working support console."
      >
        <Button asChild>
          <Link href="/admin/support-desk">
            Open Support Desk
            <ExternalLink className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </SuperadminPageHeader>
      <Card className="p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-indigo-100 p-3 text-indigo-700">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Support Summary</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This page is for platform-level support oversight. Active ticket triage, replies,
              verification, and support actions remain in the staff console at /admin/support-desk.
            </p>
          </div>
        </div>
      </Card>
    </SuperadminShell>
  );
}
