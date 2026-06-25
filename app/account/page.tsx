'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell, PageHeader, PageLoading } from '@/components/layout/sidebar';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleAlert,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Save,
  Store,
  User,
} from 'lucide-react';

type StoreForm = {
  storeName: string;
  storeAddress: string;
  city: string;
  state: string;
  zipCode: string;
  phoneNumber: string;
  posType: string;
  registerCount: string;
  hasFuel: boolean;
};

const EMPTY_STORE_FORM: StoreForm = {
  storeName: '',
  storeAddress: '',
  city: '',
  state: '',
  zipCode: '',
  phoneNumber: '',
  posType: '',
  registerCount: '1',
  hasFuel: false,
};

function cleanPhone(value: string) {
  return value.trim();
}

function validateStoreForm(form: StoreForm) {
  if (!form.storeName.trim()) return 'Store name is required.';

  const registerCount = Number(form.registerCount);

  if (!Number.isFinite(registerCount) || registerCount < 1) {
    return 'Register count must be at least 1.';
  }

  return null;
}

export default function AccountPage() {
  const router = useRouter();
  const {
    user,
    store,
    loading: authLoading,
    storeLoading,
    refreshStore,
    signOut,
  } = useAuth();

  const [form, setForm] = useState<StoreForm>(EMPTY_STORE_FORM);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!store) {
      setForm(EMPTY_STORE_FORM);
      return;
    }

    setForm({
      storeName: store.store_name || '',
      storeAddress: store.store_address || '',
      city: store.city || '',
      state: store.state || '',
      zipCode: store.zip_code || '',
      phoneNumber: store.phone_number || '',
      posType: store.pos_type || '',
      registerCount: String(store.register_count || 1),
      hasFuel: store.has_fuel || false,
    });
  }, [store]);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 2500);
  };

  const handleSaveStore = async () => {
    if (!user || !store) return;

    const validationError = validateStoreForm(form);

    if (validationError) {
      setPageError(validationError);
      return;
    }

    setSaving(true);
    setPageError(null);

    const { error } = await supabase
      .from('stores')
      .update({
        store_name: form.storeName.trim(),
        store_address: form.storeAddress.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip_code: form.zipCode.trim() || null,
        phone_number: cleanPhone(form.phoneNumber) || null,
        pos_type: form.posType.trim() || null,
        register_count: Number(form.registerCount) || 1,
        has_fuel: form.hasFuel,
      })
      .eq('id', store.id)
      .eq('owner_id', user.id);

    setSaving(false);

    if (error) {
      setPageError(`Could not update store profile: ${error.message}`);
      return;
    }

    await refreshStore();
    showSuccess('Store profile updated.');
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.push('/');
    router.refresh();
  };

  if (authLoading) {
    return (
      <DashboardShell>
        <PageLoading />
      </DashboardShell>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <User className="h-6 w-6" />
          </div>

          <h1 className="text-lg font-semibold text-foreground">Sign in required</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to manage your account and store profile.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Button onClick={() => router.push('/login')}>
              Sign in
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <Button variant="outline" onClick={() => router.push('/signup')}>
              Create account
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Account"
        description="Manage your profile, store details, and sign-in settings."
      />

      {pageError && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pageError}</span>
        </div>
      )}

      {successMessage && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <User className="h-5 w-5" />
              </div>

              <div>
                <h2 className="font-semibold text-foreground">Profile</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your sign-in account.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {user.email}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Account Status
                </p>
                <p className="mt-1 inline-flex rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                  Active
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <LogOut className="h-5 w-5" />
              </div>

              <div className="flex-1">
                <h2 className="font-semibold text-foreground">Sign out</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  End your current session.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              className="mt-5 w-full"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              Sign out
            </Button>
          </Card>
        </div>

        <Card className="p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Store className="h-5 w-5" />
              </div>

              <div>
                <h2 className="font-semibold text-foreground">Store Profile</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Update the store information shown across StorePulse.
                </p>
              </div>
            </div>

            {store && (
              <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                Store active
              </span>
            )}
          </div>

          {storeLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading store profile...
            </div>
          ) : !store ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <Building2 className="h-5 w-5" />
              </div>

              <h3 className="mt-4 font-semibold text-foreground">No store profile yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your store profile to start using StorePulse.
              </p>

              <Button className="mt-5" onClick={() => router.push('/app/setup')}>
                Set up store
              </Button>
            </div>
          ) : (
            <div className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Store Name *</span>
                  <Input
                    value={form.storeName}
                    onChange={(event) => setForm({ ...form, storeName: event.target.value })}
                    placeholder="Meridian Mart"
                  />
                </label>

                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Address</span>
                  <Input
                    value={form.storeAddress}
                    onChange={(event) => setForm({ ...form, storeAddress: event.target.value })}
                    placeholder="123 Main Street"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">City</span>
                  <Input
                    value={form.city}
                    onChange={(event) => setForm({ ...form, city: event.target.value })}
                    placeholder="Oklahoma City"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">State</span>
                  <Input
                    value={form.state}
                    onChange={(event) => setForm({ ...form, state: event.target.value })}
                    placeholder="OK"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">ZIP Code</span>
                  <Input
                    value={form.zipCode}
                    onChange={(event) => setForm({ ...form, zipCode: event.target.value })}
                    placeholder="73127"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Phone</span>
                  <Input
                    value={form.phoneNumber}
                    onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })}
                    placeholder="405-555-1234"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">POS Type</span>
                  <select
                    value={form.posType}
                    onChange={(event) => setForm({ ...form, posType: event.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select POS type</option>
                    <option value="Verifone">Verifone</option>
                    <option value="Gilbarco">Gilbarco</option>
                    <option value="Clover">Clover</option>
                    <option value="Square">Square</option>
                    <option value="Ruby">Ruby</option>
                    <option value="Other">Other</option>
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Register Count</span>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={form.registerCount}
                    onChange={(event) => setForm({ ...form, registerCount: event.target.value })}
                    placeholder="1"
                  />
                </label>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-border p-4">
                <input
                  type="checkbox"
                  checked={form.hasFuel}
                  onChange={(event) => setForm({ ...form, hasFuel: event.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    This store sells fuel
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Used for gas station reporting and store setup.
                  </span>
                </span>
              </label>

              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <span>{form.posType || 'No POS selected'}</span>
                  </div>

                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{form.city || 'No city'}{form.state ? `, ${form.state}` : ''}</span>
                  </div>

                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span>{form.phoneNumber || 'No phone'}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!store) return;

                    setForm({
                      storeName: store.store_name || '',
                      storeAddress: store.store_address || '',
                      city: store.city || '',
                      state: store.state || '',
                      zipCode: store.zip_code || '',
                      phoneNumber: store.phone_number || '',
                      posType: store.pos_type || '',
                      registerCount: String(store.register_count || 1),
                      hasFuel: store.has_fuel || false,
                    });

                    setPageError(null);
                  }}
                  disabled={saving}
                >
                  Reset
                </Button>

                <Button onClick={handleSaveStore} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Store Profile
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
