'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type DayKey =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export type OperatingHourRow = {
  closed: boolean;
  open: string;
  close: string;
};

export type OperatingHours = Record<DayKey, OperatingHourRow>;

export type PosTypeOption = {
  id?: string;
  name: string;
  pos_key: string;
  description?: string | null;
};

export type StoreUserProfile = {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  customRole?: string | null;
  isActive?: boolean;
};

export type CustomField = {
  id?: string;
  label: string;
  value: string;
};

export type PrimaryContact = {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  customRole?: string | null;
};

export type StoreProfileFormValues = {
  id?: string;

  owner_id?: string | null;
  allowed_user_count?: number | null;
  primary_owner_email?: string | null;
  primary_contacts?: PrimaryContact[] | null;
  custom_fields?: CustomField[] | null;

  store_name: string;
  store_code?: string | null;
  logo_url?: string | null;

  manager_name?: string | null;
  manager_phone?: string | null;
  manager_email?: string | null;

  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  country?: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;

  store_type?: string | null;
  pos_type?: string | null;
  register_count?: number | null;
  has_fuel?: boolean;
  fuel_brand?: string | null;

  business_legal_name?: string | null;
  dba_name?: string | null;
  ein_tax_id?: string | null;
  sales_tax_permit?: string | null;
  tobacco_license?: string | null;
  alcohol_license?: string | null;

  lottery_enabled?: boolean;
  atm_enabled?: boolean;
  money_order_enabled?: boolean;
  ebt_accepted?: boolean;

  operating_hours?: OperatingHours | null;
  store_users?: StoreUserProfile[] | null;

  plan?: string | null;
  subscription_status?: string | null;
  billing_status?: string | null;
  billing_provider?: string | null;
  billing_customer_id?: string | null;
  billing_subscription_id?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  cancel_at?: string | null;
  subscription_notes?: string | null;
  billing_custom_fields?: CustomField[] | null;

  compliance_fields?: CustomField[] | null;
  compliance_notes?: string | null;
  compliance_file_urls?: string[] | null;
  notes?: string | null;
};

type StoreProfileFormProps = {
  initialValues?: Partial<StoreProfileFormValues> | null;
  posTypes?: PosTypeOption[];
  isSubmitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: StoreProfileFormValues) => void | Promise<void>;
  onCancel?: () => void;
  onAddPosType?: () => void;
};

type StoreProfileFormState = Omit<
  StoreProfileFormValues,
  'allowed_user_count' | 'register_count' | 'latitude' | 'longitude' | 'operating_hours'
> & {
  register_count: string;
  latitude: string;
  longitude: string;
  operating_hours: OperatingHours;
  allowed_user_count: string;
  primary_contacts: PrimaryContact[];
  custom_fields: CustomField[];
  store_users: StoreUserProfile[];
  billing_custom_fields: CustomField[];
  compliance_fields: CustomField[];
  compliance_file_urls: string[];
};

const DAY_LABELS: Array<{ key: DayKey; label: string }> = [
  { key: 'sunday', label: 'Sunday' },
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
];

const DEFAULT_OPERATING_HOURS: OperatingHours = {
  sunday: { closed: true, open: '08:00', close: '22:00' },
  monday: { closed: false, open: '08:00', close: '22:00' },
  tuesday: { closed: false, open: '08:00', close: '22:00' },
  wednesday: { closed: false, open: '08:00', close: '22:00' },
  thursday: { closed: false, open: '08:00', close: '22:00' },
  friday: { closed: false, open: '08:00', close: '22:00' },
  saturday: { closed: false, open: '08:00', close: '22:00' },
};

const DEFAULT_FORM_VALUES: StoreProfileFormState = {
  owner_id: '',
  allowed_user_count: '1',
  primary_owner_email: '',
  primary_contacts: [],
  custom_fields: [],

  store_name: '',
  store_code: '',
  logo_url: '',

  manager_name: '',
  manager_phone: '',
  manager_email: '',

  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  zip_code: '',
  country: 'United States',
  timezone: 'America/Chicago',
  latitude: '',
  longitude: '',

  store_type: 'Convenience Store',
  pos_type: '',
  register_count: '1',
  has_fuel: false,
  fuel_brand: '',

  business_legal_name: '',
  dba_name: '',
  ein_tax_id: '',
  sales_tax_permit: '',
  tobacco_license: '',
  alcohol_license: '',

  lottery_enabled: false,
  atm_enabled: false,
  money_order_enabled: false,
  ebt_accepted: false,

  operating_hours: DEFAULT_OPERATING_HOURS,
  store_users: [],

  plan: 'starter',
  subscription_status: 'trialing',
  billing_status: 'trial',
  billing_provider: '',
  billing_customer_id: '',
  billing_subscription_id: '',
  current_period_start: '',
  current_period_end: '',
  trial_ends_at: '',
  cancel_at: '',
  subscription_notes: '',
  billing_custom_fields: [],

  compliance_fields: [],
  compliance_notes: '',
  compliance_file_urls: [],
  notes: '',
};

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

const labelClass = 'mb-1 block text-sm font-medium text-slate-700';

const sectionClass =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';

function normalizeOperatingHours(value: unknown): OperatingHours {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_OPERATING_HOURS;
  }

  const source = value as Partial<Record<DayKey, Partial<OperatingHourRow>>>;

  return DAY_LABELS.reduce((acc, day) => {
    const current = source[day.key];

    acc[day.key] = {
      closed:
        typeof current?.closed === 'boolean'
          ? current.closed
          : DEFAULT_OPERATING_HOURS[day.key].closed,
      open:
        typeof current?.open === 'string' && current.open
          ? current.open
          : DEFAULT_OPERATING_HOURS[day.key].open,
      close:
        typeof current?.close === 'string' && current.close
          ? current.close
          : DEFAULT_OPERATING_HOURS[day.key].close,
    };

    return acc;
  }, {} as OperatingHours);
}

function normalizeStoreUsers(value: unknown): StoreUserProfile[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const user = item as StoreUserProfile & {
        role_label?: string | null;
        custom_role_label?: string | null;
        is_active?: boolean;
      };

      return {
        id: valueToString(user.id) || crypto.randomUUID(),
        name: valueToString(user.name),
        email: valueToString(user.email),
        phone: valueToString(user.phone),
        role: valueToString(user.role || user.role_label || 'Employee'),
        customRole: valueToString(user.customRole || user.custom_role_label),
        isActive: user.isActive !== false && user.is_active !== false,
      };
    });
}

function normalizeCustomFields(value: unknown): CustomField[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const field = item as CustomField;

      return {
        id: valueToString(field.id) || crypto.randomUUID(),
        label: valueToString(field.label),
        value: valueToString(field.value),
      };
    })
    .filter((field) => field.label || field.value);
}

function normalizePrimaryContacts(value: unknown): PrimaryContact[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const contact = item as PrimaryContact;

      return {
        id: valueToString(contact.id) || crypto.randomUUID(),
        name: valueToString(contact.name),
        email: valueToString(contact.email),
        phone: valueToString(contact.phone),
        role: valueToString(contact.role || 'Owner'),
        customRole: valueToString(contact.customRole),
      };
    });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function valueToBoolean(value: unknown): boolean {
  return value === true;
}

function dateInputValue(value: unknown): string {
  if (!value || typeof value !== 'string') return '';
  return value.slice(0, 10);
}

function toFormState(initialValues?: Partial<StoreProfileFormValues> | null): StoreProfileFormState {
  if (!initialValues) {
    return {
      ...DEFAULT_FORM_VALUES,
      operating_hours: normalizeOperatingHours(DEFAULT_FORM_VALUES.operating_hours),
    };
  }

  const legacyAddress = (initialValues as StoreProfileFormValues & { store_address?: string | null })
    .store_address;

  return {
    ...DEFAULT_FORM_VALUES,

    id: initialValues.id,
    owner_id: valueToString(initialValues.owner_id),
    allowed_user_count: valueToString(initialValues.allowed_user_count || 1),
    primary_owner_email: valueToString(initialValues.primary_owner_email),
    primary_contacts: normalizePrimaryContacts(initialValues.primary_contacts),
    custom_fields: normalizeCustomFields(initialValues.custom_fields),

    store_name: valueToString(initialValues.store_name),
    store_code: valueToString(initialValues.store_code),
    logo_url: valueToString(initialValues.logo_url),

    manager_name: valueToString(initialValues.manager_name),
    manager_phone: valueToString(initialValues.manager_phone),
    manager_email: valueToString(initialValues.manager_email),

    address_line1: valueToString(initialValues.address_line1 || legacyAddress),
    address_line2: valueToString(initialValues.address_line2),
    city: valueToString(initialValues.city),
    state: valueToString(initialValues.state),
    zip_code: valueToString(initialValues.zip_code),
    country: valueToString(initialValues.country || DEFAULT_FORM_VALUES.country),
    timezone: valueToString(initialValues.timezone || DEFAULT_FORM_VALUES.timezone),
    latitude: valueToString(initialValues.latitude),
    longitude: valueToString(initialValues.longitude),

    store_type: valueToString(initialValues.store_type || DEFAULT_FORM_VALUES.store_type),
    pos_type: valueToString(initialValues.pos_type),
    register_count: valueToString(initialValues.register_count || 1),
    has_fuel: valueToBoolean(initialValues.has_fuel),
    fuel_brand: valueToString(initialValues.fuel_brand),

    business_legal_name: valueToString(initialValues.business_legal_name),
    dba_name: valueToString(initialValues.dba_name),
    ein_tax_id: valueToString(initialValues.ein_tax_id),
    sales_tax_permit: valueToString(initialValues.sales_tax_permit),
    tobacco_license: valueToString(initialValues.tobacco_license),
    alcohol_license: valueToString(initialValues.alcohol_license),

    lottery_enabled: valueToBoolean(initialValues.lottery_enabled),
    atm_enabled: valueToBoolean(initialValues.atm_enabled),
    money_order_enabled: valueToBoolean(initialValues.money_order_enabled),
    ebt_accepted: valueToBoolean(initialValues.ebt_accepted),

    operating_hours: normalizeOperatingHours(initialValues.operating_hours),
    store_users: normalizeStoreUsers(initialValues.store_users),

    plan: valueToString(initialValues.plan || DEFAULT_FORM_VALUES.plan),
    subscription_status: valueToString(
      initialValues.subscription_status || DEFAULT_FORM_VALUES.subscription_status
    ),
    billing_status: valueToString(initialValues.billing_status || DEFAULT_FORM_VALUES.billing_status),
    billing_provider: valueToString(initialValues.billing_provider),
    billing_customer_id: valueToString(initialValues.billing_customer_id),
    billing_subscription_id: valueToString(initialValues.billing_subscription_id),
    current_period_start: dateInputValue(initialValues.current_period_start),
    current_period_end: dateInputValue(initialValues.current_period_end),
    trial_ends_at: dateInputValue(initialValues.trial_ends_at),
    cancel_at: dateInputValue(initialValues.cancel_at),
    subscription_notes: valueToString(initialValues.subscription_notes),
    billing_custom_fields: normalizeCustomFields(initialValues.billing_custom_fields),

    compliance_fields: normalizeCustomFields(initialValues.compliance_fields),
    compliance_notes: valueToString(initialValues.compliance_notes),
    compliance_file_urls: normalizeStringArray(initialValues.compliance_file_urls),
    notes: valueToString(initialValues.notes),
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function numericOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

export function StoreProfileForm({
  initialValues,
  posTypes = [],
  isSubmitting = false,
  submitLabel = 'Save Store',
  onSubmit,
  onCancel,
  onAddPosType,
}: StoreProfileFormProps) {
  const [values, setValues] = useState<StoreProfileFormState>(() => toFormState(initialValues));
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [complianceUploadError, setComplianceUploadError] = useState<string | null>(null);
  const [complianceUploading, setComplianceUploading] = useState(false);

  useEffect(() => {
    setValues(toFormState(initialValues));
  }, [initialValues]);

  const sortedPosTypes = useMemo(() => {
    return [...posTypes].sort((a, b) => a.name.localeCompare(b.name));
  }, [posTypes]);
  const allowedUserCount = Number(values.allowed_user_count || 1);
  const userLimitReached = values.store_users.length >= allowedUserCount;

  function setField<K extends keyof StoreProfileFormState>(
    field: K,
    value: StoreProfileFormState[K]
  ) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function setOperatingHour(day: DayKey, update: Partial<OperatingHourRow>) {
    setValues((current) => ({
      ...current,
      operating_hours: {
        ...current.operating_hours,
        [day]: {
          ...current.operating_hours[day],
          ...update,
        },
      },
    }));
  }

  function safeFileName(name: string) {
    return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
  }

  async function uploadStorageFile(
    bucket: string,
    file: File,
    pathPrefix: 'stores' | 'temp' | 'compliance'
  ) {
    if (!file) {
      throw new Error('Choose a file to upload.');
    }

    if (!file.type.startsWith('image/') && bucket === 'store-logos') {
      throw new Error('Store logo upload must be an image file.');
    }

    const storePath = values.id ? `${pathPrefix}/${values.id}` : 'temp';
    const path = `${storePath}/${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file);

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    return path;
  }

  async function handleLogoUpload(file: File | null | undefined) {
    setLogoUploadError(null);

    try {
      if (!file) throw new Error('Choose an image to upload.');

      setLogoUploading(true);
      const path = await uploadStorageFile('store-logos', file, 'stores');
      const { data } = supabase.storage.from('store-logos').getPublicUrl(path);

      if (!data.publicUrl) {
        throw new Error('Upload completed, but no public URL was returned.');
      }

      setField('logo_url', data.publicUrl);
    } catch (error) {
      setLogoUploadError(error instanceof Error ? error.message : 'Unable to upload logo.');
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleComplianceUpload(file: File | null | undefined) {
    setComplianceUploadError(null);

    try {
      if (!file) throw new Error('Choose a compliance document to upload.');

      setComplianceUploading(true);
      const path = await uploadStorageFile('store-compliance-files', file, 'compliance');
      setField('compliance_file_urls', [...values.compliance_file_urls, path]);
    } catch (error) {
      setComplianceUploadError(
        error instanceof Error ? error.message : 'Unable to upload compliance document.'
      );
    } finally {
      setComplianceUploading(false);
    }
  }

  function updateStoreUser(index: number, update: Partial<StoreUserProfile>) {
    setField(
      'store_users',
      values.store_users.map((user, userIndex) =>
        userIndex === index ? { ...user, ...update } : user
      )
    );
  }

  function addStoreUser() {
    const allowedUserCount = Number(values.allowed_user_count || 1);

    if (values.store_users.length >= allowedUserCount) {
      return;
    }

    setField('store_users', [
      ...values.store_users,
      {
        id: crypto.randomUUID(),
        name: '',
        email: '',
        phone: '',
        role: 'Employee',
        customRole: '',
        isActive: true,
      },
    ]);
  }

  function removeStoreUser(index: number) {
    if (!window.confirm('Remove this store user?')) return;

    setField(
      'store_users',
      values.store_users.filter((_, userIndex) => userIndex !== index)
    );
  }

  function updatePrimaryContact(index: number, update: Partial<PrimaryContact>) {
    setField(
      'primary_contacts',
      values.primary_contacts.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, ...update } : contact
      )
    );
  }

  function addPrimaryContact() {
    setField('primary_contacts', [
      ...values.primary_contacts,
      {
        id: crypto.randomUUID(),
        name: '',
        email: '',
        phone: '',
        role: 'Owner',
        customRole: '',
      },
    ]);
  }

  function removePrimaryContact(index: number) {
    if (!window.confirm('Remove this primary contact?')) return;

    setField(
      'primary_contacts',
      values.primary_contacts.filter((_, contactIndex) => contactIndex !== index)
    );
  }

  function updateCustomField(
    fieldName: 'custom_fields' | 'compliance_fields' | 'billing_custom_fields',
    index: number,
    update: Partial<CustomField>
  ) {
    setField(
      fieldName,
      values[fieldName].map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...update } : field
      )
    );
  }

  function addCustomField(fieldName: 'custom_fields' | 'compliance_fields' | 'billing_custom_fields') {
    setField(fieldName, [
      ...values[fieldName],
      { id: crypto.randomUUID(), label: '', value: '' },
    ]);
  }

  function removeCustomField(
    fieldName: 'custom_fields' | 'compliance_fields' | 'billing_custom_fields',
    index: number
  ) {
    if (!window.confirm('Delete this custom field?')) return;

    setField(
      fieldName,
      values[fieldName].filter((_, fieldIndex) => fieldIndex !== index)
    );
  }

  function cleanCustomFields(fields: CustomField[]) {
    return fields
      .map((field) => ({
        ...field,
        id: field.id || crypto.randomUUID(),
        label: field.label.trim(),
        value: field.value.trim(),
      }))
      .filter((field) => field.label || field.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const firstOwnerContact = values.primary_contacts.find(
      (contact) => (contact.role || '').toLowerCase() === 'owner' && contact.email
    );
    const primaryOwnerEmail = emptyToNull(values.primary_owner_email) || emptyToNull(firstOwnerContact?.email);

    const payload: StoreProfileFormValues = {
      id: values.id,

      owner_id: emptyToNull(values.owner_id),
      allowed_user_count: numericOrNull(values.allowed_user_count),
      primary_owner_email: primaryOwnerEmail,
      primary_contacts: values.primary_contacts
        .map((contact) => ({
          ...contact,
          id: contact.id || crypto.randomUUID(),
          name: emptyToNull(contact.name),
          email: emptyToNull(contact.email),
          phone: emptyToNull(contact.phone),
          role: emptyToNull(contact.role) || 'Owner',
          customRole: emptyToNull(contact.customRole),
        }))
        .filter((contact) => contact.name || contact.email || contact.phone),
      custom_fields: cleanCustomFields(values.custom_fields),

      store_name: values.store_name.trim(),
      store_code: emptyToNull(values.store_code),
      logo_url: emptyToNull(values.logo_url),

      manager_name: emptyToNull(values.manager_name),
      manager_phone: emptyToNull(values.manager_phone),
      manager_email: emptyToNull(values.manager_email),

      address_line1: emptyToNull(values.address_line1),
      address_line2: emptyToNull(values.address_line2),
      city: emptyToNull(values.city),
      state: emptyToNull(values.state),
      zip_code: emptyToNull(values.zip_code),
      country: emptyToNull(values.country),
      timezone: emptyToNull(values.timezone),
      latitude: numericOrNull(values.latitude),
      longitude: numericOrNull(values.longitude),

      store_type: emptyToNull(values.store_type),
      pos_type: emptyToNull(values.pos_type),
      register_count: numericOrNull(values.register_count),
      has_fuel: values.has_fuel,
      fuel_brand: emptyToNull(values.fuel_brand),

      business_legal_name: emptyToNull(values.business_legal_name),
      dba_name: emptyToNull(values.dba_name),
      ein_tax_id: emptyToNull(values.ein_tax_id),
      sales_tax_permit: emptyToNull(values.sales_tax_permit),
      tobacco_license: emptyToNull(values.tobacco_license),
      alcohol_license: emptyToNull(values.alcohol_license),

      lottery_enabled: values.lottery_enabled,
      atm_enabled: values.atm_enabled,
      money_order_enabled: values.money_order_enabled,
      ebt_accepted: values.ebt_accepted,

      operating_hours: values.operating_hours,
      store_users: values.store_users
        .map((user) => ({
          ...user,
          id: user.id || crypto.randomUUID(),
          name: emptyToNull(user.name),
          email: emptyToNull(user.email),
          phone: emptyToNull(user.phone),
          role: emptyToNull(user.role) || 'Employee',
          customRole: emptyToNull(user.customRole),
          isActive: user.isActive !== false,
        }))
        .filter((user) => user.name || user.email || user.phone),

      plan: emptyToNull(values.plan),
      subscription_status: emptyToNull(values.subscription_status),
      billing_status: emptyToNull(values.billing_status),
      billing_provider: emptyToNull(values.billing_provider),
      billing_customer_id: emptyToNull(values.billing_customer_id),
      billing_subscription_id: emptyToNull(values.billing_subscription_id),
      current_period_start: dateOrNull(values.current_period_start),
      current_period_end: dateOrNull(values.current_period_end),
      trial_ends_at: dateOrNull(values.trial_ends_at),
      cancel_at: dateOrNull(values.cancel_at),
      subscription_notes: emptyToNull(values.subscription_notes),
      billing_custom_fields: cleanCustomFields(values.billing_custom_fields),

      compliance_fields: cleanCustomFields(values.compliance_fields),
      compliance_notes: emptyToNull(values.compliance_notes),
      compliance_file_urls: values.compliance_file_urls,
      notes: emptyToNull(values.notes),
    };

    await onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Store Profile</h2>
          <p className="text-sm text-slate-500">
            Basic store identity, logo, POS, and operating setup.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Store Name *</label>
            <input
              className={inputClass}
              value={values.store_name}
              onChange={(event) => setField('store_name', event.target.value)}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Store Code</label>
            <input
              className={inputClass}
              value={values.store_code || ''}
              onChange={(event) => setField('store_code', event.target.value)}
              placeholder="Example: OKC-001"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelClass}>Store Logo / Image URL</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                className={inputClass}
                value={values.logo_url || ''}
                onChange={(event) => setField('logo_url', event.target.value)}
                placeholder="https://example.com/store-logo.png"
              />
              <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {logoUploading ? 'Uploading...' : '📷 Upload'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void handleLogoUpload(event.target.files?.[0])}
                />
              </label>
            </div>
            {logoUploadError ? (
              <p className="mt-2 text-sm text-red-600">{logoUploadError}</p>
            ) : null}
            {values.logo_url ? (
              <img
                src={values.logo_url}
                alt="Store logo preview"
                className="mt-3 h-16 w-16 rounded-lg border border-slate-200 object-cover"
              />
            ) : null}
          </div>

          <div>
            <label className={labelClass}>Store Type</label>
            <select
              className={inputClass}
              value={values.store_type || ''}
              onChange={(event) => setField('store_type', event.target.value)}
            >
              <option value="">Select store type</option>
              <option value="Convenience Store">Convenience Store</option>
              <option value="Gas Station">Gas Station</option>
              <option value="Convenience Store with Fuel">Convenience Store with Fuel</option>
              <option value="Smoke Shop">Smoke Shop</option>
              <option value="Liquor Store">Liquor Store</option>
              <option value="Grocery">Grocery</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-slate-700">POS Type</label>
              {onAddPosType ? (
                <button
                  type="button"
                  onClick={onAddPosType}
                  className="text-xs font-semibold text-blue-700 hover:text-blue-900"
                >
                  Add POS Type
                </button>
              ) : null}
            </div>

            <select
              className={inputClass}
              value={values.pos_type || ''}
              onChange={(event) => setField('pos_type', event.target.value)}
            >
              <option value="">Select POS type</option>
              {sortedPosTypes.map((posType) => (
                <option key={posType.pos_key} value={posType.pos_key}>
                  {posType.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Register Count</label>
            <input
              className={inputClass}
              type="number"
              min="0"
              value={values.register_count}
              onChange={(event) => setField('register_count', event.target.value)}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-slate-700">Fuel Brand</label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={values.has_fuel || false}
                  onChange={(event) => setField('has_fuel', event.target.checked)}
                />
                Has Fuel
              </label>
            </div>
            <input
              className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
              value={values.fuel_brand || ''}
              onChange={(event) => setField('fuel_brand', event.target.value)}
              placeholder="Shell, Chevron, Valero, etc."
              disabled={!values.has_fuel}
            />
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Primary Contacts</h2>
            <p className="text-sm text-slate-500">
              Owners, partners, managers, accountants, and emergency contacts.
            </p>
          </div>
          <button
            type="button"
            onClick={addPrimaryContact}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Add Primary Contact
          </button>
        </div>

        {values.primary_contacts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No primary contacts added yet.
          </p>
        ) : (
          <div className="space-y-2">
            {values.primary_contacts.map((contact, index) => (
              <div
                key={contact.id || index}
                className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_1fr_1fr_150px_auto]"
              >
                <input
                  className={inputClass}
                  value={contact.name || ''}
                  onChange={(event) => updatePrimaryContact(index, { name: event.target.value })}
                  placeholder="Name"
                />
                <input
                  className={inputClass}
                  type="email"
                  value={contact.email || ''}
                  onChange={(event) => updatePrimaryContact(index, { email: event.target.value })}
                  placeholder="Email"
                />
                <input
                  className={inputClass}
                  value={contact.phone || ''}
                  onChange={(event) => updatePrimaryContact(index, { phone: event.target.value })}
                  placeholder="Phone / Contact"
                />
                <div className="space-y-2">
                  <select
                    className={inputClass}
                    value={contact.role || 'Owner'}
                    onChange={(event) => updatePrimaryContact(index, { role: event.target.value })}
                  >
                    <option value="Owner">Owner</option>
                    <option value="Partner">Partner</option>
                    <option value="Manager">Manager</option>
                    <option value="Accountant">Accountant</option>
                    <option value="Emergency Contact">Emergency Contact</option>
                    <option value="Custom">Custom</option>
                  </select>
                  {contact.role === 'Custom' ? (
                    <input
                      className={inputClass}
                      value={contact.customRole || ''}
                      onChange={(event) =>
                        updatePrimaryContact(index, { customRole: event.target.value })
                      }
                      placeholder="Custom label"
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removePrimaryContact(index)}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold">Set New Password / Send Password Reset</p>
            <p className="mt-1">
              Password changes are handled through the secure server-side Users & Permissions
              reset flow. Current passwords are never shown or stored here.
            </p>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Allowed User Accounts</h2>
          <p className="text-sm text-slate-500">
            Set how many team members the primary owner can add for this store.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div>
            <label className={labelClass}>Primary Owner Email</label>
            <input
              className={inputClass}
              type="email"
              value={values.primary_owner_email || ''}
              onChange={(event) => setField('primary_owner_email', event.target.value)}
              placeholder="owner@example.com"
            />
            <p className="mt-1 text-xs text-slate-500">
              If blank, the first Owner contact email is used when saving.
            </p>
          </div>

          <div>
            <label className={labelClass}>Users Allowed to Create</label>
            <select
              className={inputClass}
              value={['1', '3', '5', '10'].includes(values.allowed_user_count)
                ? values.allowed_user_count
                : 'custom'}
              onChange={(event) => {
                const nextValue = event.target.value;
                setField('allowed_user_count', nextValue === 'custom' ? values.allowed_user_count : nextValue);
              }}
            >
              <option value="1">1</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="custom">Custom</option>
            </select>
            {!['1', '3', '5', '10'].includes(values.allowed_user_count) ? (
              <input
                className={`${inputClass} mt-2`}
                type="number"
                min="1"
                value={values.allowed_user_count}
                onChange={(event) => setField('allowed_user_count', event.target.value)}
              />
            ) : null}
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Address & Location</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Address Line 1</label>
            <input
              className={inputClass}
              value={values.address_line1 || ''}
              onChange={(event) => setField('address_line1', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Address Line 2</label>
            <input
              className={inputClass}
              value={values.address_line2 || ''}
              onChange={(event) => setField('address_line2', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>City</label>
            <input
              className={inputClass}
              value={values.city || ''}
              onChange={(event) => setField('city', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>State</label>
            <input
              className={inputClass}
              value={values.state || ''}
              onChange={(event) => setField('state', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>ZIP Code</label>
            <input
              className={inputClass}
              value={values.zip_code || ''}
              onChange={(event) => setField('zip_code', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Country</label>
            <input
              className={inputClass}
              value={values.country || ''}
              onChange={(event) => setField('country', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Timezone</label>
            <input
              className={inputClass}
              value={values.timezone || ''}
              onChange={(event) => setField('timezone', event.target.value)}
              placeholder="America/Chicago"
            />
          </div>

        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Operating Hours</h2>
          <p className="text-sm text-slate-500">
            Set open and close times for each day. No raw JSON is shown here.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-slate-500">
                <th className="px-2 py-2">Day</th>
                <th className="px-2 py-2">Closed</th>
                <th className="px-2 py-2">Open Time</th>
                <th className="px-2 py-2">Close Time</th>
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((day) => {
                const row = values.operating_hours[day.key];

                return (
                  <tr key={day.key} className="border-b last:border-0">
                    <td className="px-2 py-2 font-medium text-slate-800">{day.label}</td>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={row.closed}
                        onChange={(event) =>
                          setOperatingHour(day.key, { closed: event.target.checked })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                        type="time"
                        value={row.open}
                        disabled={row.closed}
                        onChange={(event) =>
                          setOperatingHour(day.key, { open: event.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                        type="time"
                        value={row.close}
                        disabled={row.closed}
                        onChange={(event) =>
                          setOperatingHour(day.key, { close: event.target.value })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Additional Store Details</h2>
            <p className="text-sm text-slate-500">
              Add custom fields like franchise ID, regional manager, insurance provider, or POS support contact.
            </p>
          </div>
          <button
            type="button"
            onClick={() => addCustomField('custom_fields')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            + Add Field
          </button>
        </div>

        {values.custom_fields.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No custom store fields yet.
          </p>
        ) : (
          <div className="space-y-2">
            {values.custom_fields.map((field, index) => (
              <div key={field.id || index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <input
                  className={inputClass}
                  value={field.label}
                  onChange={(event) =>
                    updateCustomField('custom_fields', index, { label: event.target.value })
                  }
                  placeholder="Field Name"
                />
                <input
                  className={inputClass}
                  value={field.value}
                  onChange={(event) =>
                    updateCustomField('custom_fields', index, { value: event.target.value })
                  }
                  placeholder="Field Value"
                />
                <button
                  type="button"
                  onClick={() => removeCustomField('custom_fields', index)}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Store Users</h2>
            <p className="text-sm text-slate-500">
              {values.store_users.length} of {allowedUserCount} users added.
            </p>
          </div>
          <button
            type="button"
            onClick={addStoreUser}
            disabled={userLimitReached}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Add Store User
          </button>
        </div>

        {userLimitReached ? (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            User limit reached. Increase allowed users to add more.
          </p>
        ) : null}

        {values.store_users.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No store users added yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {values.store_users.map((user, index) => (
                  <tr key={user.id || index} className="border-t align-top">
                    <td className="px-3 py-2">
                      <input
                        className={inputClass}
                        value={user.name || ''}
                        onChange={(event) => updateStoreUser(index, { name: event.target.value })}
                        placeholder="Name"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={inputClass}
                        type="email"
                        value={user.email || ''}
                        onChange={(event) => updateStoreUser(index, { email: event.target.value })}
                        placeholder="Email"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={inputClass}
                        value={user.phone || ''}
                        onChange={(event) => updateStoreUser(index, { phone: event.target.value })}
                        placeholder="Phone"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={inputClass}
                        value={user.role || 'Employee'}
                        onChange={(event) => updateStoreUser(index, { role: event.target.value })}
                      >
                        <option value="Partner">Partner</option>
                        <option value="Cashier">Cashier</option>
                        <option value="Employee">Employee</option>
                        <option value="Manager">Manager</option>
                        <option value="Custom">Custom</option>
                      </select>
                      {user.role === 'Custom' ? (
                        <input
                          className={`${inputClass} mt-2`}
                          value={user.customRole || ''}
                          onChange={(event) =>
                            updateStoreUser(index, { customRole: event.target.value })
                          }
                          placeholder="Custom role"
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={user.isActive !== false}
                          onChange={(event) =>
                            updateStoreUser(index, { isActive: event.target.checked })
                          }
                        />
                        {user.isActive === false ? 'Inactive' : 'Active'}
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeStoreUser(index)}
                        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Business & Compliance</h2>
            <p className="text-sm text-slate-500">
              Core compliance fields plus flexible fields for permits, licenses, and documents.
            </p>
          </div>
          <button
            type="button"
            onClick={() => addCustomField('compliance_fields')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Add Compliance Field
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Business Legal Name</label>
            <input
              className={inputClass}
              value={values.business_legal_name || ''}
              onChange={(event) => setField('business_legal_name', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>DBA Name</label>
            <input
              className={inputClass}
              value={values.dba_name || ''}
              onChange={(event) => setField('dba_name', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>EIN / Tax ID</label>
            <input
              className={inputClass}
              value={values.ein_tax_id || ''}
              onChange={(event) => setField('ein_tax_id', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Sales Tax Permit</label>
            <input
              className={inputClass}
              value={values.sales_tax_permit || ''}
              onChange={(event) => setField('sales_tax_permit', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Tobacco License</label>
            <input
              className={inputClass}
              value={values.tobacco_license || ''}
              onChange={(event) => setField('tobacco_license', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Alcohol License</label>
            <input
              className={inputClass}
              value={values.alcohol_license || ''}
              onChange={(event) => setField('alcohol_license', event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ['lottery_enabled', 'Lottery Enabled'],
            ['atm_enabled', 'ATM Enabled'],
            ['money_order_enabled', 'Money Order Enabled'],
            ['ebt_accepted', 'EBT Accepted'],
          ].map(([field, label]) => (
            <label
              key={field}
              className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={Boolean(values[field as keyof StoreProfileFormState])}
                onChange={(event) =>
                  setField(
                    field as keyof StoreProfileFormState,
                    event.target.checked as never
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>

        {values.compliance_fields.length > 0 ? (
          <div className="mt-4 space-y-2">
            {values.compliance_fields.map((field, index) => (
              <div key={field.id || index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <input
                  className={inputClass}
                  value={field.label}
                  onChange={(event) =>
                    updateCustomField('compliance_fields', index, { label: event.target.value })
                  }
                  placeholder="Field Name"
                />
                <input
                  className={inputClass}
                  value={field.value}
                  onChange={(event) =>
                    updateCustomField('compliance_fields', index, { value: event.target.value })
                  }
                  placeholder="Field Value"
                />
                <button
                  type="button"
                  onClick={() => removeCustomField('compliance_fields', index)}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4">
          <label className={labelClass}>Compliance Notes</label>
          <textarea
            className={inputClass}
            rows={3}
            value={values.compliance_notes || ''}
            onChange={(event) => setField('compliance_notes', event.target.value)}
            placeholder="Permits, licenses, certificates, tax documents, or compliance notes."
          />
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Compliance Documents</p>
              <p className="text-xs text-slate-500">
                Upload permits, licenses, certificates, or tax documents.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {complianceUploading ? 'Uploading...' : 'Upload File'}
              <input
                type="file"
                className="hidden"
                onChange={(event) => void handleComplianceUpload(event.target.files?.[0])}
              />
            </label>
          </div>
          {complianceUploadError ? (
            <p className="mt-2 text-sm text-red-600">{complianceUploadError}</p>
          ) : null}
          {values.compliance_file_urls.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {values.compliance_file_urls.map((url) => (
                <li key={url} className="flex items-center justify-between gap-3 rounded border p-2">
                  {url.startsWith('http') ? (
                    <a className="truncate text-blue-700 hover:underline" href={url} target="_blank">
                      {url}
                    </a>
                  ) : (
                    <span className="truncate text-slate-600">{url}</span>
                  )}
                  <button
                    type="button"
                    className="text-xs font-semibold text-red-600"
                    onClick={() =>
                      setField(
                        'compliance_file_urls',
                        values.compliance_file_urls.filter((item) => item !== url)
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Billing & Subscription</h2>
            <p className="text-sm text-slate-500">
              Compact superadmin-only billing metadata.
            </p>
          </div>
          <button
            type="button"
            onClick={() => addCustomField('billing_custom_fields')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Add Billing Field
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>Plan</label>
            <select
              className={inputClass}
              value={values.plan || ''}
              onChange={(event) => setField('plan', event.target.value)}
            >
              <option value="">Select plan</option>
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Subscription Status</label>
            <select
              className={inputClass}
              value={values.subscription_status || ''}
              onChange={(event) => setField('subscription_status', event.target.value)}
            >
              <option value="">Select status</option>
              <option value="trialing">Trialing</option>
              <option value="active">Active</option>
              <option value="past_due">Past Due</option>
              <option value="canceled">Canceled</option>
              <option value="paused">Paused</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Billing Status</label>
            <select
              className={inputClass}
              value={values.billing_status || ''}
              onChange={(event) => setField('billing_status', event.target.value)}
            >
              <option value="">Select billing status</option>
              <option value="trial">Trial</option>
              <option value="current">Current</option>
              <option value="past_due">Past Due</option>
              <option value="failed">Failed</option>
              <option value="canceled">Canceled</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Billing Provider</label>
            <input
              className={inputClass}
              value={values.billing_provider || ''}
              onChange={(event) => setField('billing_provider', event.target.value)}
              placeholder="Stripe, Manual, etc."
            />
          </div>

          <div>
            <label className={labelClass}>Billing Customer ID</label>
            <input
              className={inputClass}
              value={values.billing_customer_id || ''}
              onChange={(event) => setField('billing_customer_id', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Billing Subscription ID</label>
            <input
              className={inputClass}
              value={values.billing_subscription_id || ''}
              onChange={(event) => setField('billing_subscription_id', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Current Period Start</label>
            <input
              className={inputClass}
              type="date"
              value={values.current_period_start || ''}
              onChange={(event) => setField('current_period_start', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Current Period End</label>
            <input
              className={inputClass}
              type="date"
              value={values.current_period_end || ''}
              onChange={(event) => setField('current_period_end', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Trial End Date</label>
            <input
              className={inputClass}
              type="date"
              value={values.trial_ends_at || ''}
              onChange={(event) => setField('trial_ends_at', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Cancel Date</label>
            <input
              className={inputClass}
              type="date"
              value={values.cancel_at || ''}
              onChange={(event) => setField('cancel_at', event.target.value)}
            />
          </div>

          <div className="md:col-span-3">
            <label className={labelClass}>Billing Notes</label>
            <textarea
              className={inputClass}
              rows={3}
              value={values.subscription_notes || ''}
              onChange={(event) => setField('subscription_notes', event.target.value)}
            />
          </div>
        </div>

        {values.billing_custom_fields.length > 0 ? (
          <div className="mt-4 space-y-2">
            {values.billing_custom_fields.map((field, index) => (
              <div key={field.id || index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <input
                  className={inputClass}
                  value={field.label}
                  onChange={(event) =>
                    updateCustomField('billing_custom_fields', index, { label: event.target.value })
                  }
                  placeholder="Field label"
                />
                <input
                  className={inputClass}
                  value={field.value}
                  onChange={(event) =>
                    updateCustomField('billing_custom_fields', index, { value: event.target.value })
                  }
                  placeholder="Value"
                />
                <button
                  type="button"
                  onClick={() => removeCustomField('billing_custom_fields', index)}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className={sectionClass}>
        <div>
          <label className={labelClass}>Internal Notes</label>
          <textarea
            className={inputClass}
            rows={4}
            value={values.notes || ''}
            onChange={(event) => setField('notes', event.target.value)}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default StoreProfileForm;
