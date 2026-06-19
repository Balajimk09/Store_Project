'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  Receipt,
  BookOpen,
  ShieldAlert,
  Sparkles,
  FileBarChart,
  Menu,
  X,
  Zap,
  Store,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transactions', label: 'Live Transactions', icon: Receipt },
  { href: '/upload', label: 'Upload POS Data', icon: Upload },
  { href: '/pricebook', label: 'Pricebook', icon: BookOpen },
  { href: '/cashier-audit', label: 'Cashier Audit', icon: ShieldAlert },
  { href: '/ai-assistant', label: 'AI Assistant', icon: Sparkles },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-sidebar-accent bg-sidebar px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 text-white">
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

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 bg-sidebar p-4 animate-slide-up">
            <div className="flex items-center justify-between">
              <Link href="/dashboard" className="flex items-center gap-2 text-white" onClick={() => setMobileOpen(false)}>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                  <Zap className="h-5 w-5" />
                </div>
                <span className="text-lg font-semibold tracking-tight">StorePulse AI</span>
              </Link>
              <Button variant="ghost" size="icon" className="text-white hover:bg-sidebar-accent" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="mt-8 space-y-1">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} active={pathname === item.href} onClick={() => setMobileOpen(false)} />
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/30">
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white">StorePulse AI</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} />
          ))}
        </nav>

        <div className="border-t border-sidebar-accent p-4">
          <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Store className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">QuickStop #4127</p>
              <p className="truncate text-xs text-sidebar-foreground/60">Demo Store</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  item,
  active,
  onClick,
}: {
  item: { href: string; label: string; icon: React.ElementType };
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

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="lg:pl-64">
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
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
