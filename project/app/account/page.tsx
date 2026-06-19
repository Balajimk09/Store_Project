'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Zap, Store, LogOut, Loader2, ArrowRight, User, Settings, Cloud, Database } from 'lucide-react';

export default function AccountPage() {
  const { user, store, storeLoading, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.push('/');
    router.refresh();
  };

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sidebar px-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <User className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">You&apos;re not signed in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage your account and cloud store data.</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button onClick={() => router.push('/login')}>Sign in <ArrowRight className="ml-2 h-4 w-4" /></Button>
            <Button variant="outline" onClick={() => router.push('/signup')}>Create an account</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-sidebar px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-5 w-5" />
            </div>
            <span className="font-semibold tracking-tight">StorePulse AI</span>
          </Link>
          <Button variant="ghost" size="sm" className="text-white hover:bg-sidebar-accent" onClick={() => router.push('/dashboard')}>
            Back to dashboard
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your sign-in and store settings.</p>

        <Card className="mt-6 p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Profile</h2>
              <p className="text-xs text-muted-foreground">Your sign-in details</p>
            </div>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
              <dd className="mt-0.5 text-sm text-foreground">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">User ID</dt>
              <dd className="mt-0.5 truncate text-sm font-mono text-muted-foreground">{user.id}</dd>
            </div>
          </dl>
        </Card>

        <Card className="mt-4 p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Store className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-foreground">Store</h2>
              <p className="text-xs text-muted-foreground">Your connected store</p>
            </div>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${store ? 'bg-success/10 text-success' : 'bg-chart-3/10 text-chart-3'}`}>
              {store ? <><Cloud className="h-3 w-3" /> Cloud Mode</> : <><Database className="h-3 w-3" /> No store</>}
            </span>
          </div>
          {storeLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading store...
            </div>
          ) : store ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Store name</dt>
                <dd className="mt-0.5 text-sm text-foreground">{store.store_name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Address</dt>
                <dd className="mt-0.5 text-sm text-foreground">{store.store_address || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">POS type</dt>
                <dd className="mt-0.5 text-sm text-foreground">{store.pos_type || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Registers</dt>
                <dd className="mt-0.5 text-sm text-foreground">{store.register_count} {store.has_fuel ? '· Has fuel' : ''}</dd>
              </div>
            </dl>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">You haven&apos;t set up a store yet. Create one to start syncing data to the cloud.</p>
              <Button className="mt-4" onClick={() => router.push('/setup')}>
                <Settings className="mr-2 h-4 w-4" /> Set up your store
              </Button>
            </div>
          )}
        </Card>

        <Card className="mt-4 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sign out</h2>
              <p className="text-xs text-muted-foreground">You&apos;ll return to demo mode using local data.</p>
            </div>
            <Button variant="outline" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
