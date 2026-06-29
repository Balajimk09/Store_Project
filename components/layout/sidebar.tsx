'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ElementType, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Receipt,
  Package,
  FileText,
  ShieldAlert,
  Sparkles,
  FileBarChart,
  Menu,
  X,
  Zap,
  Store,
  LogOut,
  Loader2,
  Settings,
  Fuel,
  LifeBuoy,
  User,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

const navItems = [
  { href: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/transactions', label: 'Live Transactions', icon: Receipt },
  { href: '/app/products', label: 'Products', icon: Package },
  { href: '/app/invoices', label: 'Invoices', icon: FileText },
  { href: '/app/fuel', label: 'Fuel', icon: Fuel },
  { href: '/app/store-settings', label: 'Store Settings', icon: Settings },
  { href: '/app/cashier-audit', label: 'Cashier Audit', icon: ShieldAlert },
  { href: '/app/ai-assistant', label: 'AI Assistant', icon: Sparkles },
  { href: '/app/reports', label: 'Reports', icon: FileBarChart },
  { href: '/app/support', label: 'Support', icon: LifeBuoy },
  { href: '/app/account', label: 'Account', icon: User },
];

function StoreCard({ onNavigate }: { onNavigate?: () => void }) {
  const { user, store, stores, storeScope, activeStoreId, setActiveStoreId, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    await signOut();
    router.push('/login');
  };

  const setupComplete =
    !!store?.store_name?.trim() &&
    !!(store.store_address || store.address_line1)?.trim() &&
    !!store?.city?.trim() &&
    !!store?.state?.trim() &&
    !!store?.zip_code?.trim() &&
    !!store?.phone_number?.trim() &&
    !!store?.pos_type?.trim() &&
    Number(store?.register_count) > 0;

  const storeName = storeScope === 'all' ? 'All Stores' : store?.store_name?.trim() || 'Setup required';

  const chooseStore = (id: string | null) => {
    setActiveStoreId(id);
    setOpen(false);
    onNavigate?.();
  };

  const handleAddStore = () => {
    setOpen(false);
    onNavigate?.();
    router.push('/app/account?addStore=1');
  };

  return (
    <div className="space-y-2 border-t border-sidebar-accent p-4">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center gap-3 rounded-lg bg-sidebar-accent p-3 transition-colors hover:bg-sidebar-accent/80"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Store className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium text-white">{storeName}</p>
            {storeScope === 'all' ? (
              <p className="text-xs text-sidebar-foreground/60">{stores.length} stores selected</p>
            ) : !setupComplete ? (
              <p className="text-xs text-sidebar-foreground/60">Complete store setup</p>
            ) : (
              <p className="text-xs text-sidebar-foreground/60">Selected store</p>
            )}
          </div>
          <ChevronDown className={cn('h-4 w-4 text-sidebar-foreground/60 transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-[min(60vh,20rem)] overflow-y-auto rounded-lg border border-sidebar-accent bg-sidebar p-2 shadow-xl">
            <button
              type="button"
              onClick={() => chooseStore(null)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                storeScope === 'all' ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-white'
              }`}
            >
              <Store className="h-4 w-4" />
              All Stores
            </button>
            {stores.map((ownedStore) => (
              <button
                key={ownedStore.id}
                type="button"
                onClick={() => chooseStore(ownedStore.id)}
                className={`mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  activeStoreId === ownedStore.id ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-white'
                }`}
              >
                <Store className="h-4 w-4" />
                <span className="truncate">{ownedStore.store_name || 'Unnamed store'}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={handleAddStore}
              className="mt-2 flex w-full items-center gap-2 rounded-md border border-sidebar-accent px-3 py-2 text-left text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-white"
            >
              <Plus className="h-4 w-4" />
              Add New Store
            </button>
          </div>
        )}
      </div>

      {user && (
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
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => pathname === href || (href === '/app/products' && pathname === '/pricebook');

  return (
    <>
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-sidebar-accent bg-sidebar px-4 py-3 lg:hidden">
        <Link href="/app/dashboard" className="flex items-center gap-2 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-5 w-5" />
          </div>
          <span className="font-semibold tracking-tight">StorePulse AI</span>
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
          <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-sidebar p-4 animate-slide-up">
            <div className="flex items-center justify-between">
              <Link href="/app/dashboard" className="flex items-center gap-2 text-white" onClick={() => setMobileOpen(false)}>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                  <Zap className="h-5 w-5" />
                </div>
                <span className="text-lg font-semibold tracking-tight">StorePulse AI</span>
              </Link>
              <Button variant="ghost" size="icon" className="text-white hover:bg-sidebar-accent" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="mt-8 flex-1 space-y-1">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} onClick={() => setMobileOpen(false)} />
              ))}
            </nav>
            <StoreCard onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <Link href="/app/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/30">
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white">StorePulse AI</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>

        <StoreCard />
      </aside>
    </>
  );
}

function NavLink({
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
      <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-primary-foreground' : 'text-sidebar-foreground/60 group-hover:text-white')} />
      {item.label}
    </Link>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="lg:pl-64">
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-muted" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-xl bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
      </div>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
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
