'use client';

import Link from 'next/link';
import {
  Clock,
  FileText,
  History,
  PackageCheck,
  Receipt,
  Truck,
  UploadCloud,
} from 'lucide-react';
import { DashboardShell, PageHeader } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const invoiceSections = [
  {
    title: 'Overview',
    description: 'A future snapshot for invoice totals, recent receiving, open vendor orders, and items needing review.',
    icon: Receipt,
  },
  {
    title: 'Upload Invoice',
    description: 'A future home for uploading invoice PDFs, images, and delivery CSV files.',
    icon: UploadCloud,
  },
  {
    title: 'Receiving',
    description: 'A future receiving workspace for reviewing invoice lines before updating inventory.',
    icon: PackageCheck,
  },
  {
    title: 'History',
    description: 'A future place to search saved invoices, source files, and received item history.',
    icon: History,
  },
  {
    title: 'Vendor Orders',
    description: 'A future ordering area for vendor-specific reorder lists and purchase order exports.',
    icon: Truck,
  },
];

export default function InvoicesPage() {
  return (
    <DashboardShell>
      <PageHeader
        title="Invoices"
        description="Prepare invoice upload, receiving, history, and vendor order workflows."
      >
        <Button asChild>
          <Link href="/app/products?tab=receiving">
            <PackageCheck className="mr-2 h-4 w-4" />
            Open current Receiving tools
          </Link>
        </Button>
      </PageHeader>

      <Card className="mb-5 border-amber-200 bg-amber-50 p-5 text-amber-950">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h2 className="font-semibold">Invoices module is being prepared</h2>
            <p className="mt-1 text-sm text-amber-900">
              Current receiving, invoice history, and vendor ordering tools are still available in Products until
              migration is complete.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {invoiceSections.map((section) => {
          const Icon = section.icon;

          return (
            <Card key={section.title} className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-4 font-semibold text-foreground">{section.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>
              <div className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                Current tools remain in Products for now.
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-5 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Continue using the current workflow</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the Products Receiving tab while the dedicated Invoices module is prepared.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href="/app/products?tab=receiving">Open current Receiving tools</Link>
          </Button>
        </div>
      </Card>
    </DashboardShell>
  );
}
