'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Mail, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ForgotPasswordPortal = 'store' | 'admin' | 'superadmin';

const PORTAL_CONFIG: Record<ForgotPasswordPortal, {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}> = {
  store: {
    title: 'Reset store login password',
    description: 'Enter your email and we will send password reset instructions if an account exists.',
    backHref: '/login',
    backLabel: 'Back to store login',
  },
  admin: {
    title: 'Reset staff login password',
    description: 'Enter your StorePulse staff email to request password reset instructions.',
    backHref: '/admin/login',
    backLabel: 'Back to staff login',
  },
  superadmin: {
    title: 'Reset superadmin password',
    description: 'Enter your platform owner email to request password reset instructions.',
    backHref: '/superadmin/login',
    backLabel: 'Back to superadmin login',
  },
};

function getSiteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
}

export function ForgotPasswordForm({ portal }: { portal: ForgotPasswordPortal }) {
  const config = PORTAL_CONFIG[portal];
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const origin = getSiteOrigin();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${origin}/reset-password`,
      });

      if (resetError) {
        console.error('[Forgot Password Error]', resetError);
      }

      setSent(true);
    } catch (requestError) {
      console.error('[Forgot Password Request Error]', requestError);
      setError('We could not send reset instructions right now. Please try again.');
    } finally {
      setLoading(false);
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
                placeholder="you@store.com"
                className="pl-9"
              />
            </div>
          </div>

          {sent ? (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>If an account exists for that email, a password reset link has been sent.</span>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send reset link
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
