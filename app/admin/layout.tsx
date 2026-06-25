'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAdminMe } from '@/lib/admin-client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type GuardState = 'loading' | 'ready' | 'denied' | 'error';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkAccess = async () => {
    setState('loading');
    setErrorMessage(null);

    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session) {
        const redirect = encodeURIComponent(pathname || '/admin');
        router.replace(`/login?redirect=${redirect}`);
        return;
      }

      const me = await fetchAdminMe();

      if (!me.isSuperadmin) {
        setState('denied');
        return;
      }

      setState('ready');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to verify admin access.');
      setState('error');
    }
  };

  useEffect(() => {
    checkAccess();
  }, [pathname]);

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking Superadmin access...
        </Card>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldCheck className="h-6 w-6" />
          </div>

          <h1 className="mt-4 text-lg font-semibold">Superadmin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is only for StorePulse platform owners. Your account does not have Superadmin
            access.
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild variant="outline">
              <Link href="/app/dashboard">Back to Dashboard</Link>
            </Button>
            <Button asChild>
              <Link href="/login">Go to Login</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>

          <h1 className="mt-4 text-lg font-semibold">Could not verify access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {errorMessage || 'Something went wrong while checking Superadmin access.'}
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={() => void checkAccess()}>
              Try Again
            </Button>
            <Button asChild>
              <Link href="/login">Go to Login</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
