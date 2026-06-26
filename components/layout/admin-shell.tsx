'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import {
  BadgeDollarSign,
  BookOpen,
  Boxes,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Store,
  Ticket,
  UserPlus,
  X,
  Zap,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { adminFetch, type AdminMeResponse } from '@/lib/admin-client';

const superadminNavItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, permissions: [] },
  { href: '/admin/signups', label: 'New Signups', icon: UserPlus, permissions: ['demo_requests.view', 'signups.view'] },
  { href: '/admin/stores', label: 'Stores', icon: Store, permissions: ['stores.view', 'stores.search'] },
  { href: '/admin/products', label: 'Products', icon: Boxes, permissions: ['products.view'] },
  { href: '/admin/billing', label: 'Billing', icon: BadgeDollarSign, permissions: ['renewals.view', 'billing.view'] },
  { href: '/admin/support-desk', label: 'Support Desk', icon: Ticket, permissions: ['tickets.view'], supportAccess: true },
  { href: '/admin/approvals', label: 'Approvals', icon: CheckSquare, permissions: ['approvals.view', 'approval.request_action', 'approval.approve_action', 'approvals.manage'] },
  { href: '/admin/knowledge-base', label: 'Knowledge Base', icon: BookOpen, permissions: ['knowledge_base.view'] },
];

function canSeeNavItem(item: (typeof superadminNavItems)[number], me: AdminMeResponse | null) {
  if (item.href === '/admin') return true;
  if (!me) return false;
  if (me.isSuperadmin || me.permissionKeys.includes('platform.superadmin')) return true;
  if (item.supportAccess && (me.profile.supportAccess || me.supportAccess.isActive)) return true;
  return item.permissions.some((permission) => me.permissionKeys.includes(permission));
}

function SuperadminCard({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    await signOut();
    router.push('/login');
  };

  return (
    <div className="space-y-3 border-t border-sidebar-accent p-4">
      <div className="rounded-xl bg-sidebar-accent p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Ticket className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">Staff Console</p>
            <p className="truncate text-xs text-sidebar-foreground/60">
              {user?.email || 'Owner Control'}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={handleLogout}
        disabled={signingOut}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-white disabled:opacity-50"
      >
        {signingOut ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <LogOut className="h-4 w-4 shrink-0" />
        )}
        {signingOut ? 'Signing out…' : 'Log out'}
      </button>
    </div>
  );
}

function AdminNavLink({
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
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white'
      )}
    >
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0',
          active
            ? 'text-primary-foreground'
            : 'text-sidebar-foreground/60 group-hover:text-white'
        )}
      />
      {item.label}
    </Link>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [me, setMe] = useState<AdminMeResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    adminFetch<AdminMeResponse>('/api/admin/me')
      .then((response) => {
        if (mounted) setMe(response);
      })
      .catch(() => {
        if (mounted) setMe(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const navItems = useMemo(
    () => superadminNavItems.filter((item) => canSeeNavItem(item, me)),
    [me]
  );

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin';
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-sidebar-accent bg-sidebar px-4 py-3 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-5 w-5" />
          </div>
          <span className="font-semibold tracking-tight">StorePulse Staff</span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-sidebar-accent"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />

          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-sidebar p-4 animate-slide-up">
            <div className="flex items-center justify-between">
              <Link
                href="/admin"
                className="flex items-center gap-2 text-white"
                onClick={() => setMobileOpen(false)}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                  <Zap className="h-5 w-5" />
                </div>
                <span className="text-lg font-semibold tracking-tight">Staff Console</span>
              </Link>

              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-sidebar-accent"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <nav className="mt-8 flex-1 space-y-1">
              {navItems.map((item) => (
                <AdminNavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </nav>

            <SuperadminCard onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="px-6 py-6">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/30">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>

            <div>
              <p className="text-lg font-semibold tracking-tight text-white">StorePulse AI</p>
              <p className="text-xs text-sidebar-foreground/60">Staff Support Center</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => (
            <AdminNavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>

        <SuperadminCard />
      </aside>
    </>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />

      <div className="lg:pl-72">
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminPageHeader({
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
