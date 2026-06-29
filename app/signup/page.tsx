'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, Mail, Lock, ArrowRight, Loader2, AlertCircle, Check } from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes('already')) {
        setError('An account with this email already exists. Try signing in instead.');
      } else {
        setError(error.message);
      }
      return;
    }

    // Email confirmation is OFF, so the session is created immediately.
    router.push('/app/setup');
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
          <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Start syncing your POS data to the cloud.</p>
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
                onChange={(e) => setEmail(e.target.value)}
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
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">Use 6 or more characters.</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create account <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </form>

        <ul className="mt-6 space-y-2">
          {['Cloud-synced transactions & pricebook', 'Owner-scoped secure storage', 'No credit card required'].map((b) => (
            <li key={b} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-success" /> {b}
            </li>
          ))}
        </ul>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
