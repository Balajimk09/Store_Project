'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

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

export type LoginAccountOption = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  name?: string | null;
};

export type PosTypeOption = {
  id?: string;
  name: string;
  pos_key: string;
  description?: string | null;
};

export type StoreProfileFormValues = {
  id?: string;

  owner_id?: string | null;

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

  notes?: string | null;
};

type StoreProfileFormProps = {
  initialValues?: Partial<StoreProfileFormValues> | null;
  loginAccounts?: LoginAccountOption[];
  posTypes?: PosTypeOption[];
  isSubmitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: StoreProfileFormValues) => void | Promise<void>;
  onCancel?: () => void;
  onAddPosType?: () => void;
};

type StoreProfileFormState = Omit<
  StoreProfileFormValues,
  'register_count' | 'latitude' | 'longitude' | 'operating_hours'
> & {
  register_count: string;
  latitude: string;
  longitude: string;
  operating_hours: OperatingHours;
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
  loginAccounts = [],
  posTypes = [],
  isSubmitting = false,
  submitLabel = 'Save Store',
  onSubmit,
  onCancel,
  onAddPosType,
}: StoreProfileFormProps) {
  const [values, setValues] = useState<StoreProfileFormState>(() => toFormState(initialValues));

  useEffect(() => {
    setValues(toFormState(initialValues));
  }, [initialValues]);

  const sortedPosTypes = useMemo(() => {
    return [...posTypes].sort((a, b) => a.name.localeCompare(b.name));
  }, [posTypes]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload: StoreProfileFormValues = {
      id: values.id,

      owner_id: emptyToNull(values.owner_id),

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
            <input
              className={inputClass}
              value={values.logo_url || ''}
              onChange={(event) => setField('logo_url', event.target.value)}
              placeholder="https://example.com/store-logo.png"
            />
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
            <label className={labelClass}>Fuel Brand</label>
            <input
              className={inputClass}
              value={values.fuel_brand || ''}
              onChange={(event) => setField('fuel_brand', event.target.value)}
              placeholder="Shell, Chevron, Valero, etc."
              disabled={!values.has_fuel}
            />
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={values.has_fuel || false}
              onChange={(event) => setField('has_fuel', event.target.checked)}
            />
            Has Fuel
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">
            Primary Contact: Owner / Manager
          </h2>
          <p className="text-sm text-slate-500">
            Real owner, manager, or payer contact for this store.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelClass}>Contact Name</label>
            <input
              className={inputClass}
              value={values.manager_name || ''}
              onChange={(event) => setField('manager_name', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Contact Phone</label>
            <input
              className={inputClass}
              value={values.manager_phone || ''}
              onChange={(event) => setField('manager_phone', event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Contact Email</label>
            <input
              className={inputClass}
              type="email"
              value={values.manager_email || ''}
              onChange={(event) => setField('manager_email', event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Assigned Login Account</h2>
          <p className="text-sm text-slate-500">
            Links this store to an existing StorePulse login account from Supabase/Auth.
          </p>
        </div>

        <select
          className={inputClass}
          value={values.owner_id || ''}
          onChange={(event) => setField('owner_id', event.target.value)}
        >
          <option value="">Unassigned</option>
          {loginAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email || account.full_name || account.name || account.id}
            </option>
          ))}
        </select>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Latitude</label>
              <input
                className={inputClass}
                value={values.latitude}
                onChange={(event) => setField('latitude', event.target.value)}
              />
            </div>

            <div>
              <label className={labelClass}>Longitude</label>
              <input
                className={inputClass}
                value={values.longitude}
                onChange={(event) => setField('longitude', event.target.value)}
              />
            </div>
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

        <div className="space-y-3">
          {DAY_LABELS.map((day) => {
            const row = values.operating_hours[day.key];

            return (
              <div
                key={day.key}
                className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[140px_120px_1fr_1fr]"
              >
                <div className="flex items-center font-medium text-slate-800">{day.label}</div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.closed}
                    onChange={(event) =>
                      setOperatingHour(day.key, { closed: event.target.checked })
                    }
                  />
                  Closed
                </label>

                <div>
                  <label className={labelClass}>Open Time</label>
                  <input
                    className={inputClass}
                    type="time"
                    value={row.open}
                    disabled={row.closed}
                    onChange={(event) => setOperatingHour(day.key, { open: event.target.value })}
                  />
                </div>

                <div>
                  <label className={labelClass}>Close Time</label>
                  <input
                    className={inputClass}
                    type="time"
                    value={row.close}
                    disabled={row.closed}
                    onChange={(event) => setOperatingHour(day.key, { close: event.target.value })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Business & Compliance</h2>
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
      </section>

      <section className={sectionClass}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">Billing & Subscription</h2>
          <p className="text-sm text-slate-500">
            StorePulse billing metadata for superadmin support and account management.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
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