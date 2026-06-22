import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn('Supabase env vars missing. Cloud mode unavailable.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface StoreRow {
  id: string;
  owner_id: string;
  store_name: string;
  store_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone_number: string | null;
  pos_type: string | null;
  has_fuel: boolean;
  register_count: number;
  created_at: string;
}

export interface UploadBatchRow {
  id: string;
  store_id: string;
  upload_type: 'transactions' | 'products';
  file_name: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  store_id: string;
  batch_id: string | null;
  transaction_id: string;
  transaction_time: string;
  register_id: number | null;
  cashier_id: string | null;
  upc: string | null;
  item_name: string | null;
  category: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total_amount: number;
  payment_type: string | null;
  transaction_type: string;
  card_network: string | null;
  exception_reason: string | null;
  fuel_grade: string | null;
  created_at: string;
}

export interface ProductRow {
  id: string;
  store_id: string;
  batch_id: string | null;
  upc: string;
  item_name: string | null;
  category: string | null;
  department: string | null;
  sku: string | null;
  brand: string | null;
  cost_price: number;
  selling_price: number;
  stock: number;
  reorder_level: number;
  vendor: string | null;
  tax_rate: number;
  tax_category: string | null;
  taxable: boolean;
  ebt_eligible: boolean;
  is_active: boolean;
  notes: string | null;
  units_per_case: number;
  cases_on_hand: number;
  loose_units: number;
  created_at: string;
  updated_at: string;
}

export interface StoreSettingsRow {
  id: string;
  store_id: string;
  default_tax_rate: number;
  default_tax_category: string;
  default_reorder_level: number;
  currency_code: string;
  price_rounding: string;
  created_at: string;
  updated_at: string;
}

export interface StoreDepartmentRow {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  default_tax_rate: number;
  ebt_eligible: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaxCategoryRow {
  id: string;
  store_id: string;
  name: string;
  rate: number;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoreVendorRow {
  id: string;
  store_id: string;
  vendor_name: string;
  sales_rep_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromotionRow {
  id: string;
  store_id: string;
  name: string;
  deal_type: string;
  quantity_required: number;
  deal_price: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromotionProductRow {
  id: string;
  store_id: string;
  promotion_id: string;
  product_id: string | null;
  upc: string;
  item_name: string | null;
  created_at: string;
}