'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, Mail, Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

function isEmail(value: string) {
  return value.includes('@');
}

function looksLikePhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  const hasLetters = /[a-zA-Z]/.test(trimmed);

  return !hasLetters && digits.length >= 7;
}

function normalizePhone(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

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
  error?: string;
};

async function resolveUsernameToEmail(identifier: string) {
  const response = await fetch(`/api/auth/resolve-login?identifier=${encodeURIComponent(identifier)}`);

  if (!response.ok) {
    throw new Error('Incorrect username/email/phone or password.');
  }

  const data = await response.json();

  if (!data.email) {
    throw new Error('Incorrect username/email/phone or password.');
  }

  return data.email as string;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/app/dashboard';

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('reason') === 'disabled'
      ? 'Your account has been deactivated. Contact your administrator.'
      : null
  );

  const blockDisabledAccount = async () => {
    await supabase.auth.signOut();
    setLoading(false);
    setError('Your account has been deactivated. Contact your administrator.');
    router.replace('/login?reason=disabled');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const identifier = loginId.trim();

    if (!identifier) {
      setError('Please enter your username, email, or phone number.');
      return;
    }

    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      let signInPayload:
        | { email: string; password: string }
        | { phone: string; password: string };

      if (isEmail(identifier)) {
        signInPayload = {
          email: identifier.toLowerCase(),
          password,
        };
      } else if (looksLikePhone(identifier)) {
        signInPayload = {
          phone: normalizePhone(identifier),
          password,
        };
      } else {
        const resolvedEmail = await resolveUsernameToEmail(identifier);

        signInPayload = {
          email: resolvedEmail.toLowerCase(),
          password,
        };
      }

      const { data, error: loginError } = await supabase.auth.signInWithPassword(signInPayload);

      if (loginError) {
        setLoading(false);
        setError('Incorrect username/email/phone or password.');
        return;
      }

      await supabase.auth.getSession();

      const userId = data.user?.id;

      if (!userId) {
        setLoading(false);
        setError('Login failed. Please try again.');
        return;
      }

      const token = data.session?.access_token;
      if (token) {
        try {
          const adminResponse = await fetch('/api/admin/me', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (adminResponse.status === 403) {
            const errorData = (await adminResponse.json().catch(() => ({}))) as ErrorResponse;
            if (errorData.reason === 'disabled') {
              await blockDisabledAccount();
              return;
            }
          }

          if (adminResponse.ok) {
            const adminData = (await adminResponse.json()) as AdminMeLoginResponse;
            setLoading(false);

            if (adminData.isSuperadmin) {
              router.push('/superadmin');
              router.refresh();
              return;
            }

            if (adminData.supportAccess?.isActive || adminData.profile?.supportAccess || adminData.profile?.isSupportAgent || adminData.isCompanyStaff) {
              router.push('/admin');
              router.refresh();
              return;
            }
          }
        } catch {
          // Login routing continues to store checks if admin lookup is unavailable.
        }
      }

      try {
        const { data: companyProfile } = await supabase
          .from('user_profiles')
          .select('is_company_staff, status')
          .eq('user_id', userId)
          .maybeSingle();

        const status = typeof companyProfile?.status === 'string' ? companyProfile.status.toLowerCase() : '';
        if (companyProfile?.is_company_staff === true && ['inactive', 'suspended', 'disabled', 'removed'].includes(status)) {
          await blockDisabledAccount();
          return;
        }

        if (companyProfile?.is_company_staff === true) {
          setLoading(false);
          router.push('/admin');
          router.refresh();
          return;
        }
      } catch {
        // Continue to store checks if the profile fallback cannot be read.
      }

      const { data: profileRow } = await supabase
        .from('user_profiles')
        .select('must_change_password')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileRow?.must_change_password) {
        setLoading(false);
        router.push('/app/account?forcePassword=1');
        router.refresh();
        return;
      }

      if (token) {
        try {
          const supportResponse = await fetch('/api/admin/support/me/permissions', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (supportResponse.ok) {
            const supportData = (await supportResponse.json()) as {
              permissions?: string[];
              is_superadmin?: boolean;
            };

            if (supportData.is_superadmin) {
              setLoading(false);
              router.push('/superadmin');
              router.refresh();
              return;
            }

            if ((supportData.permissions?.length || 0) > 0) {
              setLoading(false);
              router.push('/admin');
              router.refresh();
              return;
            }
          }
        } catch {
          // Continue to store checks if support lookup is unavailable.
        }
      }

      try {
        const { data: isSuperadmin } = await supabase.rpc('has_permission', {
          check_user_id: userId,
          required_permission: 'platform.superadmin',
        });

        if (isSuperadmin === true) {
          setLoading(false);
          router.push('/superadmin');
          router.refresh();
          return;
        }
      } catch {
        // Continue to store checks if permission lookup is unavailable.
      }

      const { data: storeRow, error: storeError } = await supabase
        .from('stores')
        .select('id, store_name')
        .eq('owner_id', userId)
        .maybeSingle();

      setLoading(false);

      if (storeError) {
        setError(storeError.message);
        return;
      }

      if (!storeRow?.id) {
        router.push('/app/setup');
        router.refresh();
        return;
      }

      const finalRedirect = redirectTo === '/setup' ? '/app/dashboard' : redirectTo;

      if (finalRedirect.startsWith('/app/')) {
        router.push(finalRedirect);
      } else {
        router.push('/app/dashboard');
      }
      router.refresh();
    } catch (error) {
      setLoading(false);
      setError(error instanceof Error ? error.message : 'Login failed. Please try again.');
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
          <h1 className="text-xl font-semibold text-foreground">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in using your username, email, or phone number.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="loginId">Username, email, or phone number</Label>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                id="loginId"
                type="text"
                required
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                placeholder="quickmart27, you@store.com, or 405-123-4567"
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
                placeholder="••••••••"
                className="pl-9"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Sign in
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </Card>
    </div>
  );
}
