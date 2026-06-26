'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Bell,
  Building2,
  Check,
  CheckCircle,
  Clock,
  CreditCard,
  Eye,
  FileText,
  Fuel,
  Landmark,
  Loader2,
  Lock,
  LogOut,
  Pencil,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { DashboardShell, PageLoading } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { supabase, type StoreRow } from '@/lib/supabase';

type AccountSection =
  | 'signin'
  | 'profile'
  | 'fuel'
  | 'hours'
  | 'licenses'
  | 'notifications'
  | 'bank'
  | 'billing'
  | 'security';

type SaveKey = AccountSection | 'add-store' | null;

type ProfileForm = {
  store_name: string;
  business_legal_name: string;
  dba_name: string;
  store_email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  phone_number: string;
  owner_phone_number: string;
  store_type: string;
  custom_store_type: string;
  pos_type: string;
  register_count: string;
};

type FuelForm = {
  has_fuel: boolean;
  fuel_brand: string;
  pump_count: string;
  distributor_type: string;
  provider_company_name: string;
  provider_address: string;
  provider_name: string;
  address: string;
  sales_rep_name: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
};

type BankForm = {
  bank_name: string;
  account_holder_name: string;
  account_type: string;
  routing_number: string;
  account_number: string;
  starting_check_number: string;
  authorized_signer_name: string;
  default_check_memo: string;
  security_note: string;
};

type NewLicense = {
  license_name: string;
  license_number: string;
  valid_from: string;
  expires_on: string;
  notes: string;
};

type NotificationPrefs = {
  low_stock: boolean;
  upload_complete: boolean;
  support_reply: boolean;
  vendor_delivery: boolean;
  new_login: boolean;
};

type DayHours = {
  open: string;
  close: string;
  closed: boolean;
};

type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
type OperatingHours = Record<DayKey, DayHours>;

type StoreLicense = {
  id: string;
  store_id: string;
  owner_id: string;
  license_name: string;
  license_number: string | null;
  valid_from: string | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string | null;
};

type StoreStorageFile = {
  name: string;
  id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: {
    size?: number;
    mimetype?: string;
    [key: string]: unknown;
  } | null;
};

type StoreBankProfile = {
  id: string;
  store_id: string;
  owner_id: string;
  bank_name: string | null;
  account_holder_name: string | null;
  account_type: string | null;
  routing_last4: string | null;
  account_last4: string | null;
  starting_check_number: number | null;
  authorized_signer_name: string | null;
  default_check_memo: string | null;
  security_note: string | null;
  created_at: string;
  updated_at?: string | null;
};

type StoreFuelProvider = {
  id: string;
  store_id: string;
  owner_id: string;
  provider_name: string | null;
  address: string | null;
  sales_rep_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  pump_count: number | null;
  distributor_type: string | null;
  provider_company_name: string | null;
  provider_address: string | null;
  created_at: string;
  updated_at?: string | null;
};

type PlatformPlan = {
  id: string;
  plan_name: string;
  plan_code: string;
  monthly_price: number | null;
  yearly_price: number | null;
  setup_fee: number | null;
  trial_days: number | null;
  max_stores: number | null;
  max_users_per_store: number | null;
  max_products: number | null;
  max_uploads_per_month: number | null;
  max_ai_requests_per_month: number | null;
  features: string[] | Record<string, unknown> | null;
  is_active: boolean;
  sort_order: number | null;
};

const STORE_TYPES = ['Convenience Store', 'Gas Station', 'Convenience Store + Gas', 'Liquor Store', 'Smoke Shop', 'Grocery', 'Other'];
const POS_TYPES = ['Verifone', 'Gilbarco', 'Clover', 'Square', 'NCR', 'Ruby', 'Other'];
const LICENSE_SUGGESTIONS = ['EIN / Tax ID', 'Sales Tax Permit', 'Tobacco License', 'Alcohol License', 'Wine License', 'Lottery License', 'Food Permit', 'Other'];
const DOCUMENT_TYPES = ['Store License', 'Tax Document', 'Fuel Document', 'Bank Document', 'Vendor Document', 'Store Photo', 'Other'];
const DAY_KEYS: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const TABS: Array<{ id: AccountSection; label: string }> = [
  { id: 'signin', label: 'Sign-in & Security' },
  { id: 'profile', label: 'Store Profile' },
  { id: 'fuel', label: 'Fuel Profile' },
  { id: 'hours', label: 'Business Hours' },
  { id: 'licenses', label: 'Licenses & Tax IDs' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'bank', label: 'Bank & Check' },
  { id: 'billing', label: 'Billing' },
  { id: 'security', label: 'Security' },
];

const DEFAULT_HOURS: OperatingHours = {
  sunday: { closed: false, open: '08:00', close: '22:00' },
  monday: { closed: false, open: '08:00', close: '22:00' },
  tuesday: { closed: false, open: '08:00', close: '22:00' },
  wednesday: { closed: false, open: '08:00', close: '22:00' },
  thursday: { closed: false, open: '08:00', close: '22:00' },
  friday: { closed: false, open: '08:00', close: '22:00' },
  saturday: { closed: false, open: '08:00', close: '22:00' },
};

const EMPTY_PROFILE: ProfileForm = {
  store_name: '',
  business_legal_name: '',
  dba_name: '',
  store_email: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  zip_code: '',
  country: 'United States',
  phone_number: '',
  owner_phone_number: '',
  store_type: '',
  custom_store_type: '',
  pos_type: '',
  register_count: '1',
};

const EMPTY_FUEL: FuelForm = {
  has_fuel: false,
  fuel_brand: '',
  pump_count: '',
  distributor_type: '',
  provider_company_name: '',
  provider_address: '',
  provider_name: '',
  address: '',
  sales_rep_name: '',
  phone: '',
  email: '',
  website: '',
  notes: '',
};

const EMPTY_BANK: BankForm = {
  bank_name: '',
  account_holder_name: '',
  account_type: 'checking',
  routing_number: '',
  account_number: '',
  starting_check_number: '',
  authorized_signer_name: '',
  default_check_memo: '',
  security_note: 'Only last 4 digits are saved now. Full encrypted bank storage must be implemented before production.',
};

const EMPTY_LICENSE: NewLicense = {
  license_name: 'EIN / Tax ID',
  license_number: '',
  valid_from: '',
  expires_on: '',
  notes: '',
};

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  low_stock: true,
  upload_complete: true,
  support_reply: true,
  vendor_delivery: true,
  new_login: true,
};

function asString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function dayLabel(day: DayKey) {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function profileFromStore(store: StoreRow | null): ProfileForm {
  if (!store) return EMPTY_PROFILE;
  return {
    store_name: store.store_name || '',
    business_legal_name: store.business_legal_name || '',
    dba_name: store.dba_name || '',
    store_email: store.store_email || '',
    address_line1: store.address_line1 || store.store_address || '',
    address_line2: store.address_line2 || '',
    city: store.city || '',
    state: store.state || '',
    zip_code: store.zip_code || '',
    country: store.country || 'United States',
    phone_number: store.phone_number || '',
    owner_phone_number: store.owner_phone_number || '',
    store_type: store.store_type || '',
    custom_store_type: store.custom_store_type || '',
    pos_type: store.pos_type || '',
    register_count: String(store.register_count || 1),
  };
}

function hoursFromStore(store: StoreRow | null): OperatingHours {
  const value = store?.operating_hours;
  if (!value || typeof value !== 'object') return DEFAULT_HOURS;
  const source = value as Record<string, Partial<DayHours> & { day?: string }>;
  const next = { ...DEFAULT_HOURS };

  if (Array.isArray(value)) {
    value.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const day = asString((row as { day?: unknown }).day).toLowerCase() as DayKey;
      if (!DAY_KEYS.includes(day)) return;
      next[day] = {
        closed: (row as Partial<DayHours>).closed === true,
        open: asString((row as Partial<DayHours>).open) || DEFAULT_HOURS[day].open,
        close: asString((row as Partial<DayHours>).close) || DEFAULT_HOURS[day].close,
      };
    });
    return next;
  }

  DAY_KEYS.forEach((day) => {
    const row = source[day] || source[dayLabel(day)];
    if (!row) return;
    next[day] = {
      closed: row.closed === true,
      open: asString(row.open) || DEFAULT_HOURS[day].open,
      close: asString(row.close) || DEFAULT_HOURS[day].close,
    };
  });
  return next;
}

function formatSupabaseError(error: unknown, fallback = 'Save failed.') {
  if (!error) return fallback;

  if (typeof error === 'object' && error !== null) {
    const supabaseError = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    const formatted = [
      supabaseError.message,
      supabaseError.details,
      supabaseError.hint,
      supabaseError.code ? `Code: ${supabaseError.code}` : null,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ');

    if (formatted) return formatted;
  }

  if (error instanceof Error) return error.message;
  return String(error || fallback);
}

const maskLast4 = (last4?: string | null) => (last4 ? `****${last4}` : 'Not set');

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const cleanStorageFileName = (name: string) => name.replace(/^\d+-/, '');

const formatMoney = (value: number | null | undefined) => {
  const amount = typeof value === 'number' ? value : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

function planFeatures(features: PlatformPlan['features']) {
  if (Array.isArray(features)) return features.map(String);
  if (features && typeof features === 'object') {
    const entries = Object.entries(features);
    if (entries.length === 0) return [];
    return entries.map(([key, value]) => {
      if (typeof value === 'boolean') return value ? key : `${key}: no`;
      if (value === null || value === undefined) return key;
      return `${key}: ${String(value)}`;
    });
  }
  return [];
}

export function StoreAccountCenter() {
  const router = useRouter();
  const {
    user,
    loading,
    storeLoading,
    stores,
    activeStore,
    activeStoreId,
    storeScope,
    setActiveStoreId,
    refreshStores,
    signOut,
  } = useAuth();

  const [activeSection, setActiveSection] = useState<AccountSection>('signin');
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [saving, setSaving] = useState<SaveKey>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<unknown>(null);
  const [addStoreOpen, setAddStoreOpen] = useState(false);

  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [newStoreForm, setNewStoreForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [fuelForm, setFuelForm] = useState<FuelForm>(EMPTY_FUEL);
  const [bankForm, setBankForm] = useState<BankForm>(EMPTY_BANK);
  const [newLicense, setNewLicense] = useState<NewLicense>(EMPTY_LICENSE);
  const [notifications, setNotifications] = useState<NotificationPrefs>(DEFAULT_NOTIFICATIONS);
  const [hours, setHours] = useState<OperatingHours>(DEFAULT_HOURS);
  const [timezone, setTimezone] = useState('America/Chicago');

  const [licenses, setLicenses] = useState<StoreLicense[]>([]);
  const [storeDocuments, setStoreDocuments] = useState<StoreStorageFile[]>([]);
  const [bankProfile, setBankProfile] = useState<StoreBankProfile | null>(null);
  const [fuelProvider, setFuelProvider] = useState<StoreFuelProvider | null>(null);
  const [availablePlans, setAvailablePlans] = useState<PlatformPlan[]>([]);

  const [showAddLicense, setShowAddLicense] = useState(false);
  const [editingLicenseId, setEditingLicenseId] = useState<string | null>(null);
  const [editLicenseForm, setEditLicenseForm] = useState<NewLicense>(EMPTY_LICENSE);
  const [showDocUploadForm, setShowDocUploadForm] = useState(false);
  const [docType, setDocType] = useState('Other');
  const [docNotes, setDocNotes] = useState('');

  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState('60');
  const [notifyNewLogin, setNotifyNewLogin] = useState(true);

  const singleStoreRequired = activeStoreId === null || !activeStoreId || storeScope === 'all';
  const isEditing = editingSection === activeSection;

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
    setDebugError(null);
  };

  const setPanelSuccess = (message: string) => {
    setError(null);
    setDebugError(null);
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 2500);
  };

  const setPanelError = (message: string) => {
    setError(message);
    window.setTimeout(() => setError(null), 7000);
  };

  const resetStoreForms = useCallback(() => {
    setProfileForm(profileFromStore(activeStore));
    setFuelForm((current) => ({
      ...EMPTY_FUEL,
      has_fuel: activeStore?.has_fuel === true,
      fuel_brand: activeStore?.fuel_brand || '',
      pump_count: current.pump_count,
      distributor_type: current.distributor_type,
      provider_company_name: current.provider_company_name,
      provider_address: current.provider_address,
      provider_name: current.provider_name,
      address: current.address,
      sales_rep_name: current.sales_rep_name,
      phone: current.phone,
      email: current.email,
      website: current.website,
      notes: current.notes,
    }));
    setTimezone(activeStore?.timezone || 'America/Chicago');
    setHours(hoursFromStore(activeStore));
    setBankForm(EMPTY_BANK);
  }, [activeStore]);

  const loadFuelProvider = useCallback(async () => {
    if (!activeStoreId) {
      setFuelProvider(null);
      setFuelForm((current) => ({ ...EMPTY_FUEL, has_fuel: current.has_fuel, fuel_brand: current.fuel_brand }));
      return;
    }

    const { data, error: loadError } = await supabase
      .from('store_fuel_providers')
      .select('*')
      .eq('store_id', activeStoreId)
      .maybeSingle();

    if (loadError) {
      console.error('Load fuel provider error:', loadError);
      setDebugError(loadError);
      return;
    }

    const row = (data as StoreFuelProvider | null) ?? null;
    setFuelProvider(row);
    setFuelForm({
      has_fuel: activeStore?.has_fuel === true,
      fuel_brand: activeStore?.fuel_brand || '',
      pump_count: row?.pump_count === null || row?.pump_count === undefined ? '' : String(row.pump_count),
      distributor_type: row?.distributor_type || '',
      provider_company_name: row?.provider_company_name || '',
      provider_address: row?.provider_address || '',
      provider_name: row?.provider_name || '',
      address: row?.address || '',
      sales_rep_name: row?.sales_rep_name || '',
      phone: row?.phone || '',
      email: row?.email || '',
      website: row?.website || '',
      notes: row?.notes || '',
    });
  }, [activeStore, activeStoreId]);

  const loadBankProfile = useCallback(async () => {
    if (!activeStoreId) {
      setBankProfile(null);
      setBankForm(EMPTY_BANK);
      return;
    }

    const { data, error: loadError } = await supabase
      .from('store_bank_profiles')
      .select('*')
      .eq('store_id', activeStoreId)
      .maybeSingle();

    if (loadError) {
      console.error('Load bank profile error:', loadError);
      setDebugError(loadError);
      return;
    }

    const row = (data as StoreBankProfile | null) ?? null;
    setBankProfile(row);
    setBankForm({
      bank_name: row?.bank_name || '',
      account_holder_name: row?.account_holder_name || '',
      account_type: row?.account_type || 'checking',
      routing_number: '',
      account_number: '',
      starting_check_number: row?.starting_check_number === null || row?.starting_check_number === undefined ? '' : String(row.starting_check_number),
      authorized_signer_name: row?.authorized_signer_name || '',
      default_check_memo: row?.default_check_memo || '',
      security_note: row?.security_note || EMPTY_BANK.security_note,
    });
  }, [activeStoreId]);

  const loadLicenses = useCallback(async () => {
    if (!activeStoreId) {
      setLicenses([]);
      return;
    }

    const { data, error: loadError } = await supabase
      .from('store_licenses')
      .select('*')
      .eq('store_id', activeStoreId)
      .order('created_at', { ascending: false });

    if (loadError) {
      console.error('Load licenses error:', loadError);
      setDebugError(loadError);
      setError(formatSupabaseError(loadError, 'Could not load licenses.'));
      return;
    }

    setLicenses((data as StoreLicense[]) || []);
  }, [activeStoreId]);

  const loadStoreDocuments = useCallback(async () => {
    if (!activeStoreId) {
      setStoreDocuments([]);
      return;
    }

    const { data, error: loadError } = await supabase.storage
      .from('store-documents')
      .list(`${activeStoreId}/docs`, {
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (loadError) {
      console.error('[Load Store Documents Error]', loadError);
      setDebugError(loadError);
      setError(formatSupabaseError(loadError, 'Could not load store documents.'));
      return;
    }

    setStoreDocuments((data as StoreStorageFile[]) || []);
  }, [activeStoreId]);

  const loadPlans = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('platform_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (loadError) {
      console.error('Load plans error:', loadError);
      setAvailablePlans([]);
      setError(formatSupabaseError(loadError, 'Could not load plans.'));
      setDebugError(loadError);
      return;
    }

    setAvailablePlans((data as PlatformPlan[]) || []);
  }, []);

  const reloadCurrentSectionData = useCallback(async () => {
    switch (activeSection) {
      case 'fuel':
        await loadFuelProvider();
        break;
      case 'licenses':
        await loadLicenses();
        await loadStoreDocuments();
        break;
      case 'bank':
        await loadBankProfile();
        break;
      case 'billing':
        await loadPlans();
        break;
      default:
        break;
    }
  }, [activeSection, loadBankProfile, loadFuelProvider, loadLicenses, loadPlans, loadStoreDocuments]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('addStore') === '1') {
      setAddStoreOpen(true);
    }
  }, []);

  useEffect(() => {
    setEditingSection(null);
    clearMessages();
    setShowAddLicense(false);
    setEditingLicenseId(null);
    setEditLicenseForm(EMPTY_LICENSE);
    setShowDocUploadForm(false);
    setDocType('Other');
    setDocNotes('');
    resetStoreForms();
  }, [activeStoreId, activeStore, resetStoreForms]);

  useEffect(() => {
    if (!user) return;
    const metadata = user.user_metadata as Record<string, unknown>;
    setUsername(asString(metadata.username));
    setPhoneNumber(asString(metadata.phone_number));
    setNewEmail(user.email || '');
    setAutoLogoutMinutes(String(metadata.auto_logout_minutes || '60'));
    setNotifyNewLogin(metadata.notify_new_login !== false);
    setNotifications({
      low_stock: metadata.notify_low_stock_in_app !== false,
      upload_complete: metadata.notify_upload_complete_in_app !== false,
      support_reply: metadata.notify_support_reply_in_app !== false,
      vendor_delivery: metadata.notify_vendor_delivery_in_app !== false,
      new_login: metadata.notify_new_login_in_app !== false,
    });
  }, [user]);

  useEffect(() => {
    if (activeSection === 'fuel' && activeStoreId) void loadFuelProvider();
    if (activeSection === 'licenses' && activeStoreId) {
      void loadLicenses();
      void loadStoreDocuments();
    }
    if (activeSection === 'bank' && activeStoreId) void loadBankProfile();
    if (activeSection === 'billing') void loadPlans();
  }, [activeSection, activeStoreId, loadBankProfile, loadFuelProvider, loadLicenses, loadPlans, loadStoreDocuments]);

  const withSave = async (key: SaveKey, action: () => Promise<string>) => {
    setSaving(key);
    setError(null);
    setSuccess(null);
    setDebugError(null);
    try {
      const message = await action();
      setEditingSection(null);
      setPanelSuccess(message);
    } catch (saveError) {
      console.error('[Account Center Save Error]', saveError);
      setDebugError(saveError);
      setPanelError(formatSupabaseError(saveError));
    } finally {
      setSaving(null);
    }
  };

  const handleTabChange = (tabId: AccountSection) => {
    setActiveSection(tabId);
    setEditingSection(null);
    setError(null);
    setSuccess(null);
    setDebugError(null);
  };

  const startEditing = () => {
    setEditingSection(activeSection);
    clearMessages();
  };

  const cancelEditing = async () => {
    setEditingSection(null);
    clearMessages();
    resetStoreForms();
    await reloadCurrentSectionData();
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.push('/login');
  };

  const handleAddStore = async () => {
    if (!user?.id) return;
    await withSave('add-store', async () => {
      if (!newStoreForm.store_name.trim()) throw new Error('Store name is required.');
      const { data, error: insertError } = await supabase
        .from('stores')
        .insert({
          owner_id: user.id,
          store_name: newStoreForm.store_name.trim(),
          store_address: newStoreForm.address_line1.trim() || null,
          address_line1: newStoreForm.address_line1.trim() || null,
          address_line2: newStoreForm.address_line2.trim() || null,
          city: newStoreForm.city.trim() || null,
          state: newStoreForm.state.trim() || null,
          zip_code: newStoreForm.zip_code.trim() || null,
          country: newStoreForm.country.trim() || 'United States',
          phone_number: newStoreForm.phone_number.trim() || null,
          store_type: newStoreForm.store_type || null,
          custom_store_type: newStoreForm.store_type === 'Other' ? newStoreForm.custom_store_type.trim() || null : null,
          pos_type: newStoreForm.pos_type || null,
          register_count: Number(newStoreForm.register_count) || 1,
          has_fuel: newStoreForm.store_type.includes('Gas'),
        })
        .select('*')
        .single();
      if (insertError) throw insertError;
      await refreshStores();
      if (data?.id) setActiveStoreId(data.id);
      setNewStoreForm(EMPTY_PROFILE);
      setAddStoreOpen(false);
      return 'Store added.';
    });
  };

  const handleSaveProfile = async () => {
    if (!activeStoreId || !user?.id) return;
    await withSave('profile', async () => {
      const { error: saveError } = await supabase
        .from('stores')
        .update({
          store_name: profileForm.store_name.trim(),
          business_legal_name: profileForm.business_legal_name.trim() || null,
          dba_name: profileForm.dba_name.trim() || null,
          store_email: profileForm.store_email.trim() || null,
          address_line1: profileForm.address_line1.trim() || null,
          address_line2: profileForm.address_line2.trim() || null,
          city: profileForm.city.trim() || null,
          state: profileForm.state.trim() || null,
          zip_code: profileForm.zip_code.trim() || null,
          country: profileForm.country.trim() || 'United States',
          phone_number: profileForm.phone_number.trim() || null,
          owner_phone_number: profileForm.owner_phone_number.trim() || null,
          store_type: profileForm.store_type || null,
          custom_store_type: profileForm.store_type === 'Other' ? profileForm.custom_store_type.trim() || null : null,
          pos_type: profileForm.pos_type || null,
          register_count: Number(profileForm.register_count) || 1,
        })
        .eq('id', activeStoreId)
        .eq('owner_id', user.id);

      if (saveError) throw saveError;
      await refreshStores();
      return 'Store profile saved.';
    });
  };

  const handleSaveFuel = async () => {
    if (!activeStoreId || !user?.id) return;
    await withSave('fuel', async () => {
      const { error: storeError } = await supabase
        .from('stores')
        .update({
          has_fuel: fuelForm.has_fuel,
          fuel_brand: fuelForm.fuel_brand.trim() || null,
        })
        .eq('id', activeStoreId)
        .eq('owner_id', user.id);

      if (storeError) throw storeError;

      const providerName = fuelForm.provider_company_name.trim() || fuelForm.provider_name.trim() || '';
      const providerAddress = fuelForm.provider_address.trim() || fuelForm.address.trim() || '';
      const { error: providerError } = await supabase
        .from('store_fuel_providers')
        .upsert(
          {
            store_id: activeStoreId,
            owner_id: user.id,
            pump_count: fuelForm.pump_count ? Number(fuelForm.pump_count) : null,
            distributor_type: fuelForm.distributor_type.trim() || null,
            provider_company_name: providerName || null,
            provider_address: providerAddress || null,
            provider_name: providerName || null,
            address: providerAddress || null,
            sales_rep_name: fuelForm.sales_rep_name.trim() || null,
            phone: fuelForm.phone.trim() || null,
            email: fuelForm.email.trim() || null,
            website: fuelForm.website.trim() || null,
            notes: fuelForm.notes.trim() || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'store_id' }
        );

      if (providerError) throw providerError;
      await refreshStores();
      await loadFuelProvider();
      return 'Fuel profile saved.';
    });
  };

  const handleSaveHours = async () => {
    if (!activeStoreId || !user?.id) return;
    await withSave('hours', async () => {
      const { error: saveError } = await supabase
        .from('stores')
        .update({
          timezone: timezone.trim() || 'America/Chicago',
          operating_hours: hours,
        })
        .eq('id', activeStoreId)
        .eq('owner_id', user.id);

      if (saveError) throw saveError;
      await refreshStores();
      return 'Business hours saved.';
    });
  };

  const handleAddLicense = async () => {
    if (!activeStoreId || !user?.id) return;
    await withSave('licenses', async () => {
      if (!newLicense.license_name.trim()) throw new Error('License/tax name is required.');
      const { error: insertError } = await supabase
        .from('store_licenses')
        .insert({
          store_id: activeStoreId,
          owner_id: user.id,
          license_name: newLicense.license_name.trim(),
          license_number: newLicense.license_number.trim() || null,
          valid_from: newLicense.valid_from || null,
          expires_on: newLicense.expires_on || null,
          notes: newLicense.notes.trim() || null,
        });

      if (insertError) throw insertError;
      await loadLicenses();
      setNewLicense(EMPTY_LICENSE);
      setShowAddLicense(false);
      return 'License/tax record added.';
    });
  };

  const startEditLicense = (license: StoreLicense) => {
    setError(null);
    setSuccess(null);
    setDebugError(null);

    setEditingLicenseId(license.id);
    setEditLicenseForm({
      license_name: license.license_name || '',
      license_number: license.license_number || '',
      valid_from: license.valid_from || '',
      expires_on: license.expires_on || '',
      notes: license.notes || '',
    });
  };

  const cancelEditLicense = () => {
    setEditingLicenseId(null);
    setEditLicenseForm(EMPTY_LICENSE);
    setError(null);
    setSuccess(null);
    setDebugError(null);
  };

  const handleUpdateLicense = async () => {
    if (!editingLicenseId || !activeStoreId || !user?.id) return;

    setError(null);
    setSuccess(null);
    setDebugError(null);
    setSaving('licenses');

    try {
      const { error: updateError } = await supabase
        .from('store_licenses')
        .update({
          license_name: editLicenseForm.license_name.trim(),
          license_number: editLicenseForm.license_number.trim() || null,
          valid_from: editLicenseForm.valid_from || null,
          expires_on: editLicenseForm.expires_on || null,
          notes: editLicenseForm.notes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingLicenseId)
        .eq('store_id', activeStoreId)
        .eq('owner_id', user.id);

      if (updateError) throw updateError;

      await loadLicenses();
      setEditingLicenseId(null);
      setEditLicenseForm(EMPTY_LICENSE);
      setPanelSuccess('License updated.');
    } catch (updateError) {
      console.error('[License Update Error]', updateError);
      setDebugError(updateError);
      setError(formatSupabaseError(updateError, 'Could not update license.'));
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteLicense = async (id: string) => {
    if (!activeStoreId || !user?.id) return;
    if (!window.confirm('Delete this license/tax record?')) return;
    await withSave('licenses', async () => {
      const { error: deleteError } = await supabase
        .from('store_licenses')
        .delete()
        .eq('id', id)
        .eq('store_id', activeStoreId)
        .eq('owner_id', user.id);

      if (deleteError) throw deleteError;
      await loadLicenses();
      return 'License/tax record deleted.';
    });
  };

  const handleUploadStoreDocument = async (file: File) => {
    if (!activeStoreId || !user?.id) return;

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      setError('Only PDF, PNG, JPG, JPEG, and WEBP files are allowed.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File must be 10 MB or smaller.');
      return;
    }

    setError(null);
    setSuccess(null);
    setDebugError(null);
    setSaving('licenses');

    try {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${activeStoreId}/docs/${timestamp}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('store-documents')
        .upload(path, file, {
          upsert: false,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      await loadStoreDocuments();
      setShowDocUploadForm(false);
      setDocType('Other');
      setDocNotes('');
      setPanelSuccess('Document uploaded.');
    } catch (uploadError) {
      console.error('[Document Upload Error]', uploadError);
      setDebugError(uploadError);
      setError(formatSupabaseError(uploadError, 'Document upload failed.'));
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteStoreDocument = async (fileName: string) => {
    if (!activeStoreId) return;

    const confirmed = window.confirm(`Delete ${cleanStorageFileName(fileName)}?`);
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    setDebugError(null);
    setSaving('licenses');

    try {
      const path = `${activeStoreId}/docs/${fileName}`;

      const { error: deleteError } = await supabase.storage
        .from('store-documents')
        .remove([path]);

      if (deleteError) throw deleteError;

      await loadStoreDocuments();
      setPanelSuccess('Document deleted.');
    } catch (deleteError) {
      console.error('[Document Delete Error]', deleteError);
      setDebugError(deleteError);
      setError(formatSupabaseError(deleteError, 'Could not delete document.'));
    } finally {
      setSaving(null);
    }
  };

  const handleViewStoreDocument = async (fileName: string) => {
    if (!activeStoreId) return;

    setError(null);
    setDebugError(null);

    try {
      const path = `${activeStoreId}/docs/${fileName}`;

      const { data, error: viewError } = await supabase.storage
        .from('store-documents')
        .createSignedUrl(path, 3600);

      if (viewError) throw viewError;

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (viewError) {
      console.error('[Document View Error]', viewError);
      setDebugError(viewError);
      setError(formatSupabaseError(viewError, 'Could not open document.'));
    }
  };

  const handleSaveSignin = async () => {
    if (!user) return;
    await withSave('signin', async () => {
      if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) throw new Error('Passwords do not match.');
        if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
      }

      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          username: username.trim().toLowerCase(),
          phone_number: phoneNumber.trim() || null,
          auto_logout_minutes: Number(autoLogoutMinutes),
          notify_new_login: notifyNewLogin,
        },
      });
      if (metadataError) throw metadataError;

      let message = 'Sign-in settings saved.';
      if (newEmail.trim() && newEmail.trim() !== user.email) {
        const { error: emailError } = await supabase.auth.updateUser({ email: newEmail.trim() });
        if (emailError) throw emailError;
        message = 'Email update requested. Check your inbox if confirmation is required.';
      }

      if (newPassword) {
        const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
        if (passwordError) throw passwordError;
        setNewPassword('');
        setConfirmPassword('');
      }

      return message;
    });
  };

  const handleSaveNotifications = async () => {
    await withSave('notifications', async () => {
      const { error: saveError } = await supabase.auth.updateUser({
        data: {
          notify_low_stock_in_app: notifications.low_stock,
          notify_upload_complete_in_app: notifications.upload_complete,
          notify_support_reply_in_app: notifications.support_reply,
          notify_vendor_delivery_in_app: notifications.vendor_delivery,
          notify_new_login_in_app: notifications.new_login,
        },
      });

      if (saveError) throw saveError;
      return 'Notification preferences saved.';
    });
  };

  const handleSaveBank = async () => {
    if (!activeStoreId || !user?.id) return;
    await withSave('bank', async () => {
      const routingLast4 = bankForm.routing_number.trim().slice(-4) || bankProfile?.routing_last4 || '';
      const accountLast4 = bankForm.account_number.trim().slice(-4) || bankProfile?.account_last4 || '';
      const startingCheckNumber = bankForm.starting_check_number ? Number(bankForm.starting_check_number) : null;

      const { error: saveError } = await supabase
        .from('store_bank_profiles')
        .upsert(
          {
            store_id: activeStoreId,
            owner_id: user.id,
            bank_name: bankForm.bank_name.trim() || null,
            account_holder_name: bankForm.account_holder_name.trim() || null,
            account_type: bankForm.account_type || null,
            routing_last4: routingLast4 || null,
            account_last4: accountLast4 || null,
            starting_check_number: Number.isFinite(startingCheckNumber) ? startingCheckNumber : null,
            authorized_signer_name: bankForm.authorized_signer_name.trim() || null,
            default_check_memo: bankForm.default_check_memo.trim() || null,
            security_note: bankForm.security_note.trim() || EMPTY_BANK.security_note,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'store_id' }
        );

      if (saveError) throw saveError;
      setBankForm((current) => ({ ...current, routing_number: '', account_number: '' }));
      await loadBankProfile();
      return 'Bank/check setup saved.';
    });
  };

  if (loading) {
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
          <User className="mx-auto mb-4 h-10 w-10 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Sign in required</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage your account and stores.</p>
          <Button className="mt-6" onClick={() => router.push('/login')}>Sign in</Button>
        </Card>
      </div>
    );
  }

  return (
    <DashboardShell>
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Account Center</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your stores, settings, and account preferences.
            </p>
          </div>

          <Button variant="outline" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
            Sign out
          </Button>
        </header>

        {error ? <Message tone="error" message={error} /> : null}
        {success ? <Message tone="success" message={success} /> : null}
        {process.env.NODE_ENV === 'development' && error && debugError ? (
          <pre className="mt-2 overflow-auto rounded bg-red-950 p-3 text-xs text-red-200">
            {JSON.stringify(debugError, null, 2)}
          </pre>
        ) : null}

        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-foreground">My Stores</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {stores.length} store{stores.length === 1 ? '' : 's'} owned. All Stores combines owned store data later.
              </p>
            </div>
            <Button onClick={() => setAddStoreOpen(true)}><Plus className="mr-2 h-4 w-4" />Add Store</Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StoreChoice active={activeStoreId === null || storeScope === 'all'} title="All Stores" description="Virtual aggregate scope." onClick={() => setActiveStoreId(null)} />
            {stores.map((store) => (
              <StoreChoice
                key={store.id}
                active={activeStoreId === store.id}
                title={store.store_name || 'Unnamed store'}
                description={[store.city, store.state].filter(Boolean).join(', ') || 'No location'}
                onClick={() => setActiveStoreId(store.id)}
              />
            ))}
          </div>
        </Card>

        <div className="overflow-x-auto border-b border-border">
          <div className="flex min-w-max gap-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={
                  activeSection === tab.id
                    ? 'border-b-2 border-teal-600 px-4 py-3 text-sm font-medium text-teal-700'
                    : 'border-b-2 border-transparent px-4 py-3 text-sm text-muted-foreground transition hover:text-foreground'
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <Card className="p-6">
          {activeSection === 'signin' && (
            <Panel icon={Lock} title="Sign-in & Security" description="User-level settings work even when All Stores is selected.">
              {isEditing ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Current Email"><Input value={user.email || ''} disabled /></Field>
                    <Field label="Username"><Input value={username} onChange={(event) => setUsername(event.target.value)} /></Field>
                    <Field label="Phone Number"><Input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} /></Field>
                    <Field label="New Email"><Input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></Field>
                    <Field label="Auto Logout"><Select value={autoLogoutMinutes} onChange={setAutoLogoutMinutes} options={[['30', '30 minutes'], ['60', '1 hour'], ['240', '4 hours'], ['0', 'Never']]} /></Field>
                    <Field label="New Password"><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
                    <Field label="Confirm Password"><Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notifyNewLogin} onChange={(event) => setNotifyNewLogin(event.target.checked)} />New login notification</label>
                  </div>
                  <FormActions saving={saving === 'signin'} saveLabel="Save Sign-in Settings" onSave={handleSaveSignin} onCancel={() => void cancelEditing()} />
                </>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <SummaryField label="Current Email" value={user.email || null} />
                    <SummaryField label="Username" value={username} />
                    <SummaryField label="Phone Number" value={phoneNumber} />
                    <SummaryField label="Auto Logout" value={autoLogoutMinutes === '0' ? 'Never' : `${autoLogoutMinutes} minutes`} />
                    <SummaryField label="New Login Notification" value={notifyNewLogin ? 'On' : 'Off'} />
                  </div>
                  <EditButton onClick={startEditing}>Edit Sign-in Settings</EditButton>
                </>
              )}
            </Panel>
          )}

          {activeSection === 'profile' && (
            <StoreSpecificGate blocked={singleStoreRequired} loading={storeLoading} message="Select a specific store to edit store profile.">
              <Panel icon={Building2} title="Store Profile" description="Business profile for the selected store.">
                {isEditing ? (
                  <>
                    <ProfileFields form={profileForm} onChange={setProfileForm} />
                    <FormActions saving={saving === 'profile'} saveLabel="Save Store Profile" onSave={handleSaveProfile} onCancel={() => void cancelEditing()} />
                  </>
                ) : (
                  <>
                    <StoreProfileSummary form={profileForm} />
                    <EditButton onClick={startEditing}>Edit Store Profile</EditButton>
                  </>
                )}
              </Panel>
            </StoreSpecificGate>
          )}

          {activeSection === 'fuel' && (
            <StoreSpecificGate blocked={singleStoreRequired} loading={storeLoading} message="Select a specific store to edit fuel profile.">
              <Panel icon={Fuel} title="Fuel Profile" description="Manual fuel provider details for the selected store.">
                {isEditing ? (
                  <>
                    <FuelFields form={fuelForm} onChange={setFuelForm} />
                    <FormActions saving={saving === 'fuel'} saveLabel="Save Fuel Profile" onSave={handleSaveFuel} onCancel={() => void cancelEditing()} />
                  </>
                ) : (
                  <>
                    <FuelSummary form={fuelForm} provider={fuelProvider} />
                    <EditButton onClick={startEditing}>Edit Fuel Profile</EditButton>
                  </>
                )}
              </Panel>
            </StoreSpecificGate>
          )}

          {activeSection === 'hours' && (
            <StoreSpecificGate blocked={singleStoreRequired} loading={storeLoading} message="Select a specific store to edit business hours.">
              <Panel icon={Clock} title="Business Hours" description="Timezone and daily open/close settings.">
                {isEditing ? (
                  <>
                    <Field label="Timezone"><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></Field>
                    <HoursEditor hours={hours} onChange={setHours} />
                    <FormActions saving={saving === 'hours'} saveLabel="Save Business Hours" onSave={handleSaveHours} onCancel={() => void cancelEditing()} />
                  </>
                ) : (
                  <>
                    <BusinessHoursSummary timezone={timezone} hours={hours} />
                    <EditButton onClick={startEditing}>Edit Business Hours</EditButton>
                  </>
                )}
              </Panel>
            </StoreSpecificGate>
          )}

          {activeSection === 'licenses' && (
            <StoreSpecificGate blocked={singleStoreRequired} loading={storeLoading} message="Select a specific store to manage licenses and tax IDs.">
              <Panel icon={Shield} title="Licenses & Tax IDs" description="Repeatable license and tax records for the selected store.">
                <div className="mb-4 flex justify-end">
                  {!showAddLicense ? <Button variant="outline" onClick={() => setShowAddLicense(true)}><Plus className="mr-2 h-4 w-4" />Add License / Tax ID</Button> : null}
                </div>
                {showAddLicense ? (
                  <div className="mb-5 rounded-xl border p-4">
                    <LicenseFields form={newLicense} onChange={setNewLicense} />
                    <FormActions saving={saving === 'licenses'} saveLabel="Save License" onSave={handleAddLicense} onCancel={() => { setShowAddLicense(false); setNewLicense(EMPTY_LICENSE); }} />
                  </div>
                ) : null}
                <div className="grid gap-3">
                  {licenses.length === 0 ? (
                    <EmptyState icon={Shield} text="No license or tax records yet." />
                  ) : (
                    licenses.map((license) => (
                      editingLicenseId === license.id ? (
                        <div key={license.id} className="rounded-xl border p-4">
                          <LicenseFields form={editLicenseForm} onChange={setEditLicenseForm} />
                          <FormActions saving={saving === 'licenses'} saveLabel="Save Changes" onSave={handleUpdateLicense} onCancel={cancelEditLicense} />
                        </div>
                      ) : (
                        <LicenseCard
                          key={license.id}
                          license={license}
                          onEdit={() => startEditLicense(license)}
                          onDelete={() => void handleDeleteLicense(license.id)}
                        />
                      )
                    ))
                  )}
                </div>
                <DocumentsAndFilesSection
                  documents={storeDocuments}
                  saving={saving === 'licenses'}
                  showUploadForm={showDocUploadForm}
                  docType={docType}
                  docNotes={docNotes}
                  onShowUploadForm={() => setShowDocUploadForm(true)}
                  onCancelUpload={() => {
                    setShowDocUploadForm(false);
                    setDocType('Other');
                    setDocNotes('');
                  }}
                  onDocTypeChange={setDocType}
                  onDocNotesChange={setDocNotes}
                  onUpload={(file) => void handleUploadStoreDocument(file)}
                  onView={(fileName) => void handleViewStoreDocument(fileName)}
                  onDelete={(fileName) => void handleDeleteStoreDocument(fileName)}
                />
              </Panel>
            </StoreSpecificGate>
          )}

          {activeSection === 'notifications' && (
            <Panel icon={Bell} title="Notifications" description="In-app notification preferences save now. Other channels are reserved for later.">
              {isEditing ? (
                <>
                  <NotificationRows notifications={notifications} onChange={setNotifications} editable />
                  <FormActions saving={saving === 'notifications'} saveLabel="Save Notifications" onSave={handleSaveNotifications} onCancel={() => void cancelEditing()} />
                </>
              ) : (
                <>
                  <NotificationSummary notifications={notifications} />
                  <EditButton onClick={startEditing}>Edit Notifications</EditButton>
                </>
              )}
            </Panel>
          )}

          {activeSection === 'bank' && (
            <StoreSpecificGate blocked={singleStoreRequired} loading={storeLoading} message="Select a specific store to manage bank/check setup.">
              <Panel icon={Landmark} title="Bank & Check Setup" description="Only last 4 digits are saved. Full encrypted bank storage is required before production.">
                {isEditing ? (
                  <>
                    <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Never enter production bank data here until encrypted storage is implemented.</p>
                    <BankFields form={bankForm} onChange={setBankForm} />
                    <FormActions saving={saving === 'bank'} saveLabel="Save Bank & Check Setup" onSave={handleSaveBank} onCancel={() => void cancelEditing()} />
                  </>
                ) : (
                  <>
                    <BankSummary profile={bankProfile} />
                    <EditButton onClick={startEditing}>Edit Bank & Check Setup</EditButton>
                  </>
                )}
              </Panel>
            </StoreSpecificGate>
          )}

          {activeSection === 'billing' && (
            <Panel icon={CreditCard} title="Billing" description="Read-only billing and available plan summary. Stripe is not connected here.">
              <div className="grid gap-3 md:grid-cols-5">
                <SummaryField label="Current Plan" value={activeStore?.plan || 'Starter'} />
                <SummaryField label="Billing Status" value={activeStore?.billing_status || activeStore?.subscription_status || 'Trial'} />
                <SummaryField label="Store Limit" value={activeStore?.allowed_store_count ?? 'Coming soon'} />
                <SummaryField label="User Limit" value={activeStore?.allowed_user_count ?? 'Coming soon'} />
                <SummaryField label="Next Billing Date" value="Coming soon" />
              </div>
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-foreground">Available Plans</h3>
                {availablePlans.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Plans will appear here after Superadmin creates subscription plans.</p>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {availablePlans.map((plan) => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        isCurrentPlan={String(activeStore?.plan || '').toLowerCase() === String(plan.plan_code || '').toLowerCase()}
                      />
                    ))}
                  </div>
                )}
              </div>
              <Button className="mt-5" variant="outline" disabled>Request Plan Change</Button>
            </Panel>
          )}

          {activeSection === 'security' && (
            <Panel icon={ShieldCheck} title="Security" description="Read-only security placeholders for prototype testing.">
              <div className="grid gap-4 md:grid-cols-2">
                <SummaryField label="Two-factor authentication" value="Not enabled" />
                <SummaryField label="Current session" value="Active" />
                <SummaryField label="Last sign-in" value={user.last_sign_in_at || 'Unavailable'} />
                <SummaryField label="Device/session history" value="Coming soon" />
              </div>
              <Button className="mt-4" variant="outline" disabled>Configure 2FA</Button>
            </Panel>
          )}
        </Card>
      </div>

      {addStoreOpen ? (
        <AddStoreModal
          form={newStoreForm}
          saving={saving === 'add-store'}
          onChange={setNewStoreForm}
          onClose={() => setAddStoreOpen(false)}
          onSubmit={handleAddStore}
        />
      ) : null}
    </DashboardShell>
  );
}

function Message({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const Icon = tone === 'success' ? CheckCircle : AlertCircle;
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function Panel({ icon: Icon, title, description, children }: { icon: typeof Store; title: string; description: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
        <div><h2 className="font-semibold text-foreground">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function SummaryField({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value || 'Not set'}</p>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
    </select>
  );
}

function EditButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <Button className="mt-5" variant="outline" onClick={onClick}><Pencil className="mr-2 h-4 w-4" />{children}</Button>;
}

function FormActions({ saving, saveLabel, onSave, onCancel }: { saving: boolean; saveLabel: string; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Button variant="outline" onClick={onCancel} disabled={saving}><X className="mr-2 h-4 w-4" />Cancel</Button>
      <Button onClick={onSave} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{saving ? 'Saving...' : saveLabel}</Button>
    </div>
  );
}

function StoreSpecificGate({ blocked, loading, message, children }: { blocked: boolean; loading: boolean; message: string; children: ReactNode }) {
  if (loading) return <div className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading store data...</div>;
  if (blocked) return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{message}</div>;
  return <>{children}</>;
}

function StoreChoice({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-xl border p-4 text-left transition hover:bg-secondary ${active ? 'border-teal-500 bg-teal-50' : 'bg-white'}`}><p className="font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></button>;
}

function StoreProfileSummary({ form }: { form: ProfileForm }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <SummaryField label="Store Name" value={form.store_name} />
      <SummaryField label="Legal Business Name" value={form.business_legal_name} />
      <SummaryField label="DBA Name" value={form.dba_name} />
      <SummaryField label="Store Email" value={form.store_email} />
      <SummaryField label="Address Line 1" value={form.address_line1} />
      <SummaryField label="Address Line 2" value={form.address_line2} />
      <SummaryField label="City / Town" value={form.city} />
      <SummaryField label="State" value={form.state} />
      <SummaryField label="ZIP Code" value={form.zip_code} />
      <SummaryField label="Country" value={form.country} />
      <SummaryField label="Store Phone" value={form.phone_number} />
      <SummaryField label="Owner Phone Number" value={form.owner_phone_number} />
      <SummaryField label="Store Type" value={form.store_type} />
      {form.store_type === 'Other' ? <SummaryField label="Custom Store Type" value={form.custom_store_type} /> : null}
      <SummaryField label="POS Type" value={form.pos_type} />
      <SummaryField label="Register Count" value={form.register_count} />
    </div>
  );
}

function ProfileFields({ form, onChange }: { form: ProfileForm; onChange: (form: ProfileForm) => void }) {
  const update = (key: keyof ProfileForm, value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Store Name"><Input value={form.store_name} onChange={(event) => update('store_name', event.target.value)} /></Field>
      <Field label="Legal Business Name"><Input value={form.business_legal_name} onChange={(event) => update('business_legal_name', event.target.value)} /></Field>
      <Field label="DBA Name"><Input value={form.dba_name} onChange={(event) => update('dba_name', event.target.value)} /></Field>
      <Field label="Store Email"><Input type="email" value={form.store_email} onChange={(event) => update('store_email', event.target.value)} /></Field>
      <Field label="Address Line 1"><Input value={form.address_line1} onChange={(event) => update('address_line1', event.target.value)} /></Field>
      <Field label="Address Line 2"><Input value={form.address_line2} onChange={(event) => update('address_line2', event.target.value)} /></Field>
      <Field label="City / Town"><Input value={form.city} onChange={(event) => update('city', event.target.value)} /></Field>
      <Field label="State"><Input value={form.state} onChange={(event) => update('state', event.target.value)} /></Field>
      <Field label="ZIP Code"><Input value={form.zip_code} onChange={(event) => update('zip_code', event.target.value)} /></Field>
      <Field label="Country"><Input value={form.country} onChange={(event) => update('country', event.target.value)} /></Field>
      <Field label="Store Phone"><Input value={form.phone_number} onChange={(event) => update('phone_number', event.target.value)} /></Field>
      <Field label="Owner Phone Number"><Input value={form.owner_phone_number} onChange={(event) => update('owner_phone_number', event.target.value)} /></Field>
      <Field label="Store Type"><Select value={form.store_type} onChange={(value) => update('store_type', value)} options={[['', 'Select store type'], ...STORE_TYPES.map((type): [string, string] => [type, type])]} /></Field>
      {form.store_type === 'Other' ? <Field label="Custom Store Type"><Input value={form.custom_store_type} onChange={(event) => update('custom_store_type', event.target.value)} /></Field> : null}
      <Field label="POS Type"><Select value={form.pos_type} onChange={(value) => update('pos_type', value)} options={[['', 'Select POS'], ...POS_TYPES.map((type): [string, string] => [type, type])]} /></Field>
      <Field label="Register Count"><Input type="number" min={1} value={form.register_count} onChange={(event) => update('register_count', event.target.value)} /></Field>
    </div>
  );
}

function FuelSummary({ form, provider }: { form: FuelForm; provider: StoreFuelProvider | null }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <SummaryField label="This store sells fuel" value={form.has_fuel ? 'Yes' : 'No'} />
      <SummaryField label="Fuel Brand" value={form.fuel_brand} />
      <SummaryField label="Number of Pumps" value={form.pump_count || provider?.pump_count} />
      <SummaryField label="Distributor Type" value={form.distributor_type || provider?.distributor_type} />
      <SummaryField label="Provider Company Name" value={form.provider_company_name || provider?.provider_company_name || provider?.provider_name} />
      <SummaryField label="Provider Address" value={form.provider_address || provider?.provider_address || provider?.address} />
      <SummaryField label="Sales Rep Name" value={form.sales_rep_name || provider?.sales_rep_name} />
      <SummaryField label="Phone" value={form.phone || provider?.phone} />
      <SummaryField label="Email" value={form.email || provider?.email} />
      <SummaryField label="Website" value={form.website || provider?.website} />
      <SummaryField label="Notes" value={form.notes || provider?.notes} />
    </div>
  );
}

function FuelFields({ form, onChange }: { form: FuelForm; onChange: (form: FuelForm) => void }) {
  const update = (key: keyof FuelForm, value: string | boolean) => onChange({ ...form, [key]: value });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={form.has_fuel} onChange={(event) => update('has_fuel', event.target.checked)} />This store sells fuel</label>
      <Field label="Fuel Brand"><Input value={form.fuel_brand} onChange={(event) => update('fuel_brand', event.target.value)} /></Field>
      <Field label="Number of Pumps"><Input type="number" value={form.pump_count} onChange={(event) => update('pump_count', event.target.value)} /></Field>
      <Field label="Fuel Provider / Distributor"><Input value={form.distributor_type} onChange={(event) => update('distributor_type', event.target.value)} /></Field>
      <Field label="Provider Company Name"><Input value={form.provider_company_name} onChange={(event) => update('provider_company_name', event.target.value)} /></Field>
      <Field label="Provider Address"><Input value={form.provider_address} onChange={(event) => update('provider_address', event.target.value)} /></Field>
      <Field label="Provider Name"><Input value={form.provider_name} onChange={(event) => update('provider_name', event.target.value)} /></Field>
      <Field label="Address"><Input value={form.address} onChange={(event) => update('address', event.target.value)} /></Field>
      <Field label="Sales Rep Name"><Input value={form.sales_rep_name} onChange={(event) => update('sales_rep_name', event.target.value)} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></Field>
      <Field label="Email"><Input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></Field>
      <Field label="Website"><Input value={form.website} onChange={(event) => update('website', event.target.value)} /></Field>
      <Field label="Notes"><Input value={form.notes} onChange={(event) => update('notes', event.target.value)} /></Field>
    </div>
  );
}

function BusinessHoursSummary({ timezone, hours }: { timezone: string; hours: OperatingHours }) {
  return (
    <div className="space-y-3">
      <SummaryField label="Timezone" value={timezone} />
      <div className="grid gap-3 md:grid-cols-2">
        {DAY_KEYS.map((day) => (
          <SummaryField key={day} label={dayLabel(day)} value={hours[day].closed ? 'Closed' : `${hours[day].open} - ${hours[day].close}`} />
        ))}
      </div>
    </div>
  );
}

function HoursEditor({ hours, onChange }: { hours: OperatingHours; onChange: (hours: OperatingHours) => void }) {
  const update = (day: DayKey, patch: Partial<DayHours>) => onChange({ ...hours, [day]: { ...hours[day], ...patch } });
  return (
    <div className="mt-4 space-y-2">
      {DAY_KEYS.map((day) => (
        <div key={day} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[140px_120px_1fr_1fr] md:items-center">
          <p className="font-medium">{dayLabel(day)}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hours[day].closed} onChange={(event) => update(day, { closed: event.target.checked })} />Closed</label>
          <Input type="time" disabled={hours[day].closed} value={hours[day].open} onChange={(event) => update(day, { open: event.target.value })} />
          <Input type="time" disabled={hours[day].closed} value={hours[day].close} onChange={(event) => update(day, { close: event.target.value })} />
        </div>
      ))}
    </div>
  );
}

function LicenseFields({ form, onChange }: { form: NewLicense; onChange: (form: NewLicense) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-5">
      <Select value={form.license_name} onChange={(value) => onChange({ ...form, license_name: value })} options={LICENSE_SUGGESTIONS.map((name): [string, string] => [name, name])} />
      <Input placeholder="Number / ID" value={form.license_number} onChange={(event) => onChange({ ...form, license_number: event.target.value })} />
      <Input type="date" value={form.valid_from} onChange={(event) => onChange({ ...form, valid_from: event.target.value })} />
      <Input type="date" value={form.expires_on} onChange={(event) => onChange({ ...form, expires_on: event.target.value })} />
      <Input placeholder="Notes" value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} />
    </div>
  );
}

function LicenseCard({ license, onEdit, onDelete }: { license: StoreLicense; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
      <div>
        <p className="font-medium">{license.license_name}</p>
        <p className="text-sm text-muted-foreground">{license.license_number || 'No number'} | Valid {license.valid_from || 'not set'} | Expires {license.expires_on || 'not set'}</p>
        {license.notes ? <p className="mt-1 text-sm text-muted-foreground">{license.notes}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function DocumentsAndFilesSection({
  documents,
  saving,
  showUploadForm,
  docType,
  docNotes,
  onShowUploadForm,
  onCancelUpload,
  onDocTypeChange,
  onDocNotesChange,
  onUpload,
  onView,
  onDelete,
}: {
  documents: StoreStorageFile[];
  saving: boolean;
  showUploadForm: boolean;
  docType: string;
  docNotes: string;
  onShowUploadForm: () => void;
  onCancelUpload: () => void;
  onDocTypeChange: (value: string) => void;
  onDocNotesChange: (value: string) => void;
  onUpload: (file: File) => void;
  onView: (fileName: string) => void;
  onDelete: (fileName: string) => void;
}) {
  return (
    <div className="mt-8 border-t pt-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Documents & Files</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload PDFs or images for this store. Files are stored only; no OCR or extraction runs here.
          </p>
        </div>
        {!showUploadForm ? (
          <Button variant="outline" onClick={onShowUploadForm}><Upload className="mr-2 h-4 w-4" />Upload Document</Button>
        ) : null}
      </div>

      {showUploadForm ? (
        <div className="mb-5 rounded-xl border p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Document Type">
              <Select value={docType} onChange={onDocTypeChange} options={DOCUMENT_TYPES.map((type): [string, string] => [type, type])} />
            </Field>
            <Field label="Notes">
              <Input value={docNotes} onChange={(event) => onDocNotesChange(event.target.value)} placeholder="Optional note" />
            </Field>
            <Field label="Choose File">
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                disabled={saving}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.target.value = '';
                }}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onCancelUpload} disabled={saving}><X className="mr-2 h-4 w-4" />Cancel</Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3">
        {documents.length === 0 ? (
          <EmptyState icon={FileText} text="No documents uploaded yet." />
        ) : (
          documents.map((document) => (
            <div key={document.name} className="flex items-center justify-between gap-3 rounded-xl border p-4">
              <div className="flex min-w-0 items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{cleanStorageFileName(document.name)}</p>
                  <p className="text-sm text-muted-foreground">{formatBytes(document.metadata?.size)}{document.metadata?.mimetype ? ` | ${document.metadata.mimetype}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onView(document.name)}><Eye className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => onDelete(document.name)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function NotificationSummary({ notifications }: { notifications: NotificationPrefs }) {
  return (
    <div>
      <NotificationRows notifications={notifications} onChange={() => undefined} editable={false} />
      <p className="mt-3 text-xs text-muted-foreground">Email, SMS, and push channels are coming soon.</p>
    </div>
  );
}

function NotificationRows({ notifications, onChange, editable }: { notifications: NotificationPrefs; onChange: (notifications: NotificationPrefs) => void; editable: boolean }) {
  const rows: Array<{ key: keyof NotificationPrefs; label: string }> = [
    { key: 'low_stock', label: 'Low stock alerts' },
    { key: 'upload_complete', label: 'Upload completion alerts' },
    { key: 'support_reply', label: 'Support ticket replies' },
    { key: 'vendor_delivery', label: 'Vendor delivery reminders' },
    { key: 'new_login', label: 'New login notification' },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Preference</th><th className="px-3 py-2">In-app</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">SMS</th><th className="px-3 py-2">Push</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <td className="px-3 py-3 font-medium">{row.label}</td>
              <td className="px-3 py-3">{editable ? <input type="checkbox" checked={notifications[row.key]} onChange={(event) => onChange({ ...notifications, [row.key]: event.target.checked })} /> : notifications[row.key] ? <Check className="h-4 w-4 text-emerald-600" /> : 'Off'}</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">Soon</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">Soon</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">Soon</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BankSummary({ profile }: { profile: StoreBankProfile | null }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SummaryField label="Bank Name" value={profile?.bank_name} />
        <SummaryField label="Account Holder Name" value={profile?.account_holder_name} />
        <SummaryField label="Account Type" value={profile?.account_type} />
        <SummaryField label="Routing" value={maskLast4(profile?.routing_last4)} />
        <SummaryField label="Account" value={maskLast4(profile?.account_last4)} />
        <SummaryField label="Starting Check Number" value={profile?.starting_check_number} />
        <SummaryField label="Authorized Signer" value={profile?.authorized_signer_name} />
        <SummaryField label="Default Check Memo" value={profile?.default_check_memo} />
        <SummaryField label="Security Note" value={profile?.security_note || EMPTY_BANK.security_note} />
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Only last 4 digits are saved now. Full encrypted bank storage must be implemented before production.</p>
    </div>
  );
}

function BankFields({ form, onChange }: { form: BankForm; onChange: (form: BankForm) => void }) {
  const update = (key: keyof BankForm, value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Bank Name"><Input value={form.bank_name} onChange={(event) => update('bank_name', event.target.value)} /></Field>
      <Field label="Account Holder Name"><Input value={form.account_holder_name} onChange={(event) => update('account_holder_name', event.target.value)} /></Field>
      <Field label="Account Type"><Select value={form.account_type} onChange={(value) => update('account_type', value)} options={[['checking', 'Checking'], ['savings', 'Savings']]} /></Field>
      <Field label="Routing Number"><Input value={form.routing_number} onChange={(event) => update('routing_number', event.target.value)} placeholder="Only last 4 will be saved" /></Field>
      <Field label="Account Number"><Input value={form.account_number} onChange={(event) => update('account_number', event.target.value)} placeholder="Only last 4 will be saved" /></Field>
      <Field label="Starting Check Number"><Input value={form.starting_check_number} onChange={(event) => update('starting_check_number', event.target.value)} /></Field>
      <Field label="Authorized Signer Name"><Input value={form.authorized_signer_name} onChange={(event) => update('authorized_signer_name', event.target.value)} /></Field>
      <Field label="Default Check Memo"><Input value={form.default_check_memo} onChange={(event) => update('default_check_memo', event.target.value)} /></Field>
      <Field label="Security Note"><Input value={form.security_note} onChange={(event) => update('security_note', event.target.value)} /></Field>
    </div>
  );
}

function PlanCard({ plan, isCurrentPlan }: { plan: PlatformPlan; isCurrentPlan: boolean }) {
  const features = planFeatures(plan.features);
  return (
    <div className={`rounded-xl border p-4 ${isCurrentPlan ? 'border-teal-500 bg-teal-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{plan.plan_name}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{plan.plan_code}</p>
        </div>
        {isCurrentPlan ? <span className="rounded-full bg-teal-600 px-2 py-1 text-xs font-medium text-white">Current</span> : null}
      </div>
      <p className="mt-3 text-lg font-semibold">{formatMoney(plan.monthly_price)}<span className="text-xs font-normal text-muted-foreground"> / mo</span></p>
      <p className="text-sm text-muted-foreground">Yearly: {formatMoney(plan.yearly_price)} / year</p>
      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <span>Trial: {plan.trial_days ?? 0} day free trial</span>
        <span>Stores: Up to {plan.max_stores ?? 'unlimited'} store(s)</span>
        <span>Users: {plan.max_users_per_store ?? 'unlimited'} user(s) per store</span>
        <span>Products: {plan.max_products ?? 'unlimited'}</span>
        <span>Uploads/month: {plan.max_uploads_per_month ?? 'unlimited'}</span>
        <span>AI requests/month: {plan.max_ai_requests_per_month ?? 'unlimited'}</span>
      </div>
      {features.length ? (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{features.slice(0, 6).map((feature) => <li key={feature}>- {feature}</li>)}</ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No features listed</p>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Store; text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      <Icon className="mx-auto mb-2 h-5 w-5" />
      {text}
    </div>
  );
}

function AddStoreModal({ form, saving, onChange, onClose, onSubmit }: { form: ProfileForm; saving: boolean; onChange: (form: ProfileForm) => void; onClose: () => void; onSubmit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close add store modal" className="flex-1 bg-black/50" onClick={onClose} />
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-background p-5 shadow-xl">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-semibold">Add New Store</h2><p className="text-sm text-muted-foreground">Active authenticated store owners can add stores in this MVP.</p></div><Button variant="ghost" onClick={onClose}>Close</Button></div>
        <ProfileFields form={form} onChange={onChange} />
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Add Store</Button></div>
      </aside>
    </div>
  );
}
