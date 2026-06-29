'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Lock, Mail, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type LoginPortal = 'store' | 'admin' | 'superadmin';

type AdminMeLoginResponse = {
  isSuperadmin?: boolean;
  isCompanyStaff?: boolean;
  profile?: {
    supportAccess?: boolean;
    isSupportAgent?: boolean;
  };
  supportAccess?: {
    isActive?: boolean;
  };
};

type ErrorResponse = {
  reason?: string;
};

type ProfileLookupRow = {
  must_change_password?: boolean | null;
};

const PORTAL_CONFIG: Record<LoginPortal, {
  title: string;
  description: string;
  forgotHref: string;
  backHref: string;
  backLabel: string;
}> = {
  store: {
    title: 'Store owner or employee login',
    description: 'Sign in with your email to manage your store workspace.',
    forgotHref: '/forgot-password',
    backHref: '/signup',
    backLabel: 'Create an account',
  },
  admin: {
    title: 'StorePulse staff login',
    description: 'Sign in with your StorePulse staff email.',
    forgotHref: '/admin/forgot-password',
    backHref: '/login',
    backLabel: 'Use regular login',
  },
  superadmin: {
    title: 'Platform superadmin login',
    description: 'Sign in with your platform owner account.',
    forgotHref: '/superadmin/forgot-password',
    backHref: '/login',
    backLabel: 'Use regular login',
  },
};

function friendlyLoginError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (lower.includes('json object requested')) return 'We could not find a matching account. Please check your email and try again.';
  if (lower.includes('email not confirmed')) return 'Please confirm your email before signing in.';
  return 'We could not sign you in. Please check your email and password.';
}

function isAdminUser(adminData: AdminMeLoginResponse | null) {
  return Boolean(
    adminData?.isSuperadmin ||
    adminData?.isCompanyStaff ||
    adminData?.supportAccess?.isActive ||
    adminData?.profile?.supportAccess ||
    adminData?.profile?.isSupportAgent
  );
}

async function fetchAdminAccess(token: string) {
  const response = await fetch('/api/admin/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 403) {
    const errorData = (await response.json().catch(() => ({}))) as ErrorResponse;
    if (errorData.reason === 'disabled') {
      return { disabled: true, access: null };
    }
  }

  if (!response.ok) {
    return { disabled: false, access: null };
  }

  const access = (await response.json()) as AdminMeLoginResponse;
  return { disabled: false, access };
}

export function LoginForm({ portal }: { portal: LoginPortal }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const config = PORTAL_CONFIG[portal];
  const redirectTo = searchParams.get('redirect') || '/app/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(
    searchParams.get('reset') === 'success'
      ? 'Password updated successfully. Please sign in.'
      : null
  );
  const [error, setError] = useState<string | null>(
    searchParams.get('reason') === 'disabled'
      ? 'Your account has been deactivated. Contact your administrator.'
      : null
  );

  const signOutForPortalMismatch = async (message: string) => {
    await supabase.auth.signOut();
    setLoading(false);
    setError(message);
  };

  const loadProfile = async (userId: string) => {
    const { data, error: profileError } = await supabase
      .from('user_profiles')
      .select('must_change_password')
      .eq('user_id', userId)
      .limit(2);

    if (profileError) {
      console.error('[Login Profile Lookup Error]', profileError);
      throw new Error('Your account setup is incomplete. Please contact support.');
    }

    const rows = (data || []) as ProfileLookupRow[];
    if (rows.length === 0) {
      console.warn('[Login Profile Missing]', { userId });
      return null;
    }

    if (rows.length > 1) {
      console.warn('[Login Profile Ambiguous]', { userId, count: rows.length });
      throw new Error('Your account setup is incomplete. Please contact support.');
    }

    return rows[0];
  };

  const hasStoreAccess = async (userId: string) => {
    const { data, error: storeError } = await supabase
      .from('stores')
      .select('id')
      .eq('owner_id', userId)
      .limit(2);

    if (storeError) {
      console.error('[Login Store Access Error]', storeError);
      throw new Error('No store is linked to your account. Please contact support or complete store setup.');
    }

    return (data || []).length > 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Please enter your email.');
      return;
    }

    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (loginError) {
        console.error('[Login Auth Error]', loginError);
        setLoading(false);
        setError(friendlyLoginError(loginError.message));
        return;
      }

      await supabase.auth.getSession();

      const userId = data.user?.id;
      const token = data.session?.access_token;
      if (!userId || !token) {
        setLoading(false);
        setError('Login failed. Please try again.');
        return;
      }

      const adminResult = await fetchAdminAccess(token);
      if (adminResult.disabled) {
        await signOutForPortalMismatch('Your account has been deactivated. Contact your administrator.');
        router.replace('/login?reason=disabled');
        return;
      }

      const adminData = adminResult.access;
      const superadmin = adminData?.isSuperadmin === true;
      const adminUser = isAdminUser(adminData);

      if (portal === 'store') {
        if (superadmin) {
          await signOutForPortalMismatch('This login is for platform superadmin. Please use the superadmin login page.');
          return;
        }

        if (adminUser) {
          await signOutForPortalMismatch('This account is for StorePulse staff. Please use the admin login page.');
          return;
        }

        const profile = await loadProfile(userId);
        if (profile?.must_change_password) {
          setLoading(false);
          router.push('/app/account?forcePassword=1');
          router.refresh();
          return;
        }

        const storeAccess = await hasStoreAccess(userId);
        setLoading(false);

        if (!storeAccess) {
          console.warn('[Login No Store Access]', { userId });
          router.push('/app/setup');
          router.refresh();
          return;
        }

        const finalRedirect = redirectTo === '/setup' ? '/app/dashboard' : redirectTo;
        router.push(finalRedirect.startsWith('/app/') ? finalRedirect : '/app/dashboard');
        router.refresh();
        return;
      }

      if (portal === 'admin') {
        if (superadmin) {
          setLoading(false);
          router.push('/superadmin');
          router.refresh();
          return;
        }

        if (adminUser) {
          setLoading(false);
          router.push('/admin');
          router.refresh();
          return;
        }

        await signOutForPortalMismatch('This login is only for StorePulse staff. Please use regular login.');
        return;
      }

      if (portal === 'superadmin') {
        if (superadmin) {
          setLoading(false);
          router.push('/superadmin');
          router.refresh();
          return;
        }

        await signOutForPortalMismatch('This login is only for platform superadmin.');
      }
    } catch (loginError) {
      console.error('[Login Error]', loginError);
      setLoading(false);
      setError(loginError instanceof Error ? loginError.message : 'Login failed. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sidebar px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/30">
          <Zap className="h-6 w-6 text-primary-foreground" />
        </div>
        <span className="text-2xl font-semibold tracking-tight text-white">StorePulse AI</span>
      </Link>

      <Card className="w-full max-w-md p-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">{config.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{config.description}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="pl-9"
              />
            </div>
          </div>

          <div className="text-right text-sm">
            <Link href={config.forgotHref} className="font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>

          {success ? (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{success}</span>
            </div>
          ) : null}

          {error ? (
            <div className="space-y-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
              {portal === 'store' && error.includes('superadmin') ? (
                <Link href="/superadmin/login" className="block font-medium text-primary hover:underline">
                  Go to superadmin login
                </Link>
              ) : null}
              {portal === 'store' && error.includes('StorePulse staff') ? (
                <Link href="/admin/login" className="block font-medium text-primary hover:underline">
                  Go to admin login
                </Link>
              ) : null}
              {portal !== 'store' && error.includes('regular login') ? (
                <Link href="/login" className="block font-medium text-primary hover:underline">
                  Go to regular login
                </Link>
              ) : null}
            </div>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Sign in
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href={config.backHref} className="font-medium text-primary hover:underline">
            {config.backLabel}
          </Link>
        </p>
      </Card>
    </div>
  );
}
