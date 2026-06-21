'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, ArrowLeft, ArrowRight, Check, AlertCircle, Loader2 } from 'lucide-react';

const POS_TYPES = ['Verifone', 'Gilbarco', 'Clover', 'NCR', 'Square', 'Other', 'Not sure'];

export default function DemoRequestPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [storeName, setStoreName] = useState('');
  const [city, setCity] = useState('');
  const [stateValue, setStateValue] = useState('');
  const [storeCount, setStoreCount] = useState('1');
  const [posType, setPosType] = useState('Verifone');
  const [message, setMessage] = useState('');

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    const parsedStoreCount = parseInt(storeCount, 10);

    setSaving(true);

    const { error: insertError } = await supabase.from('demo_requests').insert({
      full_name: fullName.trim(),
      email: email.trim(),
      phone_number: phoneNumber.trim() || null,
      store_name: storeName.trim() || null,
      city: city.trim() || null,
      state: stateValue.trim() || null,
      store_count: Number.isNaN(parsedStoreCount) ? null : parsedStoreCount,
      pos_type: posType,
      message: message.trim() || null,
      status: 'new',
    });

    setSaving(false);

    if (insertError) {
      setError(insertError.message || 'Failed to submit demo request. Please try again.');
      return;
    }

    setSuccess(true);
    setFullName('');
    setEmail('');
    setPhoneNumber('');
    setStoreName('');
    setCity('');
    setStateValue('');
    setStoreCount('1');
    setPosType('Verifone');
    setMessage('');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-sidebar px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-5 w-5" />
            </div>
            <span className="font-semibold tracking-tight">StorePulse AI</span>
          </Link>

          <Link href="/login" className="text-sm text-white/80 hover:text-white hover:underline">
            Sign in
          </Link>
        </div>
      </div>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:px-8">
        <section className="flex flex-col justify-center">
          <Link href="/" className="mb-6 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to home
          </Link>

          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Request Demo</p>

          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            See how StorePulse AI can work for your store
          </h1>

          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Tell us a little about your convenience store or gas station. We will review your request and provide a demo login so you can explore StorePulse AI with store-style data.
          </p>

          <div className="mt-6 space-y-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            <div className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>Dashboard, live transactions, pricebook, reports, and cashier audit demo.</span>
            </div>
            <div className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>Built for gas stations, convenience stores, and small retail operators.</span>
            </div>
            <div className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>No credit card required for demo access.</span>
            </div>
          </div>
        </section>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Demo request form</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We will use this information only to set up and contact you about your demo.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Smith"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@store.com"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="phoneNumber">Phone number</Label>
                <Input
                  id="phoneNumber"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="storeName">Store name</Label>
                <Input
                  id="storeName"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Meridian Mart"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="city">City / Town</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Oklahoma City"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={stateValue}
                  onChange={(e) => setStateValue(e.target.value)}
                  placeholder="OK"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="storeCount">Number of stores</Label>
                <Input
                  id="storeCount"
                  type="number"
                  min="1"
                  value={storeCount}
                  onChange={(e) => setStoreCount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="posType">POS system</Label>
                <select
                  id="posType"
                  value={posType}
                  onChange={(e) => setPosType(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {POS_TYPES.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="message">What would you like to see?</Label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Example: I want to track live sales, cashier activity, pricebook margins, fuel sales, and taxes."
                rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-start gap-2 rounded-lg bg-success/5 p-3 text-sm text-success">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Demo request submitted. We will reach out with demo access.</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit demo request <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}