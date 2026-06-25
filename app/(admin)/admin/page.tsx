'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BookOpen, ClipboardList, Headphones, Loader2, Phone, ShieldCheck } from 'lucide-react';
import { AdminPageHeader, AdminShell } from '@/components/layout/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { adminFetch } from '@/lib/admin-client';

type PermissionResponse = {
  permissions: string[];
  role_code: string | null;
  is_superadmin: boolean;
};

const cards = [
  {
    title: 'Support Desk',
    description: 'Open the support operations console.',
    href: '/admin/support-desk',
    icon: Headphones,
  },
  {
    title: 'My Assigned Work',
    description: 'Review assigned tickets and follow-ups.',
    href: '/admin/support-desk',
    icon: ClipboardList,
  },
  {
    title: 'Knowledge Base',
    description: 'Find support articles and canned guidance.',
    href: '/admin/support-desk',
    icon: BookOpen,
  },
  {
    title: 'Call Logs',
    description: 'Log and review support calls.',
    href: '/admin/support-desk',
    icon: Phone,
  },
];

export default function StaffDashboardPage() {
  const [permissions, setPermissions] = useState<PermissionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await adminFetch<PermissionResponse>('/api/admin/support/me/permissions');
        setPermissions(response);
      } catch {
        setPermissions(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AdminShell>
      <AdminPageHeader
        title="Staff Dashboard"
        description="Welcome to StorePulse Support Center"
      />

      {loading ? (
        <Card className="mb-6 flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading staff access...
        </Card>
      ) : permissions?.is_superadmin ? (
        <Card className="mb-6 border-indigo-200 bg-indigo-50 p-4 text-indigo-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">You are logged in as Superadmin.</p>
              <p className="mt-1 text-sm">Full platform controls are available at /superadmin.</p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/superadmin">Open Superadmin</Link>
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.title} href={card.href}>
              <Card className="h-full p-5 transition hover:border-primary/40 hover:shadow-sm">
                <div className="rounded-lg bg-primary/10 p-3 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 font-semibold text-foreground">{card.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
              </Card>
            </Link>
          );
        })}
      </div>
    </AdminShell>
  );
}
