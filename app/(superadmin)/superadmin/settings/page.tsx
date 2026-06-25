'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Bell,
  Bot,
  CreditCard,
  Database,
  FileText,
  Flag,
  Globe,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Store,
  TerminalSquare,
  Trash2,
  Truck,
  X,
  Zap,
} from 'lucide-react';
import { SuperadminPageHeader, SuperadminShell } from '@/components/layout/superadmin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminFetch } from '@/lib/admin-client';

type JsonValue = string | number | boolean | string[] | null;
type FieldValue = string | number | boolean | string[] | null;

type PlatformSetting = {
  id: string;
  setting_key: string;
  setting_value: JsonValue;
  category: string;
  label: string;
  description: string | null;
  value_type: 'string' | 'number' | 'boolean' | 'json';
  is_sensitive: boolean;
  is_active: boolean;
  sort_order: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
};

type PlatformPlan = {
  id: string;
  plan_name: string;
  plan_code: string;
  monthly_price: number;
  yearly_price: number;
  setup_fee: number;
  trial_days: number;
  max_stores: number | null;
  max_users_per_store: number | null;
  max_products: number | null;
  max_uploads_per_month: number | null;
  max_ai_requests_per_month: number | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
};

type PlatformFeatureFlag = {
  id: string;
  feature_name: string;
  feature_key: string;
  description: string | null;
  category: string;
  enabled_globally: boolean;
  available_on_plans: string[];
  is_beta: boolean;
  is_active: boolean;
};

type PlatformPosType = {
  id: string;
  pos_name: string;
  pos_code: string;
  description: string | null;
  supports_csv: boolean;
  supports_xlsx: boolean;
  supports_api: boolean;
  supports_pricebook_sync: boolean;
  is_default: boolean;
  is_active: boolean;
};

type PlatformPaymentMethod = {
  id: string;
  method_name: string;
  method_code: string;
  method_type: string;
  description: string | null;
  applies_to_store_billing: boolean;
  applies_to_vendor_payments: boolean;
  requires_approval: boolean;
  requires_reference_number: boolean;
  requires_vendor_email: boolean;
  requires_bank_details: boolean;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
};

type PlatformRevenueRule = {
  id: string;
  rule_name: string;
  rule_key: string;
  rule_type: string;
  amount: number | null;
  percentage: number | null;
  applies_to_plan: string | null;
  description: string | null;
  is_active: boolean;
};

type PlatformNotificationTemplate = {
  id: string;
  template_name: string;
  template_key: string;
  channel: string;
  subject: string | null;
  body: string | null;
  variables: string[] | null;
  is_enabled: boolean;
};

type PlatformAnnouncement = {
  id: string;
  title: string;
  message: string;
  announcement_type: 'info' | 'warning' | 'critical' | 'maintenance';
  target_audience: 'all' | 'store_owners' | 'superadmin';
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type SettingsResponse = {
  settings: PlatformSetting[];
  plans: PlatformPlan[];
  feature_flags: PlatformFeatureFlag[];
  pos_types: PlatformPosType[];
  payment_methods: PlatformPaymentMethod[];
  revenue_rules: PlatformRevenueRule[];
  notification_templates: PlatformNotificationTemplate[];
  announcements: PlatformAnnouncement[];
};

type TabKey =
  | 'platform_identity'
  | 'store_defaults'
  | 'plans_features'
  | 'revenue'
  | 'payment_methods'
  | 'pos_types'
  | 'import_export'
  | 'notifications'
  | 'ai'
  | 'security'
  | 'support'
  | 'vendors'
  | 'announcements'
  | 'legal'
  | 'integrations'
  | 'data';

type DrawerType =
  | 'plan'
  | 'feature'
  | 'pos'
  | 'payment'
  | 'revenue'
  | 'template'
  | 'announcement';

type DrawerMode = 'create' | 'edit';
type EditableRow =
  | PlatformPlan
  | PlatformFeatureFlag
  | PlatformPosType
  | PlatformPaymentMethod
  | PlatformRevenueRule
  | PlatformNotificationTemplate
  | PlatformAnnouncement;

type DrawerField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'checkbox' | 'select' | 'multicheck' | 'csv';
  options?: string[];
};

type DrawerConfig = {
  title: string;
  endpoint: string;
  idParam: string;
  fields: DrawerField[];
  empty: Record<string, FieldValue>;
};

const tabs: Array<{ key: TabKey; label: string; icon: typeof Globe }> = [
  { key: 'platform_identity', label: 'Platform', icon: Globe },
  { key: 'store_defaults', label: 'Store Defaults', icon: Store },
  { key: 'plans_features', label: 'Plans & Features', icon: Flag },
  { key: 'revenue', label: 'Revenue & Billing', icon: CreditCard },
  { key: 'payment_methods', label: 'Payment Methods', icon: CreditCard },
  { key: 'pos_types', label: 'POS Types', icon: TerminalSquare },
  { key: 'import_export', label: 'Import / Export', icon: FileText },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'ai', label: 'AI', icon: Bot },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'support', label: 'Support', icon: Zap },
  { key: 'vendors', label: 'Vendors', icon: Truck },
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
  { key: 'legal', label: 'Legal', icon: FileText },
  { key: 'integrations', label: 'Integrations', icon: TerminalSquare },
  { key: 'data', label: 'Data & Audit', icon: Database },
];

const planCodes = ['starter', 'professional', 'enterprise', 'custom'];
const methodTypes = ['cash', 'check', 'echeck', 'ach', 'card', 'autopay', 'vendor_portal', 'custom'];
const ruleTypes = [
  'subscription',
  'setup_fee',
  'extra_store',
  'extra_user',
  'extra_products',
  'ai_overage',
  'pos_integration',
  'support_fee',
  'late_fee',
  'custom',
];
const channels = ['email', 'sms', 'in_app', 'webhook'];
const announcementTypes = ['info', 'warning', 'critical', 'maintenance'];
const audiences = ['all', 'store_owners', 'superadmin'];

function asString(value: FieldValue) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null) return '';
  return String(value);
}

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(value || 0)
  );
}

function settingDisplayValue(setting: PlatformSetting) {
  if (setting.is_sensitive) return 'Configured securely';
  if (typeof setting.setting_value === 'boolean') return setting.setting_value ? 'Enabled' : 'Disabled';
  if (Array.isArray(setting.setting_value)) return setting.setting_value.join(', ');
  if (setting.setting_value === null) return '';
  return String(setting.setting_value);
}

function parseSettingValue(value: string, type: PlatformSetting['value_type']) {
  if (type === 'boolean') return value === 'true';
  if (type === 'number') return Number(value) || 0;
  if (type === 'json') {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeFormValue(field: DrawerField, value: FieldValue) {
  if (field.type === 'number') return value === '' || value === null ? null : Number(value);
  if (field.type === 'csv') {
    return asString(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('platform_identity');
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [featureFlags, setFeatureFlags] = useState<PlatformFeatureFlag[]>([]);
  const [posTypes, setPosTypes] = useState<PlatformPosType[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PlatformPaymentMethod[]>([]);
  const [revenueRules, setRevenueRules] = useState<PlatformRevenueRule[]>([]);
  const [notificationTemplates, setNotificationTemplates] = useState<PlatformNotificationTemplate[]>([]);
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<string[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<DrawerType>('plan');
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('create');
  const [editingItem, setEditingItem] = useState<EditableRow | null>(null);
  const [drawerValues, setDrawerValues] = useState<Record<string, FieldValue>>({});
  const [seeding, setSeeding] = useState<string | null>(null);

  const drawerConfigs = useMemo<Record<DrawerType, DrawerConfig>>(
    () => ({
      plan: {
        title: 'Plan',
        endpoint: '/api/admin/settings/plans',
        idParam: 'planId',
        empty: {
          plan_name: '',
          plan_code: '',
          monthly_price: 0,
          yearly_price: 0,
          setup_fee: 0,
          trial_days: 14,
          max_stores: null,
          max_users_per_store: null,
          max_products: null,
          max_uploads_per_month: null,
          max_ai_requests_per_month: null,
          sort_order: 0,
          is_active: true,
          features: [],
        },
        fields: [
          { key: 'plan_name', label: 'Plan Name', type: 'text' },
          { key: 'plan_code', label: 'Plan Code', type: 'text' },
          { key: 'monthly_price', label: 'Monthly Price', type: 'number' },
          { key: 'yearly_price', label: 'Yearly Price', type: 'number' },
          { key: 'setup_fee', label: 'Setup Fee', type: 'number' },
          { key: 'trial_days', label: 'Trial Days', type: 'number' },
          { key: 'max_stores', label: 'Max Stores', type: 'number' },
          { key: 'max_users_per_store', label: 'Max Users Per Store', type: 'number' },
          { key: 'max_products', label: 'Max Products', type: 'number' },
          { key: 'max_uploads_per_month', label: 'Max Uploads Per Month', type: 'number' },
          { key: 'max_ai_requests_per_month', label: 'Max AI Requests Per Month', type: 'number' },
          { key: 'sort_order', label: 'Sort Order', type: 'number' },
          { key: 'features', label: 'Features', type: 'multicheck', options: featureFlags.map((flag) => flag.feature_key) },
          { key: 'is_active', label: 'Active', type: 'checkbox' },
        ],
      },
      feature: {
        title: 'Feature Flag',
        endpoint: '/api/admin/settings/features',
        idParam: 'featureId',
        empty: {
          feature_name: '',
          feature_key: '',
          category: 'general',
          description: '',
          enabled_globally: true,
          available_on_plans: [],
          is_beta: false,
          is_active: true,
        },
        fields: [
          { key: 'feature_name', label: 'Feature Name', type: 'text' },
          { key: 'feature_key', label: 'Feature Key', type: 'text' },
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'enabled_globally', label: 'Enabled Globally', type: 'checkbox' },
          { key: 'available_on_plans', label: 'Available on Plans', type: 'multicheck', options: planCodes },
          { key: 'is_beta', label: 'Beta', type: 'checkbox' },
          { key: 'is_active', label: 'Active', type: 'checkbox' },
        ],
      },
      pos: {
        title: 'POS Type',
        endpoint: '/api/admin/settings/pos-types',
        idParam: 'posId',
        empty: {
          pos_name: '',
          pos_code: '',
          description: '',
          supports_csv: true,
          supports_xlsx: true,
          supports_api: false,
          supports_pricebook_sync: false,
          is_default: false,
          is_active: true,
        },
        fields: [
          { key: 'pos_name', label: 'POS Name', type: 'text' },
          { key: 'pos_code', label: 'POS Code', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'supports_csv', label: 'Supports CSV', type: 'checkbox' },
          { key: 'supports_xlsx', label: 'Supports XLSX', type: 'checkbox' },
          { key: 'supports_api', label: 'Supports API', type: 'checkbox' },
          { key: 'supports_pricebook_sync', label: 'Supports Pricebook Sync', type: 'checkbox' },
          { key: 'is_default', label: 'Default', type: 'checkbox' },
          { key: 'is_active', label: 'Active', type: 'checkbox' },
        ],
      },
      payment: {
        title: 'Payment Method',
        endpoint: '/api/admin/settings/payment-methods',
        idParam: 'methodId',
        empty: {
          method_name: '',
          method_code: '',
          method_type: 'cash',
          description: '',
          applies_to_store_billing: true,
          applies_to_vendor_payments: true,
          requires_approval: false,
          requires_reference_number: false,
          requires_vendor_email: false,
          requires_bank_details: false,
          is_default: false,
          is_active: true,
          sort_order: 0,
        },
        fields: [
          { key: 'method_name', label: 'Method Name', type: 'text' },
          { key: 'method_code', label: 'Method Code', type: 'text' },
          { key: 'method_type', label: 'Method Type', type: 'select', options: methodTypes },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'applies_to_store_billing', label: 'Store Billing', type: 'checkbox' },
          { key: 'applies_to_vendor_payments', label: 'Vendor Payments', type: 'checkbox' },
          { key: 'requires_approval', label: 'Requires Approval', type: 'checkbox' },
          { key: 'requires_reference_number', label: 'Requires Reference Number', type: 'checkbox' },
          { key: 'requires_vendor_email', label: 'Requires Vendor Email', type: 'checkbox' },
          { key: 'requires_bank_details', label: 'Requires Bank Details', type: 'checkbox' },
          { key: 'is_default', label: 'Default', type: 'checkbox' },
          { key: 'is_active', label: 'Active', type: 'checkbox' },
          { key: 'sort_order', label: 'Sort Order', type: 'number' },
        ],
      },
      revenue: {
        title: 'Revenue Rule',
        endpoint: '/api/admin/settings/revenue-rules',
        idParam: 'ruleId',
        empty: {
          rule_name: '',
          rule_key: '',
          rule_type: 'subscription',
          amount: null,
          percentage: null,
          applies_to_plan: '',
          description: '',
          is_active: true,
        },
        fields: [
          { key: 'rule_name', label: 'Rule Name', type: 'text' },
          { key: 'rule_key', label: 'Rule Key', type: 'text' },
          { key: 'rule_type', label: 'Rule Type', type: 'select', options: ruleTypes },
          { key: 'amount', label: 'Amount', type: 'number' },
          { key: 'percentage', label: 'Percentage', type: 'number' },
          { key: 'applies_to_plan', label: 'Applies To Plan', type: 'select', options: ['', ...planCodes] },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'is_active', label: 'Active', type: 'checkbox' },
        ],
      },
      template: {
        title: 'Notification Template',
        endpoint: '/api/admin/settings/notification-templates',
        idParam: 'templateId',
        empty: {
          template_name: '',
          template_key: '',
          channel: 'email',
          subject: '',
          body: '',
          variables: [],
          is_enabled: true,
        },
        fields: [
          { key: 'template_name', label: 'Template Name', type: 'text' },
          { key: 'template_key', label: 'Template Key', type: 'text' },
          { key: 'channel', label: 'Channel', type: 'select', options: channels },
          { key: 'subject', label: 'Subject', type: 'text' },
          { key: 'body', label: 'Body', type: 'textarea' },
          { key: 'variables', label: 'Variables comma-separated', type: 'csv' },
          { key: 'is_enabled', label: 'Enabled', type: 'checkbox' },
        ],
      },
      announcement: {
        title: 'Announcement',
        endpoint: '/api/admin/settings/announcements',
        idParam: 'announcementId',
        empty: {
          title: '',
          message: '',
          announcement_type: 'info',
          target_audience: 'all',
          is_active: false,
          starts_at: '',
          ends_at: '',
        },
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'message', label: 'Message', type: 'textarea' },
          { key: 'announcement_type', label: 'Type', type: 'select', options: announcementTypes },
          { key: 'target_audience', label: 'Target Audience', type: 'select', options: audiences },
          { key: 'is_active', label: 'Active', type: 'checkbox' },
          { key: 'starts_at', label: 'Start Time', type: 'text' },
          { key: 'ends_at', label: 'End Time', type: 'text' },
        ],
      },
    }),
    [featureFlags]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await adminFetch<SettingsResponse>('/api/admin/settings');
      setSettings(data.settings || []);
      setPlans(data.plans || []);
      setFeatureFlags(data.feature_flags || []);
      setPosTypes(data.pos_types || []);
      setPaymentMethods(data.payment_methods || []);
      setRevenueRules(data.revenue_rules || []);
      setNotificationTemplates(data.notification_templates || []);
      setAnnouncements(data.announcements || []);
      setEditValues(
        (data.settings || []).reduce<Record<string, string>>((acc, setting) => {
          acc[setting.setting_key] =
            setting.value_type === 'json'
              ? JSON.stringify(setting.setting_value ?? null)
              : settingDisplayValue(setting);
          return acc;
        }, {})
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const settingsByCategory = useMemo(() => {
    const map = new Map<string, PlatformSetting[]>();
    settings.forEach((setting) => {
      const current = map.get(setting.category) || [];
      current.push(setting);
      map.set(setting.category, current);
    });
    return map;
  }, [settings]);

  const getSettingValue = (key: string) => settings.find((setting) => setting.setting_key === key)?.setting_value;

  const saveSetting = async (setting: PlatformSetting) => {
    setSavingKeys((current) => [...current, setting.setting_key]);
    setError(null);

    try {
      await adminFetch('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({
          setting_key: setting.setting_key,
          setting_value: parseSettingValue(editValues[setting.setting_key] || '', setting.value_type),
          category: setting.category,
          label: setting.label,
          description: setting.description,
          value_type: setting.value_type,
          is_sensitive: setting.is_sensitive,
        }),
      });
      showSuccess('Setting saved.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save setting.');
    } finally {
      setSavingKeys((current) => current.filter((key) => key !== setting.setting_key));
    }
  };

  const toggleSetting = async (setting: PlatformSetting) => {
    setEditValues((current) => ({
      ...current,
      [setting.setting_key]: String(!(setting.setting_value === true)),
    }));
    await saveSetting({ ...setting, setting_value: !(setting.setting_value === true) });
  };

  const handleSeed = async (type: string) => {
    setSeeding(type);
    setError(null);

    try {
      await adminFetch('/api/admin/settings/seed', {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      showSuccess('Seed completed.');
      await load();
    } catch (seedError) {
      setError(seedError instanceof Error ? seedError.message : 'Failed to seed data.');
    } finally {
      setSeeding(null);
    }
  };

  const openCreateDrawer = (type: DrawerType) => {
    setDrawerType(type);
    setDrawerMode('create');
    setEditingItem(null);
    setDrawerValues(drawerConfigs[type].empty);
    setDrawerOpen(true);
  };

  const openEditDrawer = (type: DrawerType, item: EditableRow) => {
    const config = drawerConfigs[type];
    setDrawerType(type);
    setDrawerMode('edit');
    setEditingItem(item);
    setDrawerValues(
      config.fields.reduce<Record<string, FieldValue>>((acc, field) => {
        const record = item as unknown as Record<string, FieldValue>;
        acc[field.key] = record[field.key] ?? config.empty[field.key] ?? null;
        return acc;
      }, {})
    );
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingItem(null);
    setError(null);
  };

  const handleDrawerSubmit = async () => {
    const config = drawerConfigs[drawerType];
    const payload = config.fields.reduce<Record<string, FieldValue>>((acc, field) => {
      acc[field.key] = normalizeFormValue(field, drawerValues[field.key]);
      return acc;
    }, {});

    const endpoint =
      drawerMode === 'edit' && editingItem?.id
        ? `${config.endpoint}/${editingItem.id}`
        : config.endpoint;

    try {
      await adminFetch(endpoint, {
        method: drawerMode === 'edit' ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      showSuccess(drawerMode === 'edit' ? 'Updated successfully.' : 'Created successfully.');
      closeDrawer();
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save item.');
    }
  };

  const handleDeactivateOrDelete = async (type: DrawerType, item: EditableRow) => {
    const config = drawerConfigs[type];
    const confirmed = window.confirm(`Delete or deactivate "${item.id}"?`);
    if (!confirmed) return;

    try {
      await adminFetch(`${config.endpoint}/${item.id}`, { method: 'DELETE' });
      showSuccess('Deleted successfully.');
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete item.');
    }
  };

  const securityLevel = useMemo(() => {
    const force2fa = getSettingValue('security.force_2fa_superadmin') === true;
    const strongPassword = getSettingValue('security.require_strong_password') === true;
    if (force2fa && strongPassword) return 'High';
    if (strongPassword) return 'Standard';
    return 'Basic';
  }, [settings]);

  const activeAnnouncement = announcements.find((announcement) => announcement.is_active);

  const renderSettingCard = (setting: PlatformSetting) => (
    <Card key={setting.setting_key} className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{setting.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{setting.description || setting.setting_key}</p>
        </div>
        {setting.value_type === 'boolean' ? (
          <Button
            size="sm"
            variant={setting.setting_value === true ? 'default' : 'outline'}
            onClick={() => void toggleSetting(setting)}
            disabled={savingKeys.includes(setting.setting_key)}
          >
            {setting.setting_value === true ? 'Enabled' : 'Disabled'}
          </Button>
        ) : (
          <div className="flex min-w-[260px] gap-2">
            <Input
              value={editValues[setting.setting_key] || ''}
              disabled={setting.is_sensitive}
              onChange={(event) =>
                setEditValues((current) => ({
                  ...current,
                  [setting.setting_key]: event.target.value,
                }))
              }
            />
            <Button
              size="sm"
              onClick={() => void saveSetting(setting)}
              disabled={setting.is_sensitive || savingKeys.includes(setting.setting_key)}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    </Card>
  );

  const renderSettingsSection = (category: string, groups: Array<{ title: string; keys?: string[] }>) => {
    const categorySettings = settingsByCategory.get(category) || [];
    if (categorySettings.length === 0) {
      return (
        <Card className="p-8 text-center">
          <p className="font-medium text-foreground">No settings found</p>
          <p className="mt-1 text-sm text-muted-foreground">Seed platform settings to populate this section.</p>
          <Button className="mt-4" onClick={() => void handleSeed('platform_settings')} disabled={seeding === 'platform_settings'}>
            {seeding === 'platform_settings' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Seed Platform Settings
          </Button>
        </Card>
      );
    }

    return (
      <div className="space-y-5">
        {groups.map((group) => {
          const groupSettings = group.keys
            ? categorySettings.filter((setting) => group.keys?.some((key) => setting.setting_key.includes(key)))
            : categorySettings;
          return (
            <section key={group.title} className="space-y-3">
              <h2 className="font-semibold text-foreground">{group.title}</h2>
              <div className="grid gap-3">{groupSettings.map(renderSettingCard)}</div>
            </section>
          );
        })}
      </div>
    );
  };

  const actionButtons = (type: DrawerType, item: EditableRow) => (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" onClick={() => openEditDrawer(type, item)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:bg-destructive/10"
        onClick={() => void handleDeactivateOrDelete(type, item)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  const activeBadge = (active: boolean) => (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );

  const renderPlansAndFeatures = () => (
    <div className="space-y-6">
      <TableSection
        title="Plans"
        description="Subscription packages and limits."
        isEmpty={plans.length === 0}
        seedType="plans"
        seeding={seeding}
        onSeed={handleSeed}
        onAdd={() => openCreateDrawer('plan')}
      >
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Plan</th><th>Monthly</th><th>Yearly</th><th>Trial</th><th>Features</th><th>Active</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className="border-b">
                <td className="px-3 py-3 font-medium">{plan.plan_name}<p className="text-xs text-muted-foreground">{plan.plan_code}</p></td>
                <td>{currency(plan.monthly_price)}</td><td>{currency(plan.yearly_price)}</td><td>{plan.trial_days} days</td>
                <td className="max-w-[260px] text-muted-foreground">{plan.features?.join(', ') || '-'}</td>
                <td>{activeBadge(plan.is_active)}</td><td>{actionButtons('plan', plan)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableSection>

      <TableSection title="Feature Flags" description="Control feature availability by plan." isEmpty={featureFlags.length === 0} seedType="features" seeding={seeding} onSeed={handleSeed} onAdd={() => openCreateDrawer('feature')}>
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Feature Name</th><th>Key</th><th>Category</th><th>Global Toggle</th><th>Available Plans</th><th>Beta</th><th>Active</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {featureFlags.map((flag) => (
              <tr key={flag.id} className="border-b">
                <td className="px-3 py-3 font-medium">{flag.feature_name}</td><td>{flag.feature_key}</td><td>{flag.category}</td><td>{flag.enabled_globally ? 'On' : 'Off'}</td><td>{flag.available_on_plans.join(', ')}</td><td>{flag.is_beta ? 'Beta' : '-'}</td><td>{activeBadge(flag.is_active)}</td><td>{actionButtons('feature', flag)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableSection>
    </div>
  );

  const renderCurrentTab = () => {
    if (loading) {
      return (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading settings...
        </Card>
      );
    }

    if (activeTab === 'platform_identity') return renderSettingsSection('platform_identity', [{ title: 'Basic Info', keys: ['name', 'tagline', 'company'] }, { title: 'Links', keys: ['url', 'email', 'phone'] }, { title: 'Maintenance', keys: ['maintenance'] }]);
    if (activeTab === 'store_defaults') return renderSettingsSection('store_defaults', [{ title: 'Plan & Trial', keys: ['plan', 'trial'] }, { title: 'Limits', keys: ['max', 'limit'] }, { title: 'Store Behavior' }]);
    if (activeTab === 'plans_features') return renderPlansAndFeatures();
    if (activeTab === 'revenue') return (
      <div className="space-y-5">
        <InfoBanner text="Real Stripe billing is not enabled here. Configure Stripe keys in your server .env file. These rules are for billing calculations and future integrations." />
        {renderSettingsSection('revenue', [{ title: 'Revenue Settings' }])}
        <SimpleRows title="Revenue Rules" rows={revenueRules} emptyText="No revenue rules found." addLabel="Add Revenue Rule" onAdd={() => openCreateDrawer('revenue')} seedType={null} columns={['rule_name', 'rule_type', 'amount', 'percentage', 'applies_to_plan', 'is_active']} type="revenue" />
      </div>
    );
    if (activeTab === 'payment_methods') return (
      <div className="space-y-5">
        <InfoBanner text="Payment sending is not enabled yet. These methods are used for vendor planning and future payment integrations." />
        <SimpleRows title="Payment Methods" rows={paymentMethods} emptyText="No payment methods found." addLabel="Add Payment Method" onAdd={() => openCreateDrawer('payment')} seedType="payment_methods" columns={['method_name', 'method_type', 'applies_to_store_billing', 'applies_to_vendor_payments', 'requires_approval', 'is_default', 'is_active']} type="payment" />
      </div>
    );
    if (activeTab === 'pos_types') return <SimpleRows title="POS Types" rows={posTypes} emptyText="No POS types found." addLabel="Add POS Type" onAdd={() => openCreateDrawer('pos')} seedType="pos_types" columns={['pos_name', 'pos_code', 'supports_csv', 'supports_xlsx', 'supports_api', 'supports_pricebook_sync', 'is_default', 'is_active']} type="pos" />;
    if (activeTab === 'import_export') return renderSettingsSection('import_export', [{ title: 'Upload Limits', keys: ['size', 'products'] }, { title: 'Behavior', keys: ['preserve', 'duplicate', 'preview'] }, { title: 'Retention', keys: ['retention'] }]);
    if (activeTab === 'notifications') return (
      <div className="space-y-5">
        {renderSettingsSection('notifications', [{ title: 'Notification Settings' }])}
        <SimpleRows title="Notification Templates" rows={notificationTemplates} emptyText="No templates found." addLabel="Add Template" onAdd={() => openCreateDrawer('template')} seedType="notification_templates" columns={['template_name', 'template_key', 'channel', 'subject', 'is_enabled']} type="template" />
      </div>
    );
    if (activeTab === 'ai') return <div className="space-y-5"><InfoBanner text="AI provider API keys are managed in your .env file. Do not paste API keys into this form." />{renderSettingsSection('ai', [{ title: 'Global Controls', keys: ['enabled'] }, { title: 'Provider', keys: ['provider', 'model'] }, { title: 'Usage', keys: ['limit', 'usage'] }, { title: 'Display', keys: ['disclaimer'] }])}</div>;
    if (activeTab === 'security') return <div className="space-y-5"><Card className="p-4"><span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">Security Level: {securityLevel}</span></Card>{renderSettingsSection('security', [{ title: 'Session', keys: ['session'] }, { title: 'Login Protection', keys: ['login', 'lockout'] }, { title: 'Password', keys: ['password'] }, { title: '2FA', keys: ['2fa'] }, { title: 'Access' }])}</div>;
    if (activeTab === 'support') return renderSettingsSection('support', [{ title: 'Support Controls' }]);
    if (activeTab === 'vendors') return <div className="space-y-5">{renderSettingsSection('vendors', [{ title: 'Features', keys: ['enabled', 'import', 'analytics'] }, { title: 'Defaults', keys: ['default', 'frequency'] }, { title: 'Display', keys: ['show'] }, { title: 'Future Controls', keys: ['reminders'] }])}<Card className="p-4 text-sm text-muted-foreground">Coming soon controls are marked for future reminder automation.</Card></div>;
    if (activeTab === 'announcements') return renderAnnouncements();
    if (activeTab === 'legal') return renderSettingsSection('legal', [{ title: 'Legal Settings' }]);
    if (activeTab === 'integrations') return <div className="space-y-5"><InfoBanner text="Secret API keys must be set in server environment variables. Do not paste secrets here." />{renderSettingsSection('integrations', [{ title: 'Status', keys: ['configured'] }, { title: 'Webhooks', keys: ['webhook'] }])}</div>;
    return renderSettingsSection('data', [{ title: 'Audit Logs', keys: ['audit'] }, { title: 'Transactions', keys: ['transaction'] }, { title: 'Uploads', keys: ['upload'] }, { title: 'Deletion', keys: ['delete'] }]);
  };

  const renderAnnouncements = () => (
    <div className="space-y-5">
      {activeAnnouncement ? (
        <Card className="border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p className="font-semibold">Live preview: {activeAnnouncement.title}</p>
          <p className="mt-1 text-sm">{activeAnnouncement.message}</p>
        </Card>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={() => openCreateDrawer('announcement')}><Plus className="mr-2 h-4 w-4" />Add Announcement</Button>
      </div>
      {announcements.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No announcements found.</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {announcements.map((announcement) => (
            <Card key={announcement.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">{announcement.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{announcement.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-700">{announcement.announcement_type}</span>
                    {activeBadge(announcement.is_active)}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{announcement.target_audience}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Start: {announcement.starts_at || '-'} · End: {announcement.ends_at || '-'}</p>
                </div>
                {actionButtons('announcement', announcement)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <SuperadminShell>
      <SuperadminPageHeader
        title="Settings"
        description="Manage platform-wide settings, plans, payments, POS types, announcements, and business controls."
      >
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </SuperadminPageHeader>

      {success ? <Card className="mb-5 border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-700"><BadgeCheck className="mr-2 inline h-4 w-4" />{success}</Card> : null}
      {error ? <Card className="mb-5 flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-destructive"><AlertCircle className="mt-0.5 h-5 w-5" /><p className="text-sm">{error}</p></Card> : null}

      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${activeTab === tab.key ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {renderCurrentTab()}

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" className="flex-1 bg-black/50" aria-label="Close drawer" onClick={closeDrawer} />
          <aside className="flex h-full w-full max-w-lg flex-col bg-background shadow-xl">
            <div className="flex items-start justify-between border-b p-5">
              <h2 className="text-xl font-semibold text-foreground">{drawerMode === 'create' ? 'Add' : 'Edit'} {drawerConfigs[drawerType].title}</h2>
              <Button variant="ghost" size="icon" onClick={closeDrawer}><X className="h-5 w-5" /></Button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {drawerConfigs[drawerType].fields.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={drawerValues[field.key] ?? null}
                  onChange={(value) => setDrawerValues((current) => ({ ...current, [field.key]: value }))}
                />
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t p-5">
              <Button variant="outline" onClick={closeDrawer}>Cancel</Button>
              <Button onClick={() => void handleDrawerSubmit()}>{drawerMode === 'create' ? 'Create' : 'Save Changes'}</Button>
            </div>
          </aside>
        </div>
      ) : null}
    </SuperadminShell>
  );

  function SimpleRows({
    title,
    rows,
    emptyText,
    addLabel,
    onAdd,
    seedType,
    columns,
    type,
  }: {
    title: string;
    rows: EditableRow[];
    emptyText: string;
    addLabel: string;
    onAdd: () => void;
    seedType: string | null;
    columns: string[];
    type: DrawerType;
  }) {
    return (
      <TableSection title={title} description="" isEmpty={rows.length === 0} seedType={seedType} seeding={seeding} onSeed={handleSeed} onAdd={onAdd} addLabel={addLabel}>
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>{columns.map((column) => <th key={column} className="px-3 py-2 text-left">{column.replace(/_/g, ' ')}</th>)}<th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const record = row as unknown as Record<string, FieldValue>;
              return (
                <tr key={row.id} className="border-b">
                  {columns.map((column) => <td key={column} className="px-3 py-3">{formatCell(record[column])}</td>)}
                  <td className="px-3 py-3">{actionButtons(type, row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableSection>
    );
  }

  function TableSection({
    title,
    description,
    isEmpty,
    seedType,
    seeding: seedState,
    onSeed,
    onAdd,
    addLabel,
    children,
  }: {
    title: string;
    description: string;
    isEmpty: boolean;
    seedType: string | null;
    seeding: string | null;
    onSeed: (type: string) => void;
    onAdd: () => void;
    addLabel?: string;
    children: React.ReactNode;
  }) {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div>
            <h2 className="font-semibold text-foreground">{title}</h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <div className="flex gap-2">
            {seedType && isEmpty ? (
              <Button variant="outline" onClick={() => onSeed(seedType)} disabled={seedState === seedType}>
                {seedState === seedType ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Seed Defaults
              </Button>
            ) : null}
            <Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />{addLabel || 'Add'}</Button>
          </div>
        </div>
        {isEmpty ? <div className="p-8 text-center text-sm text-muted-foreground">No records found.</div> : <div className="overflow-x-auto p-5">{children}</div>}
      </Card>
    );
  }
}

function InfoBanner({ text }: { text: string }) {
  return <Card className="border-blue-500/30 bg-blue-500/5 p-4 text-sm text-blue-900">{text}</Card>;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: DrawerField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span className="font-medium text-foreground">{field.label}</span>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-foreground">{field.label}</span>
        <textarea className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={asString(value)} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-foreground">{field.label}</span>
        <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={asString(value)} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => <option key={option} value={option}>{option || 'None'}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'multicheck') {
    const current = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{field.label}</p>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((option) => {
            const active = current.includes(option);
            return (
              <button key={option} type="button" className={`rounded-full border px-2.5 py-1 text-xs ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground'}`} onClick={() => onChange(active ? current.filter((item) => item !== option) : [...current, option])}>
                {option}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-foreground">{field.label}</span>
      <Input type={field.type === 'number' ? 'number' : 'text'} value={asString(value)} onChange={(event) => onChange(field.type === 'number' ? event.target.value : event.target.value)} />
    </label>
  );
}

function formatCell(value: FieldValue | undefined) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || '-';
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}
