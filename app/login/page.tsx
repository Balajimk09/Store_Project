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

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const identifier = loginId.trim();

    if (!identifier) {
      setError('Please enter your email or phone number.');
      return;
    }

    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);

    const { data, error: loginError } = isEmail(identifier)
      ? await supabase.auth.signInWithPassword({
          email: identifier.toLowerCase(),
          password,
        })
      : await supabase.auth.signInWithPassword({
          phone: normalizePhone(identifier),
          password,
        });

    if (loginError) {
      setLoading(false);
      setError('Incorrect email/phone number or password.');
      return;
    }

    const userId = data.user?.id;

    if (!userId) {
      setLoading(false);
      setError('Login failed. Please try again.');
      return;
    }

    const { data: storeRow, error: storeError } = await supabase
      .from('stores')
      .select('id, store_name, store_address, city, state, zip_code, phone_number, pos_type, register_count')
      .eq('owner_id', userId)
      .maybeSingle();

    setLoading(false);

    if (storeError) {
      setError(storeError.message);
      return;
    }

    const setupComplete =
      !!storeRow?.store_name?.trim() &&
      !!storeRow?.store_address?.trim() &&
      !!storeRow?.city?.trim() &&
      !!storeRow?.state?.trim() &&
      !!storeRow?.zip_code?.trim() &&
      !!storeRow?.phone_number?.trim() &&
      !!storeRow?.pos_type?.trim() &&
      Number(storeRow?.register_count) > 0;

    if (!setupComplete) {
      router.push('/setup');
    } else {
      router.push(redirectTo);
    }

    router.refresh();
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
            Sign in with your email or phone number to access your store.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="loginId">Email or phone number</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="loginId"
                type="text"
                required
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="you@store.com or 405-123-4567"
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
                onChange={(e) => setPassword(e.target.value)}
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
            Sign in <ArrowRight className="ml-2 h-4 w-4" />
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