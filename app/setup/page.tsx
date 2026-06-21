'use client';

import { useEffect, useState } from 'react';
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
import { Zap, Store, Loader2, ArrowRight, AlertCircle, Check } from 'lucide-react';

const POS_TYPES = ['Verifone', 'Gilbarco', 'Clover', 'NCR', 'Square', 'Other'];

export default function SetupPage() {
  const { user, loading, store, storeLoading, refreshStore } = useAuth();
  const router = useRouter();

  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [posType, setPosType] = useState('Verifone');
  const [hasFuel, setHasFuel] = useState(true);
  const [registerCount, setRegisterCount] = useState('4');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login?redirect=/setup');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (store) {
      setStoreName(store.store_name);
      setStoreAddress(store.store_address || '');
      setPosType(store.pos_type || 'Verifone');
      setHasFuel(store.has_fuel);
      setRegisterCount(String(store.register_count));
    }
  }, [store]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!storeName.trim()) {
      setError('Please enter a store name.');
      return;
    }
    const regCount = parseInt(registerCount, 10);
    if (Number.isNaN(regCount) || regCount < 1) {
      setError('Register count must be at least 1.');
      return;
    }

    setSaving(true);
    const payload = {
      store_name: storeName.trim(),
      store_address: storeAddress.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      zip_code: zipCode.trim() || null,
      phone_number: phoneNumber.trim() || null,
      pos_type: posType,
      has_fuel: hasFuel,
      register_count: regCount,
      };
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

if (sessionError || !sessionData.session?.user?.id) {
  setError('No active Supabase session found. Please log out, sign in again, and retry setup.');
  setSaving(false);
  return;
}

const ownerId = sessionData.session.user.id;

console.log('SETUP DEBUG ownerId:', ownerId);

let query;

if (store) {
  query = supabase
    .from('stores')
    .update(payload)
    .eq('id', store.id)
    .select('id, owner_id, store_name')
    .single();
} else {
  query = supabase
    .from('stores')
    .insert({
      ...payload,
      owner_id: ownerId,
    })
    .select('id, owner_id, store_name')
    .single();
}

const { data: savedStore, error: dbError } = await query;

console.log('SETUP DEBUG savedStore:', savedStore);
console.log('SETUP DEBUG dbError:', dbError);
    
    if (dbError) {
      setError(dbError.message || 'Failed to save your store. Please try again.');
      setSaving(false);
      return;
    }

    await refreshStore();
    setSuccess(true);
    setSaving(false);
    setTimeout(() => router.push('/dashboard'), 900);
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
        <div className="mx-auto flex max-w-2xl items-center justify-between">
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

      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{store ? 'Edit store' : 'Set up your store'}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {store ? 'Update your store details. Changes apply to all cloud data.' : 'Tell us about your store to enable cloud sync.'}
            </p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="storeName">Store name</Label>
              <Input
                id="storeName"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="QuickStop #4127"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="storeAddress">Store address</Label>
              <Input
                id="storeAddress"
                value={storeAddress}
                onChange={(e) => setStoreAddress(e.target.value)}
                placeholder="123 Main St, Anytown, USA"
              />
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>POS type</Label>
                <Select value={posType} onValueChange={setPosType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select POS" />
                  </SelectTrigger>
                  <SelectContent>
                    {POS_TYPES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
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
                  onChange={(e) => setRegisterCount(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-medium text-foreground">This store has fuel pumps</p>
                <p className="text-xs text-muted-foreground">Enable fuel category tracking and pump-level reporting.</p>
              </div>
              <Switch checked={hasFuel} onCheckedChange={setHasFuel} />
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

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {store ? 'Save changes' : 'Create store & continue'} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
