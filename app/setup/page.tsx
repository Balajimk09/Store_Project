'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Loader2,
  MapPin,
  Phone,
  Store,
  Zap,
} from 'lucide-react';

const POS_TYPES = ['Verifone', 'Gilbarco', 'Clover', 'NCR', 'Square', 'Ruby', 'Other'];

export default function SetupPage() {
  const { user, loading, store, storeLoading, refreshStore } = useAuth();
  const router = useRouter();

  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateValue, setStateValue] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [posType, setPosType] = useState('Verifone');
  const [hasFuel, setHasFuel] = useState(true);
  const [registerCount, setRegisterCount] = useState('1');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login?redirect=/setup');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!store) return;

    setStoreName(store.store_name || '');
    setStoreAddress(store.store_address || '');
    setCity(store.city || '');
    setStateValue(store.state || '');
    setZipCode(store.zip_code || '');
    setPhoneNumber(store.phone_number || '');
    setPosType(store.pos_type || 'Verifone');
    setHasFuel(store.has_fuel || false);
    setRegisterCount(String(store.register_count || 1));
  }, [store]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!storeName.trim()) {
      setError('Please enter a store name.');
      return;
    }

    const regCount = Number(registerCount);

    if (!Number.isFinite(regCount) || regCount < 1) {
      setError('Register count must be at least 1.');
      return;
    }

    setSaving(true);

    const payload = {
      store_name: storeName.trim(),
      store_address: storeAddress.trim() || null,
      city: city.trim() || null,
      state: stateValue.trim() || null,
      zip_code: zipCode.trim() || null,
      phone_number: phoneNumber.trim() || null,
      pos_type: posType,
      has_fuel: hasFuel,
      register_count: regCount,
    };

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user?.id) {
      setError('Your session expired. Please sign in again.');
      setSaving(false);
      return;
    }

    const ownerId = session.user.id;

    const query = store
      ? supabase
          .from('stores')
          .update(payload)
          .eq('id', store.id)
          .eq('owner_id', ownerId)
          .select('*')
          .single()
      : supabase
          .from('stores')
          .insert({
            ...payload,
            owner_id: ownerId,
          })
          .select('*')
          .single();

    const { error: dbError } = await query;

    if (dbError) {
      setError(dbError.message || 'Failed to save your store. Please try again.');
      setSaving(false);
      return;
    }

    await refreshStore();

    setSuccess(true);
    setSaving(false);

    setTimeout(() => router.push('/dashboard'), 700);
  };

  if (loading || storeLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sidebar">
        <Loader2 className="h-6 w-6 animate-spin text-primary-foreground" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-sidebar px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-5 w-5" />
            </div>

            <span className="font-semibold tracking-tight">StorePulse AI</span>
          </Link>

          <Link href="/account" className="text-sm text-white/80 hover:text-white hover:underline">
            Account
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Store className="h-6 w-6" />
          </div>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {store ? 'Store Profile' : 'Set up your store'}
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              {store
                ? 'Review and update your store information.'
                : 'Add your store information to start using StorePulse.'}
            </p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-foreground">Basic Information</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These details identify the store throughout the app.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="storeName">Store name *</Label>
                <Input
                  id="storeName"
                  required
                  value={storeName}
                  onChange={(event) => setStoreName(event.target.value)}
                  placeholder="Meridian Mart"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="storeAddress">Street address</Label>
                <Input
                  id="storeAddress"
                  value={storeAddress}
                  onChange={(event) => setStoreAddress(event.target.value)}
                  placeholder="700 S Meridian Ave"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="Oklahoma City"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={stateValue}
                  onChange={(event) => setStateValue(event.target.value)}
                  placeholder="OK"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="zipCode">ZIP code</Label>
                <Input
                  id="zipCode"
                  value={zipCode}
                  onChange={(event) => setZipCode(event.target.value)}
                  placeholder="73127"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phoneNumber">Store phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="phoneNumber"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="405-555-1234"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h2 className="text-base font-semibold text-foreground">Register Information</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add the POS and register details for this location.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>POS type</Label>
                <Select value={posType} onValueChange={setPosType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select POS" />
                  </SelectTrigger>

                  <SelectContent>
                    {POS_TYPES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="registerCount">Number of registers</Label>
                <Input
                  id="registerCount"
                  type="number"
                  min="1"
                  max="50"
                  value={registerCount}
                  onChange={(event) => setRegisterCount(event.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium text-foreground">This store has fuel pumps</p>
                <p className="text-xs text-muted-foreground">
                  Enable this for gas station reporting and fuel-related setup.
                </p>
              </div>

              <Switch checked={hasFuel} onCheckedChange={setHasFuel} />
            </div>

            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Store className="h-4 w-4" />
                  <span>{storeName || 'Store name not added'}</span>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>
                    {city || 'City not added'}
                    {stateValue ? `, ${stateValue}` : ''}
                    {zipCode ? ` ${zipCode}` : ''}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{phoneNumber || 'Phone not added'}</span>
                </div>
              </div>
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
                <span>Store saved. Taking you to your dashboard...</span>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard')}
                disabled={saving}
              >
                Cancel
              </Button>

              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {store ? 'Save store profile' : 'Create store'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}