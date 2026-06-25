'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import {
  BarChart3,
  Building2,
  Crown,
  CreditCard,
  FileClock,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  Store,
  TicketCheck,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adminFetch, type AdminMeResponse } from '@/lib/admin-client';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const superadminNavItems = [
  { href: '/superadmin', label: 'Overview', icon: LayoutDashboard },
  { href: '/superadmin/stores', label: 'Stores', icon: Store },
  { href: '/superadmin/products', label: 'Products', icon: Package },
  { href: '/superadmin/vendors', label: 'Vendors', icon: Truck },
  { href: '/superadmin/users', label: 'Users', icon: Users },
  { href: '/superadmin/support-oversight', label: 'Support Oversight', icon: TicketCheck },
  { href: '/superadmin/audit-logs', label: 'Audit Logs', icon: FileClock },
  { href: '/superadmin/payments', label: 'Payments & Revenue', icon: CreditCard },
  { href: '/superadmin/marketing-insights', label: 'Marketing Insights', icon: BarChart3 },
  { href: '/superadmin/settings', label: 'Settings', icon: Settings },
];

function SuperadminNavLink({
  item,
  active,
  onClick,
}: {
  item: { href: string; label: string; icon: ElementType };
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
        active
          ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/30'
          : 'text-indigo-100/70 hover:bg-indigo-950/70 hover:text-white'
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {item.label}
    </Link>
  );
}

function SuperadminCard() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    await signOut();
    router.push('/login');
  };

  return (
    <div className="space-y-3 border-t border-indigo-900/70 p-4">
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/80 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-400/15 text-indigo-200">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">SUPERADMIN</p>
            <p className="truncate text-xs text-indigo-100/60">{user?.email || 'Platform owner'}</p>
          </div>
        </div>
      </div>

      <button
        onClick={handleLogout}
        disabled={signingOut}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-indigo-100/60 transition-colors hover:bg-indigo-950/70 hover:text-white disabled:opacity-50"
      >
        {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        {signingOut ? 'Signing out...' : 'Log out'}
      </button>
    </div>
  );
}

export function SuperadminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  const isActive = (href: string) => {
    if (href === '/superadmin') return pathname === '/superadmin';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const sidebar = (
    <>
      <div className="px-6 py-6">
        <Link href="/superadmin" className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 shadow-lg shadow-indigo-500/30">
            <Crown className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight text-white">StorePulse AI</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200/80">Superadmin</p>
          </div>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {superadminNavItems.map((item) => (
          <SuperadminNavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </nav>
      <SuperadminCard />
    </>
  );

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const me = await adminFetch<AdminMeResponse>('/api/admin/me');
        if (!mounted) return;
        if (!me.isSuperadmin) {
          router.replace('/admin');
          return;
        }
      } catch {
        if (mounted) router.replace('/login');
        return;
      } finally {
        if (mounted) setCheckingAccess(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  if (checkingAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Checking Superadmin access...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-indigo-950 bg-[#11102a] px-4 py-3 lg:hidden">
        <Link href="/superadmin" className="flex items-center gap-2 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500">
            <Crown className="h-5 w-5" />
          </div>
          <span className="font-semibold tracking-tight">StorePulse Superadmin</span>
        </Link>
        <Button variant="ghost" size="icon" className="text-white hover:bg-indigo-950" onClick={() => setMobileOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-[#11102a] text-indigo-50">
            <div className="flex justify-end p-3">
              <Button variant="ghost" size="icon" className="text-white hover:bg-indigo-950" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col bg-[#11102a] text-indigo-50 lg:flex">
        {sidebar}
      </aside>

      <div className="lg:pl-72">
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function SuperadminPageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
